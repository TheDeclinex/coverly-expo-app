import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "components/BarcodeScanFlow.tsx"), "utf8");

test("barcode save failures have an explicit rendered stage", () => {
  assert.match(source, /type ScanStage = [^;]*"save-error"/);
  assert.match(source, /setStage\("save-error"\)/);
  assert.match(source, /stage === "save-error"/);
  assert.doesNotMatch(source, /setStage\("error"\)/);
});

test("barcode save-error recovery keeps retry, manual, and cancel actions", () => {
  assert.match(source, /Couldn.t save barcode details/);
  assert.match(source, /accessibilityLabel="Retry saving barcode match"/);
  assert.match(source, /accessibilityLabel="Save barcode and enter item manually"/);
  assert.match(source, /accessibilityLabel="Cancel barcode changes"/);
  assert.match(source, /detectedBarcode/);
  assert.match(source, /result\.productName/);
});

test("lookup failure states remain distinct from save failures", () => {
  assert.match(source, /stage === "not-found"/);
  assert.match(source, /stage === "invalid"/);
  assert.match(source, /stage === "network"/);
  assert.match(source, /stage === "service"/);
  assert.match(source, /stage === "save-error"/);
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
