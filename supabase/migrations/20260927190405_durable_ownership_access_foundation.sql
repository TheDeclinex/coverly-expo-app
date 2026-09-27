-- Code-only ownership foundation. Review in QA before any separately approved deploy.
-- No subscription backfill, store writes, quota changes or inventory read-policy changes.
BEGIN;

CREATE TABLE public.user_ownership (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ownership_status text NOT NULL DEFAULT 'none'
    CHECK (ownership_status IN ('none', 'owned', 'revoked')),
  revenuecat_entitlement_id text,
  revenuecat_product_id text,
  revenuecat_customer_id text,
  ownership_source text CHECK (ownership_source IN ('revenuecat')),
  ownership_environment text CHECK (ownership_environment IN ('production', 'sandbox')),
  acquired_at timestamptz,
  last_verified_at timestamptz,
  revoked_at timestamptz,
  last_event_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ownership_status <> 'revoked' OR revoked_at IS NOT NULL)
);
ALTER TABLE public.user_ownership OWNER TO postgres;
ALTER TABLE public.user_ownership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_ownership FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_ownership TO service_role;
COMMENT ON TABLE public.user_ownership IS
  'Server-verified durable purchase projection. No client writes or subscription backfill. Future reconciler must validate customer/user and project/environment attribution before writing.';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- The only access decision implementation. Arbitrary-user entry is private.
-- VOLATILE is intentional: property counts must refresh after the creation lock,
-- including direct multi-row inserts. Durable ownership has no subscription TTL.
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
    AND o.last_verified_at <= now() AND o.revoked_at IS NULL, false);
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
ALTER FUNCTION private.resolve_coverly_access(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.resolve_coverly_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.resolve_coverly_access(uuid) TO service_role;

-- Authenticated clients can resolve only themselves; no supplied user ID.
CREATE OR REPLACE FUNCTION public.get_my_access_capabilities()
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.resolve_coverly_access(auth.uid()); $$;

-- Legacy string adapters deliberately keep coverly_owned distinct from Plus:
-- existing usage accounting must not interpret ownership as paid AI bypass.
CREATE OR REPLACE FUNCTION public.get_my_effective_plan()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.get_my_access_capabilities()->>'effective_plan'; $$;

CREATE OR REPLACE FUNCTION public.coverly_effective_plan_from_profile(p_profile jsonb)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT CASE WHEN NULLIF(p_profile->>'id', '') IS NULL THEN 'free'
  ELSE private.resolve_coverly_access((p_profile->>'id')::uuid)->>'effective_plan' END; $$;

CREATE OR REPLACE FUNCTION public.admin_effective_plan_from_profile(p_profile jsonb)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.coverly_effective_plan_from_profile(p_profile); $$;

CREATE OR REPLACE FUNCTION public.admin_tester_status_from_profile(p_profile jsonb)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT CASE WHEN NULLIF(p_profile->>'id', '') IS NULL THEN 'not_tester'
  WHEN private.resolve_coverly_access((p_profile->>'id')::uuid)->>'override_type' = 'tester'
    THEN 'active' ELSE 'not_tester' END; $$;

-- Existing load_my_profile and admin RPCs already call the two adapters above.
-- Keep property RPC column names/types for released clients. Limits/eligibility
-- come directly from the resolver; only the old label is translated here.
CREATE OR REPLACE FUNCTION public.coverly_property_access_class_for_user(p_user_id uuid)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT access_class FROM public.coverly_property_allowance_for_user(p_user_id); $$;

CREATE OR REPLACE FUNCTION public.coverly_property_allowance_for_user(p_user_id uuid)
RETURNS TABLE(access_class text, property_count integer, property_limit integer,
  can_create_property boolean, required_plan text, block_reason text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE a jsonb := private.resolve_coverly_access(p_user_id); v_class text;
BEGIN
  v_class := CASE a->>'access_class'
    WHEN 'admin' THEN 'full_access' WHEN 'tester' THEN 'full_access'
    WHEN 'legacy_plus' THEN 'plus' WHEN 'legacy_family' THEN 'family'
    WHEN 'override' THEN CASE a->>'effective_plan' WHEN 'coverly_family' THEN 'family'
      WHEN 'coverly_plus' THEN 'plus' ELSE 'free' END
    ELSE a->>'access_class' END;
  RETURN QUERY SELECT v_class, (a->>'property_count')::integer,
    (a->>'property_limit')::integer, (a->>'can_create_property')::boolean,
    CASE WHEN (a->>'can_create_property')::boolean THEN NULL::text ELSE 'coverly_family' END,
    CASE WHEN (a->>'can_create_property')::boolean THEN NULL::text ELSE 'property_limit_reached' END;
END;
$$;
-- Both existing create_my_property overloads and the direct-insert trigger
-- already lock, then call this allowance. Leave country/currency/owner checks intact.
-- No inventory read/update policies change: exceeding a limit only blocks creation.

ALTER FUNCTION public.get_my_access_capabilities() OWNER TO postgres;
ALTER FUNCTION public.get_my_effective_plan() OWNER TO postgres;
ALTER FUNCTION public.coverly_effective_plan_from_profile(jsonb) OWNER TO postgres;
ALTER FUNCTION public.admin_effective_plan_from_profile(jsonb) OWNER TO postgres;
ALTER FUNCTION public.admin_tester_status_from_profile(jsonb) OWNER TO postgres;
ALTER FUNCTION public.coverly_property_access_class_for_user(uuid) OWNER TO postgres;
ALTER FUNCTION public.coverly_property_allowance_for_user(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_access_capabilities() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_effective_plan() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coverly_effective_plan_from_profile(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_effective_plan_from_profile(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tester_status_from_profile(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coverly_property_access_class_for_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coverly_property_allowance_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_access_capabilities() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_effective_plan() TO authenticated, service_role;
COMMIT;
