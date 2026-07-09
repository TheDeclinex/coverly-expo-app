export type CoverlyPlan = "coverly_plus" | "coverly_family";
export type RevenueCatAccessStatus = "active" | "trialing" | "cancelled" | "expired" | "billing_issue" | "transferred";
export type RevenueCatWebhookAction = "update_profile" | "log_only";
export type RevenueCatWebhookEventStatus = "processing" | "processed" | "ignored" | "failed";

export type RevenueCatEvent = {
  id: string;
  type: string;
  appUserId: string | null;
  originalAppUserId: string | null;
  aliases: string[];
  transferredFrom: string[];
  transferredTo: string[];
  productId: string | null;
  newProductId: string | null;
  entitlementIds: string[];
  environment: string | null;
  store: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  expirationAtMs: number | null;
  eventTimestampMs: number | null;
  periodType: string | null;
  cancelReason: string | null;
};

export type RevenueCatPlanConfig = {
  plusEntitlementIds: string[];
  familyEntitlementIds: string[];
  plusProductIds: string[];
  familyProductIds: string[];
};

export type RevenueCatWebhookResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export type RevenueCatWebhookStore = {
  claimEvent: (event: RevenueCatEvent) => Promise<{ claimed: true } | { claimed: false; status: RevenueCatWebhookEventStatus | string | null }>;
  markIgnored: (eventId: string, errorCode: string | null, metadata: Record<string, unknown>) => Promise<void>;
  findProfile: (appUserId: string) => Promise<{ id: string } | null>;
  updateProfile: (profileId: string, values: Record<string, unknown>) => Promise<void>;
  markProcessed: (eventId: string, profileId: string, metadata: Record<string, unknown>) => Promise<void>;
  markFailed: (eventId: string, errorCode: string, metadata: Record<string, unknown>) => Promise<void>;
  logAdminEvent?: (severity: "info" | "warning" | "error", message: string, event: RevenueCatEvent, userId: string | null, extra?: Record<string, unknown>) => Promise<void>;
  syncSubscriberState?: (event: RevenueCatEvent, profileId: string, config: RevenueCatPlanConfig, fallback: RevenueCatProfileUpdate) => Promise<RevenueCatProfileUpdate | null>;
};

export type RevenueCatProfileUpdate = {
  action: RevenueCatWebhookAction;
  targetAppUserId: string | null;
  revenuecat_status: RevenueCatAccessStatus | null;
  subscription_status: string | null;
  subscription_plan?: CoverlyPlan | "free";
  subscription_period_end: string | null;
  revenuecat_customer_id: string | null;
  revenuecat_product_id: string | null;
  revenuecat_entitlement_id: string | null;
  revenuecat_expiration_at: string | null;
};

type RevenueCatCanonicalEntitlement = {
  id: string;
  plan: CoverlyPlan;
  productIdentifier: string | null;
  expiresDate: string | null;
  gracePeriodExpiresDate: string | null;
  periodType: string | null;
};

type RevenueCatCanonicalSubscriber = {
  originalAppUserId: string | null;
  entitlements: RevenueCatCanonicalEntitlement[];
};

export const SUPPORTED_REVENUECAT_EVENT_TYPES = [
  "INITIAL_PURCHASE",
  "RENEWAL",
  "CANCELLATION",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "EXPIRATION",
  "BILLING_ISSUE",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
  "REFUND_REVERSED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "TRANSFER",
  "ENTITLEMENT_CHANGE",
  "ENTITLEMENT_GRANT",
  "ENTITLEMENT_REVOKE",
  "TEST",
] as const;

const ACTIVE_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
  "REFUND_REVERSED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "ENTITLEMENT_CHANGE",
  "ENTITLEMENT_GRANT",
]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isoFromMs(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function msFromIso(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseType(value: string | null): string {
  return (value ?? "UNKNOWN").trim().toUpperCase();
}

function firstMatching(values: string[], candidates: string[]) {
  const candidateSet = new Set(candidates.map((value) => value.trim()).filter(Boolean));
  return values.find((value) => candidateSet.has(value)) ?? null;
}

export function parseList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isSupportedRevenueCatEventType(type: string) {
  return (SUPPORTED_REVENUECAT_EVENT_TYPES as readonly string[]).includes(type);
}

export function isUuid(value: string | null) {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function entitlementPlan(entitlementId: string, config: RevenueCatPlanConfig): CoverlyPlan | null {
  if (config.familyEntitlementIds.includes(entitlementId)) return "coverly_family";
  if (config.plusEntitlementIds.includes(entitlementId)) return "coverly_plus";
  return null;
}

function statusForInactiveCanonicalEvent(event: RevenueCatEvent): RevenueCatAccessStatus {
  if (event.type === "CANCELLATION") return "cancelled";
  if (event.type === "BILLING_ISSUE") return "billing_issue";
  if (event.type === "TRANSFER") return "transferred";
  return "expired";
}

function canonicalEntitlementIsActive(entitlement: RevenueCatCanonicalEntitlement, nowMs: number) {
  if (entitlement.expiresDate === null) return true;
  const graceMs = msFromIso(entitlement.gracePeriodExpiresDate);
  if (graceMs !== null && graceMs > nowMs) return true;
  const expirationMs = msFromIso(entitlement.expiresDate);
  return expirationMs !== null && expirationMs > nowMs;
}

function canonicalExpiration(entitlement: RevenueCatCanonicalEntitlement) {
  return entitlement.gracePeriodExpiresDate ?? entitlement.expiresDate;
}

function canonicalActiveUntil(entitlement: RevenueCatCanonicalEntitlement) {
  return msFromIso(canonicalExpiration(entitlement));
}

function chooseCanonicalEntitlement(entitlements: RevenueCatCanonicalEntitlement[], nowMs: number) {
  const byPlanPriority = (entry: RevenueCatCanonicalEntitlement) => entry.plan === "coverly_family" ? 0 : 1;
  const active = entitlements
    .filter((entry) => canonicalEntitlementIsActive(entry, nowMs))
    .sort((a, b) => byPlanPriority(a) - byPlanPriority(b) || (canonicalActiveUntil(b) ?? Number.MAX_SAFE_INTEGER) - (canonicalActiveUntil(a) ?? Number.MAX_SAFE_INTEGER));
  if (active[0]) return { entitlement: active[0], active: true };

  const latest = [...entitlements].sort((a, b) => (canonicalActiveUntil(b) ?? 0) - (canonicalActiveUntil(a) ?? 0));
  return latest[0] ? { entitlement: latest[0], active: false } : null;
}

function parseRevenueCatCanonicalSubscriber(payload: unknown, config: RevenueCatPlanConfig): RevenueCatCanonicalSubscriber | null {
  const root = asRecord(payload);
  const subscriber = asRecord(root?.subscriber);
  if (!subscriber) return null;

  const subscriptions = asRecord(subscriber.subscriptions) ?? {};
  const entitlements = asRecord(subscriber.entitlements) ?? {};
  const parsedEntitlements: RevenueCatCanonicalEntitlement[] = [];

  for (const [id, value] of Object.entries(entitlements)) {
    const plan = entitlementPlan(id, config);
    const row = asRecord(value);
    if (!plan || !row) continue;

    const productIdentifier = asString(row.product_identifier);
    const subscription = productIdentifier ? asRecord(subscriptions[productIdentifier]) : null;
    const expiresDate = asString(row.expires_date);
    const gracePeriodExpiresDate = asString(row.grace_period_expires_date);
    parsedEntitlements.push({
      id,
      plan,
      productIdentifier,
      expiresDate,
      gracePeriodExpiresDate,
      periodType: asString(subscription?.period_type),
    });
  }

  return {
    originalAppUserId: asString(subscriber.original_app_user_id),
    entitlements: parsedEntitlements,
  };
}

export function parseRevenueCatEvent(payload: unknown): RevenueCatEvent | null {
  const event = typeof payload === "object" && payload !== null && "event" in payload
    ? (payload as { event?: unknown }).event
    : null;
  if (typeof event !== "object" || event === null) return null;
  const row = event as Record<string, unknown>;
  const id = asString(row.id);
  const type = normaliseType(asString(row.type));
  if (!id) return null;

  return {
    id,
    type,
    appUserId: asString(row.app_user_id),
    originalAppUserId: asString(row.original_app_user_id),
    aliases: asStringArray(row.aliases),
    transferredFrom: asStringArray(row.transferred_from),
    transferredTo: asStringArray(row.transferred_to),
    productId: asString(row.product_id),
    newProductId: asString(row.new_product_id),
    entitlementIds: asStringArray(row.entitlement_ids),
    environment: asString(row.environment),
    store: asString(row.store),
    transactionId: asString(row.transaction_id),
    originalTransactionId: asString(row.original_transaction_id),
    expirationAtMs: asNumber(row.expiration_at_ms),
    eventTimestampMs: asNumber(row.event_timestamp_ms),
    periodType: asString(row.period_type),
    cancelReason: asString(row.cancel_reason),
  };
}

export function resolveTargetAppUserId(event: RevenueCatEvent): string | null {
  return event.type === "TRANSFER"
    ? event.transferredTo[0] ?? event.appUserId
    : event.appUserId ?? event.originalAppUserId ?? event.transferredTo[0] ?? null;
}

export function planForEvent(event: RevenueCatEvent, config: RevenueCatPlanConfig): CoverlyPlan | null {
  if (firstMatching(event.entitlementIds, config.familyEntitlementIds)) return "coverly_family";
  if (firstMatching(event.entitlementIds, config.plusEntitlementIds)) return "coverly_plus";
  const productIds = [event.newProductId, event.productId].filter((value): value is string => value !== null);
  if (firstMatching(productIds, config.familyProductIds)) return "coverly_family";
  if (firstMatching(productIds, config.plusProductIds)) return "coverly_plus";
  return null;
}

function accessStatusForEvent(event: RevenueCatEvent, nowMs: number): RevenueCatAccessStatus | null {
  const type = event.type;
  const isTrial = event.periodType?.toUpperCase() === "TRIAL";
  const expiresInFuture = event.expirationAtMs !== null && event.expirationAtMs > nowMs;

  if (type === "TEST") return null;
  if (type === "TRANSFER") return "transferred";
  if (type === "EXPIRATION" || type === "ENTITLEMENT_REVOKE") return "expired";
  if (type === "BILLING_ISSUE") return expiresInFuture ? (isTrial ? "trialing" : "active") : "billing_issue";
  if (type === "CANCELLATION") return expiresInFuture ? (isTrial ? "trialing" : "active") : "cancelled";
  if (ACTIVE_EVENT_TYPES.has(type)) return isTrial ? "trialing" : "active";
  return null;
}

function subscriptionStatusForEvent(event: RevenueCatEvent, accessStatus: RevenueCatAccessStatus | null): string | null {
  if (event.type === "TEST") return null;
  if (event.type === "BILLING_ISSUE") return "billing_issue";
  if (event.type === "CANCELLATION") return event.cancelReason?.toUpperCase() === "BILLING_ERROR" ? "billing_issue" : "cancelled";
  return accessStatus;
}

export function buildProfileUpdate(
  event: RevenueCatEvent,
  config: RevenueCatPlanConfig,
  nowMs = Date.now(),
): RevenueCatProfileUpdate {
  const targetAppUserId = resolveTargetAppUserId(event);
  const accessStatus = accessStatusForEvent(event, nowMs);
  const subscriptionStatus = subscriptionStatusForEvent(event, accessStatus);
  const plan = planForEvent(event, config);
  const expiration = isoFromMs(event.expirationAtMs);
  const update: RevenueCatProfileUpdate = {
    action: event.type === "TEST" ? "log_only" : "update_profile",
    targetAppUserId,
    revenuecat_status: accessStatus,
    subscription_status: subscriptionStatus,
    subscription_period_end: expiration,
    revenuecat_customer_id: targetAppUserId,
    revenuecat_product_id: event.newProductId ?? event.productId,
    revenuecat_entitlement_id: event.entitlementIds[0] ?? null,
    revenuecat_expiration_at: expiration,
  };

  if (plan) update.subscription_plan = plan;
  if (event.type === "EXPIRATION" || event.type === "ENTITLEMENT_REVOKE") update.subscription_plan = "free";
  return update;
}

export function shouldSyncCanonicalSubscriberState(event: RevenueCatEvent) {
  return isSupportedRevenueCatEventType(event.type) && event.type !== "TEST";
}

export function requiresCanonicalAccessRemovalConfirmation(event: RevenueCatEvent) {
  return event.type === "EXPIRATION" || event.type === "ENTITLEMENT_REVOKE";
}

export function buildCanonicalSubscriberProfileUpdate(
  payload: unknown,
  event: RevenueCatEvent,
  config: RevenueCatPlanConfig,
  fallback: RevenueCatProfileUpdate,
  nowMs = Date.now(),
): RevenueCatProfileUpdate | null {
  const subscriber = parseRevenueCatCanonicalSubscriber(payload, config);
  if (!subscriber) return null;

  const targetAppUserId = fallback.targetAppUserId ?? resolveTargetAppUserId(event) ?? subscriber.originalAppUserId;
  const chosen = chooseCanonicalEntitlement(subscriber.entitlements, nowMs);

  if (chosen?.active) {
    const entitlement = chosen.entitlement;
    const isTrial = entitlement.periodType?.toUpperCase() === "TRIAL";
    const revenuecatStatus: RevenueCatAccessStatus = isTrial ? "trialing" : "active";
    return {
      action: "update_profile",
      targetAppUserId,
      revenuecat_status: revenuecatStatus,
      subscription_status: fallback.subscription_status === "cancelled" || fallback.subscription_status === "billing_issue"
        ? fallback.subscription_status
        : revenuecatStatus,
      subscription_plan: entitlement.plan,
      subscription_period_end: canonicalExpiration(entitlement),
      revenuecat_customer_id: targetAppUserId,
      revenuecat_product_id: entitlement.productIdentifier,
      revenuecat_entitlement_id: entitlement.id,
      revenuecat_expiration_at: canonicalExpiration(entitlement),
    };
  }

  const inactiveStatus = statusForInactiveCanonicalEvent(event);
  return {
    action: "update_profile",
    targetAppUserId,
    revenuecat_status: inactiveStatus,
    subscription_status: inactiveStatus,
    subscription_plan: "free",
    subscription_period_end: chosen ? canonicalExpiration(chosen.entitlement) : fallback.subscription_period_end,
    revenuecat_customer_id: targetAppUserId,
    revenuecat_product_id: chosen?.entitlement.productIdentifier ?? fallback.revenuecat_product_id,
    revenuecat_entitlement_id: chosen?.entitlement.id ?? fallback.revenuecat_entitlement_id,
    revenuecat_expiration_at: chosen ? canonicalExpiration(chosen.entitlement) : fallback.revenuecat_expiration_at,
  };
}

export function safeEventMetadata(event: RevenueCatEvent): Record<string, unknown> {
  return {
    eventTimestampMs: event.eventTimestampMs,
    expirationAtMs: event.expirationAtMs,
    hasAliases: event.aliases.length > 0,
    transferredFromCount: event.transferredFrom.length,
    transferredToCount: event.transferredTo.length,
    cancelReason: event.cancelReason,
    periodType: event.periodType,
    supported: isSupportedRevenueCatEventType(event.type),
  };
}

async function safeAdminLog(
  store: RevenueCatWebhookStore,
  severity: "info" | "warning" | "error",
  message: string,
  event: RevenueCatEvent,
  userId: string | null,
  extra: Record<string, unknown> = {},
) {
  try {
    await store.logAdminEvent?.(severity, message, event, userId, extra);
  } catch {
    // Diagnostics must never make a valid RevenueCat delivery fail.
  }
}

export async function processRevenueCatWebhookEvent(
  event: RevenueCatEvent,
  config: RevenueCatPlanConfig,
  store: RevenueCatWebhookStore,
): Promise<RevenueCatWebhookResult> {
  const claim = await store.claimEvent(event);
  if (!claim.claimed) {
    return { httpStatus: 200, body: { ok: true, duplicate: true, event_id: event.id, status: claim.status ?? "processing" } };
  }

  const baseMetadata = safeEventMetadata(event);
  if (!isSupportedRevenueCatEventType(event.type)) {
    await store.markIgnored(event.id, "unknown_event_type", { ...baseMetadata, reason: "unknown_event_type" });
    await safeAdminLog(store, "warning", "Unknown RevenueCat webhook event type received.", event, isUuid(resolveTargetAppUserId(event)) ? resolveTargetAppUserId(event) : null);
    return { httpStatus: 200, body: { ok: true, event_id: event.id, status: "ignored", reason: "unknown_event_type" } };
  }

  let update = buildProfileUpdate(event, config);
  const targetAppUserId = update.targetAppUserId;

  if (update.action === "log_only") {
    await store.markIgnored(event.id, null, { ...baseMetadata, reason: "log_only_event" });
    return { httpStatus: 200, body: { ok: true, event_id: event.id, status: "ignored" } };
  }

  if (!isUuid(targetAppUserId)) {
    await store.markIgnored(event.id, "target_user_not_uuid", { ...baseMetadata, targetUserIdPresent: Boolean(targetAppUserId) });
    await safeAdminLog(store, "warning", "RevenueCat webhook target user was not a Supabase UUID.", event, null, { targetUserIdPresent: Boolean(targetAppUserId) });
    return { httpStatus: 200, body: { ok: true, event_id: event.id, status: "ignored" } };
  }

  const profile = await store.findProfile(targetAppUserId);
  if (!profile) {
    await store.markIgnored(event.id, "profile_not_found", baseMetadata);
    await safeAdminLog(store, "warning", "RevenueCat webhook target profile was not found.", event, targetAppUserId);
    return { httpStatus: 200, body: { ok: true, event_id: event.id, status: "profile_not_found" } };
  }

  let canonicalSynced = false;
  if (shouldSyncCanonicalSubscriberState(event)) {
    try {
      const canonicalUpdate = await store.syncSubscriberState?.(event, profile.id, config, update);
      if (canonicalUpdate) {
        update = canonicalUpdate;
        canonicalSynced = true;
      }
    } catch {
      await safeAdminLog(store, "warning", "RevenueCat canonical subscriber sync was skipped or failed.", event, profile.id);
    }
  }

  if (requiresCanonicalAccessRemovalConfirmation(event) && !canonicalSynced) {
    await store.markFailed(event.id, "canonical_sync_required", { ...baseMetadata, profileId: profile.id, reason: "access_removal_requires_canonical_state" });
    await safeAdminLog(store, "warning", "RevenueCat access removal was not applied because canonical subscriber state was unavailable.", event, profile.id);
    return { httpStatus: 500, body: { error: "canonical_sync_required" } };
  }

  const now = new Date().toISOString();
  const profileUpdate: Record<string, unknown> = {
    revenuecat_customer_id: update.revenuecat_customer_id,
    revenuecat_product_id: update.revenuecat_product_id,
    revenuecat_entitlement_id: update.revenuecat_entitlement_id,
    revenuecat_expiration_at: update.revenuecat_expiration_at,
    revenuecat_status: update.revenuecat_status,
    revenuecat_last_event_id: event.id,
    revenuecat_updated_at: now,
    subscription_status: update.subscription_status,
    subscription_period_end: update.subscription_period_end,
    updated_at: now,
  };
  if (update.subscription_plan) profileUpdate.subscription_plan = update.subscription_plan;

  try {
    await store.updateProfile(profile.id, profileUpdate);
  } catch {
    await store.markFailed(event.id, "profile_update_failed", { ...baseMetadata, profileId: profile.id });
    await safeAdminLog(store, "error", "RevenueCat webhook profile update failed.", event, profile.id);
    return { httpStatus: 500, body: { error: "profile_update_failed" } };
  }

  await store.markProcessed(event.id, profile.id, {
    ...baseMetadata,
    canonicalSynced,
    mappedPlan: update.subscription_plan ?? null,
    revenuecatStatus: update.revenuecat_status,
    subscriptionStatus: update.subscription_status,
  });

  return { httpStatus: 200, body: { ok: true, event_id: event.id, status: update.revenuecat_status, subscription_status: update.subscription_status } };
}
