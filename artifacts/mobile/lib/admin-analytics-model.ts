export type AdminUserAnalyticsFilter =
  | "all"
  | "active_7d"
  | "active_30d"
  | "never_active_after_creation"
  | "no_property"
  | "property_no_scan"
  | "completed_scan"
  | "inactive_30d";

export type AdminUserAnalyticsSort =
  | "last_active"
  | "account_created"
  | "email"
  | "most_items";

export const ADMIN_USER_FILTER_OPTIONS: ReadonlyArray<{
  value: AdminUserAnalyticsFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "active_7d", label: "Active 7d" },
  { value: "active_30d", label: "Active 30d" },
  { value: "never_active_after_creation", label: "Never active after signup" },
  { value: "no_property", label: "No property" },
  { value: "property_no_scan", label: "Property, no scan" },
  { value: "completed_scan", label: "Completed scan" },
  { value: "inactive_30d", label: "Inactive 30d+" },
];

export const ADMIN_USER_SORT_OPTIONS: ReadonlyArray<{
  value: AdminUserAnalyticsSort;
  label: string;
}> = [
  { value: "last_active", label: "Last active" },
  { value: "account_created", label: "Account created" },
  { value: "email", label: "Email" },
  { value: "most_items", label: "Most items" },
];

export interface AdminUsageAnalytics {
  metrics: {
    activeToday: number;
    active7d: number;
    active30d: number;
    newAccounts7d: number;
    newAccounts30d: number;
    propertyCreators: number;
    roomCreators: number;
    scanUsers: number;
    successfulScansMonth: number;
    failedScansMonth: number;
    replacementSearchesMonth: number;
    claimPacksCompletedMonth: number;
    paywallViewsMonth: number;
    purchaseStartsMonth: number;
    purchaseCompletionsMonth: number;
  };
  funnel: {
    registered: number;
    property: number;
    room: number;
    firstScan: number;
    returnedAfterFirstDay: number;
  };
}

export type AdminAnalyticsMetricKey =
  | "registered"
  | "new_accounts_30d"
  | "created_property"
  | "created_room"
  | "completed_first_scan"
  | "returned_after_first_day"
  | "active_today"
  | "active_7d"
  | "active_30d"
  | "successful_scans_month"
  | "failed_scans_month"
  | "replacement_searches_month"
  | "claim_packs_completed_month"
  | "paywall_views_month"
  | "purchase_starts_month"
  | "purchase_completions_month";

export type AdminAnalyticsMetricGroup =
  | "activation"
  | "product_usage"
  | "monetisation";
export type AdminAnalyticsMetricTone =
  | "blue"
  | "teal"
  | "lavender"
  | "amber"
  | "green"
  | "greyBlue";
export type AdminAnalyticsMetricPeriod =
  | "all_time"
  | "today"
  | "7d"
  | "30d"
  | "month";
export type AdminAnalyticsCountMode = "accounts" | "events";

export interface AdminAnalyticsMetricDefinition {
  key: AdminAnalyticsMetricKey;
  label: string;
  headlineLabel?: string;
  drilldownTitle: string;
  period: AdminAnalyticsMetricPeriod;
  group: AdminAnalyticsMetricGroup;
  tone: AdminAnalyticsMetricTone;
  icon:
    | "users"
    | "home"
    | "grid"
    | "camera"
    | "repeat"
    | "activity"
    | "alert-triangle"
    | "search"
    | "archive"
    | "eye"
    | "shopping-cart"
    | "check-circle";
  countMode: AdminAnalyticsCountMode;
  selectValue: (analytics: AdminUsageAnalytics) => number;
}

// Activation stages are independent, all-time historical event milestones.
// Deleting a property or room does not remove a milestone. A later stage may be
// higher than an earlier one when creation predated analytics collection or a
// best-effort event insert failed; later stages are never used to fabricate gaps.
export const ADMIN_ANALYTICS_METRICS: Readonly<
  Record<AdminAnalyticsMetricKey, AdminAnalyticsMetricDefinition>
> = {
  registered: {
    key: "registered",
    label: "Registered",
    drilldownTitle: "Registered accounts",
    period: "all_time",
    group: "activation",
    tone: "teal",
    icon: "users",
    countMode: "accounts",
    selectValue: (analytics) => analytics.funnel.registered,
  },
  new_accounts_30d: {
    key: "new_accounts_30d",
    label: "New accounts — 30 days",
    drilldownTitle: "New accounts",
    period: "30d",
    group: "activation",
    tone: "green",
    icon: "users",
    countMode: "accounts",
    selectValue: (analytics) => analytics.metrics.newAccounts30d,
  },
  created_property: {
    key: "created_property",
    label: "Created a property",
    drilldownTitle: "Property creators",
    period: "all_time",
    group: "activation",
    tone: "teal",
    icon: "home",
    countMode: "accounts",
    selectValue: (analytics) => analytics.funnel.property,
  },
  created_room: {
    key: "created_room",
    label: "Created a room",
    drilldownTitle: "Room creators",
    period: "all_time",
    group: "activation",
    tone: "teal",
    icon: "grid",
    countMode: "accounts",
    selectValue: (analytics) => analytics.funnel.room,
  },
  completed_first_scan: {
    key: "completed_first_scan",
    label: "Completed first scan",
    drilldownTitle: "Scan-activated accounts",
    period: "all_time",
    group: "activation",
    tone: "teal",
    icon: "camera",
    countMode: "accounts",
    selectValue: (analytics) => analytics.funnel.firstScan,
  },
  returned_after_first_day: {
    key: "returned_after_first_day",
    label: "Returned after first active day",
    drilldownTitle: "Returning accounts",
    period: "all_time",
    group: "activation",
    tone: "teal",
    icon: "repeat",
    countMode: "accounts",
    selectValue: (analytics) => analytics.funnel.returnedAfterFirstDay,
  },
  active_today: {
    key: "active_today",
    label: "Active today",
    drilldownTitle: "Active accounts",
    period: "today",
    group: "product_usage",
    tone: "blue",
    icon: "activity",
    countMode: "accounts",
    selectValue: (analytics) => analytics.metrics.activeToday,
  },
  active_7d: {
    key: "active_7d",
    label: "Active in 7 days",
    headlineLabel: "Active users — 7 days",
    drilldownTitle: "Active accounts",
    period: "7d",
    group: "product_usage",
    tone: "blue",
    icon: "activity",
    countMode: "accounts",
    selectValue: (analytics) => analytics.metrics.active7d,
  },
  active_30d: {
    key: "active_30d",
    label: "Active in 30 days",
    drilldownTitle: "Active accounts",
    period: "30d",
    group: "product_usage",
    tone: "blue",
    icon: "activity",
    countMode: "accounts",
    selectValue: (analytics) => analytics.metrics.active30d,
  },
  successful_scans_month: {
    key: "successful_scans_month",
    label: "Successful scans this month",
    headlineLabel: "Successful scans — this month",
    drilldownTitle: "Successful scans",
    period: "month",
    group: "product_usage",
    tone: "lavender",
    icon: "check-circle",
    countMode: "events",
    selectValue: (analytics) => analytics.metrics.successfulScansMonth,
  },
  failed_scans_month: {
    key: "failed_scans_month",
    label: "Failed scans this month",
    drilldownTitle: "Failed scans",
    period: "month",
    group: "product_usage",
    tone: "lavender",
    icon: "alert-triangle",
    countMode: "events",
    selectValue: (analytics) => analytics.metrics.failedScansMonth,
  },
  replacement_searches_month: {
    key: "replacement_searches_month",
    label: "Replacement searches this month",
    drilldownTitle: "Replacement searches",
    period: "month",
    group: "product_usage",
    tone: "lavender",
    icon: "search",
    countMode: "events",
    selectValue: (analytics) => analytics.metrics.replacementSearchesMonth,
  },
  claim_packs_completed_month: {
    key: "claim_packs_completed_month",
    label: "Claim packs completed this month",
    drilldownTitle: "Completed claim packs",
    period: "month",
    group: "product_usage",
    tone: "lavender",
    icon: "archive",
    countMode: "events",
    selectValue: (analytics) => analytics.metrics.claimPacksCompletedMonth,
  },
  paywall_views_month: {
    key: "paywall_views_month",
    label: "Paywall views this month",
    drilldownTitle: "Paywall views",
    period: "month",
    group: "monetisation",
    tone: "amber",
    icon: "eye",
    countMode: "events",
    selectValue: (analytics) => analytics.metrics.paywallViewsMonth,
  },
  purchase_starts_month: {
    key: "purchase_starts_month",
    label: "Purchase starts this month",
    headlineLabel: "Purchase starts — this month",
    drilldownTitle: "Purchase starts",
    period: "month",
    group: "monetisation",
    tone: "amber",
    icon: "shopping-cart",
    countMode: "events",
    selectValue: (analytics) => analytics.metrics.purchaseStartsMonth,
  },
  purchase_completions_month: {
    key: "purchase_completions_month",
    label: "Completed purchase flows this month",
    drilldownTitle: "Completed purchase flows",
    period: "month",
    group: "monetisation",
    tone: "green",
    icon: "check-circle",
    countMode: "events",
    selectValue: (analytics) => analytics.metrics.purchaseCompletionsMonth,
  },
};

export const ADMIN_ANALYTICS_HEADLINES: readonly AdminAnalyticsMetricKey[] = [
  "active_7d",
  "new_accounts_30d",
  "successful_scans_month",
  "purchase_starts_month",
];

export const ADMIN_ANALYTICS_GROUPS: ReadonlyArray<{
  key: AdminAnalyticsMetricGroup;
  label: string;
  tone: AdminAnalyticsMetricTone;
  metrics: readonly AdminAnalyticsMetricKey[];
}> = [
  {
    key: "activation",
    label: "Activation",
    tone: "teal",
    metrics: [
      "registered",
      "created_property",
      "created_room",
      "completed_first_scan",
      "returned_after_first_day",
    ],
  },
  {
    key: "product_usage",
    label: "Product usage",
    tone: "blue",
    metrics: [
      "active_today",
      "active_7d",
      "active_30d",
      "successful_scans_month",
      "failed_scans_month",
      "replacement_searches_month",
      "claim_packs_completed_month",
    ],
  },
  {
    key: "monetisation",
    label: "Monetisation",
    tone: "amber",
    metrics: [
      "paywall_views_month",
      "purchase_starts_month",
      "purchase_completions_month",
    ],
  },
];

const SUPPORTED_METRIC_KEYS = new Set<AdminAnalyticsMetricKey>(
  Object.keys(ADMIN_ANALYTICS_METRICS) as AdminAnalyticsMetricKey[],
);

export function adminAnalyticsMetricFromParam(
  value: unknown,
): AdminAnalyticsMetricKey | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" &&
    SUPPORTED_METRIC_KEYS.has(raw as AdminAnalyticsMetricKey)
    ? (raw as AdminAnalyticsMetricKey)
    : null;
}

export function adminAnalyticsMetricValue(
  analytics: AdminUsageAnalytics,
  metric: AdminAnalyticsMetricKey,
): number {
  return ADMIN_ANALYTICS_METRICS[metric].selectValue(analytics);
}

export function adminAnalyticsPeriodLabel(
  metric: AdminAnalyticsMetricKey,
  periodStart?: string | null,
): string {
  const period = ADMIN_ANALYTICS_METRICS[metric].period;
  if (period === "all_time") return "All time";
  if (period === "today") return "Today";
  if (period === "7d") return "Last 7 days";
  if (period === "30d") return "Last 30 days";
  const date = periodStart ? new Date(periodStart) : new Date();
  if (Number.isNaN(date.getTime())) return "This month";
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type AdminSafeFailureCategory =
  | "Network failure"
  | "Authentication failure"
  | "Function timeout"
  | "Usage limit reached"
  | "Invalid request"
  | "Processing failure"
  | "Unknown failure";

const SAFE_FAILURE_CATEGORIES = new Set<AdminSafeFailureCategory>([
  "Network failure",
  "Authentication failure",
  "Function timeout",
  "Usage limit reached",
  "Invalid request",
  "Processing failure",
  "Unknown failure",
]);

export function sanitizeAdminFailureCategory(
  value: string | null | undefined,
): AdminSafeFailureCategory | null {
  return value && SAFE_FAILURE_CATEGORIES.has(value as AdminSafeFailureCategory)
    ? (value as AdminSafeFailureCategory)
    : value
      ? "Unknown failure"
      : null;
}

export interface AdminAnalyticsDrilldownAccount {
  user_id: string;
  display_name: string | null;
  email: string | null;
  event_count: number;
  first_event_at: string | null;
  last_event_at: string;
  last_active_at: string | null;
  created_at: string | null;
  effective_plan: string | null;
  tester_status: string | null;
  platform: string | null;
  app_version: string | null;
  failure_category: AdminSafeFailureCategory | null;
  plan: string | null;
  product_identifier: string | null;
  cursor_activity_at: string;
}

export interface AdminAnalyticsDrilldownPage {
  metricKey: AdminAnalyticsMetricKey;
  totalEvents: number;
  totalAccounts: number;
  periodStart: string | null;
  periodEnd: string;
  items: AdminAnalyticsDrilldownAccount[];
  hasMore: boolean;
}

export interface AdminAnalyticsDrilldownCursor {
  activityAt: string;
  userId: string;
}

export function adminAnalyticsDrilldownRpcParams(input: {
  metric: AdminAnalyticsMetricKey;
  cursor?: AdminAnalyticsDrilldownCursor | null;
  limit?: number;
}): Record<string, unknown> {
  return {
    p_metric: input.metric,
    p_limit: Math.min(Math.max(Math.trunc(input.limit ?? 30), 1), 50),
    p_before_activity_at: input.cursor?.activityAt ?? null,
    p_before_user_id: input.cursor?.userId ?? null,
  };
}

export function cursorFromAdminAnalyticsPage(
  page: AdminAnalyticsDrilldownPage | undefined,
): AdminAnalyticsDrilldownCursor | null {
  const last = page?.items.at(-1);
  return last
    ? { activityAt: last.cursor_activity_at, userId: last.user_id }
    : null;
}

export function mergeAdminAnalyticsPages(
  pages: AdminAnalyticsDrilldownPage[] | undefined,
): AdminAnalyticsDrilldownAccount[] {
  const seen = new Set<string>();
  const accounts: AdminAnalyticsDrilldownAccount[] = [];
  for (const page of pages ?? []) {
    for (const account of page.items) {
      if (seen.has(account.user_id)) continue;
      seen.add(account.user_id);
      accounts.push(account);
    }
  }
  return accounts;
}

export interface AdminUserActivity {
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
  firstEventName: string | null;
  firstEventAt: string | null;
  latestEventName: string | null;
  latestEventAt: string | null;
  appOpens7d: number;
  appOpens30d: number;
  successfulScans30d: number;
  failedScans30d: number;
  replacementSearches30d: number;
  failedReplacementSearches30d: number;
  claimPacksCompleted30d: number;
  claimPacksFailed30d: number;
  paywallViews30d: number;
  purchaseStarts30d: number;
}

export interface AdminRecentActivityEvent {
  id: string;
  eventName: string;
  createdAt: string;
  summary: string | null;
}

const EVENT_LABELS: Readonly<Record<string, string>> = {
  app_opened: "Opened the app",
  app_foregrounded: "Returned to the app",
  property_created: "Created a property",
  room_created: "Created a room",
  item_created_manually: "Added an item manually",
  scan_started: "Started a scan",
  scan_completed: "Completed a scan",
  scan_failed: "Scan failed",
  replacement_search_started: "Started a replacement search",
  replacement_search_completed: "Completed a replacement search",
  replacement_search_failed: "Replacement search failed",
  claim_pack_started: "Started a claim pack",
  claim_pack_completed: "Completed a claim pack",
  claim_pack_failed: "Claim pack failed",
  paywall_viewed: "Viewed the paywall",
  purchase_started: "Started a purchase",
  purchase_completed: "Completed a purchase",
  purchase_failed: "Purchase failed",
  purchase_restored: "Restored a purchase",
};

export function adminFunnelPercent(count: number, registered: number): string {
  if (
    !Number.isFinite(count) ||
    !Number.isFinite(registered) ||
    registered <= 0
  )
    return "—";
  return `${Math.round((count / registered) * 1000) / 10}%`;
}

export function adminActivityDateLabel(
  value: string | null | undefined,
  emptyLabel: "Never signed in" | "No recorded activity",
): string {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return emptyLabel;
  return date.toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function adminTimelineEventView(event: AdminRecentActivityEvent): {
  label: string;
  summary: string | null;
} {
  const label = EVENT_LABELS[event.eventName] ?? "Recorded activity";
  if (!(event.eventName in EVENT_LABELS)) return { label, summary: null };
  const summary = event.summary?.replace(/[\r\n]+/g, " ").trim();
  if (!summary || summary.startsWith("{") || summary.startsWith("["))
    return { label, summary: null };
  return { label, summary: summary.slice(0, 120) };
}
