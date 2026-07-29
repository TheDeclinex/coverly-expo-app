-- Admin Phase 1: bounded list RPCs, server-side filters, stable cursors, and
-- a bounded property preview. Create locally; apply to each hosted environment
-- only after review through the normal Supabase promotion workflow.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS user_profiles_admin_email_trgm_idx
  ON public.user_profiles USING gin (lower(email) extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS user_profiles_admin_full_name_trgm_idx
  ON public.user_profiles USING gin (lower(full_name) extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS feedback_reports_admin_activity_cursor_idx
  ON public.feedback_reports (
    (COALESCE(last_activity_at, created_at)) DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS claim_packs_admin_created_cursor_idx
  ON public.claim_packs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS admin_events_created_id_idx
  ON public.admin_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS admin_events_source_created_id_idx
  ON public.admin_events (source, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS inventory_files_admin_user_updated_cursor_idx
  ON public.inventory_files (
    user_id,
    (COALESCE(last_modified, created_date)) DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION public.admin_get_overview_v2(
  p_error_from timestamptz DEFAULT (now() - interval '7 days')
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_month_key text := public.admin_current_month_key();
  v_total_users integer;
  v_active_testers integer;
  v_ai_scans integer;
  v_replacement_lookups integer;
  v_claim_packs integer;
  v_recent_errors integer;
  v_support_new integer := 0;
  v_support_open integer := 0;
  v_support_unread integer := 0;
BEGIN
  PERFORM public.assert_current_user_admin();

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE public.admin_tester_status_from_profile(to_jsonb(up)) = 'active'
         )::integer
    INTO v_total_users, v_active_testers
  FROM public.user_profiles up
  WHERE up.email IS NOT NULL;

  SELECT
    COALESCE(sum(used_units) FILTER (WHERE feature = 'ai_scan'), 0)::integer,
    COALESCE(sum(used_units) FILTER (WHERE feature = 'replacement_pricing'), 0)::integer
    INTO v_ai_scans, v_replacement_lookups
  FROM public.feature_usage_monthly
  WHERE month_key = v_month_key;

  SELECT count(*)::integer
    INTO v_claim_packs
  FROM public.claim_packs
  WHERE generated_at IS NOT NULL
     OR status IN ('ready', 'generated', 'completed');

  SELECT count(*)::integer
    INTO v_recent_errors
  FROM public.admin_events
  WHERE severity IN ('error', 'critical')
    AND created_at >= COALESCE(p_error_from, now() - interval '7 days');

  SELECT
    count(*) FILTER (WHERE fr.status = 'new')::integer,
    count(*) FILTER (
      WHERE fr.status IN ('under_investigation', 'development', 'testing')
    )::integer,
    count(*) FILTER (
      WHERE fr.last_user_message_at IS NOT NULL
        AND fr.last_user_message_at > COALESCE(fr.admin_last_read_at, '-infinity'::timestamptz)
    )::integer
    INTO v_support_new, v_support_open, v_support_unread
  FROM public.feedback_reports fr;

  RETURN jsonb_build_object(
    'totalUsers', v_total_users,
    'activeTesters', v_active_testers,
    'aiScansThisMonth', v_ai_scans,
    'replacementLookupsThisMonth', v_replacement_lookups,
    'claimPacksGenerated', v_claim_packs,
    'recentErrors', v_recent_errors,
    'supportNew', v_support_new,
    'supportOpen', v_support_open,
    'supportUnread', v_support_unread,
    'monthKey', v_month_key
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_query text,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  app_role text,
  effective_plan text,
  tester_status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_query text := lower(btrim(COALESCE(p_query, '')));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
BEGIN
  PERFORM public.assert_current_user_admin();

  IF char_length(v_query) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.email,
    up.full_name,
    up.app_role,
    public.admin_effective_plan_from_profile(to_jsonb(up)) AS effective_plan,
    public.admin_tester_status_from_profile(to_jsonb(up)) AS tester_status,
    up.created_at
  FROM public.user_profiles up
  WHERE lower(up.email) LIKE '%' || v_query || '%'
     OR lower(up.full_name) LIKE '%' || v_query || '%'
     OR up.id::text = v_query
  ORDER BY up.created_at DESC NULLS LAST, up.id DESC
  LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_support_tickets(
  p_limit integer DEFAULT 20,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_status text DEFAULT 'needs_attention'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_status text := lower(btrim(COALESCE(p_status, 'needs_attention')));
  v_items jsonb;
  v_has_more boolean;
BEGIN
  PERFORM public.assert_current_user_admin();

  IF v_status NOT IN ('needs_attention', 'new', 'open', 'closed', 'all') THEN
    RAISE EXCEPTION 'invalid support status filter: %', p_status USING ERRCODE = '22023';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'support cursor requires both timestamp and id' USING ERRCODE = '22023';
  END IF;

  WITH filtered AS (
    SELECT
      fr.id,
      fr.user_id,
      fr.user_email,
      fr.feedback_type,
      fr.classification,
      fr.severity,
      fr.status,
      fr.title,
      left(COALESCE(fr.latest_message_preview, fr.description), 180) AS latest_message_preview,
      fr.created_at,
      fr.last_activity_at,
      fr.admin_last_read_at,
      fr.last_user_message_at,
      (
        fr.last_user_message_at IS NOT NULL
        AND fr.last_user_message_at > COALESCE(fr.admin_last_read_at, '-infinity'::timestamptz)
      ) AS has_unread_user_message,
      COALESCE(fr.last_activity_at, fr.created_at) AS cursor_created_at
    FROM public.feedback_reports fr
    WHERE (
      v_status = 'all'
      OR (v_status = 'new' AND fr.status = 'new')
      OR (v_status = 'open' AND fr.status IN ('under_investigation', 'development', 'testing'))
      OR (v_status = 'closed' AND fr.status IN ('resolved', 'closed'))
      OR (
        v_status = 'needs_attention'
        AND (
          fr.status = 'new'
          OR fr.status IN ('under_investigation', 'development', 'testing')
          OR (
            fr.last_user_message_at IS NOT NULL
            AND fr.last_user_message_at > COALESCE(fr.admin_last_read_at, '-infinity'::timestamptz)
          )
        )
      )
    )
      AND (p_from IS NULL OR COALESCE(fr.last_activity_at, fr.created_at) >= p_from)
      AND (p_to IS NULL OR COALESCE(fr.last_activity_at, fr.created_at) <= p_to)
      AND (
        p_before_created_at IS NULL
        OR COALESCE(fr.last_activity_at, fr.created_at) < p_before_created_at
        OR (
          COALESCE(fr.last_activity_at, fr.created_at) = p_before_created_at
          AND fr.id < p_before_id
        )
      )
    ORDER BY COALESCE(fr.last_activity_at, fr.created_at) DESC, fr.id DESC
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

CREATE OR REPLACE FUNCTION public.admin_list_claim_packs_page(
  p_limit integer DEFAULT 20,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_query text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_status text := lower(btrim(COALESCE(p_status, 'all')));
  v_query text := lower(btrim(COALESCE(p_query, '')));
  v_before_id bigint;
  v_items jsonb;
  v_has_more boolean;
BEGIN
  PERFORM public.assert_current_user_admin();

  IF v_status NOT IN ('all', 'processing', 'generated', 'failed') THEN
    RAISE EXCEPTION 'invalid claim-pack status filter: %', p_status USING ERRCODE = '22023';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'claim-pack cursor requires both timestamp and id' USING ERRCODE = '22023';
  END IF;
  IF p_before_id IS NOT NULL THEN
    v_before_id := p_before_id::bigint;
  END IF;

  WITH filtered AS (
    SELECT
      cp.id::text AS id,
      cp.pack_ref,
      cp.user_id,
      COALESCE(cp.user_email, up.email) AS user_email,
      cp.file_id,
      f.name AS property_name,
      cp.status,
      cp.created_at,
      cp.generated_at,
      (to_jsonb(cp)->>'email_sent')::boolean AS email_sent,
      NULLIF(btrim(COALESCE(cp.generation_error, '')), '') IS NOT NULL AS has_generation_error,
      cp.created_at AS cursor_created_at
    FROM public.claim_packs cp
    LEFT JOIN public.user_profiles up ON up.id = cp.user_id
    LEFT JOIN public.inventory_files f ON f.id = cp.file_id
    WHERE (
      v_status = 'all'
      OR (v_status = 'processing' AND COALESCE(cp.status, '') IN ('draft', 'pending', 'queued', 'processing', 'generating'))
      OR (v_status = 'generated' AND COALESCE(cp.status, '') IN ('ready', 'generated', 'completed'))
      OR (v_status = 'failed' AND COALESCE(cp.status, '') IN ('failed', 'error'))
    )
      AND (p_from IS NULL OR cp.created_at >= p_from)
      AND (p_to IS NULL OR cp.created_at <= p_to)
      AND (
        v_query = ''
        OR lower(COALESCE(cp.user_email, up.email, '')) LIKE '%' || v_query || '%'
        OR lower(COALESCE(f.name, '')) LIKE '%' || v_query || '%'
        OR lower(COALESCE(cp.pack_ref, '')) LIKE '%' || v_query || '%'
      )
      AND (
        p_before_created_at IS NULL
        OR cp.created_at < p_before_created_at
        OR (cp.created_at = p_before_created_at AND cp.id < v_before_id)
      )
    ORDER BY cp.created_at DESC, cp.id DESC
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

CREATE OR REPLACE FUNCTION public.admin_list_events_page(
  p_limit integer DEFAULT 20,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_severity text DEFAULT 'all',
  p_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_severity text := lower(btrim(COALESCE(p_severity, 'all')));
  v_source text := lower(btrim(COALESCE(p_source, '')));
  v_items jsonb;
  v_has_more boolean;
BEGIN
  PERFORM public.assert_current_user_admin();

  IF v_severity NOT IN ('all', 'warning', 'error', 'critical') THEN
    RAISE EXCEPTION 'invalid event severity filter: %', p_severity USING ERRCODE = '22023';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'event cursor requires both timestamp and id' USING ERRCODE = '22023';
  END IF;

  WITH filtered AS (
    SELECT
      e.id,
      e.created_at,
      e.source,
      e.screen,
      e.severity,
      left(e.message, 500) AS message,
      e.user_id,
      e.created_at AS cursor_created_at
    FROM public.admin_events e
    WHERE (v_severity = 'all' OR e.severity = v_severity)
      AND (v_source = '' OR e.source = v_source)
      AND (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to IS NULL OR e.created_at <= p_to)
      AND (
        p_before_created_at IS NULL
        OR e.created_at < p_before_created_at
        OR (e.created_at = p_before_created_at AND e.id < p_before_id)
      )
    ORDER BY e.created_at DESC, e.id DESC
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

CREATE OR REPLACE FUNCTION public.admin_list_user_files_page(
  p_user_id uuid,
  p_limit integer DEFAULT 20,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_items jsonb;
  v_has_more boolean;
BEGIN
  PERFORM public.assert_current_user_admin();

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'property cursor requires both timestamp and id' USING ERRCODE = '22023';
  END IF;

  WITH filtered AS (
    SELECT
      f.id::text,
      f.name::text,
      f.property_type::text,
      f.contents_sum_insured,
      f.currency_code,
      COALESCE((
        SELECT sum(
          COALESCE(i.unit_estimated_price, i.estimated_price, 0)
          * GREATEST(COALESCE(i.quantity, 1), 1)
        )
        FROM public.inventory_items i
        WHERE i.file_id = f.id
          AND COALESCE(i.estimated_currency, f.currency_code) = f.currency_code
      ), 0)::numeric AS inventory_value,
      COALESCE((
        SELECT jsonb_object_agg(grouped.currency_code, grouped.total)
        FROM (
          SELECT
            COALESCE(i.estimated_currency, f.currency_code) AS currency_code,
            sum(
              COALESCE(i.unit_estimated_price, i.estimated_price, 0)
              * GREATEST(COALESCE(i.quantity, 1), 1)
            )::numeric AS total
          FROM public.inventory_items i
          WHERE i.file_id = f.id
          GROUP BY COALESCE(i.estimated_currency, f.currency_code)
        ) grouped
      ), '{}'::jsonb) AS inventory_totals,
      (SELECT count(*)::integer FROM public.inventory_rooms r WHERE r.file_id = f.id) AS room_count,
      (SELECT count(*)::integer FROM public.inventory_items i WHERE i.file_id = f.id) AS item_count,
      (SELECT count(*)::integer FROM public.claim_packs cp WHERE cp.file_id::text = f.id::text) AS claim_pack_count,
      COALESCE(f.last_modified, f.created_date)::timestamptz AS updated_at,
      COALESCE(f.last_modified, f.created_date)::timestamptz AS cursor_created_at
    FROM public.inventory_files f
    WHERE f.user_id = p_user_id
      AND (
        p_before_created_at IS NULL
        OR COALESCE(f.last_modified, f.created_date) < p_before_created_at
        OR (
          COALESCE(f.last_modified, f.created_date) = p_before_created_at
          AND f.id < p_before_id
        )
      )
    ORDER BY COALESCE(f.last_modified, f.created_date) DESC, f.id DESC
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

CREATE OR REPLACE FUNCTION public.admin_get_user_property_preview(
  p_user_id uuid,
  p_limit integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 3);
  v_items jsonb;
BEGIN
  PERFORM public.assert_current_user_admin();

  SELECT COALESCE(jsonb_agg(to_jsonb(preview) ORDER BY preview.updated_at DESC, preview.id DESC), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT
      f.id::text,
      f.name::text,
      f.property_type::text,
      NULL::numeric AS contents_sum_insured,
      f.currency_code,
      NULL::numeric AS inventory_value,
      NULL::jsonb AS inventory_totals,
      (SELECT count(*)::integer FROM public.inventory_rooms r WHERE r.file_id = f.id) AS room_count,
      (SELECT count(*)::integer FROM public.inventory_items i WHERE i.file_id = f.id) AS item_count,
      NULL::integer AS claim_pack_count,
      COALESCE(f.last_modified, f.created_date)::timestamptz AS updated_at
    FROM public.inventory_files f
    WHERE f.user_id = p_user_id
    ORDER BY COALESCE(f.last_modified, f.created_date) DESC, f.id DESC
    LIMIT v_limit
  ) preview;

  RETURN v_items;
END;
$function$;

ALTER FUNCTION public.admin_get_overview_v2(timestamptz) OWNER TO postgres;
ALTER FUNCTION public.admin_search_users(text, integer) OWNER TO postgres;
ALTER FUNCTION public.admin_list_support_tickets(integer, timestamptz, uuid, timestamptz, timestamptz, text) OWNER TO postgres;
ALTER FUNCTION public.admin_list_claim_packs_page(integer, timestamptz, text, timestamptz, timestamptz, text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_list_events_page(integer, timestamptz, uuid, timestamptz, timestamptz, text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_list_user_files_page(uuid, integer, timestamptz, text) OWNER TO postgres;
ALTER FUNCTION public.admin_get_user_property_preview(uuid, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_get_overview_v2(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_search_users(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_support_tickets(integer, timestamptz, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_claim_packs_page(integer, timestamptz, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_events_page(integer, timestamptz, uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_user_files_page(uuid, integer, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user_property_preview(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_overview_v2(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_support_tickets(integer, timestamptz, uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_claim_packs_page(integer, timestamptz, text, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_events_page(integer, timestamptz, uuid, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_user_files_page(uuid, integer, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_user_property_preview(uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
