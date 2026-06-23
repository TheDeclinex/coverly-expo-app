import assert from "node:assert/strict";
import test from "node:test";

import {
  normaliseUsageAllowance,
  usageWarningLevel,
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
  assert.equal(usageWarningLevel({ ...base, isLimited: false, remainingUnits: null }), "none");
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
