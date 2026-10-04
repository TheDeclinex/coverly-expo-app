import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const accountSource = readFileSync(resolve(testDirectory, "../../app/(tabs)/account.tsx"), "utf8");
const deletionSource = readFileSync(resolve(testDirectory, "../../app/(tabs)/account-deletion.tsx"), "utf8");
const upgradeSource = readFileSync(resolve(testDirectory, "../../app/upgrade.tsx"), "utf8");

test("Account row opens the dedicated deletion flow", () => {
  assert.match(accountSource, /router\.push\("\/account-deletion"/);
  assert.match(accountSource, /Delete your Coverly account and associated data\./);
  assert.doesNotMatch(accountSource, /params:\s*\{[\s\S]*category:\s*"account"/);
});

test("dedicated deletion screen preserves the required confirmation, submission, and recovery states", () => {
  assert.match(deletionSource, /accessibilityRole="checkbox"/);
  assert.match(deletionSource, /submitFeedbackReport\(/);
  assert.match(deletionSource, /if \(!canSubmit \|\| submissionLockRef\.current\) return/);
  assert.match(deletionSource, /Deletion request submitted/);
  assert.match(deletionSource, /Please try again/);
  assert.match(deletionSource, /deletionPurchaseCopy\(legacy\)/);
  assert.match(deletionSource, /accessClass === "legacy_plus"/);
  assert.match(deletionSource, />Cancel</);
});

test("dedicated deletion screen does not expose generic feedback or attachment controls", () => {
  assert.doesNotMatch(deletionSource, /ChipGroup|ImagePicker|Attach screenshot|priorityOptions|categoryOptions|typeOptions/);
});

test("ownership screen keeps restore, canonical access protection and one explicit product", () => {
  assert.match(upgradeSource, /Restore Purchases/);
  assert.match(upgradeSource, /purchaseActionLockRef\.current/);
  assert.match(upgradeSource, /ownershipScreenState/);
  assert.match(upgradeSource, /selectOwnershipPackage/);
  assert.match(upgradeSource, /state !== "available"/);
  assert.match(upgradeSource, /Retry confirmation/);
  assert.doesNotMatch(upgradeSource, /Current subscription|Compare plans|Best value|Choose plan|activeSubscriptions/);
});
