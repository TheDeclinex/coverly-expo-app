import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const camera = read("components/PhotoScanCamera.tsx");
const scan = read("app/(tabs)/scan.tsx");

test("all native still scan modes expose the existing library pipeline from the Coverly camera", () => {
  for (const mode of ["single_photo_room", "multi_photo_room", "single_item"]) {
    assert.match(camera, new RegExp(`${mode}: \\{`));
  }
  assert.match(scan, /setPendingPhotoCapture\(\{ mode, autoStart, requestId \}\)/);
  assert.match(scan, /Platform\.OS !== "web"[\s\S]*setPendingPhotoCapture/);
  assert.match(camera, /onPickLibrary: \(\) => void \| Promise<void>/);
  assert.match(camera, /accessibilityLabel="Choose photo from library"/);
  assert.match(scan, /onPickLibrary=\{handleEmbeddedLibraryPick\}/);
  assert.match(scan, /handleEmbeddedLibraryPick[\s\S]*pickImages\(request\.mode, images\.length/);
  assert.match(scan, /launchImageLibraryAsync/);
  assert.match(scan, /allowsMultipleSelection: isMulti/);
  assert.match(scan, /selectionLimit: isMulti \? remainingMultiPhotos : 1/);
  assert.match(scan, /launchCameraAsync/);
  assert.match(scan, /Keep the existing web file\/camera prompt/);
});

test("embedded library cancellation resumes the camera without resetting scan navigation", () => {
  assert.match(
    scan,
    /handleEmbeddedLibraryPick[\s\S]*preserveSessionOnCancel: true/,
  );
  assert.match(
    scan,
    /if \(result\.canceled\)[\s\S]*if \(!options\.preserveSessionOnCancel\)[\s\S]*clearCaptureState/,
  );
  assert.match(
    scan,
    /onSelectionAccepted[\s\S]*photoCaptureSessionRef\.current \+= 1;[\s\S]*setPendingPhotoCapture\(null\)/,
  );
  assert.match(camera, /invalidateCapture\(\);[\s\S]*await onPickLibrary\(\)/);
});

test("camera overlays keep controls accessible while leaving the preview dominant", () => {
  assert.match(camera, /<LinearGradient[\s\S]*styles\.headerGradient/);
  assert.match(camera, /<LinearGradient[\s\S]*styles\.controls/);
  assert.match(camera, /width: 44,[\s\S]*height: 44/);
  assert.match(camera, /width: 52,[\s\S]*height: 52/);
  assert.match(camera, /width: 68,[\s\S]*height: 68/);
  assert.match(camera, /instruction: "Capture another angle if needed\."/);
  assert.doesNotMatch(camera, /Capture one clear room angle\. You can choose whether to take more next\./);
});

test("single room and single item captures retain the existing automatic scan path", () => {
  assert.match(scan, /processCapturedPhoto[\s\S]*if \(autoStart\) \{[\s\S]*await handleStartScan\(mode, capturedImages\)/);
  assert.match(scan, /void takePhoto\(mode, mode !== "multi_photo_room"\)/);
  assert.match(scan, /await imageFromPickerAsset\(asset, "camera", 0\)/);
});

test("multi photo capture remains an adapter around the existing session modal", () => {
  assert.match(scan, /setImages\(\(current\) => \[\.\.\.current, capturedImage\]\.slice\(0, MAX_MULTI_PHOTO_IMAGES\)\)/);
  assert.match(scan, /setMultiPhotoPromptVisible\(true\)/);
  assert.match(scan, /takeAnotherMultiPhoto[\s\S]*pendingMultiPhotoCameraRef\.current = true/);
  assert.match(scan, /openPendingMultiPhotoCamera[\s\S]*takePhoto\("multi_photo_room", false\)/);
  assert.match(scan, /Take another photo/);
  assert.match(scan, /handleStartScan\("multi_photo_room"\)/);
  assert.match(scan, /All \$\{MAX_MULTI_PHOTO_IMAGES\} photos are ready to scan/);
});

test("multi photo cancellation settles the session and returns to scan selection", () => {
  assert.match(
    scan,
    /cancelEmbeddedPhotoCapture[\s\S]*multi_photo_camera_cancelled[\s\S]*single_photo_camera_cancelled/,
  );
  assert.match(scan, /clearCaptureState[\s\S]*setImages\(\[\]\)[\s\S]*setMultiPhotoPromptVisible\(false\)/);
  assert.doesNotMatch(
    scan,
    /cancelEmbeddedPhotoCapture[\s\S]*cancelledMode === "multi_photo_room" && images\.length > 0/,
  );
});

test("rapid taps, cancel, background, unmount, and repeat capture invalidate stale callbacks", () => {
  assert.match(camera, /captureLockedRef\.current/);
  assert.match(camera, /captureSessionRef\.current !== sessionId/);
  assert.match(camera, /AppState\.addEventListener\("change"/);
  assert.match(camera, /invalidateCapture\(\)/);
  assert.match(camera, /return \(\) => \{[\s\S]*mountedRef\.current = false;[\s\S]*invalidateCapture\(\)/);
  assert.match(scan, /request\.requestId !== photoCaptureSessionRef\.current/);
});

test("still photography requests camera only and recovers permissions through Settings and foreground refresh", () => {
  assert.match(camera, /useCameraPermissions\(\)/);
  assert.doesNotMatch(camera, /useMicrophonePermissions|requestMicrophonePermission/);
  assert.match(camera, /permission\?\.canAskAgain === false/);
  assert.match(camera, /Linking\.openSettings\(\)/);
  assert.match(camera, /void getPermission\(\)/);
});

test("scan entitlement, usage, limit, and upgrade paths remain outside the camera adapter", () => {
  assert.match(
    scan,
    /if \(!enforce\("ai_scan"\)\) \{[\s\S]*clearCaptureState\("scan_credit_preflight_rejected"\)/,
  );
  assert.match(scan, /scanUsageIdempotencyKeyRef/);
  assert.match(scan, /usageIdempotencyKey:/);
  assert.match(scan, /<LimitReachedModal/);
  assert.match(scan, /router\.push\(\{ pathname: "\/upgrade", params: \{ feature: "ai_scan" \}/);
  assert.doesNotMatch(camera, /enforce\(|usage|upgrade|MAX_MULTI_PHOTO_IMAGES|handleStartScan/);
});
