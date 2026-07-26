import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "app/(tabs)/scan.tsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "lib/scan-service.ts"), "utf8");
const workflowHeader = readFileSync(
  resolve(process.cwd(), "components/ScanWorkflowHeader.tsx"),
  "utf8",
);
const scanningOverlay = readFileSync(
  resolve(process.cwd(), "components/AiScanningOverlay.tsx"),
  "utf8",
);

test("the safe-area workflow header is authoritative in every scan render branch", () => {
  assert.equal(source.match(/<ScanWorkflowHeader/g)?.length, 6);
  assert.match(source, /<Stack\.Screen options=\{\{ title: "Scan items", headerShown: false \}\} \/>[\s\S]*<ScanWorkflowHeader[\s\S]*<ScrollView/);
  assert.doesNotMatch(source, /ContextBackButton|stepBackButton|preparingCancelButton|headerLeft|headerRight/);
  assert.doesNotMatch(source, /<Text[^>]*>Room<\/Text>|<Text[^>]*>Property<\/Text>/);
  assert.doesNotMatch(scanningOverlay, /onCancel|Cancel scan|cancelButton/);

  assert.match(workflowHeader, /SafeAreaView/);
  assert.match(workflowHeader, /edges=\{\["top"\]\}/);
  assert.match(workflowHeader, /minWidth: 44/);
  assert.match(workflowHeader, /minHeight: 44/);
  assert.doesNotMatch(workflowHeader, /top:\s*\d+|marginTop:\s*\d+/);
});

test("single-photo and single-item camera cancellation settle all transient scan state", () => {
  assert.match(source, /const cancelEmbeddedPhotoCapture = \(\) => \{[\s\S]*single_item_camera_cancelled[\s\S]*single_photo_camera_cancelled/);
  assert.match(source, /single_item_camera_cancelled[\s\S]*clearCaptureState/);
  assert.match(source, /setPendingPhotoCapture\(null\)/);
  assert.match(source, /setSelectedMode\(null\)/);
  assert.match(source, /scanSubmissionInFlightRef\.current = null/);
});

test("single-photo and multi-photo picker cancellation return to clean scan selection", () => {
  assert.match(source, /if \(result\.canceled\) \{[\s\S]*multi_photo_library_cancelled[\s\S]*single_photo_library_cancelled/);
  assert.match(source, /setMultiPhotoPromptVisible\(false\)/);
  assert.match(source, /pendingMultiPhotoCameraRef\.current = false/);
  assert.match(source, /setImages\(\[\]\)/);
});

test("video picker and recorder cancellation invalidate pending processing", () => {
  assert.match(source, /video_library_cancelled/);
  assert.match(source, /video_camera_cancelled/);
  assert.match(source, /<VideoScanRecorder[\s\S]*onCancel=\{cancelVideoCapture\}/);
  assert.match(source, /videoProcessingSessionRef\.current \+= 1/);
  assert.match(source, /videoProcessingRef\.current = null/);
  assert.match(source, /setVideoRecorderVisible\(false\)/);
});

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

test("credit rejection and paywall dismissal cannot resume a partial scan", () => {
  assert.match(source, /if \(!enforce\("ai_scan"\)\) \{[\s\S]*clearCaptureState\("scan_credit_preflight_rejected"\)/);
  assert.match(source, /scan_limit_dismissed/);
  assert.match(source, /onDismiss=\{dismissScanLimit\}/);
  assert.match(source, /onPrimary=\{\(\) => \{[\s\S]*returnToScanTypeSelection\(\);[\s\S]*router\.push/);
  assert.match(source, /onSecondary=\{\(\) => \{[\s\S]*returnToScanTypeSelection\(\);[\s\S]*add-item/);
  assert.match(source, /scanUsageIdempotencyKeyRef\.current = null/);
  assert.match(source, /aiScanEntitlementCheckedRef\.current = false/);
});

test("scan failure recovery returns through the supported scan selection state", () => {
  assert.match(source, /showRecoverableScanError[\s\S]*setScanStatus\("error"\)/);
  assert.match(source, /onPress=\{returnToScanTypeSelection\}[\s\S]*Choose another scan type/);
  assert.match(source, /const returnToScanTypeSelection = \(\) => \{[\s\S]*clearCaptureState\("return_to_scan_type_selection"\)/);
});

test("permanent camera and photo denial offers Settings recovery", () => {
  assert.match(source, /permission\.canAskAgain !== false/);
  assert.match(source, /Linking\.openSettings\(\)/);
  assert.match(source, /Open Settings/);
});
