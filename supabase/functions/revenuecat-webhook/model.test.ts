import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalSubscriberProfileUpdate,
  buildProfileUpdate,
  parseList,
  parseRevenueCatEvent,
  planForEvent,
  processRevenueCatWebhookEvent,
  resolveTargetAppUserId,
  type RevenueCatEvent,
  type RevenueCatWebhookEventStatus,
  type RevenueCatWebhookStore,
} from "./model.ts";
import { authorizeRevenueCatWebhook, revenueCatAuthHttpStatus } from "./auth.ts";

const config = {
  plusEntitlementIds: ["Coverly Plus"],
  familyEntitlementIds: ["Coverly Family"],
  plusProductIds: ["coverly_plus_monthly"],
  familyProductIds: ["coverly_family_monthly"],
};

test("parses RevenueCat's event wrapper and maps Plus entitlement state", () => {
  const event = parseRevenueCatEvent({
    api_version: "1.0",
    event: {
      id: "evt_1",
      type: "INITIAL_PURCHASE",
      app_user_id: "11111111-1111-4111-8111-111111111111",
      product_id: "coverly_plus_monthly",
      entitlement_ids: ["Coverly Plus"],
      expiration_at_ms: 1782864000000,
      period_type: "NORMAL",
    },
  });

  assert.ok(event);
  assert.equal(planForEvent(event, config), "coverly_plus");
  const update = buildProfileUpdate(event, config, 1780272000000);
  assert.equal(update.revenuecat_status, "active");
  assert.equal(update.subscription_status, "active");
  assert.equal(update.subscription_plan, "coverly_plus");
  assert.equal(update.subscription_period_end, "2026-07-01T00:00:00.000Z");
});

test("prefers Family entitlement over product fallback", () => {
  const event = parseRevenueCatEvent({
    event: {
      id: "evt_2",
      type: "RENEWAL",
      app_user_id: "11111111-1111-4111-8111-111111111111",
      product_id: "unknown_store_product",
      entitlement_ids: ["Coverly Family", "Coverly Plus"],
      period_type: "TRIAL",
    },
  });

  assert.ok(event);
  const update = buildProfileUpdate(event, config);
  assert.equal(update.subscription_plan, "coverly_family");
  assert.equal(update.revenuecat_status, "trialing");
});

test("keeps cancelled access active until the entitlement expires", () => {
  const event = parseRevenueCatEvent({
    event: {
      id: "evt_3",
      type: "CANCELLATION",
      app_user_id: "11111111-1111-4111-8111-111111111111",
      entitlement_ids: ["Coverly Plus"],
      expiration_at_ms: 1782864000000,
    },
  });

  assert.ok(event);
  const update = buildProfileUpdate(event, config, 1780272000000);
  assert.equal(update.revenuecat_status, "active");
  assert.equal(update.subscription_status, "cancelled");
  assert.equal(update.subscription_plan, "coverly_plus");
});

test("expires access and downgrades subscription plan on expiration", () => {
  const event = parseRevenueCatEvent({
    event: {
      id: "evt_4",
      type: "EXPIRATION",
      app_user_id: "11111111-1111-4111-8111-111111111111",
      entitlement_ids: ["Coverly Plus"],
      expiration_at_ms: 1780272000000,
    },
  });

  assert.ok(event);
  const update = buildProfileUpdate(event, config, 1782864000000);
  assert.equal(update.revenuecat_status, "expired");
  assert.equal(update.subscription_status, "expired");
  assert.equal(update.subscription_plan, "free");
});

test("routes transfer events to the destination user", () => {
  const event = parseRevenueCatEvent({
    event: {
      id: "evt_5",
      type: "TRANSFER",
      app_user_id: "source",
      transferred_to: ["22222222-2222-4222-8222-222222222222"],
      transferred_from: ["11111111-1111-4111-8111-111111111111"],
    },
  });

  assert.ok(event);
  assert.equal(resolveTargetAppUserId(event), "22222222-2222-4222-8222-222222222222");
  assert.equal(buildProfileUpdate(event, config).revenuecat_status, "transferred");
});

test("parseList trims empty entries", () => {
  assert.deepEqual(parseList(" Coverly Plus, ,Coverly Family "), ["Coverly Plus", "Coverly Family"]);
});

test("canonical subscriber state maps active Plus entitlement", () => {
  const event = webhookEvent("RENEWAL");
  const fallback = buildProfileUpdate(event, config);
  const update = buildCanonicalSubscriberProfileUpdate({
    subscriber: {
      entitlements: {
        "Coverly Plus": {
          expires_date: "2026-08-01T00:00:00Z",
          grace_period_expires_date: null,
          product_identifier: "coverly_plus_monthly",
        },
      },
      subscriptions: {
        coverly_plus_monthly: { period_type: "normal" },
      },
    },
  }, event, config, fallback, Date.parse("2026-07-01T00:00:00Z"));

  assert.ok(update);
  assert.equal(update.subscription_plan, "coverly_plus");
  assert.equal(update.subscription_status, "active");
  assert.equal(update.revenuecat_status, "active");
  assert.equal(update.revenuecat_entitlement_id, "Coverly Plus");
  assert.equal(update.revenuecat_product_id, "coverly_plus_monthly");
  assert.equal(update.subscription_period_end, "2026-08-01T00:00:00Z");
});

test("canonical subscriber state maps active Family entitlement over Plus", () => {
  const event = webhookEvent("RENEWAL");
  const fallback = buildProfileUpdate(event, config);
  const update = buildCanonicalSubscriberProfileUpdate({
    subscriber: {
      entitlements: {
        "Coverly Plus": {
          expires_date: "2026-08-01T00:00:00Z",
          product_identifier: "coverly_plus_monthly",
        },
        "Coverly Family": {
          expires_date: "2026-08-01T00:00:00Z",
          product_identifier: "coverly_family_monthly",
        },
      },
      subscriptions: {
        coverly_family_monthly: { period_type: "trial" },
      },
    },
  }, event, config, fallback, Date.parse("2026-07-01T00:00:00Z"));

  assert.ok(update);
  assert.equal(update.subscription_plan, "coverly_family");
  assert.equal(update.subscription_status, "trialing");
  assert.equal(update.revenuecat_status, "trialing");
  assert.equal(update.revenuecat_entitlement_id, "Coverly Family");
});

test("canonical subscriber state maps expired subscription back to free", () => {
  const event = webhookEvent("EXPIRATION", { expiration_at_ms: Date.parse("2026-06-01T00:00:00Z") });
  const fallback = buildProfileUpdate(event, config, Date.parse("2026-07-01T00:00:00Z"));
  const update = buildCanonicalSubscriberProfileUpdate({
    subscriber: {
      entitlements: {
        "Coverly Plus": {
          expires_date: "2026-06-01T00:00:00Z",
          product_identifier: "coverly_plus_monthly",
        },
      },
      subscriptions: {
        coverly_plus_monthly: { period_type: "normal" },
      },
    },
  }, event, config, fallback, Date.parse("2026-07-01T00:00:00Z"));

  assert.ok(update);
  assert.equal(update.subscription_plan, "free");
  assert.equal(update.subscription_status, "expired");
  assert.equal(update.revenuecat_status, "expired");
  assert.equal(update.subscription_period_end, "2026-06-01T00:00:00Z");
});

test("canonical subscriber state maps cancelled subscription without active entitlement back to free", () => {
  const event = webhookEvent("CANCELLATION", { expiration_at_ms: Date.parse("2026-06-01T00:00:00Z") });
  const fallback = buildProfileUpdate(event, config, Date.parse("2026-07-01T00:00:00Z"));
  const update = buildCanonicalSubscriberProfileUpdate({
    subscriber: {
      entitlements: {
        "Coverly Plus": {
          expires_date: "2026-06-01T00:00:00Z",
          product_identifier: "coverly_plus_monthly",
        },
      },
    },
  }, event, config, fallback, Date.parse("2026-07-01T00:00:00Z"));

  assert.ok(update);
  assert.equal(update.subscription_plan, "free");
  assert.equal(update.subscription_status, "cancelled");
  assert.equal(update.revenuecat_status, "cancelled");
});

function webhookEvent(type: string, overrides: Record<string, unknown> = {}): RevenueCatEvent {
  const event = parseRevenueCatEvent({
    event: {
      id: `${type.toLowerCase()}_event`,
      type,
      app_user_id: "11111111-1111-4111-8111-111111111111",
      entitlement_ids: ["Coverly Plus"],
      product_id: "coverly_plus_monthly",
      ...overrides,
    },
  });
  assert.ok(event);
  return event;
}

function mockStore(options: {
  claimStatus?: RevenueCatWebhookEventStatus;
  profile?: { id: string } | null;
  logFails?: boolean;
  canonicalUpdate?: ReturnType<typeof buildProfileUpdate> | null;
  syncFails?: boolean;
} = {}) {
  const calls = {
    claims: 0,
    ignored: 0,
    processed: 0,
    failed: 0,
    updates: 0,
    logs: 0,
    syncs: 0,
  };
  const updates: Record<string, unknown>[] = [];
  const store: RevenueCatWebhookStore = {
    async claimEvent() {
      calls.claims += 1;
      return options.claimStatus ? { claimed: false, status: options.claimStatus } : { claimed: true };
    },
    async markIgnored() { calls.ignored += 1; },
    async findProfile() { return options.profile === undefined ? { id: "11111111-1111-4111-8111-111111111111" } : options.profile; },
    async updateProfile(_profileId, values) { calls.updates += 1; updates.push(values); },
    async markProcessed() { calls.processed += 1; },
    async markFailed() { calls.failed += 1; },
    async logAdminEvent() {
      calls.logs += 1;
      if (options.logFails) throw new Error("diagnostics unavailable");
    },
    async syncSubscriberState() {
      calls.syncs += 1;
      if (options.syncFails) throw new Error("RevenueCat unavailable");
      return options.canonicalUpdate ?? null;
    },
  };
  return { store, calls, updates };
}

test("TEST events return 200 and are ignored", async () => {
  const { store, calls } = mockStore();
  const result = await processRevenueCatWebhookEvent(webhookEvent("TEST"), config, store);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, "ignored");
  assert.equal(calls.ignored, 1);
  assert.equal(calls.updates, 0);
  assert.equal(calls.processed, 0);
  assert.equal(calls.syncs, 0);
});

test("processed duplicate returns 200 and does not process twice", async () => {
  const { store, calls } = mockStore({ claimStatus: "processed" });
  const result = await processRevenueCatWebhookEvent(webhookEvent("RENEWAL"), config, store);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal(calls.updates, 0);
  assert.equal(calls.processed, 0);
});

test("processing duplicate returns 200", async () => {
  const { store, calls } = mockStore({ claimStatus: "processing" });
  const result = await processRevenueCatWebhookEvent(webhookEvent("RENEWAL"), config, store);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal(result.body.status, "processing");
  assert.equal(calls.updates, 0);
});

test("profile-not-found returns 200 and is ignored", async () => {
  const { store, calls } = mockStore({ profile: null });
  const result = await processRevenueCatWebhookEvent(webhookEvent("INITIAL_PURCHASE"), config, store);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, "profile_not_found");
  assert.equal(calls.ignored, 1);
  assert.equal(calls.updates, 0);
});

test("canonical subscriber update is used for profile updates when available", async () => {
  const event = webhookEvent("RENEWAL");
  const fallback = buildProfileUpdate(event, config);
  const canonicalUpdate = {
    ...fallback,
    revenuecat_status: "active" as const,
    subscription_status: "active",
    subscription_plan: "coverly_family" as const,
    subscription_period_end: "2026-08-01T00:00:00Z",
    revenuecat_product_id: "coverly_family_monthly",
    revenuecat_entitlement_id: "Coverly Family",
    revenuecat_expiration_at: "2026-08-01T00:00:00Z",
  };
  const { store, calls, updates } = mockStore({ canonicalUpdate });
  const result = await processRevenueCatWebhookEvent(event, config, store);

  assert.equal(result.httpStatus, 200);
  assert.equal(calls.syncs, 1);
  assert.equal(calls.updates, 1);
  assert.equal(calls.processed, 1);
  assert.equal(updates[0].subscription_plan, "coverly_family");
  assert.equal(updates[0].revenuecat_entitlement_id, "Coverly Family");
});

test("expiration does not downgrade when canonical subscriber state is missing", async () => {
  const { store, calls } = mockStore({ canonicalUpdate: null });
  const result = await processRevenueCatWebhookEvent(webhookEvent("EXPIRATION"), config, store);

  assert.equal(result.httpStatus, 500);
  assert.equal(result.body.error, "canonical_sync_required");
  assert.equal(calls.syncs, 1);
  assert.equal(calls.failed, 1);
  assert.equal(calls.updates, 0);
  assert.equal(calls.processed, 0);
});

test("expiration does not downgrade when canonical subscriber API sync fails", async () => {
  const { store, calls } = mockStore({ syncFails: true });
  const result = await processRevenueCatWebhookEvent(webhookEvent("EXPIRATION"), config, store);

  assert.equal(result.httpStatus, 500);
  assert.equal(result.body.error, "canonical_sync_required");
  assert.equal(calls.syncs, 1);
  assert.equal(calls.failed, 1);
  assert.equal(calls.updates, 0);
  assert.equal(calls.processed, 0);
});

test("unknown event returns 200 and does not update profile", async () => {
  const { store, calls } = mockStore({ logFails: true });
  const result = await processRevenueCatWebhookEvent(webhookEvent("SOMETHING_NEW"), config, store);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, "ignored");
  assert.equal(result.body.reason, "unknown_event_type");
  assert.equal(calls.ignored, 1);
  assert.equal(calls.updates, 0);
});

test("non-UUID app_user_id returns 200 and is ignored", async () => {
  const { store, calls } = mockStore();
  const result = await processRevenueCatWebhookEvent(webhookEvent("INITIAL_PURCHASE", { app_user_id: "external-user-id" }), config, store);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, "ignored");
  assert.equal(calls.ignored, 1);
  assert.equal(calls.updates, 0);
});

test("invalid auth and signature map to 401", async () => {
  const invalidAuth = await authorizeRevenueCatWebhook(
    { authorization: "Bearer wrong", signature: null },
    "{}",
    { bearerSecret: "expected", signingSecret: "" },
  );
  assert.equal(revenueCatAuthHttpStatus(invalidAuth), 401);

  const invalidSignature = await authorizeRevenueCatWebhook(
    { authorization: "Bearer expected", signature: null },
    "{}",
    { bearerSecret: "expected", signingSecret: "signing-secret" },
  );
  assert.equal(revenueCatAuthHttpStatus(invalidSignature), 401);
});
