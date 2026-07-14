import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildReplacementExternalQuery,
  filterResultsToPriceRange,
  validatePriceSearchRequest,
} from "./query-model.ts";

function validRequest(overrides: Record<string, unknown> = {}) {
  return validatePriceSearchRequest({
    itemName: "Television",
    country: "NZ",
    usageIdempotencyKey: "usage-1",
    ...overrides,
  });
}

test("preserves the existing initial query shape", () => {
  const validation = validRequest({
    brand: "Samsung",
    category: "Electronics",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(
    buildReplacementExternalQuery(validation.value),
    "Samsung Television Electronics NZ",
  );
});

test("keeps broad default product queries concise without hidden exclusions", () => {
  for (const [searchQuery, expected] of [
    ["Black curved gaming monitor", "Black curved gaming monitor NZ"],
    ["Black subwoofer speaker", "Black subwoofer NZ"],
    ["Black toaster", "Black toaster NZ"],
    ["Black monitor riser stand", "Black monitor riser NZ"],
  ] as const) {
    const validation = validRequest({ itemName: searchQuery, searchQuery });
    assert.equal(validation.ok, true);
    if (!validation.ok) continue;
    const query = buildReplacementExternalQuery(validation.value);
    assert.equal(query, expected);
    assert.doesNotMatch(query, /\b(?:exclude|without|-\w+)\b/i);
  }
});

test("builds a refined query with deduplicated brand model details and price intent", () => {
  const validation = validRequest({
    searchQuery: "Samsung premium television",
    brand: "Samsung",
    model: "S95D",
    additionalDetails: "65 inch anti-glare OLED",
    minPrice: 2000,
    maxPrice: 4500,
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;

  assert.equal(
    buildReplacementExternalQuery(validation.value),
    "Samsung S95D premium television 65 inch anti-glare OLED NZ $2000-$4500",
  );
});

test("removes purchase history from query fields without inferring a preferred retailer", () => {
  const validation = validRequest({
    searchQuery: "Sony soundbar and subwoofer purchased from JB Hi-Fi",
    brand: "Sony",
    additionalDetails:
      "Wireless subwoofer originally purchased from Noel Leeming",
    description: "Bought at Harvey Norman",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(validation.value.searchQuery, "Sony soundbar and subwoofer");
  assert.equal(validation.value.additionalDetails, "Wireless subwoofer");
  assert.equal(validation.value.description, undefined);
  assert.equal(validation.value.preferredRetailer, undefined);
  assert.equal(
    buildReplacementExternalQuery(validation.value),
    "Sony soundbar and subwoofer Wireless NZ",
  );
});

test("includes only structured explicit preferred retailer intent", () => {
  const validation = validRequest({
    searchQuery: "Sony soundbar. Only search JB Hi-Fi",
    brand: "Sony",
    preferredRetailer: "JB Hi-Fi",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(validation.value.searchQuery, "Sony soundbar.");
  assert.equal(validation.value.preferredRetailer, "JB Hi-Fi");
  assert.equal(
    buildReplacementExternalQuery(validation.value),
    "Sony soundbar NZ JB Hi-Fi",
  );
});

test("retailer-like product brands are not removed without purchase wording", () => {
  const validation = validRequest({
    searchQuery: "Amazon Echo Studio smart speaker",
    brand: "Amazon",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(
    buildReplacementExternalQuery(validation.value),
    "Amazon Echo Studio smart speaker NZ",
  );
});

test("keeps condition and country as structured input until query construction", () => {
  const validation = validRequest({
    searchQuery: "Sony black powered subwoofer",
    brand: "Sony",
    condition: "new",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(validation.value.condition, "new");
  assert.equal(
    buildReplacementExternalQuery(validation.value),
    "Sony black powered subwoofer new only NZ",
  );
  assert.equal(validRequest({ condition: "refurbished" }).ok, false);
});

test("omits empty optional refinement fields", () => {
  const validation = validRequest({
    searchQuery: "OLED television NZ",
    brand: " ",
    model: "",
    additionalDetails: "  ",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;

  assert.equal(validation.value.brand, undefined);
  assert.equal(validation.value.model, undefined);
  assert.equal(validation.value.additionalDetails, undefined);
  assert.equal(
    buildReplacementExternalQuery(validation.value),
    "OLED television NZ",
  );
});

test("rejects invalid and inverted price ranges before usage reservation", () => {
  const nonNumeric = validRequest({ minPrice: "100" });
  assert.equal(nonNumeric.ok, false);

  const inverted = validRequest({ minPrice: 2000, maxPrice: 1000 });
  assert.equal(inverted.ok, false);
  if (!inverted.ok) assert.match(inverted.error, /at least the minimum/i);

  const tooHigh = validRequest({ maxPrice: 10_000_001 });
  assert.equal(tooHigh.ok, false);
});

test("bounds new refinement text fields instead of trusting arbitrary input", () => {
  const invalidSearchTerm = validRequest({ searchQuery: 42 });
  assert.equal(invalidSearchTerm.ok, false);

  const brandTooLong = validRequest({ brand: "x".repeat(101) });
  assert.equal(brandTooLong.ok, false);

  const modelTooLong = validRequest({ model: "x".repeat(121) });
  assert.equal(modelTooLong.ok, false);

  const detailsTooLong = validRequest({ additionalDetails: "x".repeat(401) });
  assert.equal(detailsTooLong.ok, false);
});

const pricedResults = [
  { id: "below", price: 80 },
  { id: "min", price: 200 },
  { id: "inside", price: 300 },
  { id: "max", price: 400 },
  { id: "above", price: 649 },
  { id: "unknown", price: null },
];

test("hard price bounds support minimum-only and maximum-only filtering", () => {
  assert.deepEqual(
    filterResultsToPriceRange(pricedResults, 200).map((result) => result.id),
    ["min", "inside", "max", "above"],
  );
  assert.deepEqual(
    filterResultsToPriceRange(pricedResults, undefined, 400).map(
      (result) => result.id,
    ),
    ["below", "min", "inside", "max"],
  );
});

test("hard minimum and maximum bounds include boundaries and exclude out-of-range listings", () => {
  assert.deepEqual(
    filterResultsToPriceRange(pricedResults, 200, 400).map(
      (result) => result.id,
    ),
    ["min", "inside", "max"],
  );
});

test("hard price bounds allow fewer than ten results and can return none", () => {
  const tenResults = Array.from({ length: 10 }, (_, index) => ({
    id: index,
    price: index * 100,
  }));
  assert.deepEqual(
    filterResultsToPriceRange(tenResults, 250, 450).map((result) => result.id),
    [3, 4],
  );
  assert.deepEqual(filterResultsToPriceRange(pricedResults, 700, 900), []);
});

test("the handler filters bounds before usable-result accounting and retains the refund path", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const finalizerSource = readFileSync(
    new URL("./finalize-results.ts", import.meta.url),
    "utf8",
  );
  const qualityFilterIndex = finalizerSource.indexOf(
    "rankAndFilterReplacementResults(",
  );
  const filterIndex = finalizerSource.indexOf("filterResultsToPriceRange(");
  const topNIndex = finalizerSource.indexOf("constrained.slice(");
  const finalizerIndex = source.indexOf("finalizeReplacementResults(");
  const usablePricesIndex = source.indexOf("const prices = results");
  const refundIndex = source.indexOf("no_usable_priced_results");

  assert.ok(qualityFilterIndex >= 0);
  assert.ok(qualityFilterIndex < filterIndex);
  assert.ok(filterIndex < topNIndex);
  assert.ok(finalizerIndex >= 0);
  assert.ok(finalizerIndex < usablePricesIndex);
  assert.ok(usablePricesIndex < refundIndex);
  assert.equal(source.includes("reserve_my_feature_usage"), true);
  assert.equal(source.includes("commit_my_feature_usage"), true);
  assert.equal(source.includes("refund_my_feature_usage"), true);
});

test("hybrid Shopping and Organic retrieval remains one metered search", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.equal(source.match(/reserveUsage\(/g)?.length, 2);
  assert.equal(source.match(/commitUsage\(/g)?.length, 2);
  assert.equal(source.includes("planReplacementProviders("), true);
  assert.equal(source.includes("Promise.all(["), true);
  assert.equal(source.includes("evaluateExactModelShoppingCoverage("), true);
  assert.equal(source.includes("usageOutcome = 'committed'"), true);
  assert.match(source, /usageOutcome = \(?await refundUsage\(/);
});
