-- Admin User Lookup follow-up: bounded user directory and search pagination.
-- Create-only in this change. Do not apply automatically to hosted projects.

BEGIN;

CREATE INDEX IF NOT EXISTS user_profiles_admin_created_id_idx
  ON public.user_profiles (created_at DESC NULLS LAST, id DESC);

CREATE OR REPLACE FUNCTION public.admin_list_users_page(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_query text := btrim(COALESCE(p_query, ''));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
  v_is_uuid boolean;
  v_items jsonb;
  v_has_more boolean;
BEGIN
  PERFORM public.assert_current_user_admin();

  v_is_uuid := v_query ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_query <> '' AND NOT v_is_uuid AND char_length(v_query) < 2 THEN
    RAISE EXCEPTION 'user directory query must contain at least two characters'
      USING ERRCODE = '22023';
  END IF;

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'user directory cursor requires both timestamp and id'
      USING ERRCODE = '22023';
  END IF;

  WITH filtered AS (
    SELECT
      up.id,
      up.email,
      up.full_name,
      up.app_role,
      public.admin_effective_plan_from_profile(to_jsonb(up)) AS effective_plan,
      public.admin_tester_status_from_profile(to_jsonb(up)) AS tester_status,
      up.created_at
    FROM public.user_profiles up
    WHERE (
      v_query = ''
      OR (v_is_uuid AND up.id = v_query::uuid)
      OR (
        NOT v_is_uuid
        AND (
          lower(up.email) LIKE '%' || lower(v_query) || '%'
          OR lower(up.full_name) LIKE '%' || lower(v_query) || '%'
        )
      )
    )
      AND (
        p_before_created_at IS NULL
        OR up.created_at < p_before_created_at
        OR (
          up.created_at = p_before_created_at
          AND up.id < p_before_id
        )
      )
    ORDER BY up.created_at DESC NULLS LAST, up.id DESC
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT filtered.*, row_number() OVER () AS page_row
    FROM filtered
  )
  SELECT
    COALESCE(
      jsonb_agg(to_jsonb(numbered) - 'page_row' ORDER BY page_row)
        FILTER (WHERE page_row <= v_limit),
      '[]'::jsonb
    ),
    count(*) > v_limit
    INTO v_items, v_has_more
  FROM numbered;

  RETURN jsonb_build_object('items', v_items, 'hasMore', v_has_more);
END;
$function$;

ALTER FUNCTION public.admin_list_users_page(text, integer, timestamptz, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_list_users_page(text, integer, timestamptz, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_users_page(text, integer, timestamptz, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
