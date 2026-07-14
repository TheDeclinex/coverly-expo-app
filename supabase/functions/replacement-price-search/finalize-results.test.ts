import assert from "node:assert/strict";
import test from "node:test";

import { finalizeReplacementResults } from "./finalize-results.ts";
import type { ReplacementResultCandidate } from "./result-quality.ts";

function candidate(
  title: string,
  price: number | null,
  position: number,
): ReplacementResultCandidate {
  return {
    title,
    source: `Retailer ${position}`,
    price,
    priceRaw: price == null ? "" : `$${price}`,
    link: `https://retailer${position}.co.nz/products/${position}`,
    position,
    providerType: "shopping",
    priceSource: price == null ? "none" : "structured",
  };
}

test("strict price bounds are applied before final top-N selection", () => {
  const candidates = [
    candidate("Breville Black Toaster Premium", 499, 1),
    candidate("Breville Black Toaster Two", 199, 2),
    candidate("Sunbeam Black Toaster Three", 249, 3),
    candidate("Russell Hobbs Black Toaster Four", 299, 4),
  ];
  const finalized = finalizeReplacementResults(
    candidates,
    { itemName: "Black toaster" },
    2,
    150,
    300,
  );
  assert.equal(finalized.rankedCount, 4);
  assert.equal(finalized.constrainedCount, 3);
  assert.deepEqual(
    finalized.results.map((result) => result.price),
    [199, 249],
  );
});

test("unpriced products remain eligible without bounds but never affect bounded results", () => {
  const unpriced = candidate("Breville Black Toaster Unpriced", null, 1);
  assert.equal(
    finalizeReplacementResults(
      [unpriced],
      { itemName: "Black toaster" },
      10,
    ).results.length,
    1,
  );
  assert.equal(
    finalizeReplacementResults(
      [unpriced],
      { itemName: "Black toaster" },
      10,
      50,
      200,
    ).results.length,
    0,
  );
});
