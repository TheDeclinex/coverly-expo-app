-- Profile/Settings V1. Review and apply manually in Supabase.
-- Does not alter load_my_profile() or restore direct user_profiles writes.

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS reminder_notifications_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS product_updates_enabled boolean NOT NULL DEFAULT false;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_country_code_format'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_country_code_format
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.load_my_settings()
RETURNS TABLE(
  id uuid, email text, full_name text, country_code text,
  reminder_notifications_enabled boolean,
  product_updates_enabled boolean, onboarding_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT au.id, au.email::text, up.full_name,
    coalesce(up.country_code, 'NZ'::text),
    coalesce(up.reminder_notifications_enabled, false),
    coalesce(up.product_updates_enabled, false),
    coalesce(up.onboarding_status, 'new'::text)
  FROM auth.users au
  LEFT JOIN public.user_profiles up ON up.id = au.id
  WHERE au.id = auth.uid();
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_full_name text,
  p_country_code text,
  p_reminder_notifications_enabled boolean,
  p_product_updates_enabled boolean
)
RETURNS TABLE(
  id uuid, email text, full_name text, country_code text,
  reminder_notifications_enabled boolean,
  product_updates_enabled boolean, onboarding_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_full_name text := nullif(trim(p_full_name), '');
  v_country_code text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT au.email::text INTO v_email FROM auth.users au WHERE au.id = v_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'authenticated user not found' USING ERRCODE = '42501';
  END IF;
  IF v_full_name IS NOT NULL AND length(v_full_name) > 100 THEN
    RAISE EXCEPTION 'full name must be 100 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF p_country_code IS NULL OR trim(p_country_code) = '' THEN
    RAISE EXCEPTION 'country code is required' USING ERRCODE = '22023';
  END IF;

  v_country_code := upper(trim(p_country_code));
  IF v_country_code !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid country code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_profiles AS up (
    id, email, full_name, country_code,
    reminder_notifications_enabled, product_updates_enabled
  ) VALUES (
    v_user_id, v_email, v_full_name, v_country_code,
    p_reminder_notifications_enabled, p_product_updates_enabled
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = excluded.full_name,
    country_code = excluded.country_code,
    reminder_notifications_enabled = excluded.reminder_notifications_enabled,
    product_updates_enabled = excluded.product_updates_enabled,
    updated_at = now();

  RETURN QUERY SELECT * FROM public.load_my_settings();
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_my_onboarding_complete()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT au.email::text INTO v_email FROM auth.users au WHERE au.id = v_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'authenticated user not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_profiles AS up (id, email, onboarding_status)
  VALUES (v_user_id, v_email, 'completed')
  ON CONFLICT (id) DO UPDATE SET
    onboarding_status = CASE
      WHEN up.onboarding_status = 'completed' THEN up.onboarding_status
      ELSE 'completed'
    END,
    updated_at = now();

  RETURN 'completed';
END;
$function$;

ALTER FUNCTION public.load_my_settings() OWNER TO postgres;
ALTER FUNCTION public.update_my_profile(text, text, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION public.mark_my_onboarding_complete() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.load_my_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_profile(text, text, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_my_onboarding_complete() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.load_my_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_onboarding_complete() TO authenticated;

COMMIT;

-- Manual verification after applying:
-- 1. anon cannot execute the three RPCs; authenticated can.
-- 2. authenticated still has no direct INSERT/UPDATE on user_profiles.
-- 3. save settings and compare protected fields before/after.
-- 4. verify load_my_profile() return definition is unchanged.
