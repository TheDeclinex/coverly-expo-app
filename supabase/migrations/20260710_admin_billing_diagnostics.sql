-- Admin billing diagnostics for RevenueCat webhook state.
-- Additive JSON fields only; preserves admin-only SECURITY DEFINER access.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_latest_revenuecat_webhook jsonb := NULL;
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

  IF to_regclass('public.revenuecat_webhook_events') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT jsonb_build_object(
        'eventType', event_type,
        'status', status,
        'receivedAt', received_at,
        'processedAt', processed_at
      )
      FROM public.revenuecat_webhook_events
      WHERE profile_id = $1
         OR app_user_id = $1::text
      ORDER BY received_at DESC
      LIMIT 1
    $sql$
      INTO v_latest_revenuecat_webhook
      USING p_user_id;
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
      'revenueCatExpirationAt', v_profile->>'revenuecat_expiration_at',
      'revenueCatStatus', v_profile->>'revenuecat_status',
      'revenueCatUpdatedAt', v_profile->>'revenuecat_updated_at',
      'revenueCatLastEventId', v_profile->>'revenuecat_last_event_id'
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
    'latestRevenueCatWebhookEvent', v_latest_revenuecat_webhook,
    'supportsBonusAllowance', false
  );
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
    'latestRevenueCatWebhookEvent', v_detail->'latestRevenueCatWebhookEvent',
    'supportsBonusAllowance', false
  );
END;
$$;

ALTER FUNCTION public.admin_get_user_detail(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_get_entitlement_debug(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_entitlement_debug(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_entitlement_debug(uuid) TO authenticated, service_role;

COMMIT;

-- Verification:
-- SELECT public.admin_get_entitlement_debug('<target-user-id>'::uuid);
-- As a non-admin authenticated user, the same call should fail via assert_current_user_admin().
