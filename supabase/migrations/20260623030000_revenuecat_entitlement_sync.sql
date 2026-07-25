-- RevenueCat entitlement sync. REVIEW AND APPLY MANUALLY.
-- Additive only: preserves Stripe fields, plan/effective_plan logic, and admin overrides.
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

-- The webhook uses service_role. Do not grant mobile clients write access to these fields.
COMMIT;

-- Before applying, confirm load_my_profile() already returns effective_plan,
-- subscription_status and subscription_period_end. If it does not, extend that
-- protected RPC separately without changing its effective-plan precedence.
-- Rollback: drop the index and seven revenuecat_* columns above.
