import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReplacementPrice,
  parseReplacementPriceInput,
  buildManualScanValuePatch,
  resolveReviewedValueCurrency,
  resolveStoredValueCurrency,
  resolveValueMarket,
  supportedCurrencyCode,
} from "../replacement-value.ts";

test("strict replacement-price parsing accepts only a complete positive finite value", () => {
  for (const [input, expected] of [
    ["25", 25], ["25.50", 25.5], ["$25.50", 25.5], ["1,250.00", 1250], ["€ 1,250.00", 1250],
  ] as const) assert.equal(parseReplacementPrice(input), expected, input);

  for (const input of ["-25", "12.3.4", "25abc", "Infinity", "NaN", "", "   ", "0", "$0", "1e309", "1,25.00"]) {
    assert.equal(parseReplacementPrice(input), null, input);
  }
  assert.equal(parseReplacementPriceInput("0").status, "zero");
  assert.equal(parseReplacementPriceInput("bad").status, "invalid");
});

test("manual scan pricing applies authoritative property metadata only to a valid value", () => {
  const valued = buildManualScanValuePatch("125.50", 3, { countryCode: "AU", currencyCode: "AUD" }, "2026-07-17T00:00:00.000Z");
  assert.equal(valued.status, "value");
  assert.deepEqual(valued.patch, {
    unitEstimatedPrice: 125.5, estimatedPrice: 376.5, estimatedCurrency: "AUD",
    valuationMarket: "AU", estimatedAt: "2026-07-17T00:00:00.000Z",
    priceSourceType: "user_entered", valuationBasis: "manual",
  });
  for (const input of ["0", "-5", "bad", ""]) {
    const result = buildManualScanValuePatch(input, 2, { countryCode: "AU", currencyCode: "AUD" });
    assert.equal(result.patch.unitEstimatedPrice, null);
    assert.equal(result.patch.estimatedCurrency, null);
    assert.equal(result.patch.valuationMarket, null);
    assert.equal(result.patch.estimatedAt, null);
  }
});

test("currency resolution preserves supported voice and stored currencies", () => {
  assert.equal(supportedCurrencyCode(" usd "), "USD");
  assert.equal(supportedCurrencyCode("ABC"), null);
  assert.equal(resolveStoredValueCurrency("USD", "AUD"), "USD");
  assert.equal(resolveStoredValueCurrency(null, "AUD"), "AUD");
  assert.equal(resolveStoredValueCurrency(null, null), "NZD");
  assert.equal(resolveReviewedValueCurrency("EUR", "USD", "AUD"), "EUR");
  assert.equal(resolveReviewedValueCurrency(null, "USD", "AUD"), "USD");
  assert.equal(resolveValueMarket("USD", "USD", "US", "AUD", "AU"), "US");
  assert.equal(resolveValueMarket("AUD", null, null, "AUD", "AU"), "AU");
  assert.equal(resolveValueMarket("EUR", null, null, "AUD", "AU"), null);
});
