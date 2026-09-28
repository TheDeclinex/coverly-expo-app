-- Source only. Requires coordinated function rollout; old mutation RPCs are retired.
BEGIN;
ALTER TABLE public.app_settings ADD COLUMN usage_feature_policies jsonb NOT NULL DEFAULT
 '{"ai_scan":{"owner_limit":10,"resource":"property","operations":{"single_photo_scan":1,"multi_photo_scan":3,"video_frame_scan":3}},"replacement_pricing":{"owner_limit":5,"resource":"item","operations":{"search":1}}}'::jsonb;
COMMENT ON COLUMN public.app_settings.usage_feature_policies IS
 'Provisional owner limits equal Free safety defaults, NOT commercial promises. Free existing columns remain authoritative. Additional features use free_limit/owner_limit/resource/operations here.';
-- Read access and existing role-checked admin SECURITY DEFINER setters remain.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.app_settings FROM PUBLIC,anon,authenticated;
ALTER TABLE public.feature_usage_monthly DROP CONSTRAINT feature_usage_monthly_feature_check;
ALTER TABLE public.feature_usage_reservations DROP CONSTRAINT feature_usage_reservations_feature_check;
ALTER TABLE public.feature_usage_reservations DROP CONSTRAINT feature_usage_reservations_status_check;
ALTER TABLE public.feature_usage_reservations ADD CONSTRAINT feature_usage_reservations_status_check
 CHECK(status IN ('reserved','processing','committed','refunded','expired','denied'));
ALTER TABLE public.feature_usage_reservations
 ADD COLUMN input_fingerprint text,
 ADD COLUMN resource_id text,
 ADD COLUMN execution_token uuid,
 ADD COLUMN policy_class text,
 ADD COLUMN ledger_version integer NOT NULL DEFAULT 1,
 ADD COLUMN duplicate_count integer NOT NULL DEFAULT 0,
 ADD COLUMN fingerprint_conflicts integer NOT NULL DEFAULT 0;
ALTER TABLE public.feature_usage_reservations ALTER COLUMN ledger_version SET DEFAULT 2;
-- Retain historic counters and reservations. Release pre-upgrade uncommitted work.
WITH released AS (
 UPDATE public.feature_usage_reservations SET status='expired',refund_reason='ledger_upgrade'
 WHERE status='reserved' RETURNING *
), totals AS (
 SELECT user_id,feature,month_key,sum(units)::integer units FROM released WHERE NOT is_bypassed GROUP BY 1,2,3
)
UPDATE public.feature_usage_monthly m SET reserved_units=greatest(0,m.reserved_units-t.units),updated_at=now()
 FROM totals t WHERE m.user_id=t.user_id AND m.feature=t.feature AND m.month_key=t.month_key;
CREATE INDEX feature_usage_active_expiry ON public.feature_usage_reservations(user_id,expires_at) WHERE status IN ('reserved','processing');

CREATE TABLE private.feature_provider_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reservation_id uuid NOT NULL REFERENCES public.feature_usage_reservations(id) ON DELETE CASCADE,
 attempt_key text NOT NULL CHECK(length(attempt_key) BETWEEN 1 AND 80),
 status text NOT NULL CHECK(status IN ('started','succeeded','failed')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 http_status integer,
 UNIQUE(reservation_id,attempt_key)
);
ALTER TABLE private.feature_provider_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.feature_provider_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.feature_provider_attempts TO service_role;
REVOKE ALL ON public.feature_usage_monthly,public.feature_usage_reservations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.feature_usage_monthly,public.feature_usage_reservations TO service_role;
-- No compatibility alias may retain the old client-write hole.
REVOKE ALL ON FUNCTION public.reserve_my_feature_usage(text,text,text,jsonb),public.commit_my_feature_usage(uuid),
 public.refund_my_feature_usage(uuid,text),public.expire_feature_usage_reservations(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.usage_policy(p_user_id uuid,p_feature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb; cfg jsonb; lim integer; bypass boolean; cls text; mode text;
BEGIN
 a:=private.resolve_coverly_access(p_user_id); cls:=a->>'ai_policy_class';
 SELECT usage_feature_policies->p_feature INTO cfg FROM public.app_settings WHERE id=1;
 IF cfg IS NULL OR jsonb_typeof(cfg->'operations')<>'object' THEN RAISE EXCEPTION 'unsupported_feature'; END IF;
 bypass:=cls IN ('legacy_plus','legacy_family','admin','tester') OR (cls='override' AND NOT (a->>'ai_requires_metering')::boolean);
 IF cls='owned' THEN lim:=(cfg->>'owner_limit')::integer;
 ELSIF p_feature='ai_scan' THEN SELECT free_ai_scan_monthly_limit INTO lim FROM public.app_settings WHERE id=1;
 ELSIF p_feature='replacement_pricing' THEN SELECT free_replacement_pricing_monthly_limit INTO lim FROM public.app_settings WHERE id=1;
 ELSE lim:=(cfg->>'free_limit')::integer; END IF;
 IF lim IS NULL OR lim<0 THEN RAISE EXCEPTION 'invalid_usage_policy'; END IF;
 mode:=public.get_entitlement_mode();
 IF mode NOT IN ('open','dry_run','enforced') OR mode IS NULL THEN RAISE EXCEPTION 'invalid_entitlement_mode'; END IF;
 RETURN jsonb_build_object('policy_class',cls,'effective_plan',a->>'effective_plan','bypass',bypass,
  'limit_units',lim,'mode',mode,'operations',cfg->'operations','resource',cfg->>'resource');
END $$;

CREATE FUNCTION private.expire_usage_work(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('usage:'||p_user_id::text,0));
 WITH expired AS (
  UPDATE public.feature_usage_reservations SET status='expired',refund_reason='execution_lease_expired'
  WHERE user_id=p_user_id AND status IN ('reserved','processing') AND expires_at<=now() RETURNING *
 ), totals AS (SELECT user_id,feature,month_key,sum(units)::integer units FROM expired
    WHERE ledger_version=2 OR NOT is_bypassed GROUP BY 1,2,3)
 UPDATE public.feature_usage_monthly m SET reserved_units=greatest(0,m.reserved_units-t.units),updated_at=now()
 FROM totals t WHERE m.user_id=t.user_id AND m.feature=t.feature AND m.month_key=t.month_key;
END $$;

CREATE FUNCTION public.reserve_feature_usage(p_user_id uuid,p_feature text,p_operation text,p_key text,p_fingerprint text,p_resource_id text,p_metadata jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pol jsonb; r public.feature_usage_reservations%ROWTYPE; m public.feature_usage_monthly%ROWTYPE;
 units integer; lim integer; blocked boolean; allowed boolean; month text; code text;
BEGIN
 IF p_user_id IS NULL OR p_resource_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_user_id) THEN RAISE EXCEPTION 'invalid_usage_identity'; END IF;
 IF p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 1 AND 200 OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' OR octet_length(p_metadata::text)>2048 THEN RAISE EXCEPTION 'invalid_operation_identity'; END IF;
 pol:=private.usage_policy(p_user_id,p_feature);
 IF pol->>'resource'='property' THEN
  IF NOT EXISTS(SELECT 1 FROM public.inventory_files WHERE id=p_resource_id AND user_id=p_user_id) THEN RAISE EXCEPTION 'resource_not_owned'; END IF;
 ELSIF pol->>'resource'='item' THEN
  IF NOT EXISTS(SELECT 1 FROM public.inventory_items i JOIN public.inventory_files f ON f.id=i.file_id WHERE i.id=p_resource_id AND f.user_id=p_user_id) THEN RAISE EXCEPTION 'resource_not_owned'; END IF;
 ELSE RAISE EXCEPTION 'invalid_resource_policy'; END IF;
 units:=(pol->'operations'->>p_operation)::integer; lim:=(pol->>'limit_units')::integer;
 IF units IS NULL OR units NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'unsupported_operation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('usage:'||p_user_id::text,0));
 PERFORM private.expire_usage_work(p_user_id);
 SELECT * INTO r FROM public.feature_usage_reservations WHERE user_id=p_user_id AND feature=p_feature AND idempotency_key=p_key FOR UPDATE;
 IF FOUND THEN
  code:=CASE WHEN r.input_fingerprint IS DISTINCT FROM p_fingerprint OR r.operation<>p_operation OR r.resource_id IS DISTINCT FROM p_resource_id THEN 'IDEMPOTENCY_CONFLICT'
   WHEN r.status IN ('reserved','processing') THEN 'OPERATION_IN_PROGRESS' WHEN r.status='committed' THEN 'OPERATION_COMPLETED'
   WHEN r.status='refunded' THEN 'OPERATION_REFUNDED' WHEN r.status='expired' THEN 'OPERATION_EXPIRED' ELSE 'OPERATION_DENIED' END;
  UPDATE public.feature_usage_reservations SET duplicate_count=duplicate_count+1,
   fingerprint_conflicts=fingerprint_conflicts+CASE WHEN code='IDEMPOTENCY_CONFLICT' THEN 1 ELSE 0 END WHERE id=r.id;
  RETURN jsonb_build_object('allowed',false,'execute',false,'code',code,'status',r.status,'reservation_id',r.id,'policy_class',r.policy_class);
 END IF;
 month:=public.feature_usage_current_month_key();
 INSERT INTO public.feature_usage_monthly(user_id,feature,month_key,month_start_date,limit_units,effective_plan_snapshot,entitlement_mode_snapshot)
 VALUES(p_user_id,p_feature,month,public.feature_usage_current_month_start_date(),lim,pol->>'effective_plan',pol->>'mode')
 ON CONFLICT(user_id,feature,month_key) DO UPDATE SET limit_units=EXCLUDED.limit_units,effective_plan_snapshot=EXCLUDED.effective_plan_snapshot,entitlement_mode_snapshot=EXCLUDED.entitlement_mode_snapshot
 RETURNING * INTO m;
 blocked:=NOT (pol->>'bypass')::boolean AND m.used_units+m.reserved_units+units>lim;
 allowed:=NOT blocked OR pol->>'mode'<>'enforced';
 IF allowed THEN UPDATE public.feature_usage_monthly SET reserved_units=reserved_units+units,updated_at=now() WHERE id=m.id RETURNING * INTO m; END IF;
 INSERT INTO public.feature_usage_reservations(user_id,feature,operation,idempotency_key,month_key,month_start_date,units,status,allowed,would_have_blocked,is_limited,is_bypassed,effective_plan,entitlement_mode,limit_units,used_units_at_reservation,reserved_units_at_reservation,metadata,expires_at,input_fingerprint,resource_id,execution_token,policy_class)
 VALUES(p_user_id,p_feature,p_operation,p_key,month,public.feature_usage_current_month_start_date(),units,CASE WHEN allowed THEN 'reserved' ELSE 'denied' END,allowed,blocked,
  NOT (pol->>'bypass')::boolean,(pol->>'bypass')::boolean,pol->>'effective_plan',pol->>'mode',lim,m.used_units,m.reserved_units,p_metadata,now()+interval '5 minutes',p_fingerprint,p_resource_id,gen_random_uuid(),pol->>'policy_class') RETURNING * INTO r;
 RETURN jsonb_build_object('allowed',allowed,'execute',allowed,'code',CASE WHEN allowed THEN 'EXECUTION_CLAIMED' WHEN r.policy_class='owned' THEN 'OWNER_FAIR_USE_EXHAUSTED' ELSE 'FREE_ALLOWANCE_EXHAUSTED' END,
  'reservation_id',r.id,'execution_token',CASE WHEN allowed THEN r.execution_token ELSE NULL END,'status',r.status,'feature',p_feature,'operation',p_operation,
  'policy_class',r.policy_class,'effective_plan',r.effective_plan,'entitlement_mode',r.entitlement_mode,'is_bypassed',r.is_bypassed,'would_have_blocked',blocked,
  'units',units,'used_units',m.used_units,'reserved_units',m.reserved_units,'limit_units',lim,'remaining_units',CASE WHEN r.is_bypassed THEN NULL ELSE greatest(0,lim-m.used_units-m.reserved_units) END,'expires_at',r.expires_at);
END $$;

CREATE FUNCTION public.start_feature_provider_attempt(p_user_id uuid,p_reservation_id uuid,p_token uuid,p_attempt text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.feature_usage_reservations%ROWTYPE; attempt uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('usage:'||p_user_id::text,0)); PERFORM private.expire_usage_work(p_user_id);
 SELECT * INTO r FROM public.feature_usage_reservations WHERE id=p_reservation_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR r.execution_token IS DISTINCT FROM p_token OR r.status NOT IN ('reserved','processing') THEN RETURN jsonb_build_object('execute',false,'code','EXECUTION_CLAIM_LOST'); END IF;
 INSERT INTO private.feature_provider_attempts(reservation_id,attempt_key,status) VALUES(r.id,p_attempt,'started')
 ON CONFLICT(reservation_id,attempt_key) DO NOTHING RETURNING id INTO attempt;
 IF attempt IS NULL THEN RETURN jsonb_build_object('execute',false,'code','PROVIDER_ATTEMPT_ALREADY_STARTED'); END IF;
 UPDATE public.feature_usage_reservations SET status='processing' WHERE id=r.id;
 RETURN jsonb_build_object('execute',true,'attempt_id',attempt);
END $$;

CREATE FUNCTION public.finish_feature_provider_attempt(p_user_id uuid,p_reservation_id uuid,p_token uuid,p_attempt text,p_success boolean,p_http_status integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 -- Cost telemetry may finish after lease expiry; it cannot change customer counters.
 UPDATE private.feature_provider_attempts a SET status=CASE WHEN p_success THEN 'succeeded' ELSE 'failed' END,finished_at=now(),http_status=p_http_status
 FROM public.feature_usage_reservations r WHERE r.id=a.reservation_id AND r.id=p_reservation_id AND r.user_id=p_user_id
  AND r.execution_token=p_token AND a.attempt_key=p_attempt AND a.status='started';
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('ok',n=1);
END $$;

CREATE FUNCTION public.settle_feature_usage(p_user_id uuid,p_reservation_id uuid,p_token uuid,p_outcome text,p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.feature_usage_reservations%ROWTYPE; m public.feature_usage_monthly%ROWTYPE;
BEGIN
 IF p_outcome NOT IN ('committed','refunded') OR p_outcome IS NULL THEN RAISE EXCEPTION 'invalid_settlement'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('usage:'||p_user_id::text,0)); PERFORM private.expire_usage_work(p_user_id);
 SELECT * INTO r FROM public.feature_usage_reservations WHERE id=p_reservation_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR r.execution_token IS DISTINCT FROM p_token THEN RETURN jsonb_build_object('ok',false,'code','EXECUTION_CLAIM_LOST'); END IF;
 IF r.status=p_outcome THEN RETURN jsonb_build_object('ok',true,'status',r.status,'duplicate',true); END IF;
 IF r.status NOT IN ('reserved','processing') OR (p_outcome='committed' AND r.status<>'processing') THEN
  RETURN jsonb_build_object('ok',false,'code','EXECUTION_CLAIM_LOST','status',r.status); END IF;
 UPDATE public.feature_usage_monthly SET reserved_units=reserved_units-r.units,
  used_units=used_units+CASE WHEN p_outcome='committed' THEN r.units ELSE 0 END,updated_at=now()
 WHERE user_id=r.user_id AND feature=r.feature AND month_key=r.month_key;
 UPDATE public.feature_usage_reservations SET status=p_outcome,
  committed_at=CASE WHEN p_outcome='committed' THEN now() ELSE NULL END,
  refunded_at=CASE WHEN p_outcome='refunded' THEN now() ELSE NULL END,refund_reason=left(p_reason,120) WHERE id=r.id;
 SELECT * INTO m FROM public.feature_usage_monthly WHERE user_id=r.user_id AND feature=r.feature AND month_key=r.month_key;
 RETURN jsonb_build_object('ok',true,'status',p_outcome,'used_units',m.used_units,'reserved_units',m.reserved_units,
  'remaining_units',CASE WHEN r.is_bypassed THEN NULL ELSE greatest(0,r.limit_units-m.used_units-m.reserved_units) END);
END $$;

DROP FUNCTION public.load_my_usage_allowances();
CREATE FUNCTION public.load_my_usage_allowances() RETURNS TABLE(feature text,month_key text,month_start_date date,reset_at timestamptz,effective_plan text,entitlement_mode text,is_limited boolean,limit_units integer,used_units integer,reserved_units integer,remaining_units integer,would_be_blocked boolean,policy_class text,is_bypassed boolean,blocked boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); f text; pol jsonb; m public.feature_usage_monthly%ROWTYPE; lim integer; bypass boolean; would_block boolean;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 PERFORM private.expire_usage_work(u);
 FOR f IN SELECT jsonb_object_keys(usage_feature_policies) FROM public.app_settings WHERE id=1 LOOP
  pol:=private.usage_policy(u,f); lim:=(pol->>'limit_units')::integer; bypass:=(pol->>'bypass')::boolean;
  SELECT * INTO m FROM public.feature_usage_monthly x WHERE x.user_id=u AND x.feature=f AND x.month_key=public.feature_usage_current_month_key();
  would_block:=NOT bypass AND COALESCE(m.used_units,0)+COALESCE(m.reserved_units,0)>=lim;
  RETURN QUERY SELECT f,public.feature_usage_current_month_key(),public.feature_usage_current_month_start_date(),public.feature_usage_current_month_reset_at(),
   pol->>'effective_plan',pol->>'mode',NOT bypass,lim,COALESCE(m.used_units,0),COALESCE(m.reserved_units,0),
   CASE WHEN bypass THEN NULL::integer ELSE greatest(0,lim-COALESCE(m.used_units,0)-COALESCE(m.reserved_units,0)) END,
   would_block,pol->>'policy_class',bypass,would_block AND pol->>'mode'='enforced';
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.usage_policy(uuid,text),private.expire_usage_work(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.reserve_feature_usage(uuid,text,text,text,text,text,jsonb),public.start_feature_provider_attempt(uuid,uuid,uuid,text),
 public.finish_feature_provider_attempt(uuid,uuid,uuid,text,boolean,integer),public.settle_feature_usage(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_feature_usage(uuid,text,text,text,text,text,jsonb),public.start_feature_provider_attempt(uuid,uuid,uuid,text),
 public.finish_feature_provider_attempt(uuid,uuid,uuid,text,boolean,integer),public.settle_feature_usage(uuid,uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.load_my_usage_allowances() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.load_my_usage_allowances() TO authenticated;
COMMIT;
