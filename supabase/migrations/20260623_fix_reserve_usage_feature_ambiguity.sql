-- Hotfix: remove PL/pgSQL name ambiguity in reserve_my_feature_usage().
--
-- Context:
--   public.reserve_my_feature_usage(text, text, text, jsonb) intentionally keeps
--   RPC parameter names "feature" and "operation" for the mobile/Edge Function
--   contract. Those names can collide with feature_usage_* table columns inside
--   SQL statements compiled by PL/pgSQL.
--
-- This hotfix preserves:
--   - function name, argument types, argument names, and response shape,
--   - table schemas and existing usage records,
--   - limits, entitlement behaviour, idempotency, and accounting behaviour,
--   - existing scan-room-photo and mobile code.
--
-- It changes only the function body by:
--   - adding #variable_conflict use_column,
--   - targeting the named monthly unique constraint in ON CONFLICT.

BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_my_feature_usage(
  "feature" text,
  "operation" text,
  idempotency_key text,
  metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid;
  v_feature text := lower(btrim(COALESCE($1, '')));
  v_operation text := lower(btrim(COALESCE($2, '')));
  v_idempotency_key text := btrim(COALESCE($3, ''));
  v_metadata jsonb := COALESCE($4, '{}'::jsonb);
  v_units integer;
  v_effective_plan text;
  v_entitlement_mode text;
  v_is_admin boolean;
  v_is_limited boolean;
  v_is_bypassed boolean;
  v_month_key text;
  v_month_start date;
  v_limit_units integer;
  v_existing public.feature_usage_reservations%ROWTYPE;
  v_monthly public.feature_usage_monthly%ROWTYPE;
  v_allowed boolean;
  v_would_have_blocked boolean;
  v_reservation public.feature_usage_reservations%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  IF v_idempotency_key = '' THEN
    RAISE EXCEPTION 'idempotency_key is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(v_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'idempotency_key must be 200 characters or fewer'
      USING ERRCODE = '22023';
  END IF;

  v_units := public.feature_usage_unit_cost(v_feature, v_operation);
  v_month_key := public.feature_usage_current_month_key();
  v_month_start := public.feature_usage_current_month_start_date();

  -- Serialize each user's feature/month bucket so concurrent scans/searches
  -- cannot both observe the same remaining allowance.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_month_key || ':' || v_feature, 0)
  );

  PERFORM public.expire_feature_usage_reservations(v_user_id);

  SELECT *
    INTO v_existing
  FROM public.feature_usage_reservations r
  WHERE r.user_id = v_user_id
    AND r.feature = v_feature
    AND r.idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT *
      INTO v_monthly
    FROM public.feature_usage_monthly m
    WHERE m.user_id = v_existing.user_id
      AND m.feature = v_existing.feature
      AND m.month_key = v_existing.month_key;

    RETURN jsonb_build_object(
      'reservation_id', v_existing.id,
      'feature', v_existing.feature,
      'operation', v_existing.operation,
      'status', v_existing.status,
      'allowed', v_existing.allowed,
      'would_have_blocked', v_existing.would_have_blocked,
      'entitlement_mode', v_existing.entitlement_mode,
      'effective_plan', v_existing.effective_plan,
      'units', v_existing.units,
      'limit_units', v_existing.limit_units,
      'used_units', COALESCE(v_monthly.used_units, v_existing.used_units_at_reservation),
      'reserved_units', COALESCE(v_monthly.reserved_units, v_existing.reserved_units_at_reservation),
      'remaining_units', CASE
        WHEN v_existing.is_limited THEN greatest(
          0,
          v_existing.limit_units - COALESCE(v_monthly.used_units, v_existing.used_units_at_reservation)
          - COALESCE(v_monthly.reserved_units, v_existing.reserved_units_at_reservation)
        )
        ELSE NULL
      END,
      'expires_at', v_existing.expires_at
    );
  END IF;

  v_effective_plan := COALESCE(public.get_my_effective_plan(), 'free');
  v_entitlement_mode := lower(COALESCE(public.get_entitlement_mode(), 'open'));

  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = v_user_id
      AND up.app_role = 'admin'
  ) INTO v_is_admin;

  v_is_limited := NOT v_is_admin
    AND lower(COALESCE(v_effective_plan, 'free')) NOT IN (
      'plus',
      'family',
      'coverly_plus',
      'coverly_family'
    );
  v_is_bypassed := NOT v_is_limited;

  IF v_feature = 'ai_scan' THEN
    SELECT COALESCE(free_ai_scan_monthly_limit, 10)
      INTO v_limit_units
    FROM public.app_settings
    WHERE id = 1;
    v_limit_units := COALESCE(v_limit_units, 10);
  ELSIF v_feature = 'replacement_pricing' THEN
    SELECT COALESCE(free_replacement_pricing_monthly_limit, 5)
      INTO v_limit_units
    FROM public.app_settings
    WHERE id = 1;
    v_limit_units := COALESCE(v_limit_units, 5);
  ELSE
    RAISE EXCEPTION 'Unsupported feature: %', v_feature
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.feature_usage_monthly (
    user_id,
    feature,
    month_key,
    month_start_date,
    limit_units,
    effective_plan_snapshot,
    entitlement_mode_snapshot
  )
  VALUES (
    v_user_id,
    v_feature,
    v_month_key,
    v_month_start,
    v_limit_units,
    v_effective_plan,
    v_entitlement_mode
  )
  ON CONFLICT ON CONSTRAINT feature_usage_monthly_user_feature_month_unique
  DO UPDATE SET
    limit_units = EXCLUDED.limit_units,
    effective_plan_snapshot = EXCLUDED.effective_plan_snapshot,
    entitlement_mode_snapshot = EXCLUDED.entitlement_mode_snapshot,
    updated_at = now()
  RETURNING * INTO v_monthly;

  SELECT *
    INTO v_monthly
  FROM public.feature_usage_monthly m
  WHERE m.user_id = v_user_id
    AND m.feature = v_feature
    AND m.month_key = v_month_key
  FOR UPDATE;

  v_would_have_blocked := v_is_limited
    AND (v_monthly.used_units + v_monthly.reserved_units + v_units > v_limit_units);

  v_allowed := v_entitlement_mode <> 'enforced' OR NOT v_would_have_blocked;

  IF v_allowed AND NOT v_is_bypassed THEN
    UPDATE public.feature_usage_monthly
    SET
      reserved_units = reserved_units + v_units,
      limit_units = v_limit_units,
      effective_plan_snapshot = v_effective_plan,
      entitlement_mode_snapshot = v_entitlement_mode,
      updated_at = now()
    WHERE id = v_monthly.id
    RETURNING * INTO v_monthly;
  END IF;

  INSERT INTO public.feature_usage_reservations (
    user_id,
    feature,
    operation,
    idempotency_key,
    month_key,
    month_start_date,
    units,
    status,
    allowed,
    would_have_blocked,
    is_limited,
    is_bypassed,
    effective_plan,
    entitlement_mode,
    limit_units,
    used_units_at_reservation,
    reserved_units_at_reservation,
    metadata,
    expires_at
  )
  VALUES (
    v_user_id,
    v_feature,
    v_operation,
    v_idempotency_key,
    v_month_key,
    v_month_start,
    v_units,
    CASE WHEN v_allowed THEN 'reserved' ELSE 'denied' END,
    v_allowed,
    v_would_have_blocked,
    v_is_limited,
    v_is_bypassed,
    v_effective_plan,
    v_entitlement_mode,
    v_limit_units,
    v_monthly.used_units,
    v_monthly.reserved_units,
    v_metadata,
    now() + interval '30 minutes'
  )
  RETURNING * INTO v_reservation;

  RETURN jsonb_build_object(
    'reservation_id', v_reservation.id,
    'feature', v_reservation.feature,
    'operation', v_reservation.operation,
    'status', v_reservation.status,
    'allowed', v_reservation.allowed,
    'would_have_blocked', v_reservation.would_have_blocked,
    'entitlement_mode', v_reservation.entitlement_mode,
    'effective_plan', v_reservation.effective_plan,
    'units', v_reservation.units,
    'limit_units', v_reservation.limit_units,
    'used_units', v_monthly.used_units,
    'reserved_units', v_monthly.reserved_units,
    'remaining_units', CASE
      WHEN v_reservation.is_limited THEN greatest(0, v_reservation.limit_units - v_monthly.used_units - v_monthly.reserved_units)::integer
      ELSE NULL::integer
    END,
    'expires_at', v_reservation.expires_at
  );
END;
$$;

ALTER FUNCTION public.reserve_my_feature_usage(text, text, text, jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.reserve_my_feature_usage(text, text, text, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_my_feature_usage(text, text, text, jsonb)
  TO authenticated;

COMMIT;

-- Manual verification after applying:
--
-- 1. Confirm grants are preserved:
-- SELECT p.proname,
--   has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
--   has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname = 'reserve_my_feature_usage';
-- -- Expected: anon=false, authenticated=true, service_role=false.
--
-- 2. As an authenticated customer, reserve once:
-- SELECT public.reserve_my_feature_usage(
--   'ai_scan',
--   'single_photo_scan',
--   gen_random_uuid()::text,
--   '{"source":"reserve_ambiguity_hotfix_smoke"}'::jsonb
-- );
--
-- 3. Repeat with the same idempotency key and confirm the same reservation_id
--    is returned without incrementing reserved_units again.
