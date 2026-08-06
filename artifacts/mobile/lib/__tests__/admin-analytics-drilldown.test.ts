import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_ANALYTICS_GROUPS,
  ADMIN_ANALYTICS_HEADLINES,
  ADMIN_ANALYTICS_METRICS,
  adminAnalyticsDrilldownRpcParams,
  adminAnalyticsMetricFromParam,
  adminAnalyticsMetricValue,
  cursorFromAdminAnalyticsPage,
  mergeAdminAnalyticsPages,
  sanitizeAdminFailureCategory,
  type AdminUsageAnalytics,
} from "../admin-analytics-model.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    testDirectory,
    "../../../../supabase/migrations/20260806020000_admin_analytics_drilldowns.sql",
  ),
  "utf8",
);
const overviewMigration = readFileSync(
  resolve(
    testDirectory,
    "../../../../supabase/migrations/20260806010000_admin_analytics_visibility.sql",
  ),
  "utf8",
);
const completedPurchaseMigration = readFileSync(
  resolve(
    testDirectory,
    "../../../../supabase/migrations/20260806030000_admin_completed_purchase_metric.sql",
  ),
  "utf8",
);
const overviewScreen = readFileSync(
  resolve(testDirectory, "../../app/(tabs)/admin.tsx"),
  "utf8",
);
const drilldownScreen = readFileSync(
  resolve(testDirectory, "../../app/(tabs)/admin-analytics/[metric].tsx"),
  "utf8",
);
const accountMenu = readFileSync(
  resolve(testDirectory, "../../components/AccountMenu.tsx"),
  "utf8",
);

const analytics: AdminUsageAnalytics = {
  metrics: {
    activeToday: 1,
    active7d: 2,
    active30d: 3,
    newAccounts7d: 4,
    newAccounts30d: 5,
    propertyCreators: 6,
    roomCreators: 7,
    scanUsers: 8,
    successfulScansMonth: 9,
    failedScansMonth: 10,
    replacementSearchesMonth: 11,
    claimPacksCompletedMonth: 12,
    paywallViewsMonth: 13,
    purchaseStartsMonth: 14,
    purchaseCompletionsMonth: 15,
  },
  funnel: {
    registered: 16,
    property: 6,
    room: 7,
    firstScan: 8,
    returnedAfterFirstDay: 2,
  },
};

test("headline cards and compact metric groups have a stable order", () => {
  assert.deepEqual(ADMIN_ANALYTICS_HEADLINES, [
    "active_7d",
    "new_accounts_30d",
    "successful_scans_month",
    "purchase_starts_month",
  ]);
  assert.deepEqual(
    ADMIN_ANALYTICS_GROUPS.map((group) => group.key),
    ["activation", "product_usage", "monetisation"],
  );
  assert.deepEqual(ADMIN_ANALYTICS_GROUPS[0].metrics, [
    "registered",
    "created_property",
    "created_room",
    "completed_first_scan",
    "returned_after_first_day",
  ]);
  assert.match(overviewScreen, /ADMIN_ANALYTICS_HEADLINES\.map/);
  assert.match(overviewScreen, /ADMIN_ANALYTICS_GROUPS\.map/);
  assert.doesNotMatch(overviewScreen, /horizontal/);
});

test("pastel tones come from the existing menu colour vocabulary", () => {
  assert.equal(ADMIN_ANALYTICS_GROUPS[0].tone, "teal");
  assert.equal(ADMIN_ANALYTICS_GROUPS[1].tone, "blue");
  assert.equal(ADMIN_ANALYTICS_GROUPS[2].tone, "amber");
  assert.match(overviewScreen, /#F8FBFF/);
  assert.match(overviewScreen, /#F6FCFA/);
  assert.match(overviewScreen, /#FFFCF5/);
  assert.match(accountMenu, /tone\?: AccountRowTone/);
});

test("metric route parameters use a strict typed allowlist", () => {
  assert.equal(
    adminAnalyticsMetricFromParam("successful_scans_month"),
    "successful_scans_month",
  );
  assert.equal(
    adminAnalyticsMetricFromParam(["active_7d", "ignored"]),
    "active_7d",
  );
  assert.equal(
    adminAnalyticsMetricFromParam("app_analytics_events; drop table"),
    null,
  );
  assert.equal(adminAnalyticsMetricFromParam("unknown"), null);
  for (const key of Object.keys(ADMIN_ANALYTICS_METRICS)) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
});

test("summary selectors match the values represented by drill-down metrics", () => {
  assert.equal(adminAnalyticsMetricValue(analytics, "registered"), 16);
  assert.equal(adminAnalyticsMetricValue(analytics, "created_property"), 6);
  assert.equal(
    adminAnalyticsMetricValue(analytics, "successful_scans_month"),
    9,
  );
  assert.equal(
    adminAnalyticsMetricValue(analytics, "purchase_completions_month"),
    15,
  );

  const eventDefinitions = [
    ["propertyCreators", "property_created"],
    ["roomCreators", "room_created"],
    ["successfulScansMonth", "scan_completed"],
    ["failedScansMonth", "scan_failed"],
    ["replacementSearchesMonth", "replacement_search_completed"],
    ["claimPacksCompletedMonth", "claim_pack_completed"],
    ["paywallViewsMonth", "paywall_viewed"],
    ["purchaseStartsMonth", "purchase_started"],
    ["purchaseCompletionsMonth", "purchase_completed"],
  ] as const;
  for (const [summaryKey, eventName] of eventDefinitions) {
    const summarySource =
      summaryKey === "purchaseCompletionsMonth"
        ? completedPurchaseMigration
        : overviewMigration;
    assert.match(summarySource, new RegExp(`'${summaryKey}'`));
    assert.match(summarySource, new RegExp(`event_name = '${eventName}'`));
    assert.match(migration, new RegExp(`event_name = '${eventName}'`));
  }
});

test("completed purchase overview change is forward-only after the applied migrations", () => {
  assert.doesNotMatch(
    overviewMigration,
    /purchaseCompletionsMonth|v_purchase_completions_month|event_name = 'purchase_completed'/,
  );
  assert.match(
    completedPurchaseMigration,
    /CREATE OR REPLACE FUNCTION public\.admin_get_usage_analytics\(\)/,
  );
  assert.doesNotMatch(
    completedPurchaseMigration,
    /CREATE (TABLE|INDEX)|admin_get_analytics_metric_accounts|admin_list_users_analytics_page/,
  );
  assert.match(completedPurchaseMigration, /SET search_path = ''/);
  assert.match(
    completedPurchaseMigration,
    /auth\.uid\(\) IS NULL OR NOT EXISTS/,
  );
  assert.match(completedPurchaseMigration, /caller\.app_role = 'admin'/);
  assert.match(
    completedPurchaseMigration,
    /REVOKE ALL[\s\S]*FROM PUBLIC, anon/,
  );
  assert.match(
    completedPurchaseMigration,
    /GRANT EXECUTE[\s\S]*TO authenticated/,
  );
});

test("drill-down SQL counts unique accounts separately from total events", () => {
  assert.match(migration, /GROUP BY e\.user_id/);
  assert.match(
    migration,
    /'totalEvents', COALESCE\(\(SELECT sum\(metric_rows\.event_count\)/,
  );
  assert.match(
    migration,
    /'totalAccounts', \(SELECT count\(\*\) FROM metric_rows\)/,
  );
  assert.match(
    migration,
    /ORDER BY enriched\.cursor_activity_at DESC, enriched\.user_id DESC/,
  );
  assert.match(migration, /LIMIT v_limit \+ 1/);
});

test("activation milestones survive later property or room deletion", () => {
  const functionStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_get_analytics_metric_accounts",
  );
  const functionEnd = migration.indexOf("ALTER FUNCTION", functionStart);
  const definition = migration.slice(functionStart, functionEnd);
  assert.match(
    definition,
    /'created_property' THEN e\.event_name = 'property_created'/,
  );
  assert.match(
    definition,
    /'created_room' THEN e\.event_name = 'room_created'/,
  );
  assert.match(
    definition,
    /'completed_first_scan' THEN e\.event_name = 'scan_completed'/,
  );
  assert.doesNotMatch(definition, /inventory_files|inventory_rooms/);
});

test("returned-after-first-day and date windows are explicit", () => {
  assert.match(
    migration,
    /e\.created_at::date > first_seen\.first_active_date/,
  );
  assert.match(migration, /later UTC calendar day/);
  assert.match(migration, /v_now - interval '7 days'/);
  assert.match(migration, /v_now - interval '30 days'/);
  assert.match(migration, /date_trunc\('month', v_now\)/);
});

test("failed scan categories are sanitized to the display allowlist", () => {
  assert.equal(
    sanitizeAdminFailureCategory("Network failure"),
    "Network failure",
  );
  assert.equal(
    sanitizeAdminFailureCategory("stack trace: secret"),
    "Unknown failure",
  );
  assert.equal(sanitizeAdminFailureCategory(null), null);
  for (const label of [
    "Network failure",
    "Authentication failure",
    "Function timeout",
    "Usage limit reached",
    "Invalid request",
    "Processing failure",
    "Unknown failure",
  ])
    assert.match(migration, new RegExp(label));
});

test("drill-down response exposes only bounded behavioural metadata", () => {
  const responseStart = migration.indexOf("enriched AS (");
  const responseEnd = migration.indexOf("ALTER FUNCTION", responseStart);
  const response = migration.slice(responseStart, responseEnd);
  for (const forbidden of [
    "property_name",
    "address",
    "room_name",
    "item_name",
    "description",
    "photo_url",
    "receipt",
    "claim_evidence",
    "storage_path",
    "support_message",
    "access_token",
    "signed_url",
    "search_text",
    "prompt",
    "response_body",
  ])
    assert.doesNotMatch(response, new RegExp(forbidden, "i"));
  assert.match(migration, /LIMIT v_limit \+ 1/);
  assert.match(
    migration,
    /LEAST\(GREATEST\(COALESCE\(p_limit, 30\), 1\), 50\)/,
  );
});

test("cursor parameters, merging, and incremental loading remain bounded", () => {
  const cursor = {
    activityAt: "2026-08-06T01:00:00.000Z",
    userId: "11111111-1111-4111-8111-111111111111",
  };
  assert.deepEqual(
    adminAnalyticsDrilldownRpcParams({
      metric: "active_7d",
      cursor,
      limit: 500,
    }),
    {
      p_metric: "active_7d",
      p_limit: 50,
      p_before_activity_at: cursor.activityAt,
      p_before_user_id: cursor.userId,
    },
  );
  const page = {
    metricKey: "active_7d" as const,
    totalEvents: 3,
    totalAccounts: 1,
    periodStart: "2026-07-30T00:00:00.000Z",
    periodEnd: "2026-08-06T00:00:00.000Z",
    hasMore: false,
    items: [
      {
        user_id: cursor.userId,
        display_name: null,
        email: "user@example.com",
        event_count: 3,
        first_event_at: null,
        last_event_at: cursor.activityAt,
        last_active_at: cursor.activityAt,
        created_at: "2026-01-01T00:00:00.000Z",
        effective_plan: "free",
        tester_status: null,
        platform: "ios",
        app_version: "1.0.0",
        failure_category: null,
        plan: null,
        product_identifier: null,
        cursor_activity_at: cursor.activityAt,
      },
    ],
  };
  assert.deepEqual(cursorFromAdminAnalyticsPage(page), cursor);
  assert.equal(mergeAdminAnalyticsPages([page, page]).length, 1);
  assert.match(drilldownScreen, /useInfiniteQuery/);
  assert.match(drilldownScreen, /fetchNextPage/);
});

test("navigation and loading, empty, error states are wired", () => {
  assert.match(overviewScreen, /admin-analytics\/\[metric\]/);
  assert.match(drilldownScreen, /admin-user\/\[id\]/);
  assert.match(drilldownScreen, /Loading accounts/);
  assert.match(drilldownScreen, /No accounts matched this metric for/);
  assert.match(drilldownScreen, /Analytics unavailable/);
  assert.match(drilldownScreen, /onRefresh/);
});

test("drill-down RPC and route remain admin-only", () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /auth\.uid\(\) IS NULL OR NOT EXISTS/);
  assert.match(migration, /caller\.app_role = 'admin'/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO authenticated/);
  assert.doesNotMatch(migration, /GRANT SELECT ON .*app_analytics_events/i);
  assert.match(drilldownScreen, /if \(!isAdmin\) return <Redirect/);
});
