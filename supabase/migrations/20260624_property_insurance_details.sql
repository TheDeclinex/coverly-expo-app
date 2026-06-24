-- Add optional insurance policy metadata to properties and persist it through
-- the server-side property creation RPC.
--
-- This keeps the existing RLS-safe SECURITY DEFINER creation path. The new
-- RPC parameters are defaulted so callers that omit insurer/policy details can
-- still create properties.
--
-- Local schema references indicate public.inventory_files.id is text, so this
-- migration inserts gen_random_uuid()::text for the property id.

ALTER TABLE public.inventory_files
  ADD COLUMN IF NOT EXISTS insurer_name text,
  ADD COLUMN IF NOT EXISTS policy_number text;

DROP FUNCTION IF EXISTS public.create_my_property(text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.create_my_property(
  p_name text,
  p_property_type text DEFAULT NULL,
  p_contents_sum_insured numeric DEFAULT NULL,
  p_insurer_name text DEFAULT NULL,
  p_policy_number text DEFAULT NULL,
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

  IF p_contents_sum_insured IS NULL OR p_contents_sum_insured <= 0 THEN
    RAISE EXCEPTION 'Contents cover amount is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  v_effective_plan := COALESCE(public.get_my_effective_plan(), 'free');
  v_entitlement_mode := COALESCE(public.get_entitlement_mode(), 'open');

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
    insurer_name,
    policy_number,
    property_cover_image_url
  )
  VALUES (
    gen_random_uuid()::text,
    v_user_id,
    v_next_file_number,
    btrim(p_name),
    'active',
    NULLIF(btrim(p_property_type), ''),
    v_created_by_email,
    v_now,
    v_now,
    p_contents_sum_insured,
    NULLIF(btrim(p_insurer_name), ''),
    NULLIF(btrim(p_policy_number), ''),
    NULLIF(btrim(p_property_cover_image_url), '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.create_my_property(text, text, numeric, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_my_property(text, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_my_property(text, text, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_my_property(text, text, numeric, text, text, text) TO authenticated;
