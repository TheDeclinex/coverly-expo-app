-- Admin MVP V1 RPCs for the Coverly mobile admin surface.
--
-- Apply manually after reviewing in the target Supabase project.
-- All mobile admin reads/writes go through SECURITY DEFINER RPCs and call
-- public.assert_current_user_admin() before returning data or changing access.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_user_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log OWNER TO postgres;
REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text,
  screen text,
  severity text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT admin_events_severity_check
    CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical'))
);

CREATE INDEX IF NOT EXISTS admin_events_created_at_idx
  ON public.admin_events (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_events_severity_created_at_idx
  ON public.admin_events (severity, created_at DESC);

ALTER TABLE public.admin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_events OWNER TO postgres;
REVOKE ALL ON TABLE public.admin_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_current_month_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_month_key text;
BEGIN
  IF to_regprocedure('public.feature_usage_current_month_key()') IS NOT NULL THEN
    SELECT public.feature_usage_current_month_key() INTO v_month_key;
    RETURN v_month_key;
  END IF;

  RETURN to_char(date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland'), 'YYYY-MM');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_effective_plan_from_profile(p_profile jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_override_live boolean;
BEGIN
  IF COALESCE(p_profile->>'app_role', '') = 'admin' THEN
    RETURN 'admin';
  END IF;

  v_override_live :=
    COALESCE(p_profile->>'access_override_status', '') = 'active'
    AND NULLIF(p_profile->>'access_override_plan', '') IS NOT NULL
    AND (
      NULLIF(p_profile->>'access_override_expires_at', '') IS NULL
      OR (p_profile->>'access_override_expires_at')::timestamptz > now()
    );

  IF v_override_live THEN
    RETURN p_profile->>'access_override_plan';
  END IF;

  IF COALESCE(p_profile->>'revenuecat_status', '') IN ('active', 'trialing') THEN
    RETURN COALESCE(
      NULLIF(p_profile->>'subscription_plan', ''),
      NULLIF(p_profile->>'revenuecat_product_id', ''),
      NULLIF(p_profile->>'plan', ''),
      'free'
    );
  END IF;

  IF COALESCE(p_profile->>'subscription_status', '') IN ('active', 'trialing') THEN
    RETURN COALESCE(NULLIF(p_profile->>'subscription_plan', ''), NULLIF(p_profile->>'plan', ''), 'free');
  END IF;

  RETURN COALESCE(NULLIF(p_profile->>'plan', ''), 'free');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tester_status_from_profile(p_profile jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(p_profile->>'plan', '') = 'tester'
    OR (
      COALESCE(p_profile->>'access_override_status', '') = 'active'
      AND COALESCE(p_profile->>'access_override_plan', '') = 'tester'
      AND (
        NULLIF(p_profile->>'access_override_expires_at', '') IS NULL
        OR (p_profile->>'access_override_expires_at')::timestamptz > now()
      )
    ) THEN
    RETURN 'active';
  END IF;

  RETURN 'not_tester';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_month_key text := public.admin_current_month_key();
  v_total_users integer;
  v_active_testers integer;
  v_ai_scans integer;
  v_replacement_lookups integer;
  v_claim_packs integer;
  v_recent_errors integer;
BEGIN
  PERFORM public.assert_current_user_admin();

  IF to_regclass('public.user_profiles') IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_total_users
    FROM public.user_profiles
    WHERE email IS NOT NULL;

    SELECT count(*)::integer
      INTO v_active_testers
    FROM public.user_profiles up
    WHERE public.admin_tester_status_from_profile(to_jsonb(up)) = 'active';
  END IF;

  IF to_regclass('public.feature_usage_monthly') IS NOT NULL THEN
    SELECT COALESCE(sum(used_units), 0)::integer
      INTO v_ai_scans
    FROM public.feature_usage_monthly
    WHERE feature = 'ai_scan'
      AND month_key = v_month_key;

    SELECT COALESCE(sum(used_units), 0)::integer
      INTO v_replacement_lookups
    FROM public.feature_usage_monthly
    WHERE feature = 'replacement_pricing'
      AND month_key = v_month_key;
  END IF;

  IF to_regclass('public.claim_packs') IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_claim_packs
    FROM public.claim_packs
    WHERE generated_at IS NOT NULL
       OR status IN ('ready', 'generated', 'completed');
  END IF;

  SELECT count(*)::integer
    INTO v_recent_errors
  FROM public.admin_events
  WHERE severity IN ('error', 'critical')
    AND created_at >= now() - interval '7 days';

  RETURN jsonb_build_object(
    'totalUsers', v_total_users,
    'activeTesters', v_active_testers,
    'aiScansThisMonth', v_ai_scans,
    'replacementLookupsThisMonth', v_replacement_lookups,
    'claimPacksGenerated', v_claim_packs,
    'recentErrors', v_recent_errors,
    'monthKey', v_month_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_query text,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  app_role text,
  effective_plan text,
  tester_status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_query text := lower(btrim(COALESCE(p_query, '')));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
BEGIN
  PERFORM public.assert_current_user_admin();

  RETURN QUERY
  SELECT
    up.id,
    up.email,
    up.full_name,
    up.app_role,
    public.admin_effective_plan_from_profile(to_jsonb(up)) AS effective_plan,
    public.admin_tester_status_from_profile(to_jsonb(up)) AS tester_status,
    up.created_at
  FROM public.user_profiles up
  WHERE v_query = ''
     OR lower(COALESCE(up.email, '')) LIKE '%' || v_query || '%'
     OR lower(COALESCE(up.full_name, '')) LIKE '%' || v_query || '%'
     OR up.id::text = v_query
  ORDER BY up.created_at DESC NULLS LAST
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile jsonb;
  v_month_key text := public.admin_current_month_key();
  v_property_count integer := 0;
  v_room_count integer := 0;
  v_item_count integer := 0;
  v_ai_usage integer;
  v_replacement_usage integer;
  v_claim_pack_count integer;
  v_support jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_current_user_admin();

  SELECT to_jsonb(up)
    INTO v_profile
  FROM public.user_profiles up
  WHERE up.id = p_user_id;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = '02000';
  END IF;

  SELECT count(*)::integer
    INTO v_property_count
  FROM public.inventory_files
  WHERE user_id = p_user_id;

  SELECT count(*)::integer
    INTO v_room_count
  FROM public.inventory_rooms r
  JOIN public.inventory_files f ON f.id = r.file_id
  WHERE f.user_id = p_user_id;

  SELECT count(*)::integer
    INTO v_item_count
  FROM public.inventory_items i
  JOIN public.inventory_files f ON f.id = i.file_id
  WHERE f.user_id = p_user_id;

  IF to_regclass('public.feature_usage_monthly') IS NOT NULL THEN
    SELECT COALESCE(sum(used_units), 0)::integer
      INTO v_ai_usage
    FROM public.feature_usage_monthly
    WHERE user_id = p_user_id
      AND feature = 'ai_scan'
      AND month_key = v_month_key;

    SELECT COALESCE(sum(used_units), 0)::integer
      INTO v_replacement_usage
    FROM public.feature_usage_monthly
    WHERE user_id = p_user_id
      AND feature = 'replacement_pricing'
      AND month_key = v_month_key;
  END IF;

  IF to_regclass('public.claim_packs') IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_claim_pack_count
    FROM public.claim_packs
    WHERE user_id = p_user_id;
  END IF;

  IF to_regclass('public.feedback_reports') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_json ORDER BY row_created_at DESC), '[]'::jsonb)
      INTO v_support
    FROM (
      SELECT
        fr.created_at AS row_created_at,
        jsonb_build_object(
          'id', fr.id,
          'title', fr.title,
          'status', fr.status,
          'severity', fr.severity,
          'createdAt', fr.created_at
        ) AS row_json
      FROM public.feedback_reports fr
      WHERE fr.user_id = p_user_id
      ORDER BY fr.created_at DESC
      LIMIT 5
    ) recent;
  END IF;

  RETURN jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile->>'id',
      'email', v_profile->>'email',
      'fullName', v_profile->>'full_name',
      'appRole', v_profile->>'app_role',
      'plan', v_profile->>'plan',
      'effectivePlan', public.admin_effective_plan_from_profile(v_profile),
      'testerStatus', public.admin_tester_status_from_profile(v_profile),
      'createdAt', v_profile->>'created_at',
      'subscriptionStatus', v_profile->>'subscription_status',
      'subscriptionPlan', v_profile->>'subscription_plan',
      'subscriptionPeriodEnd', v_profile->>'subscription_period_end',
      'overridePlan', v_profile->>'access_override_plan',
      'overrideStatus', v_profile->>'access_override_status',
      'overrideReason', v_profile->>'access_override_reason',
      'overrideExpiresAt', v_profile->>'access_override_expires_at',
      'revenueCatCustomerId', v_profile->>'revenuecat_customer_id',
      'revenueCatProductId', v_profile->>'revenuecat_product_id',
      'revenueCatEntitlementId', v_profile->>'revenuecat_entitlement_id',
      'revenueCatStatus', v_profile->>'revenuecat_status',
      'revenueCatUpdatedAt', v_profile->>'revenuecat_updated_at'
    ),
    'counts', jsonb_build_object(
      'propertyCount', v_property_count,
      'roomCount', v_room_count,
      'itemCount', v_item_count,
      'claimPackCount', v_claim_pack_count
    ),
    'usage', jsonb_build_object(
      'monthKey', v_month_key,
      'aiScans', v_ai_usage,
      'replacementLookups', v_replacement_usage
    ),
    'recentSupport', v_support,
    'supportsBonusAllowance', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_access(
  p_user_id uuid,
  p_action text,
  p_expires_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_target public.user_profiles%ROWTYPE;
BEGIN
  PERFORM public.assert_current_user_admin();

  SELECT *
    INTO v_target
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = '02000';
  END IF;

  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'cannot change your own access' USING ERRCODE = '42501';
  END IF;

  IF v_action = 'grant_tester' THEN
    UPDATE public.user_profiles
    SET
      plan = 'tester',
      access_override_plan = 'tester',
      access_override_status = 'active',
      access_override_reason = COALESCE(NULLIF(p_reason, ''), 'Admin tester access'),
      access_override_expires_at = p_expires_at,
      access_override_granted_by = v_actor_id,
      access_override_created_at = now(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF v_action = 'remove_tester' THEN
    UPDATE public.user_profiles
    SET
      plan = CASE WHEN plan = 'tester' THEN 'free' ELSE plan END,
      access_override_plan = CASE WHEN access_override_plan = 'tester' THEN NULL ELSE access_override_plan END,
      access_override_status = CASE WHEN access_override_plan = 'tester' THEN 'revoked' ELSE access_override_status END,
      access_override_reason = COALESCE(NULLIF(p_reason, ''), 'Admin tester access removed'),
      access_override_expires_at = CASE WHEN access_override_plan = 'tester' THEN NULL ELSE access_override_expires_at END,
      access_override_granted_by = v_actor_id,
      access_override_created_at = now(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF v_action = 'grant_plus' THEN
    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
      RAISE EXCEPTION 'expiry must be in the future' USING ERRCODE = '22023';
    END IF;

    UPDATE public.user_profiles
    SET
      access_override_plan = 'coverly_plus',
      access_override_status = 'active',
      access_override_reason = COALESCE(NULLIF(p_reason, ''), 'Admin temporary Plus access'),
      access_override_expires_at = p_expires_at,
      access_override_granted_by = v_actor_id,
      access_override_created_at = now(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF v_action = 'clear_access' THEN
    UPDATE public.user_profiles
    SET
      access_override_plan = NULL,
      access_override_status = 'revoked',
      access_override_reason = COALESCE(NULLIF(p_reason, ''), 'Admin access override cleared'),
      access_override_expires_at = NULL,
      access_override_granted_by = v_actor_id,
      access_override_created_at = now(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF v_action = 'add_bonus_allowance' THEN
    RAISE EXCEPTION 'bonus allowance is not supported by the current entitlement schema'
      USING ERRCODE = '0A000';
  ELSE
    RAISE EXCEPTION 'unsupported access action: %', p_action USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, details)
  VALUES (
    v_actor_id,
    'admin_access_' || v_action,
    p_user_id,
    jsonb_build_object(
      'reason', p_reason,
      'expires_at', p_expires_at,
      'supports_bonus_allowance', false
    )
  );

  RETURN public.admin_get_user_detail(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_entitlement_debug(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_detail jsonb;
  v_mode text;
BEGIN
  PERFORM public.assert_current_user_admin();
  v_detail := public.admin_get_user_detail(p_user_id);

  IF to_regprocedure('public.get_entitlement_mode()') IS NOT NULL THEN
    SELECT public.get_entitlement_mode() INTO v_mode;
  END IF;

  RETURN jsonb_build_object(
    'profile', v_detail->'profile',
    'usage', v_detail->'usage',
    'entitlementMode', v_mode,
    'revenueCatConnected',
      COALESCE(NULLIF(v_detail #>> '{profile,revenueCatCustomerId}', ''), '') <> ''
      OR COALESCE(NULLIF(v_detail #>> '{profile,revenueCatStatus}', ''), '') <> '',
    'revenueCatExplanation',
      CASE
        WHEN COALESCE(NULLIF(v_detail #>> '{profile,revenueCatCustomerId}', ''), '') = ''
         AND COALESCE(NULLIF(v_detail #>> '{profile,revenueCatStatus}', ''), '') = ''
        THEN 'RevenueCat data is not connected for this user in Supabase.'
        ELSE NULL
      END,
    'supportsBonusAllowance', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_user_files(p_user_id uuid)
RETURNS TABLE (
  id text,
  name text,
  property_type text,
  contents_sum_insured numeric,
  inventory_value numeric,
  room_count integer,
  item_count integer,
  claim_pack_count integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.assert_current_user_admin();

  RETURN QUERY
  SELECT
    f.id,
    f.name,
    f.property_type,
    f.contents_sum_insured,
    COALESCE((
      SELECT sum((COALESCE(i.unit_estimated_price, i.estimated_price, 0) * COALESCE(i.quantity, 1)))::numeric
      FROM public.inventory_items i
      WHERE i.file_id = f.id
    ), 0)::numeric AS inventory_value,
    (
      SELECT count(*)::integer
      FROM public.inventory_rooms r
      WHERE r.file_id = f.id
    ) AS room_count,
    (
      SELECT count(*)::integer
      FROM public.inventory_items i
      WHERE i.file_id = f.id
    ) AS item_count,
    CASE
      WHEN to_regclass('public.claim_packs') IS NULL THEN NULL::integer
      ELSE (
        SELECT count(*)::integer
        FROM public.claim_packs cp
        WHERE cp.file_id = f.id
      )
    END AS claim_pack_count,
    COALESCE(f.last_modified, f.created_date)::timestamptz AS updated_at
  FROM public.inventory_files f
  WHERE f.user_id = p_user_id
  ORDER BY COALESCE(f.last_modified, f.created_date) DESC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_claim_packs(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id text,
  user_id uuid,
  user_email text,
  file_id text,
  property_name text,
  status text,
  created_at timestamptz,
  generated_at timestamptz,
  email_sent boolean,
  generation_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  PERFORM public.assert_current_user_admin();

  IF to_regclass('public.claim_packs') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cp.id::text,
    cp.user_id,
    COALESCE(cp.user_email, up.email) AS user_email,
    cp.file_id,
    f.name AS property_name,
    cp.status,
    cp.created_at,
    cp.generated_at,
    (to_jsonb(cp)->>'email_sent')::boolean AS email_sent,
    cp.generation_error
  FROM public.claim_packs cp
  LEFT JOIN public.user_profiles up ON up.id = cp.user_id
  LEFT JOIN public.inventory_files f ON f.id = cp.file_id
  ORDER BY COALESCE(cp.generated_at, cp.created_at) DESC NULLS LAST
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_claim_pack_detail(p_claim_pack_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row jsonb;
BEGIN
  PERFORM public.assert_current_user_admin();

  IF to_regclass('public.claim_packs') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'claimPack', to_jsonb(cp),
    'userEmail', COALESCE(cp.user_email, up.email),
    'propertyName', f.name,
    'retryAvailable', false,
    'retryUnavailableReason', 'Not available yet.'
  )
    INTO v_row
  FROM public.claim_packs cp
  LEFT JOIN public.user_profiles up ON up.id = cp.user_id
  LEFT JOIN public.inventory_files f ON f.id = cp.file_id
  WHERE cp.id::text = p_claim_pack_id
  LIMIT 1;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_recent_events(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  source text,
  screen text,
  severity text,
  message text,
  user_id uuid,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  PERFORM public.assert_current_user_admin();

  RETURN QUERY
  SELECT e.id, e.created_at, e.source, e.screen, e.severity, e.message, e.user_id, e.metadata
  FROM public.admin_events e
  ORDER BY e.created_at DESC
  LIMIT v_limit;
END;
$$;

ALTER FUNCTION public.admin_current_month_key() OWNER TO postgres;
ALTER FUNCTION public.admin_effective_plan_from_profile(jsonb) OWNER TO postgres;
ALTER FUNCTION public.admin_tester_status_from_profile(jsonb) OWNER TO postgres;
ALTER FUNCTION public.admin_get_overview() OWNER TO postgres;
ALTER FUNCTION public.admin_search_users(text, integer) OWNER TO postgres;
ALTER FUNCTION public.admin_get_user_detail(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_update_user_access(uuid, text, timestamptz, text) OWNER TO postgres;
ALTER FUNCTION public.admin_get_entitlement_debug(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_list_user_files(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_list_claim_packs(integer) OWNER TO postgres;
ALTER FUNCTION public.admin_get_claim_pack_detail(text) OWNER TO postgres;
ALTER FUNCTION public.admin_list_recent_events(integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_current_month_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_effective_plan_from_profile(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tester_status_from_profile(jsonb) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_get_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_search_users(text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_access(uuid, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_entitlement_debug(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_user_files(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_claim_packs(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_claim_pack_detail(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_recent_events(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access(uuid, text, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_entitlement_debug(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_user_files(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_claim_packs(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_claim_pack_detail(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_events(integer) TO authenticated, service_role;

COMMIT;

-- Verification notes:
-- 1. Non-admin authenticated users should receive permission denied from each
--    admin_* RPC because public.assert_current_user_admin() is called first.
-- 2. An admin user should be able to run:
--    SELECT public.admin_get_overview();
--    SELECT * FROM public.admin_search_users('', 10);
--    SELECT public.admin_get_user_detail('<user-id>'::uuid);
-- 3. Direct authenticated table reads on admin_events/admin_audit_log should be denied.
