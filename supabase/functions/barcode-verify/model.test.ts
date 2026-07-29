import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBarcodeKind,
  classifyUpcHttpFailure,
  normalizeBarcodeForLookup,
  parseUpcSuccessPayload,
} from "./model.ts";

test("barcode normalization preserves strings and leading zeroes", () => {
  assert.equal(normalizeBarcodeForLookup(" 012345678905 "), "0012345678905");
  assert.equal(normalizeBarcodeForLookup("0012345678905"), "0012345678905");
  assert.equal(normalizeBarcodeForLookup("9400547002634"), "9400547002634");
  assert.equal(normalizeBarcodeForLookup("12345670"), "12345670");
});

test("UPC-A and its zero-prefixed EAN-13 form are classified distinctly", () => {
  assert.equal(classifyBarcodeKind("012345678905"), "upc-a");
  assert.equal(classifyBarcodeKind("0012345678905"), "ean-13-upc-a-equivalent");
  assert.equal(classifyBarcodeKind("9400547002634"), "ean-13");
  assert.equal(classifyBarcodeKind("12345670"), "ean-8");
});

test("valid no-result responses are distinct from malformed responses", () => {
  assert.deepEqual(
    parseUpcSuccessPayload({ code: "OK", total: 0, items: [] }),
    {
      kind: "not-found",
      resultCount: 0,
    },
  );
  assert.equal(
    parseUpcSuccessPayload({ code: "OK", total: 1 }).kind,
    "malformed",
  );
  assert.equal(
    parseUpcSuccessPayload("<html>gateway failure</html>").kind,
    "malformed",
  );
});

test("provider HTTP failures retain their operational category", () => {
  assert.equal(classifyUpcHttpFailure(404, "NOT_FOUND"), "not-found");
  assert.equal(classifyUpcHttpFailure(400, "INVALID_UPC"), "invalid");
  assert.equal(classifyUpcHttpFailure(401, "AUTH_ERR"), "authentication");
  assert.equal(classifyUpcHttpFailure(429, "TOO_FAST"), "rate-limit");
  assert.equal(
    classifyUpcHttpFailure(429, "HTTP_TOO_MANY_REQUESTS"),
    "rate-limit",
  );
  assert.equal(classifyUpcHttpFailure(503, "SERVER_ERR"), "provider");
});

test("Coverly accepts usable products and identifies locally rejected items", () => {
  const found = parseUpcSuccessPayload({
    code: "OK",
    total: 1,
    items: [
      { ean: "09400547002634", title: "Household product", brand: "Example" },
    ],
  });
  assert.equal(found.kind, "found");
  if (found.kind === "found") {
    assert.equal(found.product.title, "Household product");
    assert.equal(found.resultCount, 1);
  }

  const rejected = parseUpcSuccessPayload({
    code: "OK",
    total: 1,
    items: [{ ean: "09400547002634" }],
  });
  assert.equal(rejected.kind, "rejected");
});
