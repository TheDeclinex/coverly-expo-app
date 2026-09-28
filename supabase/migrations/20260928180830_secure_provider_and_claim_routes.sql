-- Source only: coordinate with all remaining provider functions.
BEGIN;
UPDATE public.app_settings SET usage_feature_policies = usage_feature_policies ||
 '{"replacement_refinement":{"free_limit":5,"owner_limit":10,"resource":"item","operations":{"refine":1}}}'::jsonb WHERE id=1;
ALTER TABLE public.app_settings ADD COLUMN provider_route_limits jsonb NOT NULL DEFAULT
 '{"voice":{"minute":6,"hour":60,"day":120,"concurrent":2},"barcode":{"minute":10,"hour":100,"day":200,"concurrent":2},"refinement":{"minute":6,"hour":30,"day":60,"concurrent":2},"claim":{"minute":2,"hour":6,"day":20,"concurrent":1}}'::jsonb;
COMMENT ON COLUMN public.app_settings.provider_route_limits IS 'Provisional abuse controls, always enforced independently of monthly entitlement rollout mode. Voice routes share one bucket. No customer voice credits.';
-- Retain payment history; tokens cannot be self-granted or used as export authority.
REVOKE ALL ON public.claim_pack_tokens FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.claim_pack_tokens TO authenticated;
DROP POLICY IF EXISTS "Users manage own tokens" ON public.claim_pack_tokens;
CREATE POLICY claim_tokens_read_own ON public.claim_pack_tokens FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
REVOKE ALL ON SEQUENCE public.claim_pack_tokens_id_seq FROM PUBLIC,anon,authenticated;
-- Generated history must not be forged by mobile clients. Existing read access remains.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.claim_packs FROM PUBLIC,anon,authenticated;

CREATE TABLE private.provider_route_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 route text NOT NULL, operation_key text NOT NULL, fingerprint text NOT NULL, resource_id text,
 status text NOT NULL CHECK(status IN ('processing','completed','failed','expired')),
 token uuid NOT NULL, expires_at timestamptz NOT NULL, result jsonb,
 duplicates integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,route,operation_key)
);
CREATE TABLE private.provider_route_runs (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES private.provider_route_jobs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, bucket text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_runs_rate ON private.provider_route_runs(user_id,bucket,created_at);
CREATE INDEX provider_jobs_active ON private.provider_route_jobs(user_id,expires_at) WHERE status='processing';
CREATE TABLE private.provider_route_attempts (
 run_id uuid NOT NULL REFERENCES private.provider_route_runs(id) ON DELETE CASCADE, attempt text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, http_status integer,
 status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','succeeded','failed')),
 PRIMARY KEY(run_id,attempt)
);
ALTER TABLE private.provider_route_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.provider_route_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.provider_route_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.provider_route_jobs,private.provider_route_runs,private.provider_route_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.provider_route_jobs,private.provider_route_runs,private.provider_route_attempts TO service_role;

CREATE FUNCTION public.begin_provider_route(p_user_id uuid,p_route text,p_key text,p_fingerprint text,p_resource_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<route_control>>
DECLARE bucket text; cfg jsonb; j private.provider_route_jobs%ROWTYPE; token uuid; cap jsonb;
BEGIN
 IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_user_id) THEN RAISE EXCEPTION 'invalid_identity'; END IF;
 bucket:=CASE p_route WHEN 'voice-describe' THEN 'voice' WHEN 'voice-command' THEN 'voice' WHEN 'barcode-verify' THEN 'barcode' WHEN 'replacement-refinement-v2' THEN 'refinement' WHEN 'generate-claim-pack' THEN 'claim' END;
 IF bucket IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_operation'; END IF;
 IF bucket='claim' THEN
  cap:=private.resolve_coverly_access(p_user_id);
  IF NOT COALESCE((cap->>'can_export_claim_pack')::boolean,false) THEN RETURN jsonb_build_object('execute',false,'code','CLAIM_EXPORT_ACCESS_REQUIRED'); END IF;
  IF p_resource_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.inventory_files WHERE id=p_resource_id AND user_id=p_user_id) THEN RETURN jsonb_build_object('execute',false,'code','RESOURCE_NOT_OWNED'); END IF;
 ELSIF p_resource_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.inventory_items i JOIN public.inventory_files f ON f.id=i.file_id WHERE i.id=p_resource_id AND f.user_id=p_user_id) THEN RETURN jsonb_build_object('execute',false,'code','RESOURCE_NOT_OWNED'); END IF;
 ELSIF bucket='refinement' THEN RAISE EXCEPTION 'item_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('provider:'||p_user_id::text,0));
 UPDATE private.provider_route_jobs SET status='expired' WHERE user_id=p_user_id AND status='processing' AND expires_at<=now();
 SELECT * INTO j FROM private.provider_route_jobs WHERE user_id=p_user_id AND route=p_route AND operation_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF j.fingerprint<>p_fingerprint OR j.resource_id IS DISTINCT FROM p_resource_id THEN RETURN jsonb_build_object('execute',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  UPDATE private.provider_route_jobs SET duplicates=duplicates+1 WHERE id=j.id;
  IF j.status='completed' THEN RETURN jsonb_build_object('execute',false,'code','OPERATION_COMPLETED','result',j.result); END IF;
  -- Only known claim failures may retry. Expired/ambiguous workers never reclaim a key.
  IF j.status<>'failed' OR bucket<>'claim' THEN RETURN jsonb_build_object('execute',false,'code',CASE WHEN j.status='processing' THEN 'OPERATION_IN_PROGRESS' WHEN j.status='expired' THEN 'OPERATION_EXPIRED' ELSE 'OPERATION_REFUNDED' END); END IF;
 END IF;
 SELECT provider_route_limits->bucket INTO cfg FROM public.app_settings WHERE id=1;
 IF cfg IS NULL OR COALESCE((cfg->>'minute')::integer,0)<1 OR COALESCE((cfg->>'hour')::integer,0)<1 OR COALESCE((cfg->>'day')::integer,0)<1 OR COALESCE((cfg->>'concurrent')::integer,0)<1 THEN RAISE EXCEPTION 'invalid_rate_policy'; END IF;
 IF (SELECT count(*) FROM private.provider_route_runs WHERE user_id=p_user_id AND provider_route_runs.bucket=route_control.bucket AND created_at>now()-interval '1 minute') >= (cfg->>'minute')::integer
 OR (SELECT count(*) FROM private.provider_route_runs WHERE user_id=p_user_id AND provider_route_runs.bucket=route_control.bucket AND created_at>now()-interval '1 hour') >= (cfg->>'hour')::integer
 OR (SELECT count(*) FROM private.provider_route_runs WHERE user_id=p_user_id AND provider_route_runs.bucket=route_control.bucket AND created_at>now()-interval '1 day') >= (cfg->>'day')::integer
 OR (SELECT count(*) FROM private.provider_route_jobs x WHERE x.user_id=p_user_id AND x.status='processing' AND CASE WHEN bucket='voice' THEN x.route IN ('voice-describe','voice-command') ELSE x.route=p_route END) >= (cfg->>'concurrent')::integer THEN
  RETURN jsonb_build_object('execute',false,'code','RATE_LIMITED','retry_after_seconds',60);
 END IF;
 token:=gen_random_uuid();
 IF j.id IS NULL THEN
  INSERT INTO private.provider_route_jobs(user_id,route,operation_key,fingerprint,resource_id,status,token,expires_at)
  VALUES(p_user_id,p_route,p_key,p_fingerprint,p_resource_id,'processing',token,now()+interval '5 minutes') RETURNING * INTO j;
 ELSE UPDATE private.provider_route_jobs SET status='processing',token=route_control.token,expires_at=now()+interval '5 minutes' WHERE id=j.id RETURNING * INTO j; END IF;
 INSERT INTO private.provider_route_runs(id,job_id,user_id,bucket) VALUES(token,j.id,p_user_id,bucket);
 RETURN jsonb_build_object('execute',true,'job_id',j.id,'token',token);
END $$;

CREATE FUNCTION public.provider_route_step(p_user_id uuid,p_job_id uuid,p_token uuid,p_action text,p_attempt text DEFAULT NULL,p_http_status integer DEFAULT NULL,p_result jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.provider_route_jobs%ROWTYPE; n integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('provider:'||p_user_id::text,0));
 SELECT * INTO j FROM private.provider_route_jobs WHERE id=p_job_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR j.token IS DISTINCT FROM p_token THEN RETURN jsonb_build_object('ok',false); END IF;
 IF p_action='finish_attempt' THEN
  UPDATE private.provider_route_attempts SET finished_at=now(),http_status=p_http_status,status=CASE WHEN p_http_status BETWEEN 200 AND 299 THEN 'succeeded' ELSE 'failed' END WHERE run_id=p_token AND attempt=p_attempt AND status='started';
  GET DIAGNOSTICS n=ROW_COUNT; RETURN jsonb_build_object('ok',n=1);
 END IF;
 IF j.expires_at<=now() OR j.status NOT IN ('processing','completed') THEN RETURN jsonb_build_object('ok',false); END IF;
 IF j.route='generate-claim-pack' AND p_action<>'failed' AND NOT COALESCE((private.resolve_coverly_access(p_user_id)->>'can_export_claim_pack')::boolean,false) THEN RETURN jsonb_build_object('ok',false); END IF;
 IF p_action='check' THEN RETURN jsonb_build_object('ok',j.status='processing'); END IF;
 IF p_action='start_attempt' THEN
  IF length(p_attempt) NOT BETWEEN 1 AND 80 OR p_attempt IS NULL OR (j.status='completed' AND p_attempt<>'email') THEN RETURN jsonb_build_object('ok',false); END IF;
  INSERT INTO private.provider_route_attempts(run_id,attempt) VALUES(p_token,p_attempt) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN jsonb_build_object('ok',n=1);
 END IF;
 IF p_action='completed' THEN
  IF p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR octet_length(p_result::text)>32768 THEN RAISE EXCEPTION 'invalid_result'; END IF;
  UPDATE private.provider_route_jobs SET status='completed',result=p_result WHERE id=j.id;
 ELSIF p_action='failed' AND j.status='processing' THEN
  UPDATE private.provider_route_jobs SET status='failed' WHERE id=j.id;
 ELSE RETURN jsonb_build_object('ok',false); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.begin_provider_route(uuid,text,text,text,text),public.provider_route_step(uuid,uuid,uuid,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_provider_route(uuid,text,text,text,text),public.provider_route_step(uuid,uuid,uuid,text,text,integer,jsonb) TO service_role;
COMMIT;
