import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COUNTRY_CODE,
  isServerOnboardingComplete,
  normaliseProfileSettings,
  validateProfileSettings,
} from "../profile-settings-model.ts";

test("normalises missing optional settings to safe V1 defaults", () => {
  const settings = normaliseProfileSettings({ id: "user-1", email: "user@example.com" });
  assert.equal(settings.countryCode, DEFAULT_COUNTRY_CODE);
  assert.equal(settings.reminderNotificationsEnabled, false);
  assert.equal(settings.productUpdatesEnabled, false);
  assert.equal(settings.onboardingStatus, "new");
});

test("only completed is a completed server onboarding value", () => {
  assert.equal(isServerOnboardingComplete("completed"), true);
  assert.equal(isServerOnboardingComplete("complete"), false);
  assert.equal(isServerOnboardingComplete("new"), false);
  assert.equal(isServerOnboardingComplete(null), false);
});

test("validates name length and ISO-style country codes", () => {
  assert.equal(validateProfileSettings({ fullName: "A".repeat(101), countryCode: "NZ", reminderNotificationsEnabled: false, productUpdatesEnabled: false }), "Full name must be 100 characters or fewer.");
  assert.equal(validateProfileSettings({ fullName: "Casey", countryCode: "", reminderNotificationsEnabled: false, productUpdatesEnabled: false }), "Choose a valid country or region.");
  assert.equal(validateProfileSettings({ fullName: "Casey", countryCode: "nz", reminderNotificationsEnabled: true, productUpdatesEnabled: true }), null);
});
