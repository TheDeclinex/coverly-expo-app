import assert from "node:assert/strict";
import test from "node:test";

import { publicScanFailureMessage, scanFailureCategory } from "../scan-errors.ts";

test("scan failures expose safe recovery copy rather than provider messages", () => {
  const providerFailure = {
    httpStatus: 500,
    errorCode: "OPENAI_ERROR",
    errorMessage: "upstream provider secret diagnostic",
  };
  assert.equal(scanFailureCategory(providerFailure), "service");
  const copy = publicScanFailureMessage(providerFailure);
  assert.match(copy, /No items were saved/);
  assert.doesNotMatch(copy, /provider|secret|OPENAI/i);
});

test("upload, timeout, network, and auth failures explain submission uncertainty", () => {
  assert.match(publicScanFailureMessage({ errorCode: "SCAN_UPLOAD_FAILED" }), /could not be submitted/);
  assert.match(publicScanFailureMessage({ errorCode: "SCAN_TIMEOUT" }), /may have reached Coverly/);
  assert.match(publicScanFailureMessage({ errorCode: "SCAN_NETWORK_ERROR" }), /may not have reached Coverly/);
  assert.match(publicScanFailureMessage({ httpStatus: 401 }), /session could not be verified/);
});
