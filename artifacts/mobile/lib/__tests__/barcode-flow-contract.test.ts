import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "components/BarcodeScanFlow.tsx"), "utf8");
const itemDetailSource = readFileSync(resolve(process.cwd(), "app/(tabs)/item/[id].tsx"), "utf8");
const roomDetailSource = readFileSync(resolve(process.cwd(), "app/(tabs)/room/[id].tsx"), "utf8");

test("barcode save failures have an explicit rendered stage", () => {
  assert.match(source, /type ScanStage = [^;]*"save-error"/);
  assert.match(source, /setStage\("save-error"\)/);
  assert.match(source, /stage === "save-error"/);
  assert.doesNotMatch(source, /setStage\("error"\)/);
});

test("barcode save-error recovery keeps retry and cancel without creating a manual-entry path", () => {
  assert.match(source, /Couldn.t save barcode details/);
  assert.match(source, /accessibilityLabel="Retry saving barcode match"/);
  assert.match(source, /accessibilityLabel="Retry keeping captured barcode"/);
  assert.match(source, /accessibilityLabel="Cancel barcode changes"/);
  assert.match(source, /detectedBarcode/);
  assert.match(source, /result\.productName/);
  assert.doesNotMatch(source, /Enter item manually|Enter manually|enter the item manually/i);
});

test("lookup failure states remain distinct from save failures", () => {
  assert.match(source, /stage === "not-found"/);
  assert.match(source, /stage === "invalid"/);
  assert.match(source, /stage === "network"/);
  assert.match(source, /stage === "service"/);
  assert.match(source, /stage === "authentication"/);
  assert.match(source, /stage === "rate-limit"/);
  assert.match(source, /stage === "malformed-response"/);
  assert.match(source, /stage === "parse"/);
  assert.match(source, /stage === "save-error"/);
});

test("scanner format and raw string are retained for diagnostics", () => {
  assert.match(source, /\{ data, type \}: BarcodeScanningResult/);
  assert.match(source, /rawScannedBarcode: data/);
  assert.match(source, /detectedBarcodeFormat: type/);
  assert.match(source, /barcodeFormat: type/);
});

test("permanently denied camera access opens Settings and refreshes on foreground return", () => {
  assert.match(source, /permission\.canAskAgain === false/);
  assert.match(source, /Linking\.openSettings\(\)/);
  assert.match(source, /AppState\.addEventListener\("change"/);
  assert.match(source, /nextState === "active" && previousState !== "active"/);
  assert.match(source, /void getPermission\(\)/);
});

test("barcode provider and save errors are not rendered verbatim", () => {
  assert.doesNotMatch(source, /response\.error \|\| barcodeFailureCopy/);
  assert.match(source, /Your existing item details were not changed/);
});

test("successful matches are applied only after explicit confirmation", () => {
  assert.match(source, /const applyMatch = async \(\) =>/);
  assert.match(source, /await onApply\(\{\s*barcode: result\.barcode\?\.trim\(\) \|\| detectedBarcode/);
  assert.match(source, /Nothing changes until you confirm/);
  assert.match(source, />Apply to item</);
});

test("genuine no-result preserves the captured barcode and offers launch-safe actions", () => {
  assert.match(source, /The barcode was captured, but matching product details are unavailable/);
  assert.match(source, /await onApply\(\{ barcode: detectedBarcode, verified: false \}\)/);
  assert.match(source, /accessibilityLabel="Keep captured barcode"/);
  assert.match(source, />Keep barcode</);
  assert.match(source, /accessibilityLabel="Scan another barcode"/);
  assert.match(source, />Scan another</);
  assert.match(source, /accessibilityLabel="Cancel barcode changes"/);
});

test("rate limits and provider failures use temporary-service messaging rather than not-found copy", () => {
  assert.match(source, /if \(kind === "rate-limit"\) return "Barcode lookup limit reached"/);
  assert.match(source, /temporarily limiting lookups/);
  assert.match(source, /provider could not authenticate this request/);
  assert.match(source, /provider returned an invalid response/);
  assert.match(source, /Coverly could not read the product details returned/);
  assert.match(source, /return "Barcode service unavailable"/);
});

test("scan another and cancel never invoke the item update callback", () => {
  assert.match(source, /accessibilityLabel="Scan another barcode"\s*onPress=\{resetScan\}/);
  assert.match(source, /accessibilityLabel="Cancel barcode changes"\s*onPress=\{onClose\}/);
  assert.match(source, /onRequestClose=\{onClose\}/);
  assert.equal(source.match(/await onApply\(/g)?.length, 2);
});

test("barcode flow has no image lookup, navigation, item insertion, or duplicate manual-entry flow", () => {
  assert.doesNotMatch(source, /onTakePhoto|Take a photo|imageBase64|router\.push|\.insert\(/);
  assert.doesNotMatch(itemDetailSource, /onTakePhoto=/);
  assert.doesNotMatch(roomDetailSource, /onTakePhoto=/);
  assert.match(itemDetailSource, /\.from\("inventory_items"\)\s*\.update\(updates\)\s*\.eq\("id", item\.id\)/);
  assert.match(roomDetailSource, /\.from\("inventory_items"\)\s*\.update\(updates\)\s*\.eq\("id", item\.id\)/);
});
