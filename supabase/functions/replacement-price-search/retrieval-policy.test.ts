import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateExactModelShoppingCoverage,
  planReplacementProviders,
} from "./retrieval-policy.ts";
import type { QualifiedReplacementResult } from "./result-quality.ts";

function result(
  source: string,
  matchType: QualifiedReplacementResult["matchType"] = "best_match",
  price: number | null = 100,
): QualifiedReplacementResult {
  return {
    title: `Samsung QA65S95D from ${source}`,
    source,
    price,
    priceRaw: price == null ? "" : `$${price}`,
    link: `https://${source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.co.nz/products/qa65s95d`,
    position: 1,
    matchType,
  };
}

test("broad searches request Shopping and Organic in parallel", () => {
  assert.deepEqual(planReplacementProviders({ itemName: "Black toaster" }), {
    strategy: "parallel_broad_search",
    requestShopping: true,
    requestOrganicInParallel: true,
  });
});

test("model searches evaluate Shopping before deciding whether Organic is needed", () => {
  assert.deepEqual(
    planReplacementProviders({ itemName: "Television", model: "QA65S95D" }),
    {
      strategy: "shopping_then_exact_model_check",
      requestShopping: true,
      requestOrganicInParallel: false,
    },
  );
});

test("one priced exact-model result is not adequate coverage", () => {
  const coverage = evaluateExactModelShoppingCoverage(
    [result("Retailer One")],
    { itemName: "Television", model: "QA65S95D" },
  );
  assert.equal(coverage.adequate, false);
  assert.equal(coverage.pricedExactOfferCount, 1);
  assert.equal(coverage.distinctRetailerCount, 1);
});

test("two exact offers from the same retailer are not adequate coverage", () => {
  const coverage = evaluateExactModelShoppingCoverage(
    [result("Retailer One", "best_match", 4999), result("Retailer One", "best_match", 4799)],
    { itemName: "Television", model: "QA65S95D" },
  );
  assert.equal(coverage.adequate, false);
  assert.equal(coverage.pricedExactOfferCount, 2);
  assert.equal(coverage.distinctRetailerCount, 1);
});

test("two priced exact offers from distinct retailers are adequate coverage", () => {
  const coverage = evaluateExactModelShoppingCoverage(
    [result("Retailer One", "best_match", 4999), result("Retailer Two", "best_match", 4799)],
    { itemName: "Television", model: "QA65S95D" },
  );
  assert.equal(coverage.adequate, true);
  assert.equal(coverage.pricedExactOfferCount, 2);
  assert.equal(coverage.distinctRetailerCount, 2);
});

test("unpriced and non-exact results cannot satisfy exact-model coverage", () => {
  const coverage = evaluateExactModelShoppingCoverage(
    [
      result("Retailer One", "best_match", null),
      result("Retailer Two", "similar_item", 3999),
    ],
    { itemName: "Television", model: "QA65S95D" },
  );
  assert.equal(coverage.adequate, false);
  assert.equal(coverage.pricedExactOfferCount, 0);
});
