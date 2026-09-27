import {
  buildCanonicalSubscriberProfileUpdate,
  isSupportedRevenueCatEventType,
  isUuid,
  parseList,
  parseRevenueCatEvent,
  type RevenueCatPlanConfig,
} from "../revenuecat-webhook/model.ts";
import {
  authorizeRevenueCatWebhook,
  revenueCatAuthHttpStatus,
} from "../revenuecat-webhook/auth.ts";

type Row = Record<string, unknown>;
export type Config = RevenueCatPlanConfig & {
  secret: string;
  environment: "production" | "sandbox";
  projectId: string;
  appIds: string[];
  ownedProductIds: string[];
};
export class SyncError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
function fail(code: string): never {
  throw new SyncError(code);
}
const record = (v: unknown): Row | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
const string = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
function date(v: unknown): string {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
    fail("invalid_canonical_date");
  return new Date(v).toISOString();
}
export function readConfig(get: (name: string) => string | undefined): Config {
  const environment = get("REVENUECAT_EXPECTED_ENVIRONMENT");
  const secret = get("REVENUECAT_SECRET_API_KEY")?.trim();
  const projectId = get("REVENUECAT_PROJECT_ID")?.trim();
  const appIds = parseList(get("REVENUECAT_ALLOWED_APP_IDS"));
  const ownedProductIds = parseList(get("REVENUECAT_OWNED_PRODUCT_IDS"));
  if (
    !secret ||
    !projectId ||
    !appIds.length ||
    !ownedProductIds.length ||
    (environment !== "production" && environment !== "sandbox")
  )
    fail("server_not_configured");
  const config: Config = {
    secret,
    projectId,
    environment,
    appIds,
    ownedProductIds,
    plusEntitlementIds: parseList(get("REVENUECAT_PLUS_ENTITLEMENT_IDS")),
    familyEntitlementIds: parseList(get("REVENUECAT_FAMILY_ENTITLEMENT_IDS")),
    plusProductIds: parseList(get("REVENUECAT_PLUS_PRODUCT_IDS")),
    familyProductIds: parseList(get("REVENUECAT_FAMILY_PRODUCT_IDS")),
  };
  if (
    ![
      config.plusEntitlementIds,
      config.familyEntitlementIds,
      config.plusProductIds,
      config.familyProductIds,
    ].every((ids) => ids.length) ||
    [...config.plusEntitlementIds, ...config.familyEntitlementIds].includes(
      "coverly_owned",
    ) ||
    config.plusEntitlementIds.some((id) =>
      config.familyEntitlementIds.includes(id),
    )
  )
    fail("server_not_configured");
  return config;
}
function attribution(row: Row, config: Config) {
  if (row.app_id !== undefined && !config.appIds.includes(String(row.app_id)))
    fail("wrong_app");
  if (row.project_id !== undefined && row.project_id !== config.projectId)
    fail("wrong_project");
}
export type CanonicalState = {
  user_id: string;
  owned: boolean;
  product_id: string | null;
  acquired_at: string | null;
  expires_at: string | null;
  environment: string;
  project_id: string;
  app_id: string | null;
  original_app_user_id: string;
  request_date_ms: number;
  reason: string;
  legacy: Row;
};

// Both callers supply only a server-derived UUID. No CustomerInfo from requests is used.
export function canonicalState(
  payload: unknown,
  userId: string,
  config: Config,
  now = Date.now(),
): CanonicalState {
  if (!isUuid(userId)) fail("invalid_identity");
  const root = record(payload);
  const subscriber = record(root?.subscriber);
  const entitlements = record(subscriber?.entitlements);
  const subscriptions = record(subscriber?.subscriptions);
  const purchases = record(subscriber?.non_subscriptions);
  if (!root || !subscriber || !entitlements || !subscriptions || !purchases)
    fail("invalid_canonical_state");
  const requestMs = root.request_date_ms;
  if (
    typeof requestMs !== "number" ||
    !Number.isSafeInteger(requestMs) ||
    requestMs < now - 120_000 ||
    requestMs > now + 30_000
  )
    fail("stale_canonical_state");
  const original = string(subscriber.original_app_user_id);
  // V1 proves lookup membership but does not enumerate aliases. Refuse cross-UUID
  // aliases; an anonymous original is safe only via this server's exact UUID lookup.
  if (
    !original ||
    (original.toLowerCase() !== userId.toLowerCase() &&
      !/^\$RCAnonymousID:[a-zA-Z0-9-]+$/.test(original))
  )
    fail("identity_mismatch");
  attribution(root, config);
  attribution(subscriber, config);
  let owned = false;
  let product: string | null = null;
  let acquired: string | null = null;
  let expires: string | null = null;
  let appId: string | null = null;
  let reason = "entitlement_absent";
  const verifiedEntitlements: Row = {};
  for (const [id, value] of Object.entries(entitlements)) {
    const isOwner = id === "coverly_owned";
    const products = isOwner
      ? config.ownedProductIds
      : config.familyEntitlementIds.includes(id)
        ? config.familyProductIds
        : config.plusEntitlementIds.includes(id)
          ? config.plusProductIds
          : null;
    if (!products) continue;
    const row = record(value);
    if (!row || !Object.hasOwn(row, "expires_date"))
      fail("invalid_canonical_entitlement");
    const productId = string(row.product_identifier);
    if (!productId || !products.includes(productId))
      fail("unrecognized_product");
    const purchaseDate = date(row.purchase_date);
    const expiry = row.expires_date === null ? null : date(row.expires_date);
    if (row.grace_period_expires_date != null)
      date(row.grace_period_expires_date);
    if (Date.parse(purchaseDate) > Math.min(now, requestMs))
      fail("invalid_canonical_date");
    attribution(row, config);
    const nonRecurring = purchases[productId];
    const candidates = Array.isArray(nonRecurring)
      ? nonRecurring.map(record).filter((v): v is Row => !!v)
      : [];
    const subscription = record(subscriptions[productId]);
    if (subscription) candidates.push(subscription);
    // Match the purchase attached to this entitlement, not any old production receipt.
    const matches = candidates.filter(
      (v) =>
        typeof v.purchase_date === "string" &&
        Date.parse(v.purchase_date) === Date.parse(purchaseDate),
    );
    if (matches.length !== 1) fail("ambiguous_purchase");
    const transaction = matches[0];
    attribution(transaction, config);
    if (
      typeof transaction.is_sandbox !== "boolean" ||
      transaction.is_sandbox !== (config.environment === "sandbox")
    )
      fail("wrong_environment");
    const refunded = transaction.refunded_at != null;
    if (refunded) date(transaction.refunded_at);
    if (!refunded) verifiedEntitlements[id] = row;
    if (isOwner) {
      product = productId;
      acquired = purchaseDate;
      expires = expiry;
      appId =
        string(transaction.app_id) ??
        string(row.app_id) ??
        string(subscriber.app_id);
      owned = !refunded && (expiry === null || Date.parse(expiry) > now);
      reason = refunded
        ? "refunded"
        : owned
          ? "entitlement_active"
          : "entitlement_expired";
    }
  }
  const event = parseRevenueCatEvent({
    event: { id: "canonical", type: "ENTITLEMENT_CHANGE", app_user_id: userId },
  })!;
  const legacy = buildCanonicalSubscriberProfileUpdate(
    { subscriber: { ...subscriber, entitlements: verifiedEntitlements } },
    event,
    config,
    {
      action: "update_profile",
      targetAppUserId: userId,
      revenuecat_status: null,
      subscription_status: null,
      subscription_period_end: null,
      revenuecat_customer_id: userId,
      revenuecat_product_id: null,
      revenuecat_entitlement_id: null,
      revenuecat_expiration_at: null,
    },
    now,
  )!;
  const legacyTransaction = legacy.revenuecat_product_id
    ? record(subscriptions[legacy.revenuecat_product_id])
    : null;
  if (
    legacy.revenuecat_status === "active" ||
    legacy.revenuecat_status === "trialing"
  ) {
    if (legacyTransaction?.billing_issues_detected_at) {
      date(legacyTransaction.billing_issues_detected_at);
      legacy.subscription_status = "billing_issue";
    } else if (legacyTransaction?.unsubscribe_detected_at) {
      date(legacyTransaction.unsubscribe_detected_at);
      legacy.subscription_status = "cancelled";
    }
  }
  return {
    user_id: userId,
    owned,
    product_id: product,
    acquired_at: acquired,
    expires_at: expires,
    environment: config.environment,
    project_id: config.projectId,
    app_id: appId,
    original_app_user_id: original,
    request_date_ms: requestMs,
    reason,
    legacy,
  };
}

export async function lookup(
  userId: string,
  config: Config,
  request: typeof fetch = fetch,
): Promise<CanonicalState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${config.secret}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) fail("canonical_unavailable"); // Includes 404: never infer revocation from an error.
    return canonicalState(await response.json(), userId, config);
  } catch (error) {
    if (error instanceof SyncError) throw error;
    fail("canonical_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export type Store = {
  rpc: (name: string, args: Row) => Promise<unknown>;
  authenticate: (token: string) => Promise<string | null>;
};
export async function reconcile(
  ids: string[],
  config: Config,
  store: Store,
  eventId: string | null = null,
  eventLease: string | null = null,
  request: typeof fetch = fetch,
) {
  const token = (await store.rpc("revenuecat_begin_sync", {
    p_user_ids: ids,
  })) as string;
  try {
    const states: CanonicalState[] = [];
    for (const id of [...ids].sort())
      states.push(await lookup(id, config, request));
    return await store.rpc("revenuecat_apply_sync", {
      p_token: token,
      p_states: states,
      p_event_id: eventId,
      p_event_lease: eventLease,
    });
  } finally {
    // A crash is also recoverable after the DB lease. Never release another worker's lease.
    await store
      .rpc("revenuecat_release_sync", { p_token: token })
      .catch(() => {});
  }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(status === 503 ? { "Retry-After": "120" } : {}),
    },
  });
const code = (error: unknown) =>
  error instanceof SyncError ? error.code : "reconciliation_failed";

export async function reconciliationHandler(
  req: Request,
  config: Config,
  store: Store,
  request: typeof fetch = fetch,
) {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  const id = token ? await store.authenticate(token).catch(() => null) : null;
  if (!id || !isUuid(id)) return json({ error: "unauthorized" }, 401);
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    if (!record(body) || Object.keys(body).length)
      return json({ error: "body_must_be_empty_object" }, 400);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  try {
    return json({
      ok: true,
      access: await reconcile([id], config, store, null, null, request),
    });
  } catch (error) {
    return json({ error: code(error), retryable: true }, 503);
  }
}

export async function webhookHandler(
  req: Request,
  config: Config,
  store: Store,
  auth: { bearerSecret: string; signingSecret: string },
  request: typeof fetch = fetch,
) {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  if (raw.length > 128_000) return json({ error: "payload_too_large" }, 413);
  const authorized = await authorizeRevenueCatWebhook(
    {
      authorization: req.headers.get("authorization"),
      signature:
        req.headers.get("x-revenuecat-signature") ??
        req.headers.get("x-revenuecat-webhook-signature"),
    },
    raw,
    auth,
  );
  if (authorized !== true)
    return json({ error: authorized }, revenueCatAuthHttpStatus(authorized));
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const event = parseRevenueCatEvent(payload);
  if (!event || !string(record(record(payload)?.event)?.type))
    return json({ error: "invalid_event" }, 400);
  let ids: string[];
  try {
    const row = record(record(payload)?.event)!;
    attribution(row, config);
    if (!string(row.app_id)) fail("missing_app");
    if (event.environment?.toLowerCase() !== config.environment)
      fail("wrong_environment");
    // Authenticated TRANSFER arrays are triggers only; each UUID is independently looked up.
    const candidates =
      event.type === "TRANSFER"
        ? [...event.transferredFrom, ...event.transferredTo]
        : [event.appUserId];
    ids = [
      ...new Set(
        candidates
          .filter((id): id is string => !!id && isUuid(id))
          .map((id) => id.toLowerCase()),
      ),
    ];
    if (
      (event.type !== "TEST" &&
        isSupportedRevenueCatEventType(event.type) &&
        !ids.length) ||
      ids.length > 20 ||
      (event.type === "TRANSFER" &&
        (!Array.isArray(row.transferred_from) ||
          !Array.isArray(row.transferred_to) ||
          !event.transferredFrom.length ||
          !event.transferredTo.length))
    )
      fail("invalid_identity");
  } catch (error) {
    return json({ error: code(error) }, 400);
  }
  let lease: string | null = null;
  try {
    const claim = (await store.rpc("revenuecat_claim_event", {
      p_event: { ...event, appId: record(record(payload)?.event)?.app_id },
    })) as { token: string | null; status: string };
    if (!claim.token)
      return json(
        {
          ok: claim.status !== "processing",
          duplicate: true,
          status: claim.status,
        },
        claim.status === "processing" ? 503 : 200,
      );
    lease = claim.token;
    if (event.type === "TEST" || !isSupportedRevenueCatEventType(event.type)) {
      await store.rpc("revenuecat_finish_event", {
        p_event_id: event.id,
        p_token: lease,
        p_status: "ignored",
        p_error: null,
      });
      return json({ ok: true, status: "ignored" });
    }
    await reconcile(ids, config, store, event.id, lease, request);
    return json({ ok: true, status: "processed" });
  } catch (error) {
    if (lease)
      await store
        .rpc("revenuecat_finish_event", {
          p_event_id: event.id,
          p_token: lease,
          p_status: "failed",
          p_error: code(error),
        })
        .catch(() => {});
    return json({ error: code(error), retryable: true }, 503);
  }
}
