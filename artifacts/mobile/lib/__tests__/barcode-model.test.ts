import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBarcodeFailure,
  isSupportedBarcodeValue,
} from "../barcode-model.ts";

test("barcode no-match is distinct from invalid, network, and service failures", () => {
  assert.equal(classifyBarcodeFailure("PRODUCT_NOT_FOUND", "No product"), "not-found");
  assert.equal(classifyBarcodeFailure("INVALID_BARCODE", "Bad value"), "invalid");
  assert.equal(classifyBarcodeFailure(null, "Network request failed"), "network");
  assert.equal(classifyBarcodeFailure("UPSTREAM_ERROR", "Provider rejected request"), "service");
});

test("EAN and UPC lengths are validated before lookup", () => {
  assert.equal(isSupportedBarcodeValue("12345678"), true);
  assert.equal(isSupportedBarcodeValue("123456789012"), true);
  assert.equal(isSupportedBarcodeValue("1234567890123"), true);
  assert.equal(isSupportedBarcodeValue("abc123"), false);
});
