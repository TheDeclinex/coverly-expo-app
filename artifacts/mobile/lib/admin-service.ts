import { supabase } from "@/lib/supabase";
import { adminUserIdDebugSummary } from "@/lib/admin-model";

export interface AdminOverview {
  totalUsers: number | null;
  activeTesters: number | null;
  aiScansThisMonth: number | null;
  replacementLookupsThisMonth: number | null;
  claimPacksGenerated: number | null;
  recentErrors: number | null;
  monthKey?: string | null;
}

export interface AdminUserSearchResult {
  id: string;
  email: string | null;
  full_name: string | null;
  app_role: string | null;
  effective_plan: string | null;
  tester_status: string | null;
  created_at: string | null;
}

export interface AdminUserProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  appRole: string | null;
  plan: string | null;
  effectivePlan: string | null;
  testerStatus: string | null;
  createdAt: string | null;
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  subscriptionPeriodEnd: string | null;
  overridePlan: string | null;
  overrideStatus: string | null;
  overrideReason: string | null;
  overrideExpiresAt: string | null;
  revenueCatCustomerId: string | null;
  revenueCatProductId: string | null;
  revenueCatEntitlementId: string | null;
  revenueCatStatus: string | null;
  revenueCatUpdatedAt: string | null;
}

export interface AdminUserDetail {
  profile: AdminUserProfile;
  counts: {
    propertyCount: number | null;
    roomCount: number | null;
    itemCount: number | null;
    claimPackCount: number | null;
  };
  usage: {
    monthKey: string | null;
    aiScans: number | null;
    replacementLookups: number | null;
  };
  recentSupport: Array<{
    id: string;
    title: string | null;
    status: string | null;
    severity: string | null;
    createdAt: string | null;
  }>;
  supportsBonusAllowance: boolean;
}

export interface AdminEntitlementDebug {
  profile: AdminUserProfile;
  usage: AdminUserDetail["usage"];
  entitlementMode: string | null;
  revenueCatConnected: boolean;
  revenueCatExplanation: string | null;
  supportsBonusAllowance: boolean;
}

export type AdminAccessAction = "grant_tester" | "remove_tester" | "grant_plus" | "grant_family" | "clear_access" | "add_bonus_allowance";

export interface AdminUserFile {
  id: string;
  name: string | null;
  property_type: string | null;
  contents_sum_insured: number | null;
  inventory_value: number | null;
  room_count: number | null;
  item_count: number | null;
  claim_pack_count: number | null;
  updated_at: string | null;
}

export interface AdminClaimPackSummary {
  id: string;
  user_id: string | null;
  user_email: string | null;
  file_id: string | null;
  property_name: string | null;
  status: string | null;
  created_at: string | null;
  generated_at: string | null;
  email_sent: boolean | null;
  generation_error: string | null;
}

export interface AdminClaimPackDetail {
  claimPack: Record<string, unknown>;
  userEmail: string | null;
  propertyName: string | null;
  retryAvailable: boolean;
  retryUnavailableReason: string | null;
}

export interface AdminEvent {
  id: string;
  created_at: string | null;
  source: string | null;
  screen: string | null;
  severity: string | null;
  message: string | null;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
}

async function rpcValue<T>(name: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data as T;
}

function adminDevLog(event: string, details?: Record<string, unknown>) {
  if (!__DEV__) return;
  console.log(`[admin] ${event}`, details ?? {});
}

function adminErrorSummary(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  const maybeError = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  return {
    message: typeof maybeError.message === "string" ? maybeError.message : "Unknown admin RPC error",
    code: typeof maybeError.code === "string" ? maybeError.code : undefined,
    hasDetails: typeof maybeError.details === "string" && maybeError.details.length > 0,
    hasHint: typeof maybeError.hint === "string" && maybeError.hint.length > 0,
  };
}

export function loadAdminOverview(): Promise<AdminOverview> {
  return rpcValue<AdminOverview>("admin_get_overview");
}

export function searchAdminUsers(query: string, limit = 25): Promise<AdminUserSearchResult[]> {
  return rpcValue<AdminUserSearchResult[]>("admin_search_users", {
    p_query: query,
    p_limit: limit,
  });
}

export async function loadAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const target = adminUserIdDebugSummary(userId);
  adminDevLog("admin_get_user_detail starting", { target });
  try {
    const detail = await rpcValue<AdminUserDetail>("admin_get_user_detail", { p_user_id: userId });
    adminDevLog("admin_get_user_detail succeeded", {
      target,
      hasProfile: !!detail?.profile,
      propertyCount: detail?.counts?.propertyCount ?? null,
    });
    return detail;
  } catch (error) {
    adminDevLog("admin_get_user_detail failed", { target, error: adminErrorSummary(error) });
    throw error;
  }
}

export function updateAdminUserAccess(input: {
  userId: string;
  action: AdminAccessAction;
  expiresAt?: string | null;
  reason?: string | null;
}): Promise<AdminUserDetail> {
  const target = adminUserIdDebugSummary(input.userId);
  adminDevLog("admin_update_user_access starting", {
    target,
    action: input.action,
    hasExpiry: !!input.expiresAt,
    hasReason: !!input.reason,
  });
  return rpcValue<AdminUserDetail>("admin_update_user_access", {
    p_user_id: input.userId,
    p_action: input.action,
    p_expires_at: input.expiresAt ?? null,
    p_reason: input.reason ?? null,
  })
    .then((detail) => {
      adminDevLog("admin_update_user_access succeeded", {
        target,
        action: input.action,
        effectivePlan: detail?.profile?.effectivePlan ?? null,
        testerStatus: detail?.profile?.testerStatus ?? null,
      });
      return detail;
    })
    .catch((error) => {
      adminDevLog("admin_update_user_access failed", { target, action: input.action, error: adminErrorSummary(error) });
      throw error;
    });
}

export function loadAdminEntitlementDebug(userId: string): Promise<AdminEntitlementDebug> {
  return rpcValue<AdminEntitlementDebug>("admin_get_entitlement_debug", { p_user_id: userId });
}

export async function loadAdminUserFiles(userId: string): Promise<AdminUserFile[]> {
  const target = adminUserIdDebugSummary(userId);
  adminDevLog("admin_list_user_files starting", { target });
  try {
    const files = await rpcValue<AdminUserFile[]>("admin_list_user_files", { p_user_id: userId });
    adminDevLog("admin_list_user_files succeeded", { target, fileCount: files?.length ?? 0 });
    return files;
  } catch (error) {
    adminDevLog("admin_list_user_files failed", { target, error: adminErrorSummary(error) });
    throw error;
  }
}

export function loadAdminClaimPacks(limit = 50): Promise<AdminClaimPackSummary[]> {
  return rpcValue<AdminClaimPackSummary[]>("admin_list_claim_packs", { p_limit: limit });
}

export function loadAdminClaimPackDetail(claimPackId: string): Promise<AdminClaimPackDetail | null> {
  return rpcValue<AdminClaimPackDetail | null>("admin_get_claim_pack_detail", {
    p_claim_pack_id: claimPackId,
  });
}

export function loadAdminRecentEvents(limit = 50): Promise<AdminEvent[]> {
  return rpcValue<AdminEvent[]>("admin_list_recent_events", { p_limit: limit });
}
