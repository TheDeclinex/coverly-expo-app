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
  assert.equal(classifyBarcodeFailure("PROVIDER_AUTH_ERROR", "Provider authentication failed"), "authentication");
  assert.equal(classifyBarcodeFailure("PROVIDER_RATE_LIMIT", "Provider rate limit reached"), "rate-limit");
  assert.equal(classifyBarcodeFailure("MALFORMED_PROVIDER_RESPONSE", "Invalid response"), "malformed-response");
  assert.equal(classifyBarcodeFailure("LOCAL_PARSE_ERROR", "Could not parse result"), "parse");
  assert.equal(classifyBarcodeFailure("UPSTREAM_ERROR", "Provider rejected request"), "service");
});

test("EAN and UPC lengths are validated before lookup", () => {
  assert.equal(isSupportedBarcodeValue("12345678"), true);
  assert.equal(isSupportedBarcodeValue("123456789012"), true);
  assert.equal(isSupportedBarcodeValue("1234567890123"), true);
  assert.equal(isSupportedBarcodeValue("0012345678905"), true);
  assert.equal(isSupportedBarcodeValue("abc123"), false);
});
