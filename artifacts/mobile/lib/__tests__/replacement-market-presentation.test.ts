import assert from "node:assert/strict";
import test from "node:test";

import { replacementMarketPresentation } from "../replacement-market-presentation.ts";

test("uses the requested NZ listing and retailer wording", () => {
  const copy = replacementMarketPresentation({ countryCode: "NZ", countryName: "New Zealand", currencyCode: "NZD" });
  assert.equal(copy.introLead, "Find comparable NZ listings.");
  assert.equal(copy.loadingSubtitle, "Checking current NZ listings for similar items...");
  assert.equal(copy.resultContext, "Searching New Zealand retailers · NZD");
});

test("uses Australian wording throughout an AU search", () => {
  const copy = replacementMarketPresentation({ countryCode: "AU", countryName: "Australia", currencyCode: "AUD" });
  assert.equal(copy.introLead, "Find comparable Australian listings.");
  assert.equal(copy.loadingSubtitle, "Checking current Australian listings for similar items...");
  assert.equal(copy.resultContext, "Searching Australian retailers · AUD");
  assert.doesNotMatch(Object.values(copy).join(" "), /\bNZ\b|New Zealand/);
});

test("keeps known currency but uses safe generic copy without country context", () => {
  const copy = replacementMarketPresentation({ currencyCode: "AUD" });
  assert.equal(copy.introLead, "Find comparable listings.");
  assert.equal(copy.loadingSubtitle, "Checking current listings for similar items...");
  assert.equal(copy.resultContext, "Searching retailers · AUD");
  assert.doesNotMatch(Object.values(copy).join(" "), /\bNZ\b|New Zealand/);
});

test("does not use a country's wording when legacy currency context conflicts", () => {
  const copy = replacementMarketPresentation({ countryCode: "NZ", currencyCode: "AUD" });
  assert.equal(copy.introLead, "Find comparable listings.");
  assert.equal(copy.resultContext, "Searching retailers · AUD");
  assert.equal(copy.countryCode, null);
});

test("uses canonical country copy for a best-effort Bulgarian search", () => {
  const copy = replacementMarketPresentation({ countryCode: "BG", currencyCode: "BGN" });
  assert.equal(copy.countryName, "Bulgaria");
  assert.equal(copy.introLead, "Find comparable listings in Bulgaria.");
  assert.equal(copy.loadingSubtitle, "Checking current listings in Bulgaria for similar items...");
  assert.equal(copy.resultContext, "Searching retailers in Bulgaria · BGN");
  assert.equal(copy.searchAccessibilityLabel, "Search replacement listings in Bulgaria");
});

test("all enabled replacement markets have centralized attributive wording", () => {
  for (const countryCode of [
    "AT", "AU", "BE", "BR", "CA", "CH", "DE", "DK", "ES", "FI", "FR", "GB", "IE",
    "IN", "IT", "JP", "KR", "MX", "NL", "NO", "NZ", "PT", "SE", "SG", "US", "ZA",
  ]) {
    const copy = replacementMarketPresentation({ countryCode });
    assert.ok(copy.listingAdjective, countryCode);
    assert.notEqual(copy.retailerLabel, "retailers", countryCode);
  }
});
