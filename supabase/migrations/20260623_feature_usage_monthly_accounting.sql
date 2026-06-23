-- Free-plan monthly usage accounting foundation. REVIEW AND APPLY MANUALLY.
--
-- Phase 1 only:
--   - Adds authoritative monthly counters and reservation records.
--   - Adds RPCs for loading allowances, reserving usage, committing usage,
--     and refunding uncommitted failed work.
--   - Does not integrate scan-room-photo or replacement-price-search yet.
--   - Does not enable billing enforcement.
--   - Does not modify RevenueCat, property creation, scan payloads, image
--     handling, replacement pricing UI, or existing usage_events telemetry.
--
-- Prerequisites in deployed Supabase:
--   - public.get_my_effective_plan() already exists and returns the caller's
--     effective plan, including active paid/admin override resolution.
--   - public.get_entitlement_mode() already exists and returns one of:
--     open, dry_run, enforced.

BEGIN;

-- ---------------------------------------------------------------------------
-- App-level limits
-- ---------------------------------------------------------------------------

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS free_ai_scan_monthly_limit integer,
  ADD COLUMN IF NOT EXISTS free_replacement_pricing_monthly_limit integer;

UPDATE public.app_settings
SET
  free_ai_scan_monthly_limit = COALESCE(free_ai_scan_monthly_limit, 10),
  free_replacement_pricing_monthly_limit = COALESCE(free_replacement_pricing_monthly_limit, 5);

ALTER TABLE public.app_settings
  ALTER COLUMN free_ai_scan_monthly_limit SET DEFAULT 10,
  ALTER COLUMN free_replacement_pricing_monthly_limit SET DEFAULT 5,
  ALTER COLUMN free_ai_scan_monthly_limit SET NOT NULL,
  ALTER COLUMN free_replacement_pricing_monthly_limit SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_settings_free_ai_scan_monthly_limit_positive'
      AND conrelid = 'public.app_settings'::regclass
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_free_ai_scan_monthly_limit_positive
      CHECK (free_ai_scan_monthly_limit >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_settings_free_replacement_pricing_monthly_limit_positive'
      AND conrelid = 'public.app_settings'::regclass
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_free_replacement_pricing_monthly_limit_positive
      CHECK (free_replacement_pricing_monthly_limit >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Authoritative monthly counters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.feature_usage_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  month_key text NOT NULL,
  month_start_date date NOT NULL,
  used_units integer NOT NULL DEFAULT 0,
  reserved_units integer NOT NULL DEFAULT 0,
  limit_units integer NOT NULL,
  effective_plan_snapshot text,
  entitlement_mode_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_usage_monthly_feature_check
    CHECK (feature IN ('ai_scan', 'replacement_pricing')),
  CONSTRAINT feature_usage_monthly_month_key_check
    CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT feature_usage_monthly_used_units_nonnegative
    CHECK (used_units >= 0),
  CONSTRAINT feature_usage_monthly_reserved_units_nonnegative
    CHECK (reserved_units >= 0),
  CONSTRAINT feature_usage_monthly_limit_units_nonnegative
    CHECK (limit_units >= 0),
  CONSTRAINT feature_usage_monthly_user_feature_month_unique
    UNIQUE (user_id, feature, month_key)
);

CREATE INDEX IF NOT EXISTS feature_usage_monthly_user_month_idx
  ON public.feature_usage_monthly (user_id, month_key);

ALTER TABLE public.feature_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_usage_monthly OWNER TO postgres;
REVOKE ALL ON TABLE public.feature_usage_monthly FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reservation ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.feature_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  month_key text NOT NULL,
  month_start_date date NOT NULL,
  units integer NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  allowed boolean NOT NULL DEFAULT true,
  would_have_blocked boolean NOT NULL DEFAULT false,
  is_limited boolean NOT NULL DEFAULT true,
  is_bypassed boolean NOT NULL DEFAULT false,
  effective_plan text,
  entitlement_mode text NOT NULL,
  limit_units integer NOT NULL,
  used_units_at_reservation integer NOT NULL DEFAULT 0,
  reserved_units_at_reservation integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  refunded_at timestamptz,
  refund_reason text,
  CONSTRAINT feature_usage_reservations_feature_check
    CHECK (feature IN ('ai_scan', 'replacement_pricing')),
  CONSTRAINT feature_usage_reservations_month_key_check
    CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT feature_usage_reservations_units_positive
    CHECK (units > 0),
  CONSTRAINT feature_usage_reservations_status_check
    CHECK (status IN ('reserved', 'committed', 'refunded', 'expired', 'denied')),
  CONSTRAINT feature_usage_reservations_idempotency_key_not_blank
    CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT feature_usage_reservations_user_feature_key_unique
    UNIQUE (user_id, feature, idempotency_key)
);

CREATE INDEX IF NOT EXISTS feature_usage_reservations_user_month_idx
  ON public.feature_usage_reservations (user_id, month_key);

CREATE INDEX IF NOT EXISTS feature_usage_reservations_expiry_idx
  ON public.feature_usage_reservations (expires_at)
  WHERE status = 'reserved';

ALTER TABLE public.feature_usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_usage_reservations OWNER TO postgres;
REVOKE ALL ON TABLE public.feature_usage_reservations FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers. These are intentionally not callable by anon/authenticated.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.feature_usage_current_month_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland'), 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public.feature_usage_current_month_start_date()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland')::date;
$$;

CREATE OR REPLACE FUNCTION public.feature_usage_current_month_reset_at()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    (date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland') + interval '1 month')
    AT TIME ZONE 'Pacific/Auckland'
  );
$$;

CREATE OR REPLACE FUNCTION public.feature_usage_unit_cost(
  p_feature text,
  p_operation text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_feature text := lower(btrim(COALESCE(p_feature, '')));
  v_operation text := lower(btrim(COALESCE(p_operation, '')));
BEGIN
  IF v_feature = 'ai_scan'
    AND v_operation IN ('single_photo_scan', 'single_photo', 'photo', 'photo_scan') THEN
    RETURN 1;
  END IF;

  IF v_feature = 'ai_scan'
    AND v_operation IN ('multi_photo_scan', 'multi_photo', 'video_frame_scan', 'video_frame') THEN
    RETURN 3;
  END IF;

  IF v_feature = 'replacement_pricing'
    AND v_operation IN ('search', 'replacement_price_search', 'replacement_pricing_search') THEN
    RETURN 1;
  END IF;

  RAISE EXCEPTION 'Unsupported feature usage operation: feature=%, operation=%',
    p_feature, p_operation
    USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_feature_usage_reservations(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  WITH expired AS (
    UPDATE public.feature_usage_reservations r
    SET
      status = 'expired',
      refunded_at = now(),
      refund_reason = COALESCE(r.refund_reason, 'reservation expired')
    WHERE r.user_id = p_user_id
      AND r.status = 'reserved'
      AND r.expires_at <= now()
    RETURNING r.feature, r.month_key, r.units, r.is_bypassed
  ),
  grouped AS (
    SELECT feature, month_key, sum(units)::integer AS units
    FROM expired
    WHERE is_bypassed = false
    GROUP BY feature, month_key
  )
  UPDATE public.feature_usage_monthly m
  SET
    reserved_units = greatest(0, m.reserved_units - g.units),
    updated_at = now()
  FROM grouped g
  WHERE m.user_id = p_user_id
    AND m.feature = g.feature
    AND m.month_key = g.month_key;
END;
$$;

ALTER FUNCTION public.feature_usage_current_month_key() OWNER TO postgres;
ALTER FUNCTION public.feature_usage_current_month_start_date() OWNER TO postgres;
ALTER FUNCTION public.feature_usage_current_month_reset_at() OWNER TO postgres;
ALTER FUNCTION public.feature_usage_unit_cost(text, text) OWNER TO postgres;
ALTER FUNCTION public.expire_feature_usage_reservations(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.feature_usage_current_month_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feature_usage_current_month_start_date() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feature_usage_current_month_reset_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feature_usage_unit_cost(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_feature_usage_reservations(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public authenticated RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.load_my_usage_allowances()
RETURNS TABLE (
  feature text,
  month_key text,
  month_start_date date,
  reset_at timestamptz,
  effective_plan text,
  entitlement_mode text,
  is_limited boolean,
  limit_units integer,
  used_units integer,
  reserved_units integer,
  remaining_units integer,
  would_be_blocked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_effective_plan text;
  v_entitlement_mode text;
  v_is_admin boolean;
  v_is_limited boolean;
  v_month_key text;
  v_month_start date;
  v_reset_at timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  PERFORM public.expire_feature_usage_reservations(v_user_id);

  v_effective_plan := COALESCE(public.get_my_effective_plan(), 'free');
  v_entitlement_mode := lower(COALESCE(public.get_entitlement_mode(), 'open'));
  v_month_key := public.feature_usage_current_month_key();
  v_month_start := public.feature_usage_current_month_start_date();
  v_reset_at := public.feature_usage_current_month_reset_at();

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

  RETURN QUERY
  WITH limits(feature_name, limit_value) AS (
    SELECT
      'ai_scan'::text,
      COALESCE((SELECT free_ai_scan_monthly_limit FROM public.app_settings WHERE id = 1), 10)::integer
    UNION ALL
    SELECT
      'replacement_pricing'::text,
      COALESCE((SELECT free_replacement_pricing_monthly_limit FROM public.app_settings WHERE id = 1), 5)::integer
  )
  SELECT
    l.feature_name AS feature,
    v_month_key AS month_key,
    v_month_start AS month_start_date,
    v_reset_at AS reset_at,
    v_effective_plan AS effective_plan,
    v_entitlement_mode AS entitlement_mode,
    v_is_limited AS is_limited,
    l.limit_value AS limit_units,
    COALESCE(m.used_units, 0)::integer AS used_units,
    COALESCE(m.reserved_units, 0)::integer AS reserved_units,
    CASE
      WHEN v_is_limited THEN greatest(0, l.limit_value - COALESCE(m.used_units, 0) - COALESCE(m.reserved_units, 0))::integer
      ELSE NULL::integer
    END AS remaining_units,
    (
      v_is_limited
      AND v_entitlement_mode = 'enforced'
      AND COALESCE(m.used_units, 0) + COALESCE(m.reserved_units, 0) >= l.limit_value
    ) AS would_be_blocked
  FROM limits l
  LEFT JOIN public.feature_usage_monthly m
    ON m.user_id = v_user_id
   AND m.feature = l.feature_name
   AND m.month_key = v_month_key
  ORDER BY l.feature_name;
END;
$$;

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
  ON CONFLICT (user_id, feature, month_key)
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

CREATE OR REPLACE FUNCTION public.commit_my_feature_usage(
  reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_reservation_id uuid := $1;
  v_reservation public.feature_usage_reservations%ROWTYPE;
  v_monthly public.feature_usage_monthly%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.feature_usage_reservations r
  WHERE r.id = v_reservation_id
    AND r.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_reservation.month_key || ':' || v_reservation.feature, 0)
  );

  IF v_reservation.status = 'reserved' AND v_reservation.expires_at <= now() THEN
    UPDATE public.feature_usage_reservations
    SET
      status = 'expired',
      refunded_at = now(),
      refund_reason = COALESCE(refund_reason, 'reservation expired before commit')
    WHERE id = v_reservation.id
    RETURNING * INTO v_reservation;

    IF NOT v_reservation.is_bypassed THEN
      UPDATE public.feature_usage_monthly
      SET
        reserved_units = greatest(0, reserved_units - v_reservation.units),
        updated_at = now()
      WHERE user_id = v_user_id
        AND feature = v_reservation.feature
        AND month_key = v_reservation.month_key
      RETURNING * INTO v_monthly;
    END IF;
  ELSIF v_reservation.status = 'reserved' THEN
    IF NOT v_reservation.is_bypassed THEN
      UPDATE public.feature_usage_monthly
      SET
        used_units = used_units + v_reservation.units,
        reserved_units = greatest(0, reserved_units - v_reservation.units),
        updated_at = now()
      WHERE user_id = v_user_id
        AND feature = v_reservation.feature
        AND month_key = v_reservation.month_key
      RETURNING * INTO v_monthly;
    END IF;

    UPDATE public.feature_usage_reservations
    SET
      status = 'committed',
      committed_at = now()
    WHERE id = v_reservation.id
    RETURNING * INTO v_reservation;
  ELSE
    SELECT *
      INTO v_monthly
    FROM public.feature_usage_monthly m
    WHERE m.user_id = v_user_id
      AND m.feature = v_reservation.feature
      AND m.month_key = v_reservation.month_key;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', v_reservation.id,
    'feature', v_reservation.feature,
    'status', v_reservation.status,
    'committed', (v_reservation.status = 'committed'),
    'units', v_reservation.units,
    'used_units', COALESCE(v_monthly.used_units, 0),
    'reserved_units', COALESCE(v_monthly.reserved_units, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_my_feature_usage(
  reservation_id uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_reservation_id uuid := $1;
  v_reason text := $2;
  v_reservation public.feature_usage_reservations%ROWTYPE;
  v_monthly public.feature_usage_monthly%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.feature_usage_reservations r
  WHERE r.id = v_reservation_id
    AND r.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_reservation.month_key || ':' || v_reservation.feature, 0)
  );

  IF v_reservation.status = 'reserved' THEN
    IF NOT v_reservation.is_bypassed THEN
      UPDATE public.feature_usage_monthly
      SET
        reserved_units = greatest(0, reserved_units - v_reservation.units),
        updated_at = now()
      WHERE user_id = v_user_id
        AND feature = v_reservation.feature
        AND month_key = v_reservation.month_key
      RETURNING * INTO v_monthly;
    END IF;

    UPDATE public.feature_usage_reservations
    SET
      status = 'refunded',
      refunded_at = now(),
      refund_reason = COALESCE(NULLIF(btrim(v_reason), ''), 'refunded before commit')
    WHERE id = v_reservation.id
    RETURNING * INTO v_reservation;
  ELSE
    -- Committed usage is intentionally not reversible by refund. Other terminal
    -- states are also idempotent no-ops.
    SELECT *
      INTO v_monthly
    FROM public.feature_usage_monthly m
    WHERE m.user_id = v_user_id
      AND m.feature = v_reservation.feature
      AND m.month_key = v_reservation.month_key;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', v_reservation.id,
    'feature', v_reservation.feature,
    'status', v_reservation.status,
    'refunded', (v_reservation.status = 'refunded'),
    'committed', (v_reservation.status = 'committed'),
    'units', v_reservation.units,
    'used_units', COALESCE(v_monthly.used_units, 0),
    'reserved_units', COALESCE(v_monthly.reserved_units, 0)
  );
END;
$$;

ALTER FUNCTION public.load_my_usage_allowances() OWNER TO postgres;
ALTER FUNCTION public.reserve_my_feature_usage(text, text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.commit_my_feature_usage(uuid) OWNER TO postgres;
ALTER FUNCTION public.refund_my_feature_usage(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.load_my_usage_allowances() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.reserve_my_feature_usage(text, text, text, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.commit_my_feature_usage(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.refund_my_feature_usage(uuid, text) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.load_my_usage_allowances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_my_feature_usage(text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_my_feature_usage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_my_feature_usage(uuid, text) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification queries / smoke tests for manual review after applying.
-- ---------------------------------------------------------------------------
--
-- 1. Confirm mobile roles cannot directly read or write authoritative tables:
-- SELECT
--   has_table_privilege('anon', 'public.feature_usage_monthly', 'SELECT') AS anon_monthly_select,
--   has_table_privilege('authenticated', 'public.feature_usage_monthly', 'SELECT') AS auth_monthly_select,
--   has_table_privilege('authenticated', 'public.feature_usage_monthly', 'INSERT') AS auth_monthly_insert,
--   has_table_privilege('authenticated', 'public.feature_usage_reservations', 'SELECT') AS auth_res_select,
--   has_table_privilege('authenticated', 'public.feature_usage_reservations', 'INSERT') AS auth_res_insert;
--
-- 2. Confirm RPC grants:
-- SELECT p.proname,
--   has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN (
--     'load_my_usage_allowances',
--     'reserve_my_feature_usage',
--     'commit_my_feature_usage',
--     'refund_my_feature_usage'
--   )
-- ORDER BY p.proname;
-- -- Expected: anon=false, authenticated=true.
--
-- 3. Confirm helper grants are not exposed:
-- SELECT p.proname,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname LIKE 'feature_usage_%'
-- ORDER BY p.proname;
-- -- Expected for helper functions: authenticated=false.
--
-- 4. Authenticated customer smoke test examples, run with a real JWT/session
--    through Supabase client or SQL editor impersonation:
-- SELECT * FROM public.load_my_usage_allowances();
-- SELECT public.reserve_my_feature_usage(
--   'ai_scan',
--   'single_photo_scan',
--   gen_random_uuid()::text,
--   '{"source":"manual_sql_smoke_test"}'::jsonb
-- );
-- -- Save returned reservation_id:
-- SELECT public.commit_my_feature_usage('<reservation_id>'::uuid);
--
-- 5. Refund-before-commit example:
-- SELECT public.reserve_my_feature_usage(
--   'replacement_pricing',
--   'search',
--   gen_random_uuid()::text,
--   '{"source":"manual_sql_smoke_test"}'::jsonb
-- );
-- SELECT public.refund_my_feature_usage('<reservation_id>'::uuid, 'provider returned no usable results');
--
-- 6. Idempotency example:
-- SELECT public.reserve_my_feature_usage('ai_scan', 'single_photo_scan', 'same-key-1', '{}'::jsonb);
-- SELECT public.reserve_my_feature_usage('ai_scan', 'single_photo_scan', 'same-key-1', '{}'::jsonb);
-- -- Expected: same reservation_id and no second reserved unit.
--
-- 7. Over-limit enforced-mode example:
-- -- Set entitlement mode to enforced with existing admin tooling, then reserve
-- -- beyond the Free monthly limit. Expected: allowed=false, status='denied',
-- -- would_have_blocked=true, and no provider work should be performed by the
-- -- future Edge Function integration.
