import assert from "node:assert/strict";
import test from "node:test";

import { getPropertyAllowance, parsePropertyAllowance, propertyAllowanceCopy } from "../property-allowance.ts";

test("Free and Plus can create their first property but not a second", () => {
  for (const accessClass of ["free", "plus"] as const) {
    assert.equal(getPropertyAllowance(accessClass, 0).canCreateProperty, true);
    const atLimit = getPropertyAllowance(accessClass, 1);
    assert.equal(atLimit.canCreateProperty, false);
    assert.equal(atLimit.propertyLimit, 1);
    assert.equal(atLimit.requiredPlan, "coverly_family");
    assert.equal(atLimit.blockReason, "property_limit_reached");
  }
});

test("Family and explicit full access remain unlimited", () => {
  for (const accessClass of ["family", "full_access"] as const) {
    const allowance = getPropertyAllowance(accessClass, 12);
    assert.equal(allowance.canCreateProperty, true);
    assert.equal(allowance.propertyLimit, null);
  }
});

test("users already above a limited-plan allowance retain their count but cannot add", () => {
  const plus = getPropertyAllowance("plus", 4);
  assert.equal(plus.propertyCount, 4);
  assert.equal(plus.canCreateProperty, false);

  const downgraded = getPropertyAllowance("plus", 3);
  assert.equal(downgraded.propertyCount, 3);
  assert.equal(downgraded.canCreateProperty, false);
});

test("unknown, loading, and unavailable states fail closed", () => {
  assert.equal(getPropertyAllowance("unknown", 0, "ready").canCreateProperty, false);
  assert.equal(getPropertyAllowance("unknown", 0, "loading").blockReason, "entitlement_unavailable");
  assert.equal(getPropertyAllowance("unknown", 0, "unavailable").canCreateProperty, false);
});

test("deleting the only property restores eligibility", () => {
  assert.equal(getPropertyAllowance("free", 1).canCreateProperty, false);
  assert.equal(getPropertyAllowance("free", 0).canCreateProperty, true);
});

test("server rows are parsed into the shared allowance shape", () => {
  assert.deepEqual(parsePropertyAllowance({
    access_class: "plus",
    property_count: 1,
    property_limit: 1,
    can_create_property: false,
    required_plan: "coverly_family",
    block_reason: "property_limit_reached",
  }), getPropertyAllowance("plus", 1));
});

test("Free and Plus receive the same concise Family upgrade copy", () => {
  const freeCopy = propertyAllowanceCopy(getPropertyAllowance("free", 1));
  const plusCopy = propertyAllowanceCopy(getPropertyAllowance("plus", 1));
  assert.deepEqual(freeCopy, plusCopy);
  assert.equal(freeCopy.title, "You've reached your property limit");
  assert.equal(freeCopy.primaryCta, "Upgrade to Family");
  assert.equal(freeCopy.secondaryCta, "Continue with current property");
  assert.equal(freeCopy.benefit, "");
});
