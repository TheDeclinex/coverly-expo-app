import assert from "node:assert/strict";
import test from "node:test";

import {
  areReplacementCriteriaEqual,
  buildOriginalReplacementCriteria,
  buildReplacementPriceSearchRequest,
  buildReplacementRefinementDraft,
  canStartReplacementSearch,
  filterReplacementResults,
  filterReplacementResultsToPriceRange,
  replacementPriceRangeDescription,
  replacementSearchFailed,
  replacementSearchSucceeded,
  validateReplacementRefinement,
  type ReplacementPriceResult,
} from "../replacement-pricing-model.ts";
import { replacementVoiceTranscriptToQuery } from "../replacement-pricing-query.ts";

test("voice replacement search transcript is trimmed for editable query use", () => {
  assert.equal(
    replacementVoiceTranscriptToQuery(
      "  Samsung   65 inch OLED television   NZ  ",
    ),
    "Samsung 65 inch OLED television NZ",
  );
});

test("empty replacement search transcript stays empty", () => {
  assert.equal(replacementVoiceTranscriptToQuery(null), "");
  assert.equal(replacementVoiceTranscriptToQuery("   "), "");
});

const item = {
  id: "item-1",
  name: "Television",
  description: "65 inch OLED",
  category: "Electronics",
  brand_maker: "Samsung",
  model_series: "S95D",
};

function result(position: number, price: number): ReplacementPriceResult {
  return {
    title: `Listing ${position}`,
    source: "Retailer",
    price,
    priceRaw: `$${price}`,
    link: `https://example.com/${position}`,
    position,
    matchType: "close_match",
  };
}

test("refinement request omits empty optional fields", () => {
  const request = buildReplacementPriceSearchRequest(item, {
    searchTerm: "OLED television NZ",
  });

  assert.equal(request.searchQuery, "OLED television NZ");
  assert.equal(request.description, "65 inch OLED");
  assert.equal("brand" in request, false);
  assert.equal("model" in request, false);
  assert.equal("additionalDetails" in request, false);
  assert.equal("minPrice" in request, false);
  assert.equal("maxPrice" in request, false);
});

test("refinement request includes brand model details and price range", () => {
  const request = buildReplacementPriceSearchRequest(item, {
    searchTerm: "premium television",
    brand: "Samsung",
    model: "S95D",
    additionalDetails: "65 inch anti-glare OLED",
    condition: "new",
    country: "NZ",
    minPrice: 2000,
    maxPrice: 4500,
  });

  assert.deepEqual(
    {
      brand: request.brand,
      model: request.model,
      additionalDetails: request.additionalDetails,
      condition: request.condition,
      country: request.country,
      minPrice: request.minPrice,
      maxPrice: request.maxPrice,
    },
    {
      brand: "Samsung",
      model: "S95D",
      additionalDetails: "65 inch anti-glare OLED",
      condition: "new",
      country: "NZ",
      minPrice: 2000,
      maxPrice: 4500,
    },
  );
});

test("refinement validates required term and price range", () => {
  const empty = validateReplacementRefinement({
    searchTerm: " ",
    brand: "",
    model: "",
    additionalDetails: "",
    minPrice: "",
    maxPrice: "",
  });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.errors.searchTerm ?? "", /search term/i);

  const inverted = validateReplacementRefinement({
    searchTerm: "television",
    brand: "",
    model: "",
    additionalDetails: "",
    minPrice: "2,000",
    maxPrice: "1000",
  });
  assert.equal(inverted.ok, false);
  if (!inverted.ok) assert.match(inverted.errors.maxPrice ?? "", /at least/i);

  const invalid = validateReplacementRefinement({
    searchTerm: "television",
    brand: "",
    model: "",
    additionalDetails: "",
    minPrice: "free",
    maxPrice: "-1",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.match(invalid.errors.minPrice ?? "", /valid/i);
    assert.match(invalid.errors.maxPrice ?? "", /valid/i);
  }
});

test("refinement draft separates condition and NZ criteria from clean item details", () => {
  const draft = buildReplacementRefinementDraft({
    searchTerm: "Sony black subwoofer NZ",
    additionalDetails:
      "Black square subwoofer with front speaker grille. It is placed on the floor beside a cabinet. new only",
  });
  assert.equal(draft.searchTerm, "Sony black subwoofer");
  assert.equal(
    draft.additionalDetails,
    "Black square subwoofer with front speaker grille.",
  );
  assert.equal(draft.condition, "new");
  assert.equal(draft.country, "NZ");
});

test("saved purchase history is cleaned without becoming preferred retailer intent", () => {
  const savedItem = {
    ...item,
    description:
      "Sony soundbar and subwoofer purchased from JB Hi-Fi. Matte black finish.",
  };
  const draft = buildReplacementRefinementDraft(
    { searchTerm: "Sony soundbar and subwoofer" },
    undefined,
    {
      brand: savedItem.brand_maker,
      model: savedItem.model_series,
      additionalDetails: savedItem.description,
    },
  );
  const request = buildReplacementPriceSearchRequest(
    savedItem,
    buildOriginalReplacementCriteria(savedItem, draft.searchTerm),
  );

  assert.equal(
    draft.additionalDetails,
    "Sony soundbar and subwoofer. Matte black finish.",
  );
  assert.equal(draft.preferredRetailer, undefined);
  assert.equal(
    request.description,
    "Sony soundbar and subwoofer. Matte black finish.",
  );
  assert.equal(request.preferredRetailer, undefined);
});

test("explicit retailer intent is structured while product-like retailer names remain", () => {
  const validation = validateReplacementRefinement({
    searchTerm: "Amazon Echo speaker. Only search JB Hi-Fi",
    brand: "Amazon",
    model: "Echo Studio",
    additionalDetails:
      "Amazon smart speaker originally purchased from Noel Leeming.",
    minPrice: "",
    maxPrice: "",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(validation.criteria.searchTerm, "Amazon Echo speaker.");
  assert.equal(validation.criteria.brand, "Amazon");
  assert.equal(validation.criteria.additionalDetails, "Amazon smart speaker.");
  assert.equal(validation.criteria.preferredRetailer, "JB Hi-Fi");
});

test("successful refined results replace the prior set and reset local filtering", () => {
  const previous = [result(1, 500)];
  const refined = [result(2, 900), result(3, 1300)];
  const next = replacementSearchSucceeded(refined);

  assert.notDeepEqual(next.results, previous);
  assert.deepEqual(next.results, refined);
  assert.equal(next.filter, "all");
  assert.equal(next.preservedPrevious, false);
});

test("local price filters apply only to the current result set", () => {
  const previous = [result(1, 500)];
  const current = replacementSearchSucceeded([
    result(2, 700),
    result(3, 1000),
    result(4, 1400),
  ]).results;

  assert.deepEqual(
    filterReplacementResults(current, "around", 1000).map(
      (entry) => entry.position,
    ),
    [3],
  );
  assert.deepEqual(
    previous.map((entry) => entry.position),
    [1],
  );
});

test("failed refinements preserve the previously displayed results", () => {
  const previous = [result(1, 850), result(2, 1200)];
  assert.equal(replacementSearchFailed(previous), previous);
});

test("client defensively enforces inclusive price bounds on returned listings", () => {
  const returned = [
    result(1, 80),
    result(2, 200),
    result(3, 300),
    result(4, 400),
    result(5, 649),
  ];
  assert.deepEqual(
    filterReplacementResultsToPriceRange(returned, 200, 400).map(
      (entry) => entry.price,
    ),
    [200, 300, 400],
  );
  assert.deepEqual(
    filterReplacementResultsToPriceRange(returned, 700, 900),
    [],
  );
});

test("an empty in-range refinement preserves the prior results and local filter", () => {
  const previous = [result(1, 300)];
  const next = replacementSearchSucceeded([], {
    currentResults: previous,
    currentFilter: "around",
    preservePreviousWhenEmpty: true,
  });

  assert.equal(next.results, previous);
  assert.equal(next.filter, "around");
  assert.equal(next.preservedPrevious, true);
  assert.equal(
    replacementPriceRangeDescription({ minPrice: 200, maxPrice: 400 }),
    "within $200–$400",
  );
});

test("original item criteria can be restored after repeated refinements", () => {
  const original = buildOriginalReplacementCriteria(
    item,
    "Samsung S95D Television NZ",
  );
  const refined = {
    ...original,
    searchTerm: "Samsung S95D 65 inch OLED",
    minPrice: 2000,
  };

  assert.equal(areReplacementCriteriaEqual(original, refined), false);
  assert.deepEqual(
    buildOriginalReplacementCriteria(item, "Samsung S95D Television NZ"),
    original,
  );
});

test("duplicate replacement search submissions are blocked while pending", () => {
  assert.equal(canStartReplacementSearch(false, "television"), true);
  assert.equal(canStartReplacementSearch(true, "television"), false);
  assert.equal(canStartReplacementSearch(false, "   "), false);
});
