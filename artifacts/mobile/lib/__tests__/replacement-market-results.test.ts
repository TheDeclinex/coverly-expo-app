import assert from "node:assert/strict";
import test from "node:test";

import { resolveMarketConfig } from "../../constants/market-config.ts";
import {
  confirmedPropertyCurrencyStats,
  detectResultCurrency,
  parseProviderPrice,
} from "../../../../supabase/functions/replacement-price-search/market-results.ts";

const priced = (price: number | null, currencyCode: string | null) => ({ price, currencyCode });

test("replacement statistics use confirmed local-currency prices", () => {
  assert.deepEqual(confirmedPropertyCurrencyStats([
    priced(100, "NZD"), priced(200, "NZD"), priced(300, "NZD"),
  ], "NZD"), { low: 100, median: 200, high: 300 });
});

test("provider price parsing accepts one complete positive finite token only", () => {
  assert.equal(parseProviderPrice("NZ$1,250.00"), 1250);
  assert.equal(parseProviderPrice("From $25.50"), 25.5);
  for (const value of ["-$25", "-NZ$25", "12.3.4", "25abc", "1e309", "$0", "", null]) {
    assert.equal(parseProviderPrice(value), null, String(value));
  }
});

test("replacement statistics exclude foreign currencies", () => {
  assert.deepEqual(confirmedPropertyCurrencyStats([
    priced(100, "NZD"), priced(10, "USD"), priced(200, "NZD"),
  ], "NZD"), { low: 100, median: 150, high: 200 });
  assert.equal(confirmedPropertyCurrencyStats([priced(10, "USD"), priced(20, "AUD")], "NZD"), null);
});

test("replacement statistics exclude unknown, invalid, and unpriced results", () => {
  assert.equal(confirmedPropertyCurrencyStats([
    priced(100, null), priced(0, "NZD"), priced(-5, "NZD"), priced(null, "NZD"),
  ], "NZD"), null);
  assert.equal(confirmedPropertyCurrencyStats([], "NZD"), null);
});

test("bare dollar requires retailer-market evidence", () => {
  const nz = resolveMarketConfig("NZ")!;
  assert.equal(detectResultCurrency("$54.99", nz), null);
  assert.equal(detectResultCurrency("$54.99", nz, { retailerLink: "https://shop.example.co.nz/item" }), "NZD");
  assert.equal(detectResultCurrency("US$54.99", nz), "USD");
  assert.equal(detectResultCurrency("USD 54.99", nz), "USD");
  assert.equal(detectResultCurrency("54.99 USD", nz), "USD");
  assert.equal(detectResultCurrency("NZD $54.99", nz), "NZD");
  assert.equal(detectResultCurrency("ALL $54.99", nz), null);
  assert.equal(detectResultCurrency("TRY $54.99", nz), null);
  assert.equal(detectResultCurrency("TRY 54.99", nz), null);
  assert.equal(detectResultCurrency("54.99 TRY", nz), "TRY");
  assert.equal(detectResultCurrency("Now $54.99", nz, { retailerLink: "https://example.com/item" }), null);
});
