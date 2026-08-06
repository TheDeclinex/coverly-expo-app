-- Lightweight, privacy-conscious product analytics for the native app.
-- Review and apply manually in Supabase; this migration is not run by the client.

BEGIN;

CREATE TABLE public.app_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  event_name text NOT NULL,
  platform text NOT NULL,
  app_version text NOT NULL,
  build_number text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT app_analytics_events_event_name_check CHECK (
    event_name = ANY (ARRAY[
      'app_opened',
      'app_foregrounded',
      'property_created',
      'room_created',
      'item_created_manually',
      'scan_started',
      'scan_completed',
      'scan_failed',
      'replacement_search_started',
      'replacement_search_completed',
      'replacement_search_failed',
      'claim_pack_started',
      'claim_pack_completed',
      'claim_pack_failed',
      'paywall_viewed',
      'purchase_started',
      'purchase_completed',
      'purchase_failed',
      'purchase_restored'
    ])
  ),
  CONSTRAINT app_analytics_events_platform_check CHECK (
    platform = ANY (ARRAY['ios', 'android', 'web', 'unknown'])
  ),
  CONSTRAINT app_analytics_events_properties_object_check CHECK (
    jsonb_typeof(properties) = 'object'
  ),
  CONSTRAINT app_analytics_events_properties_keys_check CHECK (
    properties - ARRAY[
      'is_first_open',
      'authenticated',
      'property_count',
      'room_count',
      'entry_method',
      'scan_mode',
      'image_count',
      'items_detected_count',
      'duration_ms',
      'failure_category',
      'credit_cost',
      'result_count',
      'refined_search_used',
      'credit_refunded',
      'item_count',
      'evidence_file_count',
      'delivery_method',
      'plan',
      'billing_period',
      'product_identifier',
      'source_screen'
    ]::text[] = '{}'::jsonb
  ),
  CONSTRAINT app_analytics_events_properties_scalar_check CHECK (
    NOT jsonb_path_exists(
      properties,
      '$.* ? (@.type() == "object" || @.type() == "array" || @.type() == "null")'
    )
  )
);

CREATE INDEX app_analytics_events_created_at_idx
  ON public.app_analytics_events (created_at DESC);
CREATE INDEX app_analytics_events_user_id_idx
  ON public.app_analytics_events (user_id);
CREATE INDEX app_analytics_events_event_name_idx
  ON public.app_analytics_events (event_name);
CREATE INDEX app_analytics_events_user_recent_idx
  ON public.app_analytics_events (user_id, created_at DESC);

ALTER TABLE public.app_analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own analytics events"
  ON public.app_analytics_events
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.app_analytics_events FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.app_analytics_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_analytics_events TO service_role;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

CREATE INDEX IF NOT EXISTS user_profiles_last_active_at_idx
  ON public.user_profiles (last_active_at DESC)
  WHERE last_active_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_my_last_active()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_last_active_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT au.email::text
  INTO v_email
  FROM auth.users au
  WHERE au.id = v_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'authenticated user not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_profiles AS up (id, email, last_active_at)
  VALUES (v_user_id, v_email, now())
  ON CONFLICT (id) DO UPDATE
    SET last_active_at = excluded.last_active_at
    WHERE up.last_active_at IS NULL
      OR up.last_active_at <= now() - interval '15 minutes'
  RETURNING up.last_active_at INTO v_last_active_at;

  IF v_last_active_at IS NULL THEN
    SELECT up.last_active_at
    INTO v_last_active_at
    FROM public.user_profiles up
    WHERE up.id = v_user_id;
  END IF;

  RETURN v_last_active_at;
END;
$function$;

ALTER FUNCTION public.touch_my_last_active() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.touch_my_last_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_my_last_active() TO authenticated;

COMMIT;

-- Manual verification after applying:
-- 1. authenticated can insert only when user_id = auth.uid().
-- 2. authenticated and anon cannot SELECT from app_analytics_events.
-- 3. authenticated cannot UPDATE or DELETE app_analytics_events.
-- 4. touch_my_last_active() changes only the caller's last_active_at and performs
--    no second write inside the 15-minute database throttle window.

