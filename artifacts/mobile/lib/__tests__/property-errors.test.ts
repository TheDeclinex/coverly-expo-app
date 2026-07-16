import assert from "node:assert/strict";
import test from "node:test";

import { normalizePropertyCreationError } from "../property-errors.ts";

test("PROPERTY_LIMIT_REACHED maps structured details without exposing SQL", () => {
  const error = normalizePropertyCreationError({
    message: "PROPERTY_LIMIT_REACHED",
    details: JSON.stringify({ propertyCount: 1, propertyLimit: 1, requiredPlan: "coverly_family" }),
  });
  assert.equal(error.errorCode, "PROPERTY_LIMIT_REACHED");
  assert.deepEqual(error.details, { propertyCount: 1, propertyLimit: 1, requiredPlan: "coverly_family" });
  assert.doesNotMatch(error.message, /P0001|SQL|RPC/i);
});

test("allowance failures and unknown failures use safe messages", () => {
  assert.equal(normalizePropertyCreationError({ message: "PROPERTY_ALLOWANCE_UNAVAILABLE" }).errorCode, "PROPERTY_ALLOWANCE_UNAVAILABLE");
  const unknown = normalizePropertyCreationError({ message: "sensitive database detail" });
  assert.equal(unknown.errorCode, "PROPERTY_CREATION_FAILED");
  assert.equal(unknown.message, "Could not create property. Please try again.");
});
