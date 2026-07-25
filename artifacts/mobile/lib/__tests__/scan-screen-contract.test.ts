import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "app/(tabs)/scan.tsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "lib/scan-service.ts"), "utf8");

test("scan submission is synchronously single-flight and cancelled work is invalidated", () => {
  assert.match(source, /scanSubmissionInFlightRef\.current !== null/);
  assert.match(source, /duplicate scan start ignored/);
  assert.match(source, /scanAttemptRef\.current \+= 1/);
  assert.match(source, /screenMountedRef\.current = false/);
  assert.match(source, /scanSubmissionInFlightRef\.current === scanAttemptId/);
});

test("the same scan keeps one usage idempotency key across retry and compatibility mode", () => {
  assert.match(source, /scanUsageIdempotencyKeyRef/);
  assert.match(source, /usageIdempotencyKey:/);
  assert.match(source, /createScanUsageIdempotencyKey\(\)/);
  assert.match(source, /retryCompatibilityScan/);
  assert.match(service, /usageIdempotencyKey: input\.usageIdempotencyKey \?\? createUsageIdempotencyKey\(\)/);
});

test("timeouts abort the native fetch and user errors avoid raw backend copy", () => {
  assert.match(service, /const controller = new AbortController\(\)/);
  assert.match(service, /controller\.abort\(\)/);
  assert.match(service, /publicScanFailureMessage/);
  assert.doesNotMatch(source, /setScanError\(message \|\| "You must be signed in to scan items\."\)/);
});

test("usage-limit dismissal and decline always leave the scan workflow", () => {
  assert.match(source, /onDismiss=\{returnToScanTypeSelection\}/);
  assert.match(source, /onPrimary=\{\(\) => \{[\s\S]*returnToScanTypeSelection\(\);[\s\S]*router\.push/);
  assert.match(source, /onSecondary=\{\(\) => \{[\s\S]*returnToScanTypeSelection\(\);[\s\S]*add-item/);
});

test("permanent camera and photo denial offers Settings recovery", () => {
  assert.match(source, /permission\.canAskAgain !== false/);
  assert.match(source, /Linking\.openSettings\(\)/);
  assert.match(source, /Open Settings/);
});
