-- Enforce Coverly property limits by effective plan.
--
-- Free and Plus accounts may own one property. Family accounts and explicit
-- tester/admin full-access accounts may own multiple properties. Property
-- archiving is not implemented, so every inventory_files row counts.

CREATE OR REPLACE FUNCTION public.coverly_property_access_class_for_user(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile jsonb;
  v_plan text;
  v_override_live boolean;
BEGIN
  SELECT to_jsonb(up)
    INTO v_profile
  FROM public.user_profiles up
  WHERE up.id = p_user_id;

  IF v_profile IS NULL THEN
    RETURN 'free';
  END IF;

  IF lower(COALESCE(v_profile->>'app_role', '')) = 'admin'
    OR lower(COALESCE(v_profile->>'plan', '')) = 'tester' THEN
    RETURN 'full_access';
  END IF;

  v_override_live :=
    lower(COALESCE(v_profile->>'access_override_status', '')) = 'active'
    AND NULLIF(v_profile->>'access_override_plan', '') IS NOT NULL
    AND (
      NULLIF(v_profile->>'access_override_expires_at', '') IS NULL
      OR (v_profile->>'access_override_expires_at')::timestamptz > now()
    );

  -- Current tester grants use a Plus override and retain their tester identity
  -- in access_override_reason. Legacy grants may still use plan/override=tester.
  IF v_override_live AND (
    lower(COALESCE(v_profile->>'access_override_plan', '')) = 'tester'
    OR lower(COALESCE(v_profile->>'access_override_reason', '')) LIKE 'tester access%'
  ) THEN
    RETURN 'full_access';
  END IF;

  IF v_override_live THEN
    v_plan := lower(v_profile->>'access_override_plan');
  ELSIF lower(COALESCE(v_profile->>'revenuecat_status', '')) IN ('active', 'trialing') THEN
    v_plan := lower(COALESCE(
      NULLIF(v_profile->>'subscription_plan', ''),
      NULLIF(v_profile->>'revenuecat_entitlement_id', ''),
      NULLIF(v_profile->>'revenuecat_product_id', ''),
      NULLIF(v_profile->>'plan', ''),
      'free'
    ));
  ELSIF lower(COALESCE(v_profile->>'subscription_status', '')) IN ('active', 'trialing') THEN
    v_plan := lower(COALESCE(
      NULLIF(v_profile->>'subscription_plan', ''),
      NULLIF(v_profile->>'plan', ''),
      'free'
    ));
  ELSE
    v_plan := lower(COALESCE(NULLIF(v_profile->>'plan', ''), 'free'));
  END IF;

  IF v_plan LIKE '%family%' THEN
    RETURN 'family';
  ELSIF v_plan LIKE '%plus%' THEN
    RETURN 'plus';
  END IF;

  RETURN 'free';
END;
$$;

CREATE OR REPLACE FUNCTION public.coverly_property_allowance_for_user(p_user_id uuid)
RETURNS TABLE(
  access_class text,
  property_count integer,
  property_limit integer,
  can_create_property boolean,
  required_plan text,
  block_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_access_class text;
  v_property_count integer;
  v_property_limit integer;
BEGIN
  v_access_class := public.coverly_property_access_class_for_user(p_user_id);

  SELECT count(*)::integer
    INTO v_property_count
  FROM public.inventory_files
  WHERE user_id = p_user_id;

  v_property_limit := CASE
    WHEN v_access_class IN ('family', 'full_access') THEN NULL
    ELSE 1
  END;

  RETURN QUERY SELECT
    v_access_class,
    v_property_count,
    v_property_limit,
    v_property_limit IS NULL OR v_property_count < v_property_limit,
    CASE WHEN v_property_limit IS NULL OR v_property_count < v_property_limit THEN NULL ELSE 'coverly_family' END,
    CASE WHEN v_property_limit IS NULL OR v_property_count < v_property_limit THEN NULL ELSE 'property_limit_reached' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_property_allowance()
RETURNS TABLE(
  access_class text,
  property_count integer,
  property_limit integer,
  can_create_property boolean,
  required_plan text,
  block_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT * FROM public.coverly_property_allowance_for_user(auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.raise_property_limit_reached(
  p_property_count integer,
  p_property_limit integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'PROPERTY_LIMIT_REACHED',
    DETAIL = jsonb_build_object(
      'propertyCount', p_property_count,
      'propertyLimit', p_property_limit,
      'requiredPlan', 'coverly_family'
    )::text,
    HINT = 'coverly_family';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_inventory_file_property_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowance record;
BEGIN
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'Property owner is required' USING ERRCODE = '23502';
  END IF;

  -- The same lock key is used by create_my_property, direct authenticated
  -- inserts, and service-role inserts so concurrent paths cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

  SELECT *
    INTO v_allowance
  FROM public.coverly_property_allowance_for_user(NEW.user_id);

  IF NOT v_allowance.can_create_property THEN
    PERFORM public.raise_property_limit_reached(
      v_allowance.property_count,
      v_allowance.property_limit
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_inventory_file_property_limit ON public.inventory_files;
CREATE TRIGGER enforce_inventory_file_property_limit
BEFORE INSERT ON public.inventory_files
FOR EACH ROW
EXECUTE FUNCTION public.enforce_inventory_file_property_limit();

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
  v_allowance record;
  v_next_file_number bigint;
  v_now timestamptz := now();
  v_created_by_email text;
  v_row public.inventory_files%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Property name is required' USING ERRCODE = '22023';
  END IF;

  IF p_contents_sum_insured IS NULL OR p_contents_sum_insured <= 0 THEN
    RAISE EXCEPTION 'Contents cover amount is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  SELECT *
    INTO v_allowance
  FROM public.coverly_property_allowance_for_user(v_user_id);

  IF NOT v_allowance.can_create_property THEN
    PERFORM public.raise_property_limit_reached(
      v_allowance.property_count,
      v_allowance.property_limit
    );
  END IF;

  SELECT COALESCE(max(file_number), 0) + 1
    INTO v_next_file_number
  FROM public.inventory_files
  WHERE user_id = v_user_id;

  v_created_by_email := NULLIF(auth.jwt() ->> 'email', '');

  INSERT INTO public.inventory_files (
    id, user_id, file_number, name, status, property_type,
    created_by_email, created_date, last_modified, contents_sum_insured,
    insurer_name, policy_number, property_cover_image_url
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

ALTER FUNCTION public.coverly_property_access_class_for_user(uuid) OWNER TO postgres;
ALTER FUNCTION public.coverly_property_allowance_for_user(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_my_property_allowance() OWNER TO postgres;
ALTER FUNCTION public.raise_property_limit_reached(integer, integer) OWNER TO postgres;
ALTER FUNCTION public.enforce_inventory_file_property_limit() OWNER TO postgres;
ALTER FUNCTION public.create_my_property(text, text, numeric, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.coverly_property_access_class_for_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coverly_property_allowance_for_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_property_allowance() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.raise_property_limit_reached(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_inventory_file_property_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_my_property(text, text, numeric, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_property_allowance() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_my_property(text, text, numeric, text, text, text) TO authenticated;
