-- Bounded, privacy-conscious account drill-downs for allowlisted Admin metrics.
-- Only behavioural metadata is returned; inventory, household, support, storage,
-- authentication-token, and billing-receipt content is intentionally absent.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_analytics_metric_accounts(
  p_metric text,
  p_limit integer DEFAULT 30,
  p_before_activity_at timestamptz DEFAULT NULL,
  p_before_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_metric text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_metric, '')));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50);
  v_now timestamptz := pg_catalog.now();
  v_period_start timestamptz;
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

  IF v_metric NOT IN (
    'registered',
    'new_accounts_30d',
    'created_property',
    'created_room',
    'completed_first_scan',
    'returned_after_first_day',
    'active_today',
    'active_7d',
    'active_30d',
    'successful_scans_month',
    'failed_scans_month',
    'replacement_searches_month',
    'claim_packs_completed_month',
    'paywall_views_month',
    'purchase_starts_month',
    'purchase_completions_month'
  ) THEN
    RAISE EXCEPTION 'unsupported analytics metric' USING ERRCODE = '22023';
  END IF;

  IF (p_before_activity_at IS NULL) <> (p_before_user_id IS NULL) THEN
    RAISE EXCEPTION 'analytics cursor requires both activity timestamp and user id'
      USING ERRCODE = '22023';
  END IF;

  v_period_start := CASE
    WHEN v_metric = 'active_today' THEN pg_catalog.date_trunc('day', v_now)
    WHEN v_metric = 'active_7d' THEN v_now - interval '7 days'
    WHEN v_metric IN ('active_30d', 'new_accounts_30d') THEN v_now - interval '30 days'
    WHEN v_metric LIKE '%_month' THEN pg_catalog.date_trunc('month', v_now)
    ELSE NULL
  END;

  WITH matching_events AS (
    SELECT
      e.id,
      e.user_id,
      e.created_at,
      e.event_name,
      e.platform,
      e.app_version,
      e.properties
    FROM public.app_analytics_events AS e
    WHERE CASE v_metric
      WHEN 'created_property' THEN e.event_name = 'property_created'
      WHEN 'created_room' THEN e.event_name = 'room_created'
      WHEN 'completed_first_scan' THEN e.event_name = 'scan_completed'
      WHEN 'successful_scans_month' THEN e.event_name = 'scan_completed' AND e.created_at >= v_period_start
      WHEN 'failed_scans_month' THEN e.event_name = 'scan_failed' AND e.created_at >= v_period_start
      WHEN 'replacement_searches_month' THEN e.event_name = 'replacement_search_completed' AND e.created_at >= v_period_start
      WHEN 'claim_packs_completed_month' THEN e.event_name = 'claim_pack_completed' AND e.created_at >= v_period_start
      WHEN 'paywall_views_month' THEN e.event_name = 'paywall_viewed' AND e.created_at >= v_period_start
      WHEN 'purchase_starts_month' THEN e.event_name = 'purchase_started' AND e.created_at >= v_period_start
      WHEN 'purchase_completions_month' THEN e.event_name = 'purchase_completed' AND e.created_at >= v_period_start
      ELSE false
    END
  ),
  event_rollup AS (
    SELECT
      e.user_id,
      count(*)::integer AS event_count,
      min(e.created_at) AS first_event_at,
      max(e.created_at) AS last_event_at,
      (pg_catalog.array_agg(e.platform ORDER BY e.created_at DESC, e.id DESC))[1] AS platform,
      (pg_catalog.array_agg(e.app_version ORDER BY e.created_at DESC, e.id DESC))[1] AS app_version,
      (pg_catalog.array_agg(e.properties->>'failure_category' ORDER BY e.created_at DESC, e.id DESC))[1] AS raw_failure_category,
      (pg_catalog.array_agg(e.properties->>'plan' ORDER BY e.created_at DESC, e.id DESC))[1] AS plan,
      (pg_catalog.array_agg(e.properties->>'product_identifier' ORDER BY e.created_at DESC, e.id DESC))[1] AS product_identifier
    FROM matching_events AS e
    GROUP BY e.user_id
  ),
  active_event_rollup AS (
    SELECT
      e.user_id,
      count(*)::integer AS event_count,
      min(e.created_at) AS first_event_at,
      max(e.created_at) AS last_event_at,
      (pg_catalog.array_agg(e.platform ORDER BY e.created_at DESC, e.id DESC))[1] AS platform,
      (pg_catalog.array_agg(e.app_version ORDER BY e.created_at DESC, e.id DESC))[1] AS app_version
    FROM public.app_analytics_events AS e
    WHERE v_metric IN ('active_today', 'active_7d', 'active_30d')
      AND e.created_at >= v_period_start
    GROUP BY e.user_id
  ),
  first_activity AS (
    SELECT e.user_id, min(e.created_at)::date AS first_active_date
    FROM public.app_analytics_events AS e
    WHERE v_metric = 'returned_after_first_day'
    GROUP BY e.user_id
  ),
  returned_rollup AS (
    -- "Returned" means an analytics event on a later UTC calendar day than
    -- the account's first recorded analytics day. Same-day foregrounds do not qualify.
    SELECT
      e.user_id,
      count(*)::integer AS event_count,
      min(e.created_at) AS first_event_at,
      max(e.created_at) AS last_event_at,
      (pg_catalog.array_agg(e.platform ORDER BY e.created_at DESC, e.id DESC))[1] AS platform,
      (pg_catalog.array_agg(e.app_version ORDER BY e.created_at DESC, e.id DESC))[1] AS app_version
    FROM public.app_analytics_events AS e
    JOIN first_activity AS first_seen ON first_seen.user_id = e.user_id
    WHERE e.created_at::date > first_seen.first_active_date
    GROUP BY e.user_id
  ),
  metric_rows AS (
    SELECT
      events.user_id,
      events.event_count,
      events.first_event_at,
      events.last_event_at,
      events.platform,
      events.app_version,
      CASE events.raw_failure_category
        WHEN 'network' THEN 'Network failure'
        WHEN 'authentication' THEN 'Authentication failure'
        WHEN 'timeout' THEN 'Function timeout'
        WHEN 'usage_limit' THEN 'Usage limit reached'
        WHEN 'configuration' THEN 'Invalid request'
        WHEN 'processing' THEN 'Processing failure'
        WHEN 'upload' THEN 'Processing failure'
        ELSE CASE WHEN events.raw_failure_category IS NULL THEN NULL ELSE 'Unknown failure' END
      END AS failure_category,
      events.plan,
      events.product_identifier
    FROM event_rollup AS events
    WHERE v_metric IN (
      'created_property', 'created_room', 'completed_first_scan',
      'successful_scans_month', 'failed_scans_month', 'replacement_searches_month',
      'claim_packs_completed_month', 'paywall_views_month', 'purchase_starts_month',
      'purchase_completions_month'
    )

    UNION ALL

    SELECT
      au.id,
      1,
      au.created_at,
      au.created_at,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text
    FROM auth.users AS au
    WHERE v_metric IN ('registered', 'new_accounts_30d')
      AND (v_metric = 'registered' OR au.created_at >= v_period_start)

    UNION ALL

    SELECT
      au.id,
      COALESCE(activity.event_count, 0),
      activity.first_event_at,
      GREATEST(
        COALESCE(up.last_active_at, '-infinity'::timestamptz),
        COALESCE(activity.last_event_at, '-infinity'::timestamptz)
      ),
      activity.platform,
      activity.app_version,
      NULL::text,
      NULL::text,
      NULL::text
    FROM auth.users AS au
    LEFT JOIN public.user_profiles AS up ON up.id = au.id
    LEFT JOIN active_event_rollup AS activity ON activity.user_id = au.id
    WHERE v_metric IN ('active_today', 'active_7d', 'active_30d')
      AND GREATEST(
        COALESCE(up.last_active_at, '-infinity'::timestamptz),
        COALESCE(activity.last_event_at, '-infinity'::timestamptz)
      ) >= v_period_start

    UNION ALL

    SELECT
      returned.user_id,
      returned.event_count,
      returned.first_event_at,
      returned.last_event_at,
      returned.platform,
      returned.app_version,
      NULL::text,
      NULL::text,
      NULL::text
    FROM returned_rollup AS returned
    WHERE v_metric = 'returned_after_first_day'
  ),
  enriched AS (
    SELECT
      rows.user_id,
      up.full_name AS display_name,
      au.email::text AS email,
      rows.event_count,
      rows.first_event_at,
      rows.last_event_at,
      up.last_active_at,
      au.created_at,
      CASE
        WHEN up.id IS NULL THEN NULL
        ELSE public.admin_effective_plan_from_profile(pg_catalog.to_jsonb(up))
      END AS effective_plan,
      CASE
        WHEN up.id IS NULL THEN NULL
        ELSE public.admin_tester_status_from_profile(pg_catalog.to_jsonb(up))
      END AS tester_status,
      rows.platform,
      rows.app_version,
      rows.failure_category,
      rows.plan,
      rows.product_identifier,
      rows.last_event_at AS cursor_activity_at
    FROM metric_rows AS rows
    JOIN auth.users AS au ON au.id = rows.user_id
    LEFT JOIN public.user_profiles AS up ON up.id = rows.user_id
  ),
  paged AS (
    SELECT enriched.*
    FROM enriched
    WHERE p_before_activity_at IS NULL
      OR enriched.cursor_activity_at < p_before_activity_at
      OR (
        enriched.cursor_activity_at = p_before_activity_at
        AND enriched.user_id < p_before_user_id
      )
    ORDER BY enriched.cursor_activity_at DESC, enriched.user_id DESC
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT paged.*, pg_catalog.row_number() OVER () AS page_row
    FROM paged
  )
  SELECT pg_catalog.jsonb_build_object(
    'metricKey', v_metric,
    'totalEvents', COALESCE((SELECT sum(metric_rows.event_count) FROM metric_rows), 0),
    'totalAccounts', (SELECT count(*) FROM metric_rows),
    'periodStart', v_period_start,
    'periodEnd', v_now,
    'items', COALESCE(
      pg_catalog.jsonb_agg(pg_catalog.to_jsonb(numbered) - 'page_row' ORDER BY numbered.page_row)
        FILTER (WHERE numbered.page_row <= v_limit),
      '[]'::jsonb
    ),
    'hasMore', count(*) > v_limit
  )
  INTO v_result
  FROM numbered;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.admin_get_analytics_metric_accounts(text, integer, timestamptz, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_get_analytics_metric_accounts(text, integer, timestamptz, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_analytics_metric_accounts(text, integer, timestamptz, uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Manual regression checks after applying:
-- 1. non-admin and anonymous callers receive SQLSTATE 42501;
-- 2. an account with scan_completed but deleted inventory still appears in
--    completed_first_scan because activation uses historical events;
-- 3. no response key contains properties, inventory content, storage URLs,
--    support content, auth tokens, or billing receipts.
