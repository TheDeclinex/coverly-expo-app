import assert from "node:assert/strict";
import test from "node:test";

import {
  normaliseUsageAllowance,
  usageWarningLevel,
  usageOperationRecovery,
} from "../usage-allowances-model.ts";

test("normalises usage allowance RPC rows", () => {
  const row = normaliseUsageAllowance({
    feature: "ai_scan",
    month_key: "2026-06",
    month_start_date: "2026-06-01",
    reset_at: "2026-07-01T00:00:00+12:00",
    effective_plan: "free",
    entitlement_mode: "enforced",
    is_limited: true,
    limit_units: 10,
    used_units: 7,
    reserved_units: 1,
    remaining_units: 2,
    would_be_blocked: false,
  });

  assert.equal(row?.feature, "ai_scan");
  assert.equal(row?.limitUnits, 10);
  assert.equal(row?.usedUnits, 7);
  assert.equal(row?.reservedUnits, 1);
  assert.equal(row?.remainingUnits, 2);
  assert.equal(row?.isLimited, true);
});

test("owner allowance is bounded and cannot become a bypass", () => {
  const value = {
    feature: "ai_scan",
    policy_class: "owned",
    is_limited: true,
    is_bypassed: false,
    limit_units: 10,
    used_units: 8,
    reserved_units: 1,
    remaining_units: 1,
  };
  const row = normaliseUsageAllowance(value);
  assert.equal(row?.policyClass, "owned");
  assert.equal(row?.remainingUnits, 1);
  assert.equal(row?.isBypassed, false);
  assert.equal(
    normaliseUsageAllowance({
      ...value,
      is_limited: false,
      is_bypassed: true,
      remaining_units: null,
    }),
    null,
  );
});

test("explicit bypass preserves counted usage with no remaining cap", () => {
  const row = normaliseUsageAllowance({
    feature: "ai_scan",
    policy_class: "admin",
    is_limited: false,
    is_bypassed: true,
    limit_units: 10,
    used_units: 20,
    reserved_units: 0,
    remaining_units: null,
  });
  assert.equal(row?.usedUnits, 20);
  assert.equal(row?.isBypassed, true);
  assert.equal(row?.remainingUnits, null);
});

test("malformed or contradictory allowance responses are rejected", () => {
  for (const row of [
    { feature: "ai_scan" },
    {
      feature: "ai_scan",
      is_limited: true,
      limit_units: 10,
      used_units: 9,
      remaining_units: 10,
    },
    {
      feature: "ai_scan",
      is_limited: true,
      limit_units: NaN,
      remaining_units: 0,
    },
    {
      feature: "ai_scan",
      is_limited: true,
      limit_units: 10,
      remaining_units: null,
    },
  ])
    assert.equal(normaliseUsageAllowance(row), null);
});

test("structured usage errors distinguish recovery from allowance exhaustion", () => {
  assert.equal(usageOperationRecovery("OWNER_FAIR_USE_EXHAUSTED"), "allowance");
  assert.equal(usageOperationRecovery("FREE_ALLOWANCE_EXHAUSTED"), "allowance");
  assert.equal(usageOperationRecovery("OPERATION_IN_PROGRESS"), "wait");
  assert.equal(usageOperationRecovery("OPERATION_COMPLETED"), "completed");
  assert.equal(usageOperationRecovery("OPERATION_REFUNDED"), "new_operation");
  assert.equal(usageOperationRecovery("IDEMPOTENCY_CONFLICT"), "invalid");
  assert.equal(usageOperationRecovery("USAGE_SETTLEMENT_FAILED"), "service");
});

test("classifies free allowance warning levels", () => {
  const base = normaliseUsageAllowance({
    feature: "replacement_pricing",
    is_limited: true,
    limit_units: 5,
    used_units: 3,
    reserved_units: 0,
    remaining_units: 2,
  });

  assert.ok(base);
  assert.equal(usageWarningLevel(base), "none");
  assert.equal(usageWarningLevel({ ...base, remainingUnits: 1 }), "low");
  assert.equal(usageWarningLevel({ ...base, remainingUnits: 0 }), "empty");
  assert.equal(
    usageWarningLevel({ ...base, isLimited: false, remainingUnits: null }),
    "none",
  );
});

test("classifies low AI scan allowance at two remaining", () => {
  const allowance = normaliseUsageAllowance({
    feature: "ai_scan",
    is_limited: true,
    limit_units: 10,
    used_units: 8,
    remaining_units: 2,
  });

  assert.ok(allowance);
  assert.equal(usageWarningLevel(allowance), "low");
});
