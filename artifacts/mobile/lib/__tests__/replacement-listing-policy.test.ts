import assert from "node:assert/strict";
import test from "node:test";

import {
  formatReplacementListingPrice,
  resolveReplacementListingCurrency,
} from "../replacement-listing-policy.ts";
import type { ReplacementPriceResult } from "../replacement-pricing.ts";

function listing(overrides: Partial<ReplacementPriceResult> = {}): ReplacementPriceResult {
  return {
    title: "Chair",
    source: "NZ retailer",
    price: 169,
    priceRaw: "$169.00",
    link: "https://retailer.example/item",
    position: 1,
    matchType: "best_match",
    currencyCode: null,
    retailerCountryCode: null,
    fulfilmentType: "unknown",
    warnings: ["Retailer location could not be confirmed."],
    ...overrides,
  };
}

test("search currency is the trusted default when listing metadata is missing", () => {
  const decision = resolveReplacementListingCurrency(listing(), "NZD");
  assert.deepEqual(decision, {
    canUse: true,
    currencyCode: "NZD",
    requiresForeignCurrencyConfirmation: false,
    source: "search_context",
    warning: null,
  });
});

test("an explicitly matching listing currency remains selectable", () => {
  const decision = resolveReplacementListingCurrency(listing({ currencyCode: "NZD", warnings: [] }), "NZD");
  assert.equal(decision.canUse, true);
  assert.equal(decision.currencyCode, "NZD");
  assert.equal(decision.requiresForeignCurrencyConfirmation, false);
  assert.equal(decision.warning, null);
});

test("an explicitly foreign listing retains its warning and confirmation protection", () => {
  const decision = resolveReplacementListingCurrency(listing({
    currencyCode: "USD",
    fulfilmentType: "overseas",
    warnings: ["Listed in USD, not NZD. No conversion is applied."],
  }), "NZD");
  assert.equal(decision.canUse, true);
  assert.equal(decision.currencyCode, "USD");
  assert.equal(decision.requiresForeignCurrencyConfirmation, true);
  assert.match(decision.warning ?? "", /USD.*NZD/);
});

test("retailer location uncertainty alone does not block selection", () => {
  const decision = resolveReplacementListingCurrency(listing({
    retailerCountryCode: null,
    fulfilmentType: "unknown",
    warnings: ["Retailer location could not be confirmed."],
  }), "NZD");
  assert.equal(decision.canUse, true);
  assert.equal(decision.warning, null);
});

test("an explicitly ambiguous response remains blocked", () => {
  const decision = resolveReplacementListingCurrency(listing({
    warnings: ["Currency evidence is ambiguous."],
  }), "NZD");
  assert.equal(decision.canUse, false);
  assert.equal(decision.currencyCode, null);
  assert.match(decision.warning ?? "", /ambiguous/i);
});

test("replacement listing prices retain listing precision in market context", () => {
  assert.equal(formatReplacementListingPrice(listing({ price: 169, priceRaw: "$169.00" }), "NZD"), "$169");
  assert.equal(formatReplacementListingPrice(listing({ price: 489.99, priceRaw: "$489.99" }), "NZD"), "$489.99");
  assert.equal(formatReplacementListingPrice(listing({ price: 1539, priceRaw: "$1,539.00" }), "NZD"), "$1,539");
});
