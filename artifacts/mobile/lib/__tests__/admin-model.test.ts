import assert from "node:assert/strict";
import test from "node:test";

import {
  adminCurrencyLabel,
  adminDateLabel,
  adminMetricLabel,
  adminNumberLabel,
  adminStatusLabel,
  adminTextLabel,
} from "../admin-model.ts";

test("admin labels show Not available for nullish values", () => {
  assert.equal(adminNumberLabel(null), "Not available");
  assert.equal(adminCurrencyLabel(undefined), "Not available");
  assert.equal(adminTextLabel(""), "Not available");
  assert.equal(adminDateLabel("not-a-date"), "Not available");
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
