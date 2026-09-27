-- Source only. Apply later to an explicitly verified QA project before production.
BEGIN;
ALTER TABLE public.revenuecat_webhook_events
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.user_ownership
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN revenuecat_request_date_ms bigint,
  ADD COLUMN revenuecat_project_id text,
  ADD COLUMN revenuecat_app_id text,
  ADD COLUMN verification_reason text;

CREATE TABLE private.revenuecat_sync_leases (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE private.revenuecat_verifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  state jsonb NOT NULL
);
CREATE INDEX revenuecat_verifications_user_time ON private.revenuecat_verifications(user_id, verified_at DESC);
ALTER TABLE private.revenuecat_sync_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.revenuecat_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.revenuecat_sync_leases, private.revenuecat_verifications FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.revenuecat_verifications TO service_role;

CREATE FUNCTION public.revenuecat_claim_event(p_event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.revenuecat_webhook_events%ROWTYPE; t uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.revenuecat_webhook_events(event_id,event_type,app_user_id,original_app_user_id,environment,store,product_id,entitlement_ids,metadata)
  VALUES(p_event->>'id',p_event->>'type',p_event->>'appUserId',p_event->>'originalAppUserId',p_event->>'environment',p_event->>'store',p_event->>'productId',
    ARRAY(SELECT jsonb_array_elements_text(p_event->'entitlementIds')),
    jsonb_build_object('app_id',p_event->>'appId','event_timestamp_ms',p_event->'eventTimestampMs',
      'transferred_from',p_event->'transferredFrom','transferred_to',p_event->'transferredTo'))
  ON CONFLICT(event_id) DO NOTHING;
  SELECT * INTO e FROM public.revenuecat_webhook_events WHERE event_id=p_event->>'id' FOR UPDATE;
  IF e.status IN ('processed','ignored') OR (e.status='processing' AND e.lease_expires_at > now()) THEN
    RETURN jsonb_build_object('token',NULL,'status',e.status);
  END IF;
  UPDATE public.revenuecat_webhook_events SET status='processing', lease_token=t,
    lease_expires_at=now()+interval '120 seconds', attempt_count=attempt_count+1,
    error_code=NULL, processed_at=NULL WHERE event_id=e.event_id;
  RETURN jsonb_build_object('token',t,'status','processing');
END $$;

CREATE FUNCTION public.revenuecat_finish_event(p_event_id text,p_token uuid,p_status text,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_status NOT IN ('failed','ignored') THEN RAISE EXCEPTION 'invalid_terminal_status'; END IF;
  UPDATE public.revenuecat_webhook_events SET status=p_status,error_code=p_error,
    processed_at=now(),lease_expires_at=NULL
    WHERE event_id=p_event_id AND lease_token=p_token AND status='processing' AND lease_expires_at>now();
END $$;

CREATE FUNCTION public.revenuecat_begin_sync(p_user_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid; t uuid:=gen_random_uuid(); n integer;
BEGIN
  IF cardinality(p_user_ids) IS NULL OR cardinality(p_user_ids) NOT BETWEEN 1 AND 20
    OR array_position(p_user_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'invalid_identities'; END IF;
  -- Acquire every transfer participant in a deterministic order before any API lookup.
  FOR u IN SELECT DISTINCT unnest(p_user_ids) ORDER BY 1 LOOP
    IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=u) THEN RAISE EXCEPTION 'profile_not_found'; END IF;
    INSERT INTO private.revenuecat_sync_leases(user_id,token,expires_at) VALUES(u,t,now()+interval '120 seconds')
    ON CONFLICT(user_id) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at
      WHERE private.revenuecat_sync_leases.expires_at<=now();
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'reconciliation_busy'; END IF;
  END LOOP;
  RETURN t;
END $$;

CREATE FUNCTION public.revenuecat_release_sync(p_token uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM private.revenuecat_sync_leases WHERE token=p_token;
$$;

CREATE FUNCTION public.revenuecat_apply_sync(p_token uuid,p_states jsonb,p_event_id text DEFAULT NULL,p_event_lease uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb; u uuid; l jsonb; old public.user_ownership%ROWTYPE; v_status text;
  expected integer; actual integer; result jsonb;
BEGIN
  IF jsonb_typeof(p_states)<>'array' OR jsonb_array_length(p_states) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid_states'; END IF;
  IF p_event_id IS NOT NULL THEN
    PERFORM 1 FROM public.revenuecat_webhook_events WHERE event_id=p_event_id AND lease_token=p_event_lease
      AND status='processing' AND lease_expires_at>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'event_lease_lost'; END IF;
  END IF;
  SELECT count(*) INTO expected FROM private.revenuecat_sync_leases WHERE token=p_token;
  SELECT count(DISTINCT value->>'user_id') INTO actual FROM jsonb_array_elements(p_states);
  IF actual<>expected OR actual<>jsonb_array_length(p_states) THEN RAISE EXCEPTION 'lease_membership_mismatch'; END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(p_states) ORDER BY value->>'user_id' LOOP
    u:=(s->>'user_id')::uuid;
    PERFORM 1 FROM private.revenuecat_sync_leases WHERE user_id=u AND token=p_token AND expires_at>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sync_lease_lost'; END IF;
    PERFORM 1 FROM public.user_profiles WHERE id=u FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
    SELECT * INTO old FROM public.user_ownership WHERE user_id=u FOR UPDATE;
    IF (s->>'request_date_ms')::bigint IS NULL OR (s->>'request_date_ms')::bigint <= COALESCE(old.revenuecat_request_date_ms,0) THEN
      RAISE EXCEPTION 'stale_canonical_state';
    END IF;
    IF s->>'environment' NOT IN ('production','sandbox') OR nullif(s->>'project_id','') IS NULL
      OR jsonb_typeof(s->'owned') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_projection'; END IF;
    IF old.ownership_environment IS NOT NULL AND old.ownership_environment<>s->>'environment' THEN
      RAISE EXCEPTION 'projection_environment_mismatch';
    END IF;
    v_status:=CASE WHEN (s->>'owned')::boolean THEN 'owned'
      WHEN old.ownership_status IN ('owned','revoked') OR s->>'product_id' IS NOT NULL THEN 'revoked' ELSE 'none' END;
    IF v_status='owned' AND (nullif(s->>'product_id','') IS NULL OR (s->>'acquired_at')::timestamptz IS NULL
      OR (s->>'acquired_at')::timestamptz>now() OR (s->>'expires_at')::timestamptz<=now()) THEN RAISE EXCEPTION 'invalid_owned_projection'; END IF;
    INSERT INTO public.user_ownership(user_id,ownership_status,revenuecat_entitlement_id,revenuecat_product_id,revenuecat_customer_id,
      ownership_source,ownership_environment,acquired_at,last_verified_at,revoked_at,last_event_id,updated_at,
      expires_at,revenuecat_request_date_ms,revenuecat_project_id,revenuecat_app_id,verification_reason)
    VALUES(u,v_status,CASE WHEN v_status='none' THEN NULL ELSE 'coverly_owned' END,COALESCE(s->>'product_id',old.revenuecat_product_id),u::text,
      'revenuecat',s->>'environment',COALESCE((s->>'acquired_at')::timestamptz,old.acquired_at),now(),
      CASE WHEN v_status='revoked' THEN COALESCE(old.revoked_at,now()) ELSE NULL END,COALESCE(p_event_id,old.last_event_id),now(),
      (s->>'expires_at')::timestamptz,(s->>'request_date_ms')::bigint,s->>'project_id',COALESCE(s->>'app_id',old.revenuecat_app_id),s->>'reason')
    ON CONFLICT(user_id) DO UPDATE SET ownership_status=EXCLUDED.ownership_status,revenuecat_entitlement_id=EXCLUDED.revenuecat_entitlement_id,
      revenuecat_product_id=EXCLUDED.revenuecat_product_id,revenuecat_customer_id=EXCLUDED.revenuecat_customer_id,
      ownership_source=EXCLUDED.ownership_source,ownership_environment=EXCLUDED.ownership_environment,acquired_at=EXCLUDED.acquired_at,
      last_verified_at=EXCLUDED.last_verified_at,revoked_at=EXCLUDED.revoked_at,last_event_id=EXCLUDED.last_event_id,updated_at=EXCLUDED.updated_at,
      expires_at=EXCLUDED.expires_at,revenuecat_request_date_ms=EXCLUDED.revenuecat_request_date_ms,
      revenuecat_project_id=EXCLUDED.revenuecat_project_id,revenuecat_app_id=EXCLUDED.revenuecat_app_id,verification_reason=EXCLUDED.verification_reason;
    l:=s->'legacy';
    -- Avoid introducing an inactive native provider for a Stripe-only profile.
    -- Previously native profiles still receive canonical expiration/removal.
    UPDATE public.user_profiles SET revenuecat_customer_id=u::text,
      revenuecat_product_id=l->>'revenuecat_product_id',revenuecat_entitlement_id=l->>'revenuecat_entitlement_id',
      revenuecat_status=l->>'revenuecat_status',revenuecat_expiration_at=(l->>'revenuecat_expiration_at')::timestamptz,
      revenuecat_last_event_id=COALESCE(p_event_id,revenuecat_last_event_id),revenuecat_updated_at=now(),
      subscription_plan=l->>'subscription_plan',subscription_status=l->>'subscription_status',
      subscription_period_end=(l->>'subscription_period_end')::timestamptz,updated_at=now()
      WHERE id=u AND (l->>'subscription_plan' IN ('coverly_plus','coverly_family') OR revenuecat_status IS NOT NULL);
    INSERT INTO private.revenuecat_verifications(user_id,event_id,state) VALUES(u,p_event_id,s);
    result:=private.resolve_coverly_access(u);
  END LOOP;
  IF p_event_id IS NOT NULL THEN
    UPDATE public.revenuecat_webhook_events SET status='processed',processed_at=now(),lease_expires_at=NULL,
      profile_id=CASE WHEN actual=1 THEN u ELSE NULL END,
      metadata=metadata||jsonb_build_object('canonical_synced',true,'affected_user_count',actual)
      WHERE event_id=p_event_id;
  END IF;
  DELETE FROM private.revenuecat_sync_leases WHERE token=p_token;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.revenuecat_claim_event(jsonb), public.revenuecat_finish_event(text,uuid,text,text),
  public.revenuecat_begin_sync(uuid[]), public.revenuecat_release_sync(uuid), public.revenuecat_apply_sync(uuid,jsonb,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revenuecat_claim_event(jsonb), public.revenuecat_finish_event(text,uuid,text,text),
  public.revenuecat_begin_sync(uuid[]), public.revenuecat_release_sync(uuid), public.revenuecat_apply_sync(uuid,jsonb,text,uuid)
  TO service_role;

COMMENT ON TABLE public.user_ownership IS 'Server canonical RevenueCat projection. Lifetime ownership has null expiry. Only verified canonical removal revokes. Full verification history is private.revenuecat_verifications.';
-- Preserve the foundation access contract; additionally enforce a known finite expiry.
CREATE OR REPLACE FUNCTION private.resolve_coverly_access(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.user_profiles%ROWTYPE;
  o public.user_ownership%ROWTYPE;
  v_status text;
  v_verification text;
  v_owned boolean;
  v_override_live boolean;
  v_override text := 'none';
  v_override_plan text;
  v_legacy text;
  v_candidate text;
  v_class text := 'free';
  v_plan text := 'free';
  v_ai text := 'free';
  v_limit integer := 1;
  v_count integer;
  v_claim boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO p FROM public.user_profiles WHERE id = p_user_id;
  SELECT * INTO o FROM public.user_ownership WHERE user_id = p_user_id;
  v_status := COALESCE(o.ownership_status, 'none');
  v_owned := COALESCE(v_status = 'owned'
    AND o.revenuecat_entitlement_id = 'coverly_owned'
    AND o.ownership_source = 'revenuecat'
    AND o.ownership_environment IN ('production', 'sandbox')
    AND NULLIF(btrim(o.revenuecat_product_id), '') IS NOT NULL
    AND NULLIF(btrim(o.revenuecat_customer_id), '') IS NOT NULL
    AND o.acquired_at IS NOT NULL AND o.acquired_at <= o.last_verified_at
    AND o.last_verified_at <= now() AND o.revoked_at IS NULL
    AND (o.expires_at IS NULL OR o.expires_at > now()), false);
  v_verification := CASE WHEN v_owned THEN 'verified'
    WHEN v_status = 'revoked' THEN 'revoked'
    WHEN v_status = 'owned' THEN 'unverified' ELSE 'not_owned' END;

  v_override_live := COALESCE(p.access_override_status = 'active'
    AND NULLIF(p.access_override_plan, '') IS NOT NULL
    AND (p.access_override_expires_at IS NULL OR p.access_override_expires_at > now()), false);
  v_override_plan := lower(COALESCE(p.access_override_plan, ''));

  -- Transitional subscriptions: a provider's explicit inactive/expired state
  -- defeats stale plan strings. Status-less legacy grants remain compatible.
  IF NULLIF(p.revenuecat_status, '') IS NOT NULL THEN
    IF p.revenuecat_status IN ('active', 'trialing')
      AND (p.revenuecat_expiration_at IS NULL OR p.revenuecat_expiration_at > now()) THEN
      v_candidate := COALESCE(NULLIF(p.subscription_plan, ''), NULLIF(p.revenuecat_entitlement_id, ''),
        NULLIF(p.revenuecat_product_id, ''), p.plan);
    END IF;
  ELSIF NULLIF(p.subscription_status, '') IS NOT NULL THEN
    IF (p.subscription_status IN ('active', 'trialing')
        AND (p.subscription_period_end IS NULL OR p.subscription_period_end > now()))
      OR (p.subscription_status = 'past_due' AND p.subscription_period_end > now() - interval '7 days') THEN
      v_candidate := COALESCE(NULLIF(p.subscription_plan, ''), p.plan);
    END IF;
  ELSE
    v_candidate := p.plan;
  END IF;
  IF lower(v_candidate) LIKE '%family%' THEN v_legacy := 'coverly_family';
  ELSIF lower(v_candidate) LIKE '%plus%' THEN v_legacy := 'coverly_plus'; END IF;

  IF p.app_role = 'admin' THEN
    v_override := 'admin'; v_class := 'admin'; v_plan := 'admin';
    v_ai := 'admin'; v_limit := NULL; v_claim := true;
  ELSIF p.plan = 'tester' OR (v_override_live AND
    (v_override_plan = 'tester' OR lower(COALESCE(p.access_override_reason, '')) LIKE 'tester access%')) THEN
    v_override := 'tester'; v_class := 'tester'; v_plan := 'coverly_plus';
    v_ai := 'tester'; v_limit := NULL; v_claim := true;
  ELSIF v_override_live AND v_override_plan IN ('free', 'plus', 'family', 'coverly_plus', 'coverly_family') THEN
    v_override := 'support'; v_class := 'override'; v_ai := 'override';
    v_plan := CASE WHEN v_override_plan IN ('family', 'coverly_family') THEN 'coverly_family'
      WHEN v_override_plan IN ('plus', 'coverly_plus') THEN 'coverly_plus' ELSE 'free' END;
    v_limit := CASE WHEN v_plan = 'coverly_family' THEN NULL ELSE 1 END;
    v_claim := v_plan <> 'free';
  ELSIF v_owned THEN
    v_class := 'owner'; v_plan := 'coverly_owned'; v_ai := 'owned'; v_limit := 5; v_claim := true;
  ELSIF v_status = 'none' AND v_legacy IS NOT NULL THEN
    v_plan := v_legacy; v_claim := true;
    v_class := CASE WHEN v_legacy = 'coverly_family' THEN 'legacy_family' ELSE 'legacy_plus' END;
    v_ai := v_class;
    v_limit := CASE WHEN v_legacy = 'coverly_family' THEN NULL ELSE 1 END;
  END IF;
  -- Revoked or incomplete owned projections never fall back to stale paid fields.
  SELECT count(*)::integer INTO v_count FROM public.inventory_files WHERE user_id = p_user_id;
  RETURN jsonb_build_object(
    'contract_version', 1, 'access_class', v_class, 'effective_plan', v_plan,
    'owns_coverly', v_owned, 'ownership_status', v_status, 'ownership_verification', v_verification,
    'legacy_plan', v_legacy, 'override_type', v_override,
    'property_limit', v_limit, 'property_count', v_count,
    'can_create_property', v_limit IS NULL OR v_count < v_limit,
    'can_export_claim_pack', v_claim, 'can_manage_inventory', true, 'can_access_evidence', true,
    'ai_policy_class', v_ai,
    'ai_requires_metering', v_override = 'none' OR v_plan = 'free',
    'legacy_compatibility', v_status = 'none' AND v_legacy IS NOT NULL AND v_override = 'none'
  );
END;
$$;
COMMIT;
