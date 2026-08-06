-- Focused, admin-only product analytics visibility.
-- Review and apply through the normal Supabase migration workflow; the client
-- never receives direct SELECT access to public.app_analytics_events.

BEGIN;

CREATE INDEX IF NOT EXISTS app_analytics_events_event_created_user_idx
  ON public.app_analytics_events (event_name, created_at DESC, user_id);

CREATE OR REPLACE FUNCTION public.admin_get_usage_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_active_today integer := 0;
  v_active_7d integer := 0;
  v_active_30d integer := 0;
  v_new_7d integer := 0;
  v_new_30d integer := 0;
  v_property_creators integer := 0;
  v_room_creators integer := 0;
  v_scan_users integer := 0;
  v_scans_month integer := 0;
  v_scan_failures_month integer := 0;
  v_searches_month integer := 0;
  v_claim_packs_month integer := 0;
  v_paywalls_month integer := 0;
  v_purchase_starts_month integer := 0;
  v_registered integer := 0;
  v_returned_after_first_day integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS caller
    WHERE caller.id = auth.uid()
      AND caller.app_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  WITH recent_event_activity AS (
    SELECT e.user_id, max(e.created_at) AS last_event_at
    FROM public.app_analytics_events AS e
    WHERE e.created_at >= pg_catalog.now() - interval '30 days'
    GROUP BY e.user_id
  )
  SELECT
    count(*) FILTER (
      WHERE GREATEST(
        COALESCE(up.last_active_at, '-infinity'::timestamptz),
        COALESCE(activity.last_event_at, '-infinity'::timestamptz)
      ) >= pg_catalog.date_trunc('day', pg_catalog.now())
    )::integer,
    count(*) FILTER (
      WHERE GREATEST(
        COALESCE(up.last_active_at, '-infinity'::timestamptz),
        COALESCE(activity.last_event_at, '-infinity'::timestamptz)
      ) >= pg_catalog.now() - interval '7 days'
    )::integer,
    count(*) FILTER (
      WHERE GREATEST(
        COALESCE(up.last_active_at, '-infinity'::timestamptz),
        COALESCE(activity.last_event_at, '-infinity'::timestamptz)
      ) >= pg_catalog.now() - interval '30 days'
    )::integer
  INTO v_active_today, v_active_7d, v_active_30d
  FROM auth.users AS au
  LEFT JOIN public.user_profiles AS up ON up.id = au.id
  LEFT JOIN recent_event_activity AS activity ON activity.user_id = au.id;

  SELECT
    count(*) FILTER (WHERE au.created_at >= pg_catalog.now() - interval '7 days')::integer,
    count(*) FILTER (WHERE au.created_at >= pg_catalog.now() - interval '30 days')::integer,
    count(*)::integer
  INTO v_new_7d, v_new_30d, v_registered
  FROM auth.users AS au;

  SELECT
    count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'property_created')::integer,
    count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'room_created')::integer,
    count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'scan_completed')::integer,
    count(*) FILTER (
      WHERE e.event_name = 'scan_completed'
        AND e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    )::integer,
    count(*) FILTER (
      WHERE e.event_name = 'scan_failed'
        AND e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    )::integer,
    count(*) FILTER (
      WHERE e.event_name = 'replacement_search_completed'
        AND e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    )::integer,
    count(*) FILTER (
      WHERE e.event_name = 'claim_pack_completed'
        AND e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    )::integer,
    count(*) FILTER (
      WHERE e.event_name = 'paywall_viewed'
        AND e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    )::integer,
    count(*) FILTER (
      WHERE e.event_name = 'purchase_started'
        AND e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    )::integer
  INTO
    v_property_creators,
    v_room_creators,
    v_scan_users,
    v_scans_month,
    v_scan_failures_month,
    v_searches_month,
    v_claim_packs_month,
    v_paywalls_month,
    v_purchase_starts_month
  FROM public.app_analytics_events AS e;

  WITH first_activity AS (
    SELECT e.user_id, min(e.created_at)::date AS first_active_date
    FROM public.app_analytics_events AS e
    GROUP BY e.user_id
  )
  SELECT count(*)::integer
  INTO v_returned_after_first_day
  FROM first_activity AS first_seen
  WHERE EXISTS (
    SELECT 1
    FROM public.app_analytics_events AS later
    WHERE later.user_id = first_seen.user_id
      AND later.created_at::date > first_seen.first_active_date
  );

  RETURN pg_catalog.jsonb_build_object(
    'metrics', pg_catalog.jsonb_build_object(
      'activeToday', v_active_today,
      'active7d', v_active_7d,
      'active30d', v_active_30d,
      'newAccounts7d', v_new_7d,
      'newAccounts30d', v_new_30d,
      'propertyCreators', v_property_creators,
      'roomCreators', v_room_creators,
      'scanUsers', v_scan_users,
      'successfulScansMonth', v_scans_month,
      'failedScansMonth', v_scan_failures_month,
      'replacementSearchesMonth', v_searches_month,
      'claimPacksCompletedMonth', v_claim_packs_month,
      'paywallViewsMonth', v_paywalls_month,
      'purchaseStartsMonth', v_purchase_starts_month
    ),
    'funnel', pg_catalog.jsonb_build_object(
      'registered', v_registered,
      'property', v_property_creators,
      'room', v_room_creators,
      'firstScan', v_scan_users,
      'returnedAfterFirstDay', v_returned_after_first_day
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_users_analytics_page(
  p_query text DEFAULT NULL,
  p_filter text DEFAULT 'all',
  p_sort text DEFAULT 'last_active',
  p_limit integer DEFAULT 50,
  p_before_sort_value text DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_query text := pg_catalog.btrim(COALESCE(p_query, ''));
  v_filter text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_filter, 'all')));
  v_sort text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_sort, 'last_active')));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
  v_is_uuid boolean;
  v_items jsonb;
  v_has_more boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS caller
    WHERE caller.id = auth.uid()
      AND caller.app_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_filter NOT IN (
    'all', 'active_7d', 'active_30d', 'never_active_after_creation',
    'no_property', 'property_no_scan', 'completed_scan', 'inactive_30d'
  ) THEN
    RAISE EXCEPTION 'invalid user analytics filter' USING ERRCODE = '22023';
  END IF;

  IF v_sort NOT IN ('last_active', 'account_created', 'email', 'most_items') THEN
    RAISE EXCEPTION 'invalid user analytics sort' USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_value IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'user directory cursor requires both sort value and id'
      USING ERRCODE = '22023';
  END IF;

  v_is_uuid := v_query ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF v_query <> '' AND NOT v_is_uuid AND pg_catalog.char_length(v_query) < 2 THEN
    RAISE EXCEPTION 'user directory query must contain at least two characters'
      USING ERRCODE = '22023';
  END IF;

  WITH property_counts AS (
    SELECT f.user_id, count(*)::integer AS property_count
    FROM public.inventory_files AS f
    GROUP BY f.user_id
  ),
  room_counts AS (
    SELECT f.user_id, count(*)::integer AS room_count
    FROM public.inventory_rooms AS r
    JOIN public.inventory_files AS f ON f.id = r.file_id
    GROUP BY f.user_id
  ),
  item_counts AS (
    SELECT f.user_id, count(*)::integer AS item_count
    FROM public.inventory_items AS i
    JOIN public.inventory_files AS f ON f.id = i.file_id
    GROUP BY f.user_id
  ),
  analytics_counts AS (
    SELECT
      e.user_id,
      count(*) FILTER (WHERE e.event_name = 'scan_completed' AND e.created_at >= pg_catalog.now() - interval '30 days')::integer AS successful_scans_30d,
      count(*) FILTER (WHERE e.event_name = 'replacement_search_completed' AND e.created_at >= pg_catalog.now() - interval '30 days')::integer AS replacement_searches_30d,
      count(*) FILTER (WHERE e.event_name = 'claim_pack_completed' AND e.created_at >= pg_catalog.now() - interval '30 days')::integer AS claim_packs_30d,
      pg_catalog.bool_or(e.event_name = 'scan_completed') AS completed_scan
    FROM public.app_analytics_events AS e
    GROUP BY e.user_id
  ),
  candidates AS (
    SELECT
      up.id,
      au.email::text AS email,
      up.full_name,
      up.app_role,
      public.admin_effective_plan_from_profile(pg_catalog.to_jsonb(up)) AS effective_plan,
      public.admin_tester_status_from_profile(pg_catalog.to_jsonb(up)) AS tester_status,
      au.created_at,
      au.last_sign_in_at,
      up.last_active_at,
      COALESCE(pc.property_count, 0) AS property_count,
      COALESCE(rc.room_count, 0) AS room_count,
      COALESCE(ic.item_count, 0) AS item_count,
      COALESCE(ac.successful_scans_30d, 0) AS successful_scans_30d,
      COALESCE(ac.replacement_searches_30d, 0) AS replacement_searches_30d,
      COALESCE(ac.claim_packs_30d, 0) AS claim_packs_30d,
      COALESCE(ac.completed_scan, false) AS completed_scan,
      COALESCE(up.last_active_at, '-infinity'::timestamptz) AS last_active_sort,
      COALESCE(au.created_at, '-infinity'::timestamptz) AS created_sort,
      COALESCE(pg_catalog.lower(au.email::text), '~~~~') AS email_sort
    FROM public.user_profiles AS up
    JOIN auth.users AS au ON au.id = up.id
    LEFT JOIN property_counts AS pc ON pc.user_id = up.id
    LEFT JOIN room_counts AS rc ON rc.user_id = up.id
    LEFT JOIN item_counts AS ic ON ic.user_id = up.id
    LEFT JOIN analytics_counts AS ac ON ac.user_id = up.id
    WHERE (
      v_query = ''
      OR (v_is_uuid AND up.id = v_query::uuid)
      OR (
        NOT v_is_uuid
        AND pg_catalog.lower(au.email::text) LIKE '%' || pg_catalog.lower(v_query) || '%'
      )
    )
      AND CASE v_filter
        WHEN 'active_7d' THEN up.last_active_at >= pg_catalog.now() - interval '7 days'
        WHEN 'active_30d' THEN up.last_active_at >= pg_catalog.now() - interval '30 days'
        WHEN 'never_active_after_creation' THEN up.last_active_at IS NULL OR up.last_active_at <= au.created_at
        WHEN 'no_property' THEN COALESCE(pc.property_count, 0) = 0
        WHEN 'property_no_scan' THEN COALESCE(pc.property_count, 0) > 0 AND NOT COALESCE(ac.completed_scan, false)
        WHEN 'completed_scan' THEN COALESCE(ac.completed_scan, false)
        WHEN 'inactive_30d' THEN up.last_active_at IS NULL OR up.last_active_at < pg_catalog.now() - interval '30 days'
        ELSE true
      END
  ),
  paged AS (
    SELECT c.*
    FROM candidates AS c
    WHERE p_before_sort_value IS NULL
      OR CASE v_sort
        WHEN 'email' THEN c.email_sort > p_before_sort_value
          OR (c.email_sort = p_before_sort_value AND c.id < p_before_id)
        WHEN 'most_items' THEN c.item_count < p_before_sort_value::integer
          OR (c.item_count = p_before_sort_value::integer AND c.id < p_before_id)
        WHEN 'account_created' THEN c.created_sort < p_before_sort_value::timestamptz
          OR (c.created_sort = p_before_sort_value::timestamptz AND c.id < p_before_id)
        ELSE c.last_active_sort < p_before_sort_value::timestamptz
          OR (c.last_active_sort = p_before_sort_value::timestamptz AND c.id < p_before_id)
      END
    ORDER BY
      CASE WHEN v_sort = 'email' THEN c.email_sort END ASC,
      CASE WHEN v_sort = 'most_items' THEN c.item_count END DESC,
      CASE WHEN v_sort = 'account_created' THEN c.created_sort END DESC,
      CASE WHEN v_sort = 'last_active' THEN c.last_active_sort END DESC,
      c.id DESC
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT
      p.*,
      CASE v_sort
        WHEN 'email' THEN p.email_sort
        WHEN 'most_items' THEN p.item_count::text
        WHEN 'account_created' THEN p.created_sort::text
        ELSE p.last_active_sort::text
      END AS cursor_sort_value,
      pg_catalog.row_number() OVER () AS page_row
    FROM paged AS p
  )
  SELECT
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(numbered) - ARRAY[
          'completed_scan', 'last_active_sort', 'created_sort', 'email_sort', 'page_row'
        ]::text[]
        ORDER BY numbered.page_row
      ) FILTER (WHERE numbered.page_row <= v_limit),
      '[]'::jsonb
    ),
    count(*) > v_limit
  INTO v_items, v_has_more
  FROM numbered;

  RETURN pg_catalog.jsonb_build_object('items', v_items, 'hasMore', v_has_more);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_activity(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS caller
    WHERE caller.id = auth.uid()
      AND caller.app_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'accountCreatedAt', au.created_at,
    'lastSignInAt', au.last_sign_in_at,
    'lastActiveAt', up.last_active_at,
    'firstEventName', first_event.event_name,
    'firstEventAt', first_event.created_at,
    'latestEventName', latest_event.event_name,
    'latestEventAt', latest_event.created_at,
    'appOpens7d', COALESCE(counts.app_opens_7d, 0),
    'appOpens30d', COALESCE(counts.app_opens_30d, 0),
    'successfulScans30d', COALESCE(counts.successful_scans_30d, 0),
    'failedScans30d', COALESCE(counts.failed_scans_30d, 0),
    'replacementSearches30d', COALESCE(counts.replacement_searches_30d, 0),
    'failedReplacementSearches30d', COALESCE(counts.failed_replacement_searches_30d, 0),
    'claimPacksCompleted30d', COALESCE(counts.claim_packs_completed_30d, 0),
    'claimPacksFailed30d', COALESCE(counts.claim_packs_failed_30d, 0),
    'paywallViews30d', COALESCE(counts.paywall_views_30d, 0),
    'purchaseStarts30d', COALESCE(counts.purchase_starts_30d, 0)
  )
  INTO v_result
  FROM auth.users AS au
  LEFT JOIN public.user_profiles AS up ON up.id = au.id
  LEFT JOIN LATERAL (
    SELECT e.event_name, e.created_at
    FROM public.app_analytics_events AS e
    WHERE e.user_id = au.id
    ORDER BY e.created_at ASC, e.id ASC
    LIMIT 1
  ) AS first_event ON true
  LEFT JOIN LATERAL (
    SELECT e.event_name, e.created_at
    FROM public.app_analytics_events AS e
    WHERE e.user_id = au.id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  ) AS latest_event ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE e.event_name = 'app_opened' AND e.created_at >= pg_catalog.now() - interval '7 days')::integer AS app_opens_7d,
      count(*) FILTER (WHERE e.event_name = 'app_opened' AND e.created_at >= pg_catalog.now() - interval '30 days')::integer AS app_opens_30d,
      count(*) FILTER (WHERE e.event_name = 'scan_completed')::integer AS successful_scans_30d,
      count(*) FILTER (WHERE e.event_name = 'scan_failed')::integer AS failed_scans_30d,
      count(*) FILTER (WHERE e.event_name = 'replacement_search_completed')::integer AS replacement_searches_30d,
      count(*) FILTER (WHERE e.event_name = 'replacement_search_failed')::integer AS failed_replacement_searches_30d,
      count(*) FILTER (WHERE e.event_name = 'claim_pack_completed')::integer AS claim_packs_completed_30d,
      count(*) FILTER (WHERE e.event_name = 'claim_pack_failed')::integer AS claim_packs_failed_30d,
      count(*) FILTER (WHERE e.event_name = 'paywall_viewed')::integer AS paywall_views_30d,
      count(*) FILTER (WHERE e.event_name = 'purchase_started')::integer AS purchase_starts_30d
    FROM public.app_analytics_events AS e
    WHERE e.user_id = au.id
      AND e.created_at >= pg_catalog.now() - interval '30 days'
  ) AS counts ON true
  WHERE au.id = p_user_id
  GROUP BY
    au.created_at,
    au.last_sign_in_at,
    up.last_active_at,
    first_event.event_name,
    first_event.created_at,
    latest_event.event_name,
    latest_event.created_at,
    counts.app_opens_7d,
    counts.app_opens_30d,
    counts.successful_scans_30d,
    counts.failed_scans_30d,
    counts.replacement_searches_30d,
    counts.failed_replacement_searches_30d,
    counts.claim_packs_completed_30d,
    counts.claim_packs_failed_30d,
    counts.paywall_views_30d,
    counts.purchase_starts_30d;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = '02000';
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_recent_activity(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_events jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS caller
    WHERE caller.id = auth.uid()
      AND caller.app_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', recent.id,
        'eventName', recent.event_name,
        'createdAt', recent.created_at,
        'summary', recent.summary
      )
      ORDER BY recent.created_at DESC, recent.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_events
  FROM (
    SELECT
      e.id,
      e.event_name,
      e.created_at,
      NULLIF(
        CASE e.event_name
          WHEN 'scan_started' THEN pg_catalog.concat_ws(' · ', e.properties->>'scan_mode', (e.properties->>'image_count') || ' images')
          WHEN 'scan_completed' THEN pg_catalog.concat_ws(' · ', e.properties->>'scan_mode', (e.properties->>'items_detected_count') || ' items detected')
          WHEN 'scan_failed' THEN pg_catalog.concat_ws(' · ', e.properties->>'failure_category', e.properties->>'scan_mode')
          WHEN 'replacement_search_started' THEN pg_catalog.concat_ws(' · ', e.properties->>'entry_method', e.properties->>'source_screen')
          WHEN 'replacement_search_completed' THEN pg_catalog.concat_ws(' · ', (e.properties->>'result_count') || ' results', CASE WHEN e.properties->>'refined_search_used' = 'true' THEN 'refined' END)
          WHEN 'replacement_search_failed' THEN e.properties->>'failure_category'
          WHEN 'claim_pack_started' THEN pg_catalog.concat_ws(' · ', (e.properties->>'item_count') || ' items', e.properties->>'delivery_method')
          WHEN 'claim_pack_completed' THEN pg_catalog.concat_ws(' · ', (e.properties->>'item_count') || ' items', e.properties->>'delivery_method')
          WHEN 'claim_pack_failed' THEN e.properties->>'failure_category'
          WHEN 'paywall_viewed' THEN pg_catalog.concat_ws(' · ', e.properties->>'source_screen', e.properties->>'plan')
          WHEN 'purchase_started' THEN pg_catalog.concat_ws(' · ', e.properties->>'plan', e.properties->>'billing_period')
          WHEN 'purchase_completed' THEN pg_catalog.concat_ws(' · ', e.properties->>'plan', e.properties->>'billing_period')
          WHEN 'purchase_failed' THEN pg_catalog.concat_ws(' · ', e.properties->>'failure_category', e.properties->>'plan')
          WHEN 'purchase_restored' THEN e.properties->>'plan'
          WHEN 'property_created' THEN pg_catalog.concat_ws(' · ', e.properties->>'entry_method', (e.properties->>'property_count') || ' properties')
          WHEN 'room_created' THEN pg_catalog.concat_ws(' · ', e.properties->>'entry_method', (e.properties->>'room_count') || ' rooms')
          WHEN 'item_created_manually' THEN e.properties->>'entry_method'
          ELSE ''
        END,
        ''
      ) AS summary
    FROM public.app_analytics_events AS e
    WHERE e.user_id = p_user_id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 20
  ) AS recent;

  RETURN v_events;
END;
$function$;

ALTER FUNCTION public.admin_get_usage_analytics() OWNER TO postgres;
ALTER FUNCTION public.admin_list_users_analytics_page(text, text, text, integer, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_get_user_activity(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_get_user_recent_activity(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_get_usage_analytics() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users_analytics_page(text, text, text, integer, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user_activity(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user_recent_activity(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_usage_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users_analytics_page(text, text, text, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_activity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_recent_activity(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Manual authorization checks after applying:
-- 1. an admin authenticated session can execute all four RPCs;
-- 2. a non-admin authenticated session receives SQLSTATE 42501;
-- 3. an anonymous session receives SQLSTATE 42501;
-- 4. authenticated still has INSERT-only access to app_analytics_events.
