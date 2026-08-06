import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_ANALYTICS_METRICS,
  adminActivityDateLabel,
  adminFunnelPercent,
  adminTimelineEventView,
} from "../admin-analytics-model.ts";
import {
  adminUsersAnalyticsRpcParams,
  cursorFromAdminUserPage,
} from "../admin-list-model.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
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
const usersScreen = readFileSync(
  resolve(testDirectory, "../../app/(tabs)/admin-users.tsx"),
  "utf8",
);
const userDetailScreen = readFileSync(
  resolve(testDirectory, "../../app/(tabs)/admin-user/[id].tsx"),
  "utf8",
);

const rpcNames = [
  "admin_get_usage_analytics",
  "admin_list_users_analytics_page",
  "admin_get_user_activity",
  "admin_get_user_recent_activity",
];

test("analytics RPCs are security definer, fixed-path, and explicitly admin-gated", () => {
  for (const name of rpcNames) {
    const start = migration.indexOf(
      `CREATE OR REPLACE FUNCTION public.${name}`,
    );
    assert.notEqual(start, -1, name);
    const next = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.",
      start + 1,
    );
    const definition = migration.slice(start, next === -1 ? undefined : next);
    assert.match(definition, /SECURITY DEFINER/);
    assert.match(definition, /SET search_path = ''/);
    assert.match(definition, /auth\.uid\(\) IS NULL OR NOT EXISTS/);
    assert.match(
      definition,
      /caller\.id = auth\.uid\(\)[\s\S]*caller\.app_role = 'admin'/,
    );
    assert.match(
      definition,
      /RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'/,
    );
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, anon`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO authenticated`,
      ),
    );
  }
  assert.doesNotMatch(
    migration,
    /GRANT SELECT ON (TABLE )?public\.app_analytics_events TO authenticated/,
  );
});

test("overview metric definitions use profile activity, accounts, and bounded event names", () => {
  for (const key of [
    "activeToday",
    "active7d",
    "active30d",
    "newAccounts7d",
    "newAccounts30d",
    "propertyCreators",
    "roomCreators",
    "scanUsers",
    "successfulScansMonth",
    "failedScansMonth",
    "replacementSearchesMonth",
    "claimPacksCompletedMonth",
    "paywallViewsMonth",
    "purchaseStartsMonth",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(
    migration,
    /purchaseCompletionsMonth|v_purchase_completions_month/,
  );
  assert.match(
    completedPurchaseMigration,
    /'purchaseCompletionsMonth', v_purchase_completions_month/,
  );
  assert.match(completedPurchaseMigration, /event_name = 'purchase_completed'/);
  assert.equal(
    ADMIN_ANALYTICS_METRICS.purchase_completions_month.countMode,
    "events",
  );
  assert.match(
    migration,
    /GREATEST\([\s\S]*up\.last_active_at[\s\S]*activity\.last_event_at/,
  );
  assert.match(migration, /event_name = 'property_created'/);
  assert.match(migration, /event_name = 'room_created'/);
  assert.match(
    migration,
    /au\.created_at >= pg_catalog\.now\(\) - interval '30 days'/,
  );
  assert.match(migration, /date_trunc\('month', pg_catalog\.now\(\)\)/);
});

test("activation funnel is account-based and reports approximate percentages", () => {
  for (const key of [
    "registered",
    "property",
    "room",
    "firstScan",
    "returnedAfterFirstDay",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
  assert.match(
    migration,
    /later\.created_at::date > first_seen\.first_active_date/,
  );
  assert.equal(adminFunnelPercent(25, 200), "12.5%");
  assert.equal(adminFunnelPercent(0, 0), "\u2014");
  assert.match(overviewScreen, /Approx\. \$\{adminFunnelPercent/);
  assert.doesNotMatch(overviewScreen, /download conversion/i);
});

test("directory sends server-side filters, sorts, and stable sort-aware cursors", () => {
  assert.deepEqual(
    adminUsersAnalyticsRpcParams({
      query: "person@example.com",
      filter: "inactive_30d",
      sort: "most_items",
      cursor: { sortValue: "42", id: "11111111-1111-4111-8111-111111111111" },
      limit: 500,
    }),
    {
      p_query: "person@example.com",
      p_filter: "inactive_30d",
      p_sort: "most_items",
      p_limit: 50,
      p_before_sort_value: "42",
      p_before_id: "11111111-1111-4111-8111-111111111111",
    },
  );

  assert.deepEqual(
    cursorFromAdminUserPage({
      items: [{ id: "2", cursor_sort_value: "12" }],
      hasMore: true,
    }),
    { sortValue: "12", id: "2" },
  );
  assert.equal(cursorFromAdminUserPage({ items: [], hasMore: false }), null);

  for (const value of [
    "active_7d",
    "active_30d",
    "never_active_after_creation",
    "no_property",
    "property_no_scan",
    "completed_scan",
    "inactive_30d",
  ])
    assert.match(migration, new RegExp(`'${value}'`));
  for (const value of [
    "last_active",
    "account_created",
    "email",
    "most_items",
  ]) {
    assert.match(migration, new RegExp(`'${value}'`));
  }
  assert.match(migration, /LIMIT v_limit \+ 1/);
  assert.match(migration, /count\(\*\) > v_limit/);
  assert.match(usersScreen, /useInfiniteQuery/);
  assert.match(usersScreen, /cursorFromAdminUserPage/);
});

test("directory and detail keep sign-in and last-active timestamps separate", () => {
  const signIn = "2026-08-01T01:00:00.000Z";
  const activity = "2026-08-06T04:00:00.000Z";
  assert.notEqual(
    adminActivityDateLabel(signIn, "Never signed in"),
    adminActivityDateLabel(activity, "No recorded activity"),
  );
  assert.equal(
    adminActivityDateLabel(null, "Never signed in"),
    "Never signed in",
  );
  assert.equal(
    adminActivityDateLabel(null, "No recorded activity"),
    "No recorded activity",
  );
  assert.match(migration, /au\.last_sign_in_at/);
  assert.match(migration, /up\.last_active_at/);
  assert.match(usersScreen, /Last sign-in[\s\S]*Last active/);
  assert.match(
    userDetailScreen,
    /title="Last sign-in"[\s\S]*title="Last active"/,
  );
});

test("activity summary covers 7d and 30d windows and zero fallbacks", () => {
  assert.match(migration, /app_opened'[\s\S]*interval '7 days'/);
  assert.match(migration, /app_opened'[\s\S]*interval '30 days'/);
  assert.match(migration, /COALESCE\(counts\.successful_scans_30d, 0\)/);
  assert.match(migration, /COALESCE\(counts\.paywall_views_30d, 0\)/);
  assert.match(migration, /COALESCE\(counts\.purchase_starts_30d, 0\)/);
  assert.match(userDetailScreen, /No recorded activity/);
  assert.match(userDetailScreen, /Never signed in/);
  assert.match(userDetailScreen, /No activity in the last 30 days/);
});

test("recent activity is capped at 20 and cannot render raw JSON", () => {
  assert.match(
    migration,
    /ORDER BY e\.created_at DESC, e\.id DESC[\s\S]*LIMIT 20/,
  );
  assert.doesNotMatch(migration, /'properties',\s*e\.properties/);
  assert.doesNotMatch(userDetailScreen, /\.properties/);

  assert.deepEqual(
    adminTimelineEventView({
      id: "1",
      eventName: "scan_completed",
      createdAt: "2026-08-06T00:00:00.000Z",
      summary: "automatic · 4 items detected",
    }),
    { label: "Completed a scan", summary: "automatic · 4 items detected" },
  );
  assert.deepEqual(
    adminTimelineEventView({
      id: "2",
      eventName: "unknown_event",
      createdAt: "2026-08-06T00:00:00.000Z",
      summary: "should not display",
    }),
    { label: "Recorded activity", summary: null },
  );
  assert.equal(
    adminTimelineEventView({
      id: "3",
      eventName: "scan_failed",
      createdAt: "2026-08-06T00:00:00.000Z",
      summary: '{"raw":"hidden"}',
    }).summary,
    null,
  );
});

test("empty analytics states and retry controls remain isolated", () => {
  assert.match(overviewScreen, /The rest of Admin is still available/);
  assert.match(overviewScreen, /Retry analytics/);
  assert.match(userDetailScreen, /No recorded activity/);
  assert.match(userDetailScreen, /Tap to retry/);
  assert.match(usersScreen, /No users are available/);
});
