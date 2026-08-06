-- Forward-only addition of the completed purchase-flow metric to the existing
-- admin usage overview RPC. Earlier applied migrations remain immutable.

BEGIN;

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
  v_purchase_completions_month integer := 0;
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
    )::integer,
    count(*) FILTER (
      WHERE e.event_name = 'purchase_completed'
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
    v_purchase_starts_month,
    v_purchase_completions_month
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
      'purchaseStartsMonth', v_purchase_starts_month,
      'purchaseCompletionsMonth', v_purchase_completions_month
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

ALTER FUNCTION public.admin_get_usage_analytics() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_get_usage_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_usage_analytics() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
