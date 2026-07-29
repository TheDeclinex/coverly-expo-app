export const ADMIN_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_MAX_PAGE_SIZE = 50;

export type AdminTimeframe = "7d" | "30d" | "90d" | "all";
export type AdminCursor = {
  createdAt: string;
  id: string;
};

export interface AdminPage<T> {
  items: T[];
  hasMore: boolean;
}

export type AdminSupportFilter = "needs_attention" | "new" | "open" | "closed" | "all";
export type AdminClaimPackStatusFilter = "all" | "processing" | "generated" | "failed";
export type AdminEventSeverityFilter = "all" | "warning" | "error" | "critical";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLETE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function clampAdminLimit(limit: number | null | undefined, fallback = ADMIN_DEFAULT_PAGE_SIZE): number {
  const candidate = Number.isFinite(limit) ? Math.trunc(limit!) : fallback;
  return Math.min(Math.max(candidate, 1), ADMIN_MAX_PAGE_SIZE);
}

export function normalizeAdminSearchQuery(value: string): string {
  return value.trim();
}

export function canRunAdminUserSearch(value: string): boolean {
  const query = normalizeAdminSearchQuery(value);
  return query.length >= 2 || EMAIL_PATTERN.test(query) || UUID_PATTERN.test(query);
}

export function adminUserDirectoryEffectiveQuery(value: string): string | null {
  const query = normalizeAdminSearchQuery(value);
  if (query.length >= 2 || COMPLETE_UUID_PATTERN.test(query)) return query;
  return null;
}

export function adminUsersRpcParams(input: {
  query: string | null;
  cursor?: AdminCursor | null;
  limit?: number;
}): Record<string, unknown> {
  return {
    p_query: input.query === null ? null : adminUserDirectoryEffectiveQuery(input.query),
    p_limit: clampAdminLimit(input.limit, 50),
    p_before_created_at: input.cursor?.createdAt ?? null,
    p_before_id: input.cursor?.id ?? null,
  };
}

export function adminDateRange(
  timeframe: AdminTimeframe,
  now = new Date(),
): { from: string | null; to: string } {
  const to = new Date(now);
  if (Number.isNaN(to.getTime())) throw new Error("A valid date is required.");
  if (timeframe === "all") return { from: null, to: to.toISOString() };

  const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function cursorFromPage<T extends { id: string; cursor_created_at?: string | null; created_at?: string | null }>(
  page: AdminPage<T> | undefined,
): AdminCursor | null {
  const last = page?.items.at(-1);
  const createdAt = last?.cursor_created_at ?? last?.created_at;
  return last && createdAt ? { createdAt, id: last.id } : null;
}

export function mergeAdminPages<T extends { id: string }>(pages: Array<AdminPage<T>> | undefined): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

export function supportNeedsAttention(input: {
  status: string | null | undefined;
  hasUnreadUserMessage: boolean;
}): boolean {
  const status = input.status?.trim().toLowerCase() || "new";
  return status === "new"
    || ["under_investigation", "development", "testing"].includes(status)
    || input.hasUnreadUserMessage;
}

export function supportTimeframeApplies(filter: AdminSupportFilter): boolean {
  return filter === "closed" || filter === "all";
}

export function adminSupportRpcParams(input: {
  filter: AdminSupportFilter;
  timeframe: AdminTimeframe;
  cursor?: AdminCursor | null;
  limit?: number;
  now?: Date;
}): Record<string, unknown> {
  const range = supportTimeframeApplies(input.filter)
    ? adminDateRange(input.timeframe, input.now)
    : { from: null, to: null };
  return {
    p_limit: clampAdminLimit(input.limit),
    p_before_created_at: input.cursor?.createdAt ?? null,
    p_before_id: input.cursor?.id ?? null,
    p_from: range.from,
    p_to: range.to,
    p_status: input.filter,
  };
}

export function adminClaimPackRpcParams(input: {
  status: AdminClaimPackStatusFilter;
  timeframe: AdminTimeframe;
  query: string;
  cursor?: AdminCursor | null;
  limit?: number;
  now?: Date;
}): Record<string, unknown> {
  const range = adminDateRange(input.timeframe, input.now);
  return {
    p_limit: clampAdminLimit(input.limit),
    p_before_created_at: input.cursor?.createdAt ?? null,
    p_before_id: input.cursor?.id ?? null,
    p_from: range.from,
    p_to: range.to,
    p_status: input.status,
    p_query: normalizeAdminSearchQuery(input.query) || null,
  };
}

export function adminEventRpcParams(input: {
  timeframe: AdminTimeframe;
  severity: AdminEventSeverityFilter;
  source: string;
  cursor?: AdminCursor | null;
  limit?: number;
  now?: Date;
}): Record<string, unknown> {
  const range = adminDateRange(input.timeframe, input.now);
  return {
    p_limit: clampAdminLimit(input.limit),
    p_before_created_at: input.cursor?.createdAt ?? null,
    p_before_id: input.cursor?.id ?? null,
    p_from: range.from,
    p_to: range.to,
    p_severity: input.severity,
    p_source: normalizeAdminSearchQuery(input.source) || null,
  };
}
