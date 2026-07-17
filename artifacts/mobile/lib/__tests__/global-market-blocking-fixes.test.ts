import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

test("all manual replacement editors use the strict shared parser", () => {
  for (const path of [
    "artifacts/mobile/app/(tabs)/add-item.tsx",
    "artifacts/mobile/components/ItemMaintenanceForm.tsx",
    "artifacts/mobile/app/(tabs)/room/[id].tsx",
    "artifacts/mobile/app/(tabs)/scan.tsx",
  ]) assert.match(source(path), /parseReplacementPriceInput|buildManualScanValuePatch/, path);
});

test("stored and reviewed currencies are wired through add, maintenance, and quick edit", () => {
  const add = source("artifacts/mobile/app/(tabs)/add-item.tsx");
  const maintenance = source("artifacts/mobile/components/ItemMaintenanceForm.tsx");
  const room = source("artifacts/mobile/app/(tabs)/room/[id].tsx");
  assert.ok(add.includes('label={`Each price (${replacementCurrencyToken})`}'));
  assert.match(add, /estimatedCurrency: replacementCurrency/);
  assert.match(maintenance, /resolveReviewedValueCurrency\(voiceEstimatedCurrency, item\.estimated_currency/);
  assert.ok(maintenance.includes('Original purchase price (${purchaseCurrencyToken})'));
  assert.match(room, /supportedCurrencyCode\(patch\.estimated_currency\)/);
  assert.match(room, /estimated_currency: normalizedUnitPrice == null \? null : draftCurrency/);
  assert.doesNotMatch(room, /Math\.round\((?:nextUnitPrice|replacementPrice) \* 100\) \/ 100/);
});

test("manual scan values and attention displays carry property market context", () => {
  const scan = source("artifacts/mobile/app/(tabs)/scan.tsx");
  const attention = source("artifacts/mobile/app/(tabs)/items-needing-attention.tsx");
  assert.match(scan, /select\("id, name, country_code, currency_code"\)/);
  assert.match(scan, /buildManualScanValuePatch/);
  assert.match(attention, /resolveStoredValueCurrency\(item\.estimated_currency, propertyCurrency\)/);
});

test("single-property cover and claim-builder values keep property currency context", () => {
  const addProperty = source("artifacts/mobile/app/(tabs)/add-property.tsx");
  const claimBuilder = source("artifacts/mobile/app/(tabs)/claim-pack/[fileId].tsx");
  assert.match(addProperty, /formatPropertyMoney\(parsedCoverAmount, market\.countryCode, market\.currencyCode, \{ precision: "summary" \}\)/);
  assert.match(claimBuilder, /formatCurrencyTotals\(selectedTotals, \{ contextCurrency: currencyCode \}\)/);
  assert.match(claimBuilder, /resolveClaimItemCurrency\(item\.estimated_currency, currencyCode\), \{ contextCurrency: currencyCode, precision: "value" \}/);
  assert.doesNotMatch(claimBuilder, /resolveClaimItemCurrency\(item\.estimated_currency, currencyCode\), \{ mode: "explicit" \}/);
});

test("screen money displays use semantic summary, value, and listing formatters", () => {
  const home = source("artifacts/mobile/app/(tabs)/index.tsx");
  const property = source("artifacts/mobile/app/(tabs)/property/[id].tsx");
  const room = source("artifacts/mobile/app/(tabs)/room/[id].tsx");
  const scan = source("artifacts/mobile/app/(tabs)/scan.tsx");
  const listings = source("artifacts/mobile/components/ReplacementListingCard.tsx");
  const history = source("artifacts/mobile/app/(tabs)/claim-packs.tsx");

  assert.match(home, /formatCurrency\(inventoryValue/);
  assert.match(home, /formatCurrencyFull\(value, item\.estimated_currency/);
  assert.match(property, /formatCurrencyFull\(item\.value/);
  assert.match(room, /formatCurrencyTotals\(roomSummary\.totalsByCurrency/);
  assert.match(room, /formatCurrency\(category\.value, resolvedPropertyCurrency\)/);
  assert.match(scan, /formatCurrencyFull\(\(item\.unitEstimatedPrice/);
  assert.match(listings, /precision: "listing"/);
  assert.match(history, /formal: true, precision: "summary"/);
});

test("Edge price paths use strict finite helpers and preserve metering code", () => {
  const scan = source("supabase/functions/scan-room-photo/index.ts");
  const search = source("supabase/functions/replacement-price-search/index.ts");
  assert.match(scan, /finitePositiveScanEstimate/);
  assert.doesNotMatch(scan, /\bisNaN\(/);
  assert.match(search, /parseProviderPrice\(r\.price\)/);
  assert.match(search, /reserveUsage/);
  assert.match(search, /commitUsage/);
  assert.match(search, /refundUsage/);
});
