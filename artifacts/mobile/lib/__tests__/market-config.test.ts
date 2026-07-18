import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

import { COUNTRY_CURRENCY_PAIRS as backendPairs, resolveMarketConfig as resolveBackend } from "../../../../supabase/functions/_shared/market-config.ts";
import { COUNTRY_NAME_BY_CODE } from "../../constants/country-names.ts";
import { COUNTRY_CURRENCY_PAIRS, COUNTRY_OPTIONS, filterCountryOptions, MARKET_CONFIGS, resolveMarketConfig } from "../../constants/market-config.ts";

type ComparableMarket = Omit<(typeof MARKET_CONFIGS)[number], "countryName">;
const root = new URL("../../../../", import.meta.url);
const migration = readFileSync(new URL("supabase/migrations/20260717_global_market_foundation.sql", root), "utf8");
const countrySelectSource = readFileSync(new URL("artifacts/mobile/components/CountrySelect.tsx", root), "utf8");

function comparable(market: (typeof MARKET_CONFIGS)[number]): ComparableMarket {
  const { countryName: _countryName, ...fields } = market;
  return fields;
}

function parseSqlMarketSeed(): Map<string, ComparableMarket> {
  const pairSeed = migration.match(/string_to_array\(\s*'([^']+)'\s*,\s*','/s)?.[1];
  assert.ok(pairSeed, "SQL country/currency seed was not found");
  const pairs = pairSeed.split(",").map((entry) => entry.split(":"));
  assert.equal(pairs.length, 249);
  assert.equal(new Set(pairs.map(([countryCode]) => countryCode)).size, pairs.length, "duplicate SQL country code");

  const markets = new Map<string, ComparableMarket>();
  for (const [countryCode, currencyCode] of pairs) {
    assert.match(countryCode, /^[A-Z]{2}$/);
    assert.match(currencyCode, /^[A-Z]{3}$/);
    markets.set(countryCode, {
      countryCode, currencyCode, locale: `en-${countryCode}`, searchLanguage: "en",
      serperGl: countryCode.toLowerCase(), serperHl: "en", pricingSupportTier: "limited",
      aiEstimatesEnabled: false, replacementSearchEnabled: true, materialItemThreshold: null,
    });
  }

  const previewBlock = migration.match(/pricing_support_tier = 'preview'[\s\S]*?ARRAY\[([^\]]+)\]/)?.[1];
  assert.ok(previewBlock, "SQL preview-market update was not found");
  const previewCodes = [...previewBlock.matchAll(/'([A-Z]{2})'/g)].map((match) => match[1]);
  assert.equal(new Set(previewCodes).size, previewCodes.length, "duplicate SQL preview code");
  for (const countryCode of previewCodes) {
    const market = markets.get(countryCode);
    assert.ok(market, `unknown SQL preview country ${countryCode}`);
    Object.assign(market, {
      serperGl: countryCode.toLowerCase(), pricingSupportTier: "preview",
      aiEstimatesEnabled: true, replacementSearchEnabled: true,
    });
  }

  const localeBlock = migration.match(/UPDATE public\.pricing_markets SET locale = v\.locale[\s\S]*?FROM \(VALUES([\s\S]*?)\) AS v\(country_code, locale, lang\)/)?.[1];
  assert.ok(localeBlock, "SQL locale update was not found");
  const localeRows = [...localeBlock.matchAll(/\('([A-Z]{2})','([^']+)','([^']+)'\)/g)];
  assert.equal(new Set(localeRows.map((match) => match[1])).size, localeRows.length, "duplicate SQL locale country");
  for (const match of localeRows) {
    const market = markets.get(match[1]);
    assert.ok(market, `unknown SQL locale country ${match[1]}`);
    market.locale = match[2];
    market.searchLanguage = match[3];
    market.serperHl = match[3];
  }

  const verifiedBlock = migration.match(/pricing_support_tier = 'verified'[\s\S]*?FROM \(VALUES([\s\S]*?)\) AS v\(country_code, locale, threshold\)/)?.[1];
  assert.ok(verifiedBlock, "SQL verified-market update was not found");
  const verifiedRows = [...verifiedBlock.matchAll(/\('([A-Z]{2})','([^']+)',(\d+)::numeric\)/g)];
  assert.equal(new Set(verifiedRows.map((match) => match[1])).size, verifiedRows.length, "duplicate SQL verified country");
  for (const match of verifiedRows) {
    const market = markets.get(match[1]);
    assert.ok(market, `unknown SQL verified country ${match[1]}`);
    Object.assign(market, {
      locale: match[2], searchLanguage: "en", serperGl: match[1].toLowerCase(), serperHl: "en",
      pricingSupportTier: "verified", aiEstimatesEnabled: true, replacementSearchEnabled: true,
      materialItemThreshold: Number(match[3]),
    });
  }
  return markets;
}

test("mobile and backend country/currency datasets remain identical", () => {
  assert.deepEqual(COUNTRY_CURRENCY_PAIRS, backendPairs);
  assert.equal(COUNTRY_CURRENCY_PAIRS.length, 249);
});

test("all 249 SQL, mobile, and Edge market records match on every business field", () => {
  const sqlMarkets = parseSqlMarketSeed();
  assert.equal(sqlMarkets.size, MARKET_CONFIGS.length);
  for (const mobileMarket of MARKET_CONFIGS) {
    const edgeMarket = resolveBackend(mobileMarket.countryCode);
    assert.ok(edgeMarket, `missing Edge market ${mobileMarket.countryCode}`);
    assert.deepEqual(comparable(edgeMarket), comparable(mobileMarket), `mobile/Edge mismatch for ${mobileMarket.countryCode}`);
    assert.deepEqual(sqlMarkets.get(mobileMarket.countryCode), comparable(mobileMarket), `SQL/mobile mismatch for ${mobileMarket.countryCode}`);
  }
});

test("all selectable countries have unique uppercase ISO-style codes and currencies", () => {
  assert.equal(new Set(MARKET_CONFIGS.map((market) => market.countryCode)).size, MARKET_CONFIGS.length);
  for (const market of MARKET_CONFIGS) {
    assert.match(market.countryCode, /^[A-Z]{2}$/);
    assert.match(market.currencyCode, /^[A-Z]{3}$/);
    assert.deepEqual(resolveBackend(market.countryCode), market);
  }
});

test("all 249 selectable countries have canonical names sorted alphabetically", () => {
  assert.equal(Object.keys(COUNTRY_NAME_BY_CODE).length, 249);
  assert.equal(COUNTRY_OPTIONS.length, 249);
  assert.equal(resolveMarketConfig("NZ")?.countryName, "New Zealand");
  assert.equal(resolveMarketConfig("NF")?.countryName, "Norfolk Island");
  assert.equal(resolveMarketConfig("NG")?.countryName, "Nigeria");
  for (const option of COUNTRY_OPTIONS) assert.notEqual(option.label, option.code, option.code);
  assert.equal(new Set(COUNTRY_OPTIONS.map((option) => option.label)).size, COUNTRY_OPTIONS.length);
  assert.deepEqual(
    COUNTRY_OPTIONS.map((option) => option.label),
    [...COUNTRY_OPTIONS].map((option) => option.label).sort((left, right) => left.localeCompare(right)),
  );
});

test("country search matches name, country code, and currency code", () => {
  for (const query of ["New Zealand", "Zeal", "NZ", "NZD"]) {
    assert.ok(filterCountryOptions(query).some((option) => option.code === "NZ"), query);
  }
  assert.deepEqual(filterCountryOptions("Nigeria").map((option) => option.code), ["NG"]);
});

test("country selector renders names as primary labels and codes as metadata", () => {
  assert.match(countrySelectSource, />\{market\.countryName\}<\/Text>/);
  assert.match(countrySelectSource, />\{item\.label\}<\/Text>/);
  assert.match(countrySelectSource, /\{item\.code\} · \{item\.currencyCode\}/);
  assert.doesNotMatch(countrySelectSource, /Verified pricing|Manual inventory/);
  assert.doesNotMatch(countrySelectSource, /styles\.name[^\n]+>\{item\.code\}<\/Text>/);
});

test("verified markets use approved currency and Serper localisation", () => {
  for (const [country, currency, locale, gl] of [
    ["NZ", "NZD", "en-NZ", "nz"], ["AU", "AUD", "en-AU", "au"],
    ["US", "USD", "en-US", "us"], ["CA", "CAD", "en-CA", "ca"],
    ["GB", "GBP", "en-GB", "gb"],
  ]) {
    const market = resolveMarketConfig(country)!;
    assert.equal(market.currencyCode, currency);
    assert.equal(market.locale, locale);
    assert.equal(market.serperGl, gl);
    assert.equal(market.pricingSupportTier, "verified");
  }
});

test("preview samples are explicit and limited markets keep AI safeguards while enabling search", () => {
  for (const [country, currency] of [["DE","EUR"],["IE","EUR"],["JP","JPY"],["ZA","ZAR"],["SG","SGD"],["IN","INR"],["BR","BRL"],["SE","SEK"],["CH","CHF"],["KR","KRW"]]) {
    const market = resolveMarketConfig(country)!;
    assert.equal(market.currencyCode, currency);
    assert.equal(market.pricingSupportTier, "preview");
  }
  const limited = resolveMarketConfig("BG")!;
  assert.equal(limited.pricingSupportTier, "limited");
  assert.equal(limited.currencyCode, "BGN");
  assert.equal(limited.locale, "bg-BG");
  assert.equal(limited.searchLanguage, "bg");
  assert.equal(limited.serperHl, "bg");
  assert.equal(limited.aiEstimatesEnabled, false);
  assert.equal(limited.replacementSearchEnabled, true);
  assert.equal(limited.serperGl, "bg");
  for (const market of MARKET_CONFIGS) {
    assert.equal(market.replacementSearchEnabled, true, market.countryCode);
    assert.equal(market.serperGl, market.countryCode.toLowerCase(), market.countryCode);
  }
  assert.equal(resolveMarketConfig("ZZ"), null);
});
