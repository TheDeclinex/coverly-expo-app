import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOrganicResults,
  normalizeShoppingResults,
} from "./provider-normalization.ts";
import { replacementRegressionFixtures } from "./regression-fixtures.ts";
import {
  evaluateExactModelShoppingCoverage,
  planReplacementProviders,
} from "./retrieval-policy.ts";
import { finalizeReplacementResults } from "./finalize-results.ts";
import {
  evaluateReplacementResult,
  rankAndFilterReplacementResults,
} from "./result-quality.ts";

for (const fixture of replacementRegressionFixtures) {
  test(`${fixture.name}: only credible product listings survive`, () => {
    const candidates = [
      ...normalizeShoppingResults({ shopping: fixture.shopping }, 10),
      ...normalizeOrganicResults({ organic: fixture.organic }, 10),
    ];
    const ranked = finalizeReplacementResults(
      candidates,
      fixture.context,
      10,
    ).results;

    assert.deepEqual(
      ranked.map((result) => result.title),
      fixture.acceptedTitles,
    );
    assert.ok(ranked.length < 10, "results must not be padded to ten");

    for (const candidate of candidates) {
      const evaluation = evaluateReplacementResult(candidate, fixture.context);
      assert.equal(
        evaluation.accepted,
        fixture.acceptedTitles.includes(candidate.title),
        `${candidate.title}: ${evaluation.rejectionReason}`,
      );
    }
  });
}

test("initial and refined searches use the same acceptance and ranking rules", () => {
  const fixture = replacementRegressionFixtures[0];
  const candidates = normalizeOrganicResults({ organic: fixture.organic }, 10);
  const initialContext = {
    itemName: "Silver HP 14-inch laptop",
    brand: "HP",
    category: "Computers",
  };
  const initial = rankAndFilterReplacementResults(
    candidates,
    initialContext,
    10,
  );
  const refined = rankAndFilterReplacementResults(
    candidates,
    fixture.context,
    10,
  );
  assert.deepEqual(initial, refined);
});

test("Shopping results with structured prices prevent unnecessary organic fallback", () => {
  const fixture = replacementRegressionFixtures[2];
  const shopping = rankAndFilterReplacementResults(
    normalizeShoppingResults({ shopping: fixture.shopping }, 10),
    fixture.context,
    10,
  );
  assert.equal(shopping.length, 1);
  assert.equal(shopping[0].price, 449);
  assert.equal(
    shopping.some((result) => result.price != null && result.price > 0),
    true,
  );
});

test("broad searches always merge Shopping and Organic before final selection", () => {
  for (const name of [
    "initial black curved gaming monitor",
    "initial black subwoofer speaker",
    "initial black toaster",
    "initial Dyson vacuum cleaner",
    "initial microwave",
    "initial dining chair",
    "initial Breville coffee machine",
  ]) {
    const fixture = replacementRegressionFixtures.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(fixture);
    const shoppingCandidates = normalizeShoppingResults(
      { shopping: fixture.shopping },
      10,
    );
    const shopping = rankAndFilterReplacementResults(
      shoppingCandidates,
      fixture.context,
      10,
    );
    const plan = planReplacementProviders(fixture.context);
    assert.equal(plan.requestOrganicInParallel, true, name);
    const organicCandidates = normalizeOrganicResults(
      { organic: fixture.organic },
      10,
    );
    const combined = finalizeReplacementResults(
      [...shoppingCandidates, ...organicCandidates],
      fixture.context,
      10,
    ).results;
    assert.ok(combined.length >= 3, name);
    for (const result of shopping) {
      assert.equal(
        combined.some((candidate) => candidate.title === result.title),
        true,
        `${name}: ${result.title}`,
      );
    }
  }
});

test("one priced exact model result remains first but does not suppress Organic", () => {
  const fixture = replacementRegressionFixtures.find(
    (candidate) => candidate.name === "known exact Samsung S95D model",
  );
  assert.ok(fixture);
  const shopping = rankAndFilterReplacementResults(
    normalizeShoppingResults({ shopping: fixture.shopping }, 10),
    fixture.context,
    10,
  );
  const plan = planReplacementProviders(fixture.context);
  assert.equal(plan.requestOrganicInParallel, false);
  const coverage = evaluateExactModelShoppingCoverage(
    shopping,
    fixture.context,
  );
  assert.equal(coverage.adequate, false);
  assert.equal(coverage.pricedExactOfferCount, 1);
  assert.deepEqual(
    shopping.map((result) => result.title),
    fixture.acceptedTitles,
  );
});
