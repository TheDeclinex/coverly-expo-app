-- RevenueCat webhook hardening.
-- Additive event delivery tracking plus a mobile-safe profile RPC refresh.
-- Review and apply manually in the target Supabase project.

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS revenuecat_customer_id text,
  ADD COLUMN IF NOT EXISTS revenuecat_product_id text,
  ADD COLUMN IF NOT EXISTS revenuecat_entitlement_id text,
  ADD COLUMN IF NOT EXISTS revenuecat_expiration_at timestamptz,
  ADD COLUMN IF NOT EXISTS revenuecat_status text,
  ADD COLUMN IF NOT EXISTS revenuecat_last_event_id text,
  ADD COLUMN IF NOT EXISTS revenuecat_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_revenuecat_customer_id_unique
  ON public.user_profiles (revenuecat_customer_id)
  WHERE revenuecat_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.revenuecat_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  app_user_id text,
  original_app_user_id text,
  profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  environment text,
  store text,
  product_id text,
  entitlement_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'processing',
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.revenuecat_webhook_events
  DROP COLUMN IF EXISTS transaction_id,
  DROP COLUMN IF EXISTS original_transaction_id;

ALTER TABLE public.revenuecat_webhook_events
  ALTER COLUMN status SET DEFAULT 'processing';

ALTER TABLE public.revenuecat_webhook_events
  DROP CONSTRAINT IF EXISTS revenuecat_webhook_events_status_check;

ALTER TABLE public.revenuecat_webhook_events
  ADD CONSTRAINT revenuecat_webhook_events_status_check
  CHECK (status IN ('processing', 'processed', 'ignored', 'failed'));

CREATE INDEX IF NOT EXISTS revenuecat_webhook_events_received_at_idx
  ON public.revenuecat_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS revenuecat_webhook_events_profile_received_idx
  ON public.revenuecat_webhook_events (profile_id, received_at DESC);

CREATE INDEX IF NOT EXISTS revenuecat_webhook_events_status_received_idx
  ON public.revenuecat_webhook_events (status, received_at DESC);

ALTER TABLE public.revenuecat_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenuecat_webhook_events OWNER TO postgres;
REVOKE ALL ON TABLE public.revenuecat_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.revenuecat_webhook_events TO service_role;

DO $$
BEGIN
  IF to_regclass('public.admin_events') IS NOT NULL THEN
    GRANT INSERT ON TABLE public.admin_events TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.coverly_effective_plan_from_profile(p_profile jsonb)
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

DROP FUNCTION IF EXISTS public.load_my_profile();

CREATE FUNCTION public.load_my_profile()
RETURNS TABLE(
  id uuid,
  email text,
  full_name text,
  plan text,
  app_role text,
  onboarding_status text,
  created_at timestamptz,
  updated_at timestamptz,
  subscription_status text,
  subscription_plan text,
  subscription_period_end timestamptz,
  stripe_customer_id text,
  access_override_plan text,
  access_override_status text,
  access_override_expires_at timestamptz,
  override_is_live boolean,
  effective_plan text,
  revenuecat_customer_id text,
  revenuecat_product_id text,
  revenuecat_entitlement_id text,
  revenuecat_expiration_at timestamptz,
  revenuecat_status text,
  revenuecat_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    au.id,
    au.email::text,
    up.full_name,
    up.plan,
    up.app_role,
    up.onboarding_status,
    up.created_at,
    up.updated_at,
    up.subscription_status,
    up.subscription_plan,
    up.subscription_period_end,
    up.stripe_customer_id,
    up.access_override_plan,
    up.access_override_status,
    up.access_override_expires_at,
    (
      COALESCE(up.access_override_status, '') = 'active'
      AND up.access_override_plan IS NOT NULL
      AND (
        up.access_override_expires_at IS NULL
        OR up.access_override_expires_at > now()
      )
    )::boolean AS override_is_live,
    public.coverly_effective_plan_from_profile(to_jsonb(up)) AS effective_plan,
    up.revenuecat_customer_id,
    up.revenuecat_product_id,
    up.revenuecat_entitlement_id,
    up.revenuecat_expiration_at,
    up.revenuecat_status,
    up.revenuecat_updated_at
  FROM auth.users au
  LEFT JOIN public.user_profiles up ON up.id = au.id
  WHERE au.id = auth.uid();
END;
$$;

ALTER FUNCTION public.coverly_effective_plan_from_profile(jsonb) OWNER TO postgres;
ALTER FUNCTION public.load_my_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.coverly_effective_plan_from_profile(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.load_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.load_my_profile() TO authenticated, service_role;

COMMIT;

-- Rollback:
-- DROP FUNCTION IF EXISTS public.load_my_profile();
-- DROP FUNCTION IF EXISTS public.coverly_effective_plan_from_profile(jsonb);
-- DROP TABLE IF EXISTS public.revenuecat_webhook_events;
