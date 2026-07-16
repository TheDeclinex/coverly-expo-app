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
  assert.match(deletionSource, /does not cancel an Apple App Store or Google Play subscription/);
  assert.match(deletionSource, />Cancel</);
});

test("dedicated deletion screen does not expose generic feedback or attachment controls", () => {
  assert.doesNotMatch(deletionSource, /ChipGroup|ImagePicker|Attach screenshot|priorityOptions|categoryOptions|typeOptions/);
});

test("upgrade screen keeps restore, current-package protection, and an authoritative comparison", () => {
  assert.match(upgradeSource, /Restore purchases/);
  assert.match(upgradeSource, /Current subscription/);
  assert.match(upgradeSource, /purchaseActionLockRef\.current/);
  assert.match(upgradeSource, />Compare plans</);
  assert.doesNotMatch(upgradeSource, /Only Coverly Family enables multiple properties\./);
  assert.doesNotMatch(upgradeSource, /Your Plus plan includes one property\./);
  assert.match(upgradeSource, /propertyAllowance\.accessClass === "full_access"/);
  assert.doesNotMatch(upgradeSource, /invit|collaborat|shared access|household members/i);
});
