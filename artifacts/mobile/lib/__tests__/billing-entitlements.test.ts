import assert from "node:assert/strict";
import test from "node:test";

import { hasActiveRevenueCatEntitlement, resolveRevenueCatPlan } from "../billing-entitlements.ts";

const config = {
  plusEntitlementId: "Coverly Plus",
  familyEntitlementId: "Coverly Family",
};

test("resolves no active RevenueCat entitlement as no paid plan", () => {
  assert.deepEqual(resolveRevenueCatPlan({ entitlements: { active: {} } }, config), {
    plan: null,
    entitlementId: null,
    subscriptionStatus: null,
    subscriptionPeriodEnd: null,
  });
});

test("resolves the configured Plus entitlement without product ID assumptions", () => {
  const state = resolveRevenueCatPlan({
    entitlements: {
      active: {
        "Coverly Plus": { expirationDate: "2026-08-01T00:00:00Z", periodType: "normal" },
      },
    },
  }, config);

  assert.equal(state.plan, "coverly_plus");
  assert.equal(state.entitlementId, "Coverly Plus");
  assert.equal(state.subscriptionStatus, "active");
  assert.equal(state.subscriptionPeriodEnd, "2026-08-01T00:00:00Z");
});

test("trims configured entitlement IDs with spaces around the value", () => {
  const state = resolveRevenueCatPlan({
    entitlements: {
      active: {
        "Coverly Plus": { expirationDate: "2026-08-01T00:00:00Z", periodType: "normal" },
      },
    },
  }, { plusEntitlementId: " Coverly Plus ", familyEntitlementId: " Coverly Family " });

  assert.equal(state.plan, "coverly_plus");
  assert.equal(state.entitlementId, "Coverly Plus");
});

test("prefers the configured Family entitlement when both paid entitlements are active", () => {
  const state = resolveRevenueCatPlan({
    entitlements: {
      active: {
        "Coverly Plus": { expirationDate: "2026-08-01T00:00:00Z", periodType: "normal" },
        "Coverly Family": { expirationDate: "2026-09-01T00:00:00Z", periodType: "trial" },
      },
    },
  }, config);

  assert.equal(state.plan, "coverly_family");
  assert.equal(state.subscriptionStatus, "trialing");
  assert.equal(hasActiveRevenueCatEntitlement({ entitlements: { active: { "Coverly Family": {} } } }, config), true);
});
