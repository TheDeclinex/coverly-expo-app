-- Additive RPC for server-side property creation.
--
-- Prerequisites in deployed Supabase:
--   - public.get_my_effective_plan() already exists and returns the caller's effective plan.
--   - public.get_entitlement_mode() already exists and returns one of: open, dry_run, enforced.
--
-- This migration intentionally does not:
--   - redefine plan/entitlement helper functions,
--   - change existing RLS policies,
--   - revoke direct INSERT on public.inventory_files,
--   - enable billing enforcement.

CREATE OR REPLACE FUNCTION public.create_my_property(
  p_name text,
  p_property_type text DEFAULT NULL,
  p_contents_sum_insured numeric DEFAULT NULL,
  p_property_cover_image_url text DEFAULT NULL
)
RETURNS public.inventory_files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_effective_plan text;
  v_entitlement_mode text;
  v_property_count integer;
  v_would_have_blocked boolean;
  v_next_file_number bigint;
  v_now timestamptz := now();
  v_created_by_email text;
  v_row public.inventory_files%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Property name is required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize property creation per user so property counts and file_number
  -- generation cannot race for the same account.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  v_effective_plan := COALESCE(public.get_my_effective_plan(), 'free');
  v_entitlement_mode := COALESCE(public.get_entitlement_mode(), 'open');

  -- V1 counts all rows for the user. No active/deleted/archive distinction is
  -- confirmed for inventory_files yet.
  SELECT count(*)::integer
    INTO v_property_count
  FROM public.inventory_files
  WHERE user_id = v_user_id;

  v_would_have_blocked := lower(v_effective_plan) = 'free' AND v_property_count >= 1;

  IF v_entitlement_mode = 'enforced' AND v_would_have_blocked THEN
    RAISE EXCEPTION 'Free plan allows 1 property. Upgrade to add another property.'
      USING ERRCODE = 'P0001';
  ELSIF v_entitlement_mode = 'dry_run' AND v_would_have_blocked THEN
    RAISE LOG 'create_my_property dry_run would block user_id=% effective_plan=% property_count=%',
      v_user_id, v_effective_plan, v_property_count;
  END IF;

  SELECT COALESCE(max(file_number), 0) + 1
    INTO v_next_file_number
  FROM public.inventory_files
  WHERE user_id = v_user_id;

  v_created_by_email := NULLIF(auth.jwt() ->> 'email', '');

  INSERT INTO public.inventory_files (
    id,
    user_id,
    file_number,
    name,
    status,
    property_type,
    created_by_email,
    created_date,
    last_modified,
    contents_sum_insured,
    property_cover_image_url
  )
  VALUES (
    gen_random_uuid(),
    v_user_id,
    v_next_file_number,
    btrim(p_name),
    'active',
    NULLIF(btrim(p_property_type), ''),
    v_created_by_email,
    v_now,
    v_now,
    p_contents_sum_insured,
    NULLIF(btrim(p_property_cover_image_url), '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.create_my_property(text, text, numeric, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_my_property(text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_my_property(text, text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_my_property(text, text, numeric, text) TO authenticated;
