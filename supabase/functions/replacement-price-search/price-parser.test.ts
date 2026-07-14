import assert from "node:assert/strict";
import test from "node:test";

import { parseListingPriceText, resolveProviderPrice } from "./price-parser.ts";

test("parses current NZ prices from product text", () => {
  for (const [text, expected] of [
    ["Our Price $329", 329],
    ["NOW $26.96", 26.96],
    ["Sale price NZ$1,299.95", 1299.95],
    ["Black Monitor Stand - Black $19", 19],
  ] as const) {
    assert.equal(parseListingPriceText(text)?.value, expected);
  }
});

test("does not treat savings or category starting prices as exact product prices", () => {
  assert.equal(parseListingPriceText("SAVE $800"), null);
  assert.equal(parseListingPriceText("Starting from $4,544.00"), null);
  assert.equal(parseListingPriceText("Base model from $1,899.80"), null);
  assert.equal(parseListingPriceText("Or $12.50 per week"), null);
  assert.equal(parseListingPriceText("4 payments of $25.00"), null);
  assert.equal(
    parseListingPriceText("RRP $499. NOW $329. SAVE $170")?.value,
    329,
  );
});

test("structured text rejects finance and non-current reference prices", () => {
  assert.equal(resolveProviderPrice({ price: "RRP $499" }, "RRP $499"), null);
  assert.equal(
    resolveProviderPrice({ price: "$12.50 per week" }, "$12.50 per week"),
    null,
  );
  assert.deepEqual(
    resolveProviderPrice(
      { price: "RRP $499. NOW $329. SAVE $170" },
      "RRP $499. NOW $329. SAVE $170",
    ),
    {
      value: 329,
      raw: "RRP $499. NOW $329. SAVE $170",
      source: "structured",
    },
  );
});

test("structured provider price wins and survives normalization", () => {
  assert.deepEqual(
    resolveProviderPrice(
      { extractedPrice: 1449.5, price: "$1,699" },
      "Starting from $999",
    ),
    { value: 1449.5, raw: "1449.5", source: "structured" },
  );
  assert.deepEqual(
    resolveProviderPrice({ salePrice: "NZ$1,299.00" }, "SAVE $800"),
    { value: 1299, raw: "NZ$1,299.00", source: "structured" },
  );
});
