import assert from "node:assert/strict";
import test from "node:test";

import {
  getPropertyAllowance,
  parsePropertyAllowance,
  propertyAllowanceCopy,
} from "../property-allowance.ts";

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
  assert.equal(
    getPropertyAllowance("unknown", 0, "ready").canCreateProperty,
    false,
  );
  assert.equal(
    getPropertyAllowance("unknown", 0, "loading").blockReason,
    "entitlement_unavailable",
  );
  assert.equal(
    getPropertyAllowance("unknown", 0, "unavailable").canCreateProperty,
    false,
  );
});

test("deleting the only property restores eligibility", () => {
  assert.equal(getPropertyAllowance("free", 1).canCreateProperty, false);
  assert.equal(getPropertyAllowance("free", 0).canCreateProperty, true);
});

test("server rows are parsed into the shared allowance shape", () => {
  assert.deepEqual(
    parsePropertyAllowance({
      access_class: "plus",
      property_count: 1,
      property_limit: 1,
      can_create_property: false,
      required_plan: "coverly_family",
      block_reason: "property_limit_reached",
    }),
    getPropertyAllowance("plus", 1),
  );
});

test("Free can purchase ownership while legacy Plus keeps its existing access", () => {
  const freeCopy = propertyAllowanceCopy(getPropertyAllowance("free", 1));
  const plusCopy = propertyAllowanceCopy(getPropertyAllowance("plus", 1));
  assert.equal(freeCopy.action, "purchase");
  assert.equal(plusCopy.action, "dismiss");
  assert.equal(freeCopy.title, "You've reached your property limit");
  assert.equal(freeCopy.primaryCta, "Own Coverly");
  assert.equal(freeCopy.secondaryCta, "Continue with current property");
  assert.equal(freeCopy.benefit, "");
});

test("RPC numeric limits are authoritative even for legacy Family", () => {
  for (const access_class of ["owner", "family", "plus", "free"]) {
    const row = {
      access_class,
      property_count: 4,
      property_limit: 5,
      can_create_property: true,
    };
    assert.equal(parsePropertyAllowance(row).propertyLimit, 5);
    assert.equal(parsePropertyAllowance(row).canCreateProperty, true);
    assert.equal(
      parsePropertyAllowance({
        ...row,
        property_count: 5,
        can_create_property: false,
      }).canCreateProperty,
      false,
    );
    assert.equal(
      parsePropertyAllowance({
        ...row,
        property_count: 8,
        can_create_property: false,
      }).propertyCount,
      8,
    );
  }
});

test("RPC unlimited allowance and explicit denials are preserved", () => {
  assert.equal(
    parsePropertyAllowance({
      access_class: "family",
      property_count: 50,
      property_limit: null,
      can_create_property: true,
    }).canCreateProperty,
    true,
  );
  assert.equal(
    parsePropertyAllowance({
      access_class: "owner",
      property_count: 0,
      property_limit: 5,
      can_create_property: false,
    }).canCreateProperty,
    false,
  );
});

test("missing, malformed and contradictory server limits cannot grant access", () => {
  const base = {
    access_class: "family",
    property_count: 0,
    can_create_property: true,
  };
  for (const property_limit of [undefined, "5", -1, 1.5, NaN, Infinity]) {
    assert.equal(
      parsePropertyAllowance({ ...base, property_limit }).state,
      "unavailable",
    );
  }
  assert.equal(
    parsePropertyAllowance({ ...base, property_limit: 5, property_count: 5 })
      .canCreateProperty,
    false,
  );
  assert.equal(
    parsePropertyAllowance({ ...base, property_limit: 5, property_count: -1 })
      .state,
    "unavailable",
  );
  assert.equal(
    parsePropertyAllowance({
      ...base,
      property_limit: 5,
      can_create_property: undefined,
    }).state,
    "unavailable",
  );
});
