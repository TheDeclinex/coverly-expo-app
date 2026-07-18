import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

import { calcPortfolioStats, calcPropertyStats } from "../dashboard-stats.ts";
import { buildItemInsertPayload, buildItemUpdatePayload } from "../item-insert-helpers.ts";
import { getItemTotalValue, getItemUnitPrice } from "../inventory-mappers.ts";

const root = new URL("../../../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

test("new and updated item values maintain unit × quantity totals and metadata", () => {
  const inserted = buildItemInsertPayload({ fileId: "file", roomId: "room", name: "Chair", quantity: 3, unitEstimatedPrice: 500, estimatedCurrency: "AUD", valuationMarket: "AU" });
  assert.equal(inserted.unit_estimated_price, 500);
  assert.equal(inserted.estimated_price, 1500);
  assert.equal(inserted.estimated_currency, "AUD");
  assert.equal(inserted.valuation_market, "AU");
  assert.ok(inserted.estimated_at);

  const updated = buildItemUpdatePayload({ roomId: "room", name: "Chair", quantity: 4, unitEstimatedPrice: 500, estimatedCurrency: "AUD", valuationMarket: "AU", estimatedAt: "2026-07-17T00:00:00Z" });
  assert.equal(updated.estimated_price, 2000);
  assert.equal(updated.unit_estimated_price, 500);
});

test("missing, zero, negative, or invalid replacement prices remain null", () => {
  for (const value of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const item = buildItemInsertPayload({ fileId: "file", roomId: "room", name: "Unknown item", quantity: 2, unitEstimatedPrice: value });
    assert.equal(item.unit_estimated_price, null);
    assert.equal(item.estimated_price, null);
    assert.equal(getItemTotalValue(item), 0);
  }
  assert.equal(getItemTotalValue({ unit_estimated_price: 0, estimated_price: 0, quantity: 4 } as any), 0);
  assert.equal(getItemTotalValue({ unit_estimated_price: -5, estimated_price: -20, quantity: 4 } as any), 0);
});

test("legacy value normalization is complete and idempotent", () => {
  type Row = { unit: number | null; estimated: number | null; quantity: number | null };
  const normalize = (row: Row): Row => row.unit == null && row.estimated != null
    ? { ...row, unit: row.estimated, estimated: row.estimated * Math.max(row.quantity ?? 1, 1) }
    : { ...row };
  const quantityTwo = normalize({ unit: null, estimated: 54.99, quantity: 2 });
  assert.deepEqual(quantityTwo, { unit: 54.99, estimated: 109.98, quantity: 2 });
  assert.deepEqual(normalize({ unit: null, estimated: 54.99, quantity: 1 }), { unit: 54.99, estimated: 54.99, quantity: 1 });
  assert.deepEqual(normalize({ unit: 25, estimated: 50, quantity: 2 }), { unit: 25, estimated: 50, quantity: 2 });
  assert.deepEqual(normalize({ unit: null, estimated: null, quantity: 2 }), { unit: null, estimated: null, quantity: 2 });
  assert.deepEqual(normalize(quantityTwo), quantityTwo);
});

test("legacy per-unit values and replacement query compatibility are explicit", () => {
  const legacy = { quantity: 3, estimated_price: 1500, unit_estimated_price: null } as any;
  assert.equal(getItemTotalValue(legacy), 4500);
  assert.equal(getItemUnitPrice(legacy), 1500);
  const mobileSearch = source("artifacts/mobile/lib/replacement-pricing.ts");
  assert.match(mobileSearch, /return composeReplacementSearchTerm\(/);
  assert.doesNotMatch(mobileSearch, /join\(" "\).*NZ/);
});

test("property and portfolio totals do not combine currencies", () => {
  const nz = { id: "nz", currency_code: "NZD", contents_sum_insured: 10000 } as any;
  const au = { id: "au", currency_code: "AUD", contents_sum_insured: 12000 } as any;
  const items = [
    { file_id: "nz", estimated_currency: "NZD", unit_estimated_price: 100, estimated_price: 100, quantity: 1 } as any,
    { file_id: "nz", estimated_currency: "USD", unit_estimated_price: 50, estimated_price: 50, quantity: 1 } as any,
    { file_id: "au", estimated_currency: "AUD", unit_estimated_price: 200, estimated_price: 200, quantity: 1 } as any,
  ];
  const property = calcPropertyStats(nz, [], items.slice(0, 2));
  assert.equal(property.totalValue, 100);
  assert.deepEqual(property.totalsByCurrency, { NZD: 100, USD: 50 });
  const portfolio = calcPortfolioStats([nz, au], items);
  assert.equal(portfolio.hasMultipleCurrencies, true);
  assert.equal(portfolio.totalInventoryValue, 0);
  assert.deepEqual(portfolio.inventoryTotalsByCurrency, { NZD: 100, USD: 50, AUD: 200 });
});

test("forward migration contains all markets, backfills, server derivation, and preserved limits", () => {
  const migration = source("supabase/migrations/20260717_global_market_foundation.sql");
  assert.match(migration, /AD:EUR[\s\S]*ZW:USD/);
  assert.match(migration, /SET country_code = 'NZ', currency_code = 'NZD'/);
  assert.match(migration, /unit_estimated_price = estimated_price,[\s\S]*estimated_price \*[\s\S]*GREATEST\(COALESCE\(quantity, 1\), 1\)/);
  assert.ok(migration.indexOf("unit_estimated_price = estimated_price") < migration.indexOf("estimated_currency = COALESCE"));
  assert.match(migration, /WHERE unit_estimated_price IS NULL\s+AND estimated_price IS NOT NULL/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/i);
  assert.match(migration, /FROM public\.pricing_markets[\s\S]*upper\(btrim\(p_country_code\)\)/);
  assert.match(migration, /coverly_property_allowance_for_user/);
  assert.match(migration, /estimated_at timestamptz/);
  assert.match(migration, /locale = v\.locale/);
  assert.doesNotMatch(migration, /locale = values\.locale/);
  assert.doesNotMatch(migration, /inventory_item_valuations|current_valuation_id/);

  const searchMigration = source("supabase/migrations/20260718_enable_global_replacement_search.sql");
  assert.match(searchMigration, /replacement_search_enabled = true/);
  assert.match(searchMigration, /serper_gl = lower\(country_code\)/);
  assert.match(searchMigration, /WHERE country_code = 'BG'/);
  assert.match(searchMigration, /search_language = 'bg'/);
  assert.doesNotMatch(searchMigration, /ai_estimates_enabled/);
});

test("manual deployment guide includes preflight, RPC, and rollout checks", () => {
  const guide = source("docs/global-market-foundation.md");
  for (const dependency of [
    "create_my_property(text,text,numeric,text,text,text)",
    "coverly_property_allowance_for_user(uuid)",
    "raise_property_limit_reached(integer,integer)",
    "assert_current_user_admin()",
    "inventory_items",
    "claim_packs",
  ]) assert.match(guide, new RegExp(dependency.replace(/[()]/g, "\\$&")));
  assert.match(guide, /create_my_property\(text,text,text,numeric,text,text,text\)/);
  assert.match(guide, /notify pgrst, 'reload schema';/i);
  assert.match(guide, /Do not use `supabase db push`/);
});

test("pricing Edge Functions use authoritative property markets and preserve the scan model", () => {
  const scan = source("supabase/functions/scan-room-photo/index.ts");
  const model = source("supabase/functions/scan-room-photo/scan-model.ts");
  const search = source("supabase/functions/replacement-price-search/index.ts");
  assert.match(scan, /from\('inventory_files'\).*country_code,currency_code/);
  assert.match(scan, /unitEstimatedPrice = null/);
  assert.doesNotMatch(scan, /unitEstimatedPrice = 1/);
  assert.match(model, /gpt-5\.6-luna/);
  assert.match(search, /from\('inventory_items'\).*id,file_id/);
  assert.match(search, /gl: market\.serperGl, hl: market\.serperHl/);
  assert.match(search, /from\('inventory_files'\).*country_code,currency_code/);
  assert.match(search, /requestedCountryCode[\s\S]*property\.country_code/);
  const screen = source("artifacts/mobile/app/(tabs)/replacement-pricing/[id].tsx");
  assert.match(screen, /countryCode: propertyMarket\?\.country_code/);
  assert.match(screen, /currencyCode: propertyMarket\?\.currency_code/);
  assert.doesNotMatch(search, /pricingSupportTier\s*[!=]==?\s*['"]limited['"]/);
  assert.doesNotMatch(search, /gl: 'nz', hl: 'en'/);
  assert.match(search, /priceRaw/);
  assert.match(search, /fulfilmentType/);
});

test("replacement search entry points and refined searches are not support-tier gated", () => {
  const screen = source("artifacts/mobile/app/(tabs)/replacement-pricing/[id].tsx");
  const item = source("artifacts/mobile/app/(tabs)/item/[id].tsx");
  const room = source("artifacts/mobile/app/(tabs)/room/[id].tsx");
  const claim = source("artifacts/mobile/app/(tabs)/claim-pack/[fileId].tsx");

  assert.match(screen, /const runSearch = React\.useCallback/);
  assert.match(screen, /const handleSearch = \(\) => \{\s*void runSearch\(searchQuery\)/);
  assert.match(screen, /void runSearch\(suggestedQuery\)/);
  assert.doesNotMatch(screen, /replacementSearchEnabled/);
  assert.match(item, /onReviewReplacementPrice=\{handleReplacementPricing\}/);
  assert.match(room, />Find replacement price<\/Text>/);
  assert.match(claim, /onRunPriceSearch=\{openPriceSearch\}/);
});

test("new claim packs preserve currency metadata and mixed-currency subtotals", () => {
  const claims = source("supabase/functions/generate-claim-pack/index.ts");
  const builder = source("artifacts/mobile/app/(tabs)/claim-pack/[fileId].tsx");
  const history = source("artifacts/mobile/app/(tabs)/claim-packs.tsx");
  assert.match(claims, /country_code: property\.country_code/);
  assert.match(claims, /summary_currency: property\.currency_code/);
  assert.match(claims, /estimated_currency: item\.estimated_currency \?\? propertyCurrency/);
  assert.match(claims, /totalsByCurrency/);
  assert.match(claims, /No exchange-rate conversion has been applied/);
  assert.match(builder, /summaryCurrencyCode: property\?\.currency_code/);
  assert.doesNotMatch(builder, /item\.estimated_currency \?\? "NZD"/);
  assert.match(history, /pack\.summary_currency \?\? pack\.currency_code \?\? "NZD"/);
});
