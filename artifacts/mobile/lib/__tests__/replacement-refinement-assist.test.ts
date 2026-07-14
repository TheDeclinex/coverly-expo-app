import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyReplacementRefinementChip,
  applyVoiceRefinement,
  canStartReplacementAssist,
  shouldApplyReplacementAssistResult,
  suggestedReplacementRefinementChips,
  validateAndApplyAiRefinement,
} from "../replacement-refinement-assist.ts";

const draft = {
  searchTerm: "wireless subwoofer NZ",
  brand: "",
  model: "",
  additionalDetails: "black",
  country: "NZ" as const,
  minPrice: "",
  maxPrice: "",
};

const item = {
  itemName: "Wireless subwoofer",
  description: "Black home theatre subwoofer",
  category: "Electronics",
  brand: "Sony",
  model: "SA-SW5",
  condition: "Good",
};

test("single-field voice transcript updates only the targeted refinement field", () => {
  const next = applyVoiceRefinement(
    draft,
    "brand",
    { brand_maker: "Sony" },
    "Sony",
  );
  assert.equal(next.brand, "Sony");
  assert.equal(next.searchTerm, draft.searchTerm);
  assert.equal(next.additionalDetails, draft.additionalDetails);
});

test("combined voice populates structured fields and a spoken price range", () => {
  const next = applyVoiceRefinement(
    draft,
    "combined",
    {
      name: "Sony black wireless subwoofer",
      brand_maker: "Sony",
      model_series: "SA-SW5",
      description: "black wireless replacement subwoofer",
    },
    "Sony black wireless subwoofer, model SA-SW5, new replacement, around 300 to 500 dollars.",
  );
  assert.deepEqual(
    {
      searchTerm: next.searchTerm,
      brand: next.brand,
      model: next.model,
      minPrice: next.minPrice,
      maxPrice: next.maxPrice,
    },
    {
      searchTerm: "Sony black wireless subwoofer",
      brand: "Sony",
      model: "SA-SW5",
      minPrice: "300",
      maxPrice: "500",
    },
  );
});

test("combined voice preserves manual values for omitted fields and empty voice preserves the draft", () => {
  const manual = {
    ...draft,
    brand: "Manual brand",
    model: "Manual model",
    minPrice: "200",
  };
  const next = applyVoiceRefinement(
    manual,
    "combined",
    { description: "matte black" },
    "matte black",
  );
  assert.equal(next.brand, "Manual brand");
  assert.equal(next.model, "Manual model");
  assert.equal(next.minPrice, "200");
  assert.equal(applyVoiceRefinement(manual, "combined", {}, "   "), manual);
});

test("voice removes purchase history but preserves explicit current retailer intent", () => {
  const history = applyVoiceRefinement(
    draft,
    "additionalDetails",
    { description: "Sony soundbar purchased from JB Hi-Fi." },
    "Sony soundbar purchased from JB Hi-Fi.",
  );
  assert.equal(history.additionalDetails, "Sony soundbar.");
  assert.equal(history.preferredRetailer, undefined);

  const explicit = applyVoiceRefinement(
    history,
    "combined",
    { name: "Sony soundbar and wireless subwoofer" },
    "Find this at Noel Leeming",
  );
  assert.equal(explicit.searchTerm, "Sony soundbar and wireless subwoofer");
  assert.equal(explicit.preferredRetailer, "Noel Leeming");
});

test("suggested chips are contextual and add brand/model chips disappear once applied", () => {
  const chips = suggestedReplacementRefinementChips(draft, item);
  assert.ok(chips.some((chip) => chip.id === "add_brand"));
  assert.ok(chips.some((chip) => chip.id === "add_model"));
  assert.equal(
    chips.some((chip) => chip.id === "exact_model"),
    true,
  );

  const withBrand = applyReplacementRefinementChip(draft, item, "add_brand");
  const withModel = applyReplacementRefinementChip(
    withBrand,
    item,
    "add_model",
  );
  const nextChips = suggestedReplacementRefinementChips(withModel, item);
  assert.equal(
    nextChips.some((chip) => chip.id === "add_brand"),
    false,
  );
  assert.equal(
    nextChips.some((chip) => chip.id === "add_model"),
    false,
  );
});

test("exact model requires a model and similar replacement relaxes exact wording", () => {
  const withoutModel = { ...item, model: null };
  assert.equal(
    suggestedReplacementRefinementChips(draft, withoutModel).some(
      (chip) => chip.id === "exact_model",
    ),
    false,
  );

  const exact = applyReplacementRefinementChip(
    { ...draft, model: "SA-SW5" },
    item,
    "exact_model",
  );
  assert.match(exact.searchTerm, /SA-SW5/i);
  const similar = applyReplacementRefinementChip(
    exact,
    item,
    "similar_replacement",
  );
  assert.doesNotMatch(similar.searchTerm, /SA-SW5/i);
  assert.equal(similar.model, "");
  const similarChips = suggestedReplacementRefinementChips(similar, item);
  assert.equal(
    similarChips.find((chip) => chip.id === "similar_replacement")?.selected,
    true,
  );
});

test("new-only and used-only chips are mutually exclusive and mutate draft only", () => {
  const used = applyReplacementRefinementChip(draft, item, "used_only");
  assert.equal(used.condition, "used");
  assert.doesNotMatch(used.additionalDetails, /used only/i);
  const next = applyReplacementRefinementChip(used, item, "new_only");
  assert.equal(next.condition, "new");
  assert.doesNotMatch(next.additionalDetails, /new only/i);
  assert.doesNotMatch(next.additionalDetails, /used/i);
});

test("AI validation rejects fabricated identity, removes duplicate terms, and preserves valid manual fields", () => {
  const current = { ...draft, brand: "Sony", model: "SA-SW5", minPrice: "300" };
  const validation = validateAndApplyAiRefinement(
    {
      searchTerm:
        "Sony Sony Fabricated Brand wireless subwoofer Made-Up-9000 NZ NZ",
      brandMaker: "Fabricated Brand",
      modelSeries: "Made-Up-9000",
      additionalDetails: null,
      minPrice: null,
      maxPrice: 500,
      rationale: "Removed duplicate words.",
    },
    current,
    item,
  );
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(validation.draft.searchTerm, "Sony wireless subwoofer");
  assert.equal(validation.draft.brand, "Sony");
  assert.equal(validation.draft.model, "SA-SW5");
  assert.equal(validation.draft.minPrice, "300");
  assert.equal(validation.draft.maxPrice, "");
  assert.deepEqual(validation.rejectedFields, ["brand", "model"]);
});

test("AI failure and stale async guards preserve the existing draft", () => {
  const invalid = validateAndApplyAiRefinement({ searchTerm: 42 }, draft, item);
  assert.equal(invalid.ok, false);
  assert.deepEqual(draft, {
    searchTerm: "wireless subwoofer NZ",
    brand: "",
    model: "",
    additionalDetails: "black",
    country: "NZ",
    minPrice: "",
    maxPrice: "",
  });
  assert.equal(canStartReplacementAssist(false, false, false), true);
  assert.equal(canStartReplacementAssist(false, true, false), false);
  assert.equal(canStartReplacementAssist(false, false, true), false);
  assert.equal(shouldApplyReplacementAssistResult(true, 2, 2), true);
  assert.equal(shouldApplyReplacementAssistResult(false, 2, 2), false);
  assert.equal(shouldApplyReplacementAssistResult(true, 1, 2), false);
});

test("AI draft cleanup preserves structured preferred retailer intent", () => {
  const current = { ...draft, preferredRetailer: "JB Hi-Fi" };
  const result = validateAndApplyAiRefinement(
    {
      searchTerm: "Sony wireless subwoofer purchased from JB Hi-Fi",
      brandMaker: "Sony",
      modelSeries: null,
      additionalDetails: "Black wireless subwoofer bought at JB Hi-Fi",
      minPrice: null,
      maxPrice: null,
      rationale: "Cleaned purchase history.",
    },
    current,
    item,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.searchTerm, "Sony wireless subwoofer");
  assert.equal(result.draft.additionalDetails, "Black wireless subwoofer");
  assert.equal(result.draft.preferredRetailer, "JB Hi-Fi");
});

test("AI refinement removes scene language, preserves attributes, and leaves an unknown model blank", () => {
  const current = {
    ...draft,
    searchTerm: "Sony Black subwoofer NZ",
    brand: "Sony",
    additionalDetails:
      "A black square-shaped subwoofer with a visible front speaker grille. It is placed on the floor to the right side of the cabinet.",
    condition: "new" as const,
  };
  const result = validateAndApplyAiRefinement(
    {
      searchTerm: "Sony black powered subwoofer NZ new",
      brandMaker: "Sony",
      modelSeries: null,
      additionalDetails:
        "Black square powered subwoofer with front speaker grille. It is shown next to a cabinet. new only",
      minPrice: null,
      maxPrice: null,
      rationale: "Removed scene narration.",
    },
    current,
    { ...item, model: null },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.searchTerm, "Sony black powered subwoofer");
  assert.equal(result.draft.model, "");
  assert.equal(
    result.draft.additionalDetails,
    "Black square powered subwoofer with front speaker grille.",
  );
  assert.equal(result.draft.condition, "new");
  assert.equal(result.draft.country, "NZ");
});

test("assist controls only edit the draft and never invoke listing search", () => {
  const modalPath = new URL(
    "../../components/ReplacementSearchRefinementModal.tsx",
    import.meta.url,
  ).pathname.replace(/^\/(?=[A-Za-z]:)/, "");
  const source = readFileSync(modalPath, "utf8");

  assert.equal(source.includes("searchReplacementPrices"), false);
  assert.equal(source.includes("replacement-price-search"), false);
  assert.equal(source.includes("Describe item by voice"), true);
  assert.equal(source.includes("Improve search with AI"), true);
  assert.equal(source.includes("Run refined search"), true);
});
