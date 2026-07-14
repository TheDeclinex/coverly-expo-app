import assert from "node:assert/strict";
import test from "node:test";

import {
  changedRefinementDisplayedFields,
  clearChangedRefinementField,
  shouldInitialiseRefinementModal,
} from "../replacement-refinement-ui-state.ts";
import type { ReplacementSearchRefinementDraft } from "../replacement-pricing-model.ts";
import { REPLACEMENT_SEARCH_LIMITS } from "../replacement-pricing-model.ts";

const original: ReplacementSearchRefinementDraft = {
  searchTerm: "Television",
  brand: "Samsung",
  model: "S95D",
  additionalDetails: "65 inch OLED",
  minPrice: "2000",
  maxPrice: "4500",
};

test("modal draft initialises only on a closed-to-open transition", () => {
  assert.equal(shouldInitialiseRefinementModal(false, true), true);
  assert.equal(shouldInitialiseRefinementModal(true, true), false);
  assert.equal(shouldInitialiseRefinementModal(true, false), false);
  assert.equal(shouldInitialiseRefinementModal(false, false), false);

  let visible = false;
  let draft = original;
  const edited = { ...draft, searchTerm: "Manually edited OLED" };

  if (shouldInitialiseRefinementModal(visible, true)) draft = original;
  visible = true;
  draft = edited;
  const changedParentDraft = { ...original, searchTerm: "Late transcript" };
  if (shouldInitialiseRefinementModal(visible, true))
    draft = changedParentDraft;
  assert.equal(draft.searchTerm, "Manually edited OLED");

  visible = false;
  if (shouldInitialiseRefinementModal(visible, true))
    draft = changedParentDraft;
  assert.equal(draft.searchTerm, "Late transcript");
});

test("changed-field feedback marks only displayed values that changed", () => {
  const next = {
    ...original,
    searchTerm: "Samsung 65 inch OLED television",
    additionalDetails: "65 inch anti-glare OLED",
  };
  assert.deepEqual(changedRefinementDisplayedFields(original, next), [
    "searchTerm",
    "additionalDetails",
  ]);
  assert.deepEqual(changedRefinementDisplayedFields(original, original), []);
});

test("manual editing clears only that field's changed marker", () => {
  assert.deepEqual(
    clearChangedRefinementField(
      ["searchTerm", "brand", "additionalDetails"],
      "brand",
    ),
    ["searchTerm", "additionalDetails"],
  );
});

test("character counters use the same limits and exact values as validation", () => {
  const draft = {
    ...original,
    searchTerm: "OLED television",
    additionalDetails: "Black, 65 inch, anti-glare",
  };
  assert.equal(draft.searchTerm.length, 15);
  assert.equal(draft.additionalDetails.length, 26);
  assert.equal(REPLACEMENT_SEARCH_LIMITS.searchTerm, 300);
  assert.equal(REPLACEMENT_SEARCH_LIMITS.additionalDetails, 400);
});
