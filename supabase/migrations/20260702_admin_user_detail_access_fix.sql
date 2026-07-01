-- Fix Admin MVP user drill-through and access grants.
--
-- This migration keeps admin access behind SECURITY DEFINER RPCs and
-- public.assert_current_user_admin(). It does not grant direct table access.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_tester_status_from_profile(p_profile jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_override_active boolean;
BEGIN
  v_override_active :=
    COALESCE(p_profile->>'access_override_status', '') = 'active'
    AND NULLIF(p_profile->>'access_override_plan', '') IS NOT NULL
    AND (
      NULLIF(p_profile->>'access_override_expires_at', '') IS NULL
      OR (p_profile->>'access_override_expires_at')::timestamptz > now()
    );

  IF COALESCE(p_profile->>'plan', '') = 'tester'
    OR (
      v_override_active
      AND lower(COALESCE(p_profile->>'access_override_reason', '')) LIKE 'tester access%'
    )
    OR (
      v_override_active
      AND COALESCE(p_profile->>'access_override_plan', '') = 'tester'
    ) THEN
    RETURN 'active';
  END IF;

  RETURN 'not_tester';
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
  v_has_claim_user_id boolean := false;
  v_has_feedback_shape boolean := false;
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

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'claim_packs'
      AND column_name = 'user_id'
  ) INTO v_has_claim_user_id;

  IF to_regclass('public.claim_packs') IS NOT NULL AND v_has_claim_user_id THEN
    EXECUTE 'SELECT count(*)::integer FROM public.claim_packs WHERE user_id::text = $1::text'
      INTO v_claim_pack_count
      USING p_user_id;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['user_id', 'id', 'title', 'status', 'severity', 'created_at']) AS required_column(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'feedback_reports'
        AND c.column_name = required_column.column_name
    )
  ) INTO v_has_feedback_shape;

  IF to_regclass('public.feedback_reports') IS NOT NULL AND v_has_feedback_shape THEN
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
      WHERE fr.user_id = p_user_id::text
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
DECLARE
  v_has_claim_file_id boolean := false;
BEGIN
  PERFORM public.assert_current_user_admin();

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'claim_packs'
      AND column_name = 'file_id'
  ) INTO v_has_claim_file_id;

  IF to_regclass('public.claim_packs') IS NOT NULL AND v_has_claim_file_id THEN
    RETURN QUERY
    SELECT
      f.id::text,
      f.name::text,
      f.property_type::text,
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
      (
        SELECT count(*)::integer
        FROM public.claim_packs cp
        WHERE cp.file_id::text = f.id::text
      ) AS claim_pack_count,
      COALESCE(f.last_modified, f.created_date)::timestamptz AS updated_at
    FROM public.inventory_files f
    WHERE f.user_id = p_user_id
    ORDER BY COALESCE(f.last_modified, f.created_date) DESC NULLS LAST;

    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.id::text,
    f.name::text,
    f.property_type::text,
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
    NULL::integer AS claim_pack_count,
    COALESCE(f.last_modified, f.created_date)::timestamptz AS updated_at
  FROM public.inventory_files f
  WHERE f.user_id = p_user_id
  ORDER BY COALESCE(f.last_modified, f.created_date) DESC NULLS LAST;
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
  v_reason text := btrim(COALESCE(p_reason, ''));
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

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expiry must be in the future' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'grant_tester' THEN
    UPDATE public.user_profiles
    SET
      plan = CASE WHEN plan = 'tester' THEN 'free' ELSE plan END,
      access_override_plan = 'coverly_plus',
      access_override_status = 'active',
      access_override_reason = CASE
        WHEN v_reason = '' THEN 'Tester access'
        ELSE 'Tester access: ' || v_reason
      END,
      access_override_expires_at = p_expires_at,
      access_override_granted_by = v_actor_id,
      access_override_created_at = now(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF v_action = 'remove_tester' THEN
    UPDATE public.user_profiles
    SET
      plan = CASE WHEN plan = 'tester' THEN 'free' ELSE plan END,
      access_override_plan = CASE
        WHEN lower(COALESCE(access_override_reason, '')) LIKE 'tester access%' OR access_override_plan = 'tester'
        THEN NULL
        ELSE access_override_plan
      END,
      access_override_status = CASE
        WHEN lower(COALESCE(access_override_reason, '')) LIKE 'tester access%' OR access_override_plan = 'tester'
        THEN 'revoked'
        ELSE access_override_status
      END,
      access_override_reason = COALESCE(NULLIF(v_reason, ''), 'Tester access removed'),
      access_override_expires_at = CASE
        WHEN lower(COALESCE(access_override_reason, '')) LIKE 'tester access%' OR access_override_plan = 'tester'
        THEN NULL
        ELSE access_override_expires_at
      END,
      access_override_granted_by = v_actor_id,
      access_override_created_at = now(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF v_action = 'grant_plus' THEN
    UPDATE public.user_profiles
    SET
      plan = CASE WHEN plan = 'tester' THEN 'free' ELSE plan END,
      access_override_plan = 'coverly_plus',
      access_override_status = 'active',
      access_override_reason = COALESCE(NULLIF(v_reason, ''), 'Admin temporary Plus access'),
      access_override_expires_at = p_expires_at,
      access_override_granted_by = v_actor_id,
      access_override_created_at = now(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF v_action = 'grant_family' THEN
    UPDATE public.user_profiles
    SET
      plan = CASE WHEN plan = 'tester' THEN 'free' ELSE plan END,
      access_override_plan = 'coverly_family',
      access_override_status = 'active',
      access_override_reason = COALESCE(NULLIF(v_reason, ''), 'Admin temporary Family access'),
      access_override_expires_at = p_expires_at,
      access_override_granted_by = v_actor_id,
      access_override_created_at = now(),
      updated_at = now()
    WHERE id = p_user_id;
  ELSIF v_action = 'clear_access' THEN
    UPDATE public.user_profiles
    SET
      plan = CASE WHEN plan = 'tester' THEN 'free' ELSE plan END,
      access_override_plan = NULL,
      access_override_status = 'revoked',
      access_override_reason = COALESCE(NULLIF(v_reason, ''), 'Admin access override cleared'),
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
      'reason_present', v_reason <> '',
      'expires_at', p_expires_at,
      'tester_access_uses_plan', CASE WHEN v_action = 'grant_tester' THEN 'coverly_plus' ELSE NULL END,
      'supports_bonus_allowance', false
    )
  );

  RETURN public.admin_get_user_detail(p_user_id);
END;
$$;

ALTER FUNCTION public.admin_tester_status_from_profile(jsonb) OWNER TO postgres;
ALTER FUNCTION public.admin_get_user_detail(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_list_user_files(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_update_user_access(uuid, text, timestamptz, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_tester_status_from_profile(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_user_files(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_access(uuid, text, timestamptz, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_user_files(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access(uuid, text, timestamptz, text) TO authenticated, service_role;

COMMIT;

-- Verification SQL after applying:
-- 1. As admin:
--    SELECT public.admin_get_user_detail('<normal-user-id>'::uuid);
--    SELECT * FROM public.admin_list_user_files('<normal-user-id>'::uuid);
--    SELECT public.admin_update_user_access('<normal-user-id>'::uuid, 'grant_tester', NULL, 'tester release');
--    SELECT public.admin_update_user_access('<normal-user-id>'::uuid, 'grant_plus', now() + interval '14 days', 'support test');
-- 2. As a non-admin authenticated user:
--    SELECT public.admin_get_user_detail('<normal-user-id>'::uuid); -- expected permission denied
-- 3. Direct authenticated SELECT/UPDATE on user_profiles, inventory_files, inventory_rooms,
--    inventory_items, admin_audit_log should remain denied except existing user-safe RPC paths.
