-- Coverly mobile product analytics query examples.
-- Run with an administrative/service role. The mobile roles have no SELECT access.

-- Daily active users (authenticated users with at least one event).
SELECT created_at::date AS activity_date, count(DISTINCT user_id) AS daily_active_users
FROM public.app_analytics_events
GROUP BY 1
ORDER BY 1 DESC;

-- Weekly active users by calendar week.
SELECT date_trunc('week', created_at)::date AS week_start, count(DISTINCT user_id) AS weekly_active_users
FROM public.app_analytics_events
GROUP BY 1
ORDER BY 1 DESC;

-- New installations by day. This is an app-open approximation, not a store download count.
SELECT created_at::date AS opened_date, count(DISTINCT installation_id) AS new_installations
FROM public.app_analytics_events
WHERE event_name = 'app_opened' AND properties @> '{"is_first_open": true}'::jsonb
GROUP BY 1
ORDER BY 1 DESC;

-- Returning installations by day.
SELECT created_at::date AS opened_date, count(DISTINCT installation_id) AS returning_installations
FROM public.app_analytics_events
WHERE event_name = 'app_opened' AND properties @> '{"is_first_open": false}'::jsonb
GROUP BY 1
ORDER BY 1 DESC;

-- Users active in the last 7 and 30 days.
SELECT
  count(*) FILTER (WHERE last_active_at >= now() - interval '7 days') AS active_last_7_days,
  count(*) FILTER (WHERE last_active_at >= now() - interval '30 days') AS active_last_30_days
FROM public.user_profiles;

-- Activation conversions from users observed opening the app.
WITH opened AS (
  SELECT DISTINCT user_id FROM public.app_analytics_events WHERE event_name = 'app_opened'
), activated AS (
  SELECT
    user_id,
    bool_or(event_name = 'property_created') AS created_property,
    bool_or(event_name = 'room_created') AS created_room,
    bool_or(event_name = 'scan_completed') AS completed_scan
  FROM public.app_analytics_events
  GROUP BY user_id
)
SELECT
  count(*) AS opened_users,
  count(*) FILTER (WHERE activated.created_property) AS property_creators,
  round(100.0 * count(*) FILTER (WHERE activated.created_property) / NULLIF(count(*), 0), 1) AS property_conversion_percent,
  count(*) FILTER (WHERE activated.created_room) AS room_creators,
  round(100.0 * count(*) FILTER (WHERE activated.created_room) / NULLIF(count(*), 0), 1) AS room_conversion_percent,
  count(*) FILTER (WHERE activated.completed_scan) AS first_scan_users,
  round(100.0 * count(*) FILTER (WHERE activated.completed_scan) / NULLIF(count(*), 0), 1) AS scan_conversion_percent
FROM opened
LEFT JOIN activated USING (user_id);

-- Scan completion and failure rates by day.
SELECT
  created_at::date AS event_date,
  count(*) FILTER (WHERE event_name = 'scan_started') AS starts,
  count(*) FILTER (WHERE event_name = 'scan_completed') AS completions,
  count(*) FILTER (WHERE event_name = 'scan_failed') AS failures
FROM public.app_analytics_events
WHERE event_name IN ('scan_started', 'scan_completed', 'scan_failed')
GROUP BY 1
ORDER BY 1 DESC;

-- Replacement-search completion and failure rates by day.
SELECT
  created_at::date AS event_date,
  count(*) FILTER (WHERE event_name = 'replacement_search_started') AS starts,
  count(*) FILTER (WHERE event_name = 'replacement_search_completed') AS completions,
  count(*) FILTER (WHERE event_name = 'replacement_search_failed') AS failures
FROM public.app_analytics_events
WHERE event_name IN ('replacement_search_started', 'replacement_search_completed', 'replacement_search_failed')
GROUP BY 1
ORDER BY 1 DESC;

-- Claim-pack completion and failure rates by day.
SELECT
  created_at::date AS event_date,
  count(*) FILTER (WHERE event_name = 'claim_pack_started') AS starts,
  count(*) FILTER (WHERE event_name = 'claim_pack_completed') AS completions,
  count(*) FILTER (WHERE event_name = 'claim_pack_failed') AS failures
FROM public.app_analytics_events
WHERE event_name IN ('claim_pack_started', 'claim_pack_completed', 'claim_pack_failed')
GROUP BY 1
ORDER BY 1 DESC;

-- Paywall and client purchase-flow interactions by day.
-- RevenueCat webhook data remains the billing source of truth.
SELECT
  created_at::date AS event_date,
  count(*) FILTER (WHERE event_name = 'paywall_viewed') AS paywall_views,
  count(*) FILTER (WHERE event_name = 'purchase_started') AS purchase_starts,
  count(*) FILTER (WHERE event_name = 'purchase_completed') AS client_purchase_completions,
  count(*) FILTER (WHERE event_name = 'purchase_failed') AS purchase_failures,
  count(*) FILTER (WHERE event_name = 'purchase_restored') AS purchase_restores
FROM public.app_analytics_events
WHERE event_name IN ('paywall_viewed', 'purchase_started', 'purchase_completed', 'purchase_failed', 'purchase_restored')
GROUP BY 1
ORDER BY 1 DESC;

-- Most recent analytics activity per user.
SELECT DISTINCT ON (user_id)
  user_id,
  event_name AS most_recent_event,
  created_at AS most_recent_event_at,
  installation_id,
  platform,
  app_version,
  build_number
FROM public.app_analytics_events
ORDER BY user_id, created_at DESC;

-- Storage-health snapshot for retention and growth reviews.
-- total_relation_size includes the table, indexes, and TOAST data.
SELECT
  pg_size_pretty(pg_total_relation_size('public.app_analytics_events')) AS total_relation_size,
  pg_size_pretty(pg_relation_size('public.app_analytics_events')) AS table_size,
  pg_size_pretty(pg_indexes_size('public.app_analytics_events')) AS indexes_size,
  count(*) AS event_count,
  min(created_at) AS oldest_event_at,
  max(created_at) AS newest_event_at
FROM public.app_analytics_events;
