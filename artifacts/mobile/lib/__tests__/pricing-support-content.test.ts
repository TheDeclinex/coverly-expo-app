import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

import { MARKET_CONFIGS, resolveMarketConfig } from "../../constants/market-config.ts";
import { getPricingSupportContent } from "../../constants/pricing-support-content.ts";

const root = new URL("../../../../", import.meta.url);
const countrySelectSource = readFileSync(new URL("artifacts/mobile/components/CountrySelect.tsx", root), "utf8");

test("pricing support tiers use the approved user-facing labels", () => {
  assert.equal(getPricingSupportContent("verified").label, "Full pricing support");
  assert.equal(getPricingSupportContent("preview").label, "Pricing preview");
  assert.equal(getPricingSupportContent("limited").label, "Manual pricing");
});

test("pricing support tiers use the approved short descriptions", () => {
  assert.equal(
    getPricingSupportContent("verified").shortDescription,
    "AI estimates and local retailer searches are available and tested for this market.",
  );
  assert.equal(
    getPricingSupportContent("preview").shortDescription,
    "AI estimates and local retailer searches are available but still undergoing market validation.",
  );
  assert.equal(
    getPricingSupportContent("limited").shortDescription,
    "AI item recognition and best-effort local retailer search are available; replacement values can still be entered manually.",
  );
});

test("market classifications and AI feature flags remain unchanged while retailer search is global", () => {
  assert.deepEqual(
    MARKET_CONFIGS.filter((market) => market.pricingSupportTier === "verified").map((market) => market.countryCode).sort(),
    ["AU", "CA", "GB", "NZ", "US"],
  );
  assert.deepEqual(
    MARKET_CONFIGS.filter((market) => market.pricingSupportTier === "preview").map((market) => market.countryCode).sort(),
    ["AT", "BE", "BR", "CH", "DE", "DK", "ES", "FI", "FR", "IE", "IN", "IT", "JP", "KR", "MX", "NL", "NO", "PT", "SE", "SG", "ZA"],
  );

  for (const countryCode of ["NZ", "DE"]) {
    const market = resolveMarketConfig(countryCode)!;
    assert.equal(market.aiEstimatesEnabled, true);
    assert.equal(market.replacementSearchEnabled, true);
  }
  const limited = resolveMarketConfig("AQ")!;
  assert.equal(limited.aiEstimatesEnabled, false);
  assert.equal(limited.replacementSearchEnabled, true);
  assert.ok(MARKET_CONFIGS.every((market) => market.replacementSearchEnabled));
  assert.ok(MARKET_CONFIGS.filter((market) => market.pricingSupportTier === "limited").every((market) => !market.aiEstimatesEnabled));
});

test("country selector uses shared support content and removes misleading labels", () => {
  assert.match(countrySelectSource, /getPricingSupportContent/);
  assert.match(countrySelectSource, /selectedSupport\.shortDescription/);
  assert.match(countrySelectSource, /Explain country pricing support levels/);
  assert.doesNotMatch(countrySelectSource, /Verified pricing/);
  assert.doesNotMatch(countrySelectSource, /Manual inventory/);
});
