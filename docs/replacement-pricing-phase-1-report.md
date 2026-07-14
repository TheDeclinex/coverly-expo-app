# Replacement pricing Phase 1 recovery report

Status: implemented locally and verified. Not deployed.

## Outcome

Phase 1 replaces Shopping-gated fallback with controlled hybrid retrieval while
preserving the existing request, response, pricing and usage contracts.

- Broad searches request Shopping and Organic concurrently.
- Model-confirmed searches request Shopping first and skip Organic only after
  two priced exact offers from at least two retailers.
- Candidates are normalized, merged, hard-excluded, deduplicated and ranked in
  one final path.
- Strict price bounds run before final top-N selection.
- Credible unpriced products remain eligible but do not contribute to price
  statistics.
- No result padding or out-of-range backfill is performed.

## Provider orchestration

### Broad search

```text
One usage reservation
        |
        +-- Shopping request --+
        |                      +-- normalize --+
        +-- Organic request ---+               |
                                               +-- merge
                                                   -> hard exclusions
                                                   -> deduplicate
                                                   -> rank
                                                   -> price constraints
                                                   -> top-N
                                                   -> one commit or refund
```

The Shopping and Organic requests run through `Promise.all`. One provider may
fail without discarding valid candidates returned by the other. A provider
failure is terminal only when no requested provider supplies usable candidate
data.

### Confirmed model

Shopping is evaluated first. Organic is skipped only when the accepted Shopping
set contains:

- at least two priced `best_match` offers; and
- at least two distinct retailer identities.

One exact offer or two offers from the same retailer are not adequate coverage.

## Ranking and hard exclusions

Hard exclusions are limited to:

- videos;
- articles and buying guides;
- support pages;
- trade-in pages;
- Organic retailer homepages;
- obvious search, filter, category and collection pages;
- clearly incompatible accessories and product classes.

Eligible same-type products are ranked using exact model, brand, product type,
attributes, title identity, model/specification signals, product-page
specificity, valid price, structured price source, provider, retailer presence,
NZ hostname and preferred retailer.

Brand differences, missing model, missing colour, unfamiliar URL shape and
missing price do not independently disqualify a same-type product.

## Price behavior

- Structured `salePrice`, `currentPrice`, `extractedPrice`, `priceValue`,
  `offerPrice`, offers and price values remain supported.
- Explicit current/sale labels are preferred.
- `SAVE`, RRP, `was`, `starting from`, base-model-from, finance instalments and
  periodic payments are not treated as current listing prices.
- Unpriced products may be returned outside a strict price refinement.
- Unpriced products never affect low/median/high statistics.
- Price bounds are inclusive and applied before final result limiting.
- A strict range excludes unpriced and out-of-range products without backfill.

## Representative regression results

The following are deterministic provider-payload replays. They do not call or
modify production and should not be represented as live Serper measurements.

| Search | Before | Phase 1 final result |
|---|---|---|
| Black curved gaming monitor | 0 | 3 credible monitors |
| Black toaster | 2 weak Shopping results | 4 toaster products |
| Black subwoofer speaker | 2 category/comparison results | 3 actual subwoofers |
| Silver HP laptop 14-inch | 1 product | 1 product; two HP category pages excluded |
| Black monitor riser | 1 product | 1 correct riser; mount category and desk excluded |
| Sony HT-S400 | 1 exact | 1 exact at rank 1; video, trade-in and homepage excluded |
| Samsung QA65S95D | 1 exact | 1 exact at rank 1; wall mount excluded |
| Dyson vacuum cleaner | Product plus accessory/category contamination | 3 vacuum cleaners; filter and categories excluded |
| Microwave | Product plus shelf/category contamination | 3 microwave ovens; shelf, category and guide excluded |
| Dining chair | Product plus table/cover contamination | 3 dining chairs; table, covers and category excluded |
| Breville coffee machine | Product plus grinder/category contamination | 3 Breville machines; grinder and categories excluded |

### Final ranked outputs

#### Black curved gaming monitor

Shopping 0, Organic 4, merged 4, hard rejected 1 category.

1. Samsung Odyssey G5 32-inch Curved Gaming Monitor — unpriced — Close match
2. AOC CQ32G3SE 31.5-inch Curved Gaming Monitor — unpriced — Close match
3. LG UltraGear 34-inch Curved Gaming Display — unpriced — Close match

#### Black toaster

Shopping 2, Organic 4, merged 6, hard rejected 2 category pages.

1. Russell Hobbs Addison 4-Slice Black Toaster — $89.99 — Close match
2. Black toaster — $49 — Close match
3. Breville the Smart Toast 4-Slice Black Toaster — unpriced — Close match
4. Sunbeam Alinea 2-Slice Black Toaster — unpriced — Close match

#### Black subwoofer speaker

Shopping 2, Organic 4, merged 6, hard rejected 3 category/comparison pages.

1. Sony SA-SW5 Wireless Powered Subwoofer — $899 — Similar item
2. Yamaha NS-SW100 Active Subwoofer — unpriced — Similar item
3. Polk Audio HTS 10 Powered Subwoofer — unpriced — Similar item

#### Silver HP laptop 14-inch

Shopping 0, Organic 3, merged 3, hard rejected 2 category/filter pages.

1. HP 14-inch Laptop Intel Core i5 16GB 512GB Silver — $1,299 — Close match

#### Black monitor riser

Shopping 0, Organic 3, merged 3, hard rejected one collection and one desk.

1. Black Monitor Riser Stand — $26.96 — Close match

#### Sony HT-S400

Shopping 1, Organic 3, merged 4, hard rejected video, trade-in and homepage.

1. Sony HT-S400 2.1ch Soundbar with Wireless Subwoofer — $449 — Best match

One exact retailer offer is intentionally insufficient to short-circuit Organic.

#### Samsung QA65S95D

Shopping 2, Organic 0, merged 2, hard rejected one wall-mount accessory.

1. Samsung QA65S95D 65-inch OLED 4K Smart TV — $4,999 — Best match

One exact retailer offer is intentionally insufficient to short-circuit Organic.

#### Dyson vacuum cleaner

Shopping 3, Organic 3, merged 6, hard rejected filter and category/comparison
pages.

1. Dyson V15 Detect Absolute Vacuum Cleaner — $1,199 — Close match
2. Dyson Gen5detect Absolute Vacuum Cleaner — $1,499 — Close match
3. Shark Detect Pro Cordless Vacuum Cleaner — $799 — Similar item

#### Microwave

Shopping 3, Organic 3, merged 6, hard rejected shelf, category and guide.

1. Panasonic 32L Inverter Microwave Oven — $349 — Similar item
2. LG NeoChef 42L Smart Inverter Microwave Oven — $399 — Similar item
3. Samsung 40L Sensor Microwave Oven — $329 — Similar item

#### Dining chair

Shopping 3, Organic 3, merged 6, hard rejected table, chair covers and category.

1. Oak Upholstered Dining Chair — $199 — Similar item
2. Nora Timber Dining Chair — $179 — Similar item
3. Luna Fabric Dining Chair — $249 — Similar item

#### Breville coffee machine

Shopping 3, Organic 3, merged 6, hard rejected grinder and two categories.

1. Breville Barista Express Coffee Machine — $899 — Close match
2. Breville Bambino Plus Espresso Machine — $699 — Close match
3. Breville Barista Pro Coffee Machine — $1,099 — Close match

## Usage accounting verification

- `reserveUsage` is invoked once after validation and before either provider.
- Broad parallel calls share that reservation.
- Exact-model sequential calls share that reservation.
- `commitUsage` is invoked once only after final results contain a usable price.
- All failure/no-price exits use the same reservation-aware refund helper.
- Zero credible priced results preserve the `no_usable_priced_results` refund.
- A failed optional provider does not discard valid candidates from the other.
- Source-invariant tests confirm one reserve call site and one commit call site in
  the handler in addition to their function definitions.

## Verification performed

- Replacement-price Edge tests: 58 passed, 0 failed.
- Mobile replacement/refinement/usage tests: 41 passed, 0 failed.
- Edge entry-point JavaScript/TypeScript syntax check: passed.
- Git whitespace/error check: passed.
- Full deterministic eleven-search report: completed.
- Prettier check was unavailable because the workspace executable is not
  installed; no dependency was installed to work around that.
- No build was run, as instructed.

## Exact final change set

Phase 1 and the earlier uncommitted recovery work together modify or add:

- `supabase/functions/replacement-price-search/index.ts`
- `supabase/functions/replacement-price-search/finalize-results.ts`
- `supabase/functions/replacement-price-search/finalize-results.test.ts`
- `supabase/functions/replacement-price-search/retrieval-policy.ts`
- `supabase/functions/replacement-price-search/retrieval-policy.test.ts`
- `supabase/functions/replacement-price-search/result-quality.ts`
- `supabase/functions/replacement-price-search/result-quality.test.ts`
- `supabase/functions/replacement-price-search/provider-normalization.ts`
- `supabase/functions/replacement-price-search/provider-normalization.test.ts`
- `supabase/functions/replacement-price-search/price-parser.ts`
- `supabase/functions/replacement-price-search/price-parser.test.ts`
- `supabase/functions/replacement-price-search/query-model.ts`
- `supabase/functions/replacement-price-search/query-model.test.ts`
- `supabase/functions/replacement-price-search/regression-fixtures.ts`
- `supabase/functions/replacement-price-search/regression-fixtures.test.ts`
- `supabase/functions/replacement-price-search/regression-fixture-report.ts`
- `docs/replacement-pricing-architecture-d-plan.md`
- `docs/replacement-pricing-phase-1-report.md`

The unrelated untracked `.claude/` directory was not touched.

## Deployment and client impact

- Only the `replacement-price-search` Edge Function requires deployment.
- No `replacement-search-refine` deployment is required.
- No database migration or environment variable change is required.
- No mobile source change or mobile build is required.
- Nothing has been deployed. Deployment must wait for explicit review and
  approval.

## Done looks like

- Broad searches cannot be suppressed by one or two weak Shopping results.
- Exact-model results rank first and Organic is skipped only with conservative
  multi-retailer exact coverage.
- Category pages and representative wrong-class accessories are excluded.
- Alternate brands and credible unpriced same-type products remain eligible.
- Price bounds and usage accounting remain authoritative.

## Do not change

- pricing limits or subscription behavior;
- item-save behavior;
- database schema or RLS;
- mobile request/response contracts;
- production configuration;
- Phase 2 architecture without explicit approval.
