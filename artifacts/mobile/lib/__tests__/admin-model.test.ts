import assert from "node:assert/strict";
import test from "node:test";

import {
  adminCurrencyLabel,
  adminInventoryTotalLabel,
  adminDateLabel,
  adminMetricLabel,
  adminNumberLabel,
  adminUserIdDebugSummary,
  normalizeAdminUserIdParam,
  adminStatusLabel,
  adminTextLabel,
} from "../admin-model.ts";

test("admin labels show Not available for nullish values", () => {
  assert.equal(adminNumberLabel(null), "Not available");
  assert.equal(adminCurrencyLabel(undefined), "Not available");
  assert.equal(adminTextLabel(""), "Not available");
  assert.equal(adminDateLabel("not-a-date"), "Not available");
});

test("admin inventory totals preserve one or many currencies without conversion", () => {
  assert.match(adminInventoryTotalLabel(125, "NZD", { NZD: 125 }), /NZD/);
  assert.match(adminInventoryTotalLabel(0, "NZD", { USD: 80 }), /USD/);
  const localAndForeign = adminInventoryTotalLabel(125, "NZD", { NZD: 125, USD: 80 });
  assert.match(localAndForeign, /NZD/);
  assert.match(localAndForeign, /USD/);
  const foreignOnly = adminInventoryTotalLabel(0, "NZD", { AUD: 50, EUR: 75 });
  assert.match(foreignOnly, /AUD/);
  assert.match(foreignOnly, /EUR/);
  assert.equal(adminInventoryTotalLabel(0, "NZD", {}), "Not available");
  assert.equal(adminInventoryTotalLabel(0, "NZD", { NZD: 0 }), "Not available");
});

test("admin status labels are human readable", () => {
  assert.equal(adminStatusLabel("coverly_plus"), "Coverly Plus");
  assert.equal(adminStatusLabel("under-investigation"), "Under Investigation");
});

test("admin metric label handles loading and error states", () => {
  assert.equal(adminMetricLabel(12), "12");
  assert.equal(adminMetricLabel(null, true), "Loading");
  assert.equal(adminMetricLabel(null, false, true), "Unavailable");
});

test("admin user id helpers normalize route params safely", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(normalizeAdminUserIdParam(id), id);
  assert.equal(normalizeAdminUserIdParam([id, "ignored"]), id);
  assert.equal(normalizeAdminUserIdParam("  "), null);
  assert.deepEqual(adminUserIdDebugSummary(id), {
    present: true,
    type: "string",
    length: 36,
    uuidLike: true,
  });
});
