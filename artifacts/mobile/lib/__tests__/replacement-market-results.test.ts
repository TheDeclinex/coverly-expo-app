import assert from "node:assert/strict";
import test from "node:test";

import { resolveMarketConfig } from "../../constants/market-config.ts";
import {
  classifyRetailerMarket,
  confirmedPropertyCurrencyStats,
  countryCodeFromRetailerLink,
  countryCodeFromRetailerSource,
  detectResultCurrency,
  KNOWN_RETAILER_COUNTRY_BY_DOMAIN,
  parseProviderPrice,
  providerShoppingResultEvidence,
} from "../../../../supabase/functions/replacement-price-search/market-results.ts";
import { applyAuthoritativeReplacementPriceRange, classifyReplacementRangeCandidate } from "../../../../supabase/functions/replacement-price-search/refinement-results.ts";

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

test("bare local dollar symbols resolve only with matching NZ, AU, US, or CA retailer evidence", () => {
  for (const [countryCode, currencyCode] of [
    ["NZ", "NZD"],
    ["AU", "AUD"],
    ["US", "USD"],
    ["CA", "CAD"],
  ] as const) {
    const market = resolveMarketConfig(countryCode)!;
    assert.equal(detectResultCurrency("$1,299", market), null);
    assert.equal(
      detectResultCurrency("$1,299", market, { retailerCountryCode: countryCode }),
      currencyCode,
    );
    assert.equal(
      detectResultCurrency("$1,299", market, { retailerCountryCode: countryCode === "NZ" ? "AU" : "NZ" }),
      null,
    );
  }
});

test("symbol-free price text does not invent a property currency", () => {
  const nz = resolveMarketConfig("NZ")!;
  assert.equal(detectResultCurrency("1,299", nz, { retailerCountryCode: "NZ" }), null);
  assert.equal(detectResultCurrency("From 1,299", nz, { retailerCountryCode: "NZ" }), null);
});

test("provider metadata and conservative retailer sources supply strong local-market evidence", () => {
  assert.equal(countryCodeFromRetailerSource("Noel Leeming"), "NZ");
  assert.equal(countryCodeFromRetailerSource("Harvey Norman New Zealand"), "NZ");
  assert.equal(countryCodeFromRetailerSource("Unknown Shop"), null);
  assert.deepEqual(providerShoppingResultEvidence({ countryCode: "NZ", currency: "NZD" }), {
    retailerCountryCode: "NZ",
    providerCurrencyCode: "NZD",
  });
  assert.deepEqual(providerShoppingResultEvidence({
    source: "Unknown Shop",
    link: "https://example.com/product?country=AU&currency=AUD",
  }), { retailerCountryCode: "AU", providerCurrencyCode: "AUD" });
});

test("representative NZ provider candidates retain local in-range listings and explain every exclusion", () => {
  const nz = resolveMarketConfig("NZ")!;
  const raw = [
    { id: "local-domain", price: "$900", link: "https://shop.example.co.nz/a", source: "Shop" },
    { id: "local-source", price: "$1,299", link: "https://example.com/b", source: "Noel Leeming" },
    { id: "local-metadata", price: "$2,999", link: "https://example.com/c", source: "Shop", countryCode: "NZ", currencyCode: "NZD" },
    { id: "below", price: "$899", link: "https://shop.example.co.nz/d", source: "Shop" },
    { id: "above", price: "$3,001", link: "https://shop.example.co.nz/e", source: "Shop" },
    { id: "foreign", price: "US$1,100", link: "https://shop.example.co.nz/f", source: "Shop" },
    { id: "unknown", price: "$1,500", link: "https://example.com/g", source: "Unknown Shop" },
    { id: "invalid", price: "Call 0800 123 456", link: "https://shop.example.co.nz/h", source: "Shop" },
    { id: "unpriced", price: "", link: "https://shop.example.co.nz/i", source: "Shop" },
  ];
  const classified = raw.map((candidate) => {
    const evidence = providerShoppingResultEvidence(candidate);
    return {
      id: candidate.id,
      priceRaw: candidate.price,
      price: parseProviderPrice(candidate.price),
      currencyCode: detectResultCurrency(candidate.price, nz, evidence),
    };
  });
  assert.deepEqual(
    applyAuthoritativeReplacementPriceRange(classified, "NZD", 900, 3000, 10).map((result) => result.id),
    ["local-domain", "local-source", "local-metadata"],
  );
  assert.deepEqual(Object.fromEntries(classified.map((result) => [
    result.id,
    classifyReplacementRangeCandidate(result, "NZD", 900, 3000),
  ])), {
    "local-domain": "inside_range",
    "local-source": "inside_range",
    "local-metadata": "inside_range",
    below: "below_range",
    above: "above_range",
    foreign: "foreign_currency",
    unknown: "unknown_currency",
    invalid: "invalid_price",
    unpriced: "unpriced",
  });
  assert.equal(applyAuthoritativeReplacementPriceRange(classified, "NZD", undefined, undefined, 20).length, raw.length);
});

test("known French retailers on generic domains resolve conservatively to France", () => {
  assert.deepEqual(KNOWN_RETAILER_COUNTRY_BY_DOMAIN, {
    "boulanger.com": "FR",
    "cdiscount.com": "FR",
    "cultura.com": "FR",
  });
  for (const domain of Object.keys(KNOWN_RETAILER_COUNTRY_BY_DOMAIN)) {
    assert.equal(countryCodeFromRetailerLink(`https://${domain}/item`), "FR", domain);
    assert.equal(countryCodeFromRetailerLink(`https://www.${domain}/item`), "FR", `www.${domain}`);
  }
});

test("generic domains are not local without an exact known-domain or subdomain match", () => {
  assert.equal(countryCodeFromRetailerLink("https://example.com/item"), null);
  assert.equal(countryCodeFromRetailerLink("https://notboulanger.com/item"), null);
  assert.equal(countryCodeFromRetailerLink("https://boulanger.com.evil.example/item"), null);
  assert.equal(countryCodeFromRetailerLink("https://shop.example.fr/item"), "FR");
});

test("known generic-domain retailers are local only in their mapped market", () => {
  const france = resolveMarketConfig("FR")!;
  const belgium = resolveMarketConfig("BE")!;

  assert.deepEqual(
    classifyRetailerMarket("https://www.boulanger.com/item", "EUR", france),
    { retailerCountryCode: "FR", fulfilmentType: "local", warnings: [] },
  );

  const missingCurrency = classifyRetailerMarket("https://cdiscount.com/item", null, france);
  assert.equal(missingCurrency.retailerCountryCode, "FR");
  assert.equal(missingCurrency.fulfilmentType, "local");
  assert.match(missingCurrency.warnings[0], /currency could not be confirmed/i);

  const otherEuroMarket = classifyRetailerMarket("https://cultura.com/item", "EUR", belgium);
  assert.equal(otherEuroMarket.retailerCountryCode, "FR");
  assert.equal(otherEuroMarket.fulfilmentType, "overseas");
  assert.match(otherEuroMarket.warnings[0], /FR.*BE/);

  const arbitraryDotCom = classifyRetailerMarket("https://example.com/item", "EUR", france);
  assert.equal(arbitraryDotCom.retailerCountryCode, null);
  assert.equal(arbitraryDotCom.fulfilmentType, "unknown");

  const conflictingCurrency = classifyRetailerMarket("https://boulanger.com/item", "USD", france);
  assert.equal(conflictingCurrency.retailerCountryCode, "FR");
  assert.equal(conflictingCurrency.fulfilmentType, "overseas");
  assert.match(conflictingCurrency.warnings[0], /USD.*EUR/);
});
