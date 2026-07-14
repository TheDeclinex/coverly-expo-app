import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractAiResponseText,
  validateAiSuggestion,
  validateRefinementRequest,
} from "./model.ts";

const requestInput = {
  item: {
    itemName: "Wireless subwoofer",
    description: "Sony black wireless home theatre subwoofer",
    category: "Electronics",
    brandMaker: "Sony",
    modelSeries: "SA-SW5",
    condition: "Good",
  },
  draft: {
    searchTerm: "Sony Sony wireless subwoofer NZ",
    brandMaker: "Sony",
    modelSeries: "SA-SW5",
    additionalDetails: "black",
    minPrice: 300,
    selectedCriteria: { condition: "new", country: "NZ" },
  },
  voiceTranscript: "Sony SA-SW5 around 300 to 500 dollars",
};

test("validates and bounds AI refinement request input", () => {
  const valid = validateRefinementRequest(requestInput);
  assert.equal(valid.ok, true);
  assert.equal(
    validateRefinementRequest({
      ...requestInput,
      voiceTranscript: "x".repeat(1501),
    }).ok,
    false,
  );
  assert.equal(
    validateRefinementRequest({
      ...requestInput,
      draft: { ...requestInput.draft, minPrice: 900, maxPrice: 100 },
    }).ok,
    false,
  );
});

test("extracts structured output text without assuming the first response item", () => {
  assert.equal(
    extractAiResponseText({
      output: [
        { type: "reasoning" },
        { content: [{ type: "output_text", text: '{"searchTerm":"Sony"}' }] },
      ],
    }),
    '{"searchTerm":"Sony"}',
  );
  assert.equal(extractAiResponseText({ output: [] }), null);
});

test("AI suggestion removes duplicate terms and preserves valid draft values", () => {
  const request = validateRefinementRequest(requestInput);
  assert.equal(request.ok, true);
  if (!request.ok) return;

  const result = validateAiSuggestion(
    {
      searchTerm: "Sony Sony wireless subwoofer NZ NZ",
      brandMaker: null,
      modelSeries: null,
      additionalDetails: null,
      minPrice: null,
      maxPrice: 500,
      rationale: "Cleaned the search and retained grounded identity.",
    },
    request.value,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.searchTerm, "Sony wireless subwoofer");
  assert.equal(result.value.brandMaker, "Sony");
  assert.equal(result.value.modelSeries, "SA-SW5");
  assert.equal(result.value.minPrice, 300);
  assert.equal(result.value.maxPrice, null);
});

test("unsupported AI brand and model are rejected rather than fabricated", () => {
  const request = validateRefinementRequest({
    ...requestInput,
    item: { itemName: "Wireless subwoofer", category: "Electronics" },
    draft: {
      searchTerm: "wireless subwoofer NZ",
      selectedCriteria: { condition: null, country: "NZ" },
    },
    voiceTranscript: undefined,
  });
  assert.equal(request.ok, true);
  if (!request.ok) return;

  const result = validateAiSuggestion(
    {
      searchTerm: "Invented Audio wireless subwoofer FAKE-9000 NZ",
      brandMaker: "Invented Audio",
      modelSeries: "FAKE-9000",
      additionalDetails: null,
      minPrice: null,
      maxPrice: null,
      rationale: null,
    },
    request.value,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.brandMaker, null);
  assert.equal(result.value.modelSeries, null);
  assert.equal(result.value.searchTerm, "wireless subwoofer");
  assert.deepEqual(result.rejectedFields, ["brand", "model"]);
});

test("invalid structured AI output is rejected without producing criteria", () => {
  const request = validateRefinementRequest(requestInput);
  assert.equal(request.ok, true);
  if (!request.ok) return;
  assert.equal(
    validateAiSuggestion({ searchTerm: 42 }, request.value).ok,
    false,
  );
  assert.equal(
    validateAiSuggestion(
      {
        searchTerm: "subwoofer",
        brandMaker: null,
        modelSeries: null,
        additionalDetails: null,
        minPrice: "900",
        maxPrice: null,
        rationale: null,
      },
      request.value,
    ).ok,
    false,
  );
});

test("confirmed model is preserved while an unknown model remains blank", () => {
  const confirmed = validateRefinementRequest(requestInput);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  const confirmedResult = validateAiSuggestion(
    {
      searchTerm: "Sony powered subwoofer",
      brandMaker: null,
      modelSeries: null,
      additionalDetails: null,
      minPrice: null,
      maxPrice: null,
      rationale: null,
    },
    confirmed.value,
  );
  assert.equal(confirmedResult.ok, true);
  if (confirmedResult.ok)
    assert.equal(confirmedResult.value.modelSeries, "SA-SW5");

  const unknown = validateRefinementRequest({
    item: { itemName: "Black subwoofer" },
    draft: {
      searchTerm: "black subwoofer",
      selectedCriteria: { condition: null, country: "NZ" },
    },
  });
  assert.equal(unknown.ok, true);
  if (!unknown.ok) return;
  const unknownResult = validateAiSuggestion(
    {
      searchTerm: "black powered subwoofer",
      brandMaker: null,
      modelSeries: null,
      additionalDetails: "Black square powered subwoofer",
      minPrice: null,
      maxPrice: null,
      rationale: null,
    },
    unknown.value,
  );
  assert.equal(unknownResult.ok, true);
  if (unknownResult.ok) assert.equal(unknownResult.value.modelSeries, null);
});

test("scene language and structured preference prose are removed while attributes remain", () => {
  const request = validateRefinementRequest({
    item: { itemName: "Sony black subwoofer", brandMaker: "Sony" },
    draft: {
      searchTerm: "Sony Black subwoofer NZ",
      brandMaker: "Sony",
      additionalDetails:
        "A black square-shaped subwoofer with a visible front speaker grille. It is placed on the floor to the right side of the cabinet. new only",
      selectedCriteria: { condition: "new", country: "NZ" },
    },
  });
  assert.equal(request.ok, true);
  if (!request.ok) return;

  const result = validateAiSuggestion(
    {
      searchTerm: "Sony black powered subwoofer NZ new",
      brandMaker: "Sony",
      modelSeries: null,
      additionalDetails:
        "Black square powered subwoofer with front speaker grille. It is placed next to the cabinet. new only",
      minPrice: 999,
      maxPrice: null,
      rationale: "Removed scene narration.",
    },
    request.value,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.searchTerm, "Sony black powered subwoofer");
  assert.equal(
    result.value.additionalDetails,
    "Black square powered subwoofer with front speaker grille.",
  );
  assert.equal(result.value.minPrice, null);
});

test("saved and AI-generated purchase history cannot leak into refinement text", () => {
  const request = validateRefinementRequest({
    item: {
      itemName: "Sony soundbar and subwoofer",
      description: "Purchased from JB Hi-Fi. Matte black finish.",
      brandMaker: "Sony",
    },
    draft: {
      searchTerm: "Sony soundbar purchased from JB Hi-Fi",
      additionalDetails:
        "Wireless subwoofer originally purchased from Noel Leeming.",
      selectedCriteria: { condition: null, country: "NZ" },
    },
  });
  assert.equal(request.ok, true);
  if (!request.ok) return;
  assert.equal(request.value.item.description, "Matte black finish.");
  assert.equal(request.value.draft.searchTerm, "Sony soundbar");
  assert.equal(request.value.draft.additionalDetails, "Wireless subwoofer.");

  const result = validateAiSuggestion(
    {
      searchTerm: "Sony soundbar bought at Harvey Norman",
      brandMaker: "Sony",
      modelSeries: null,
      additionalDetails: "Wireless subwoofer purchased from JB Hi-Fi.",
      minPrice: null,
      maxPrice: null,
      rationale: null,
    },
    request.value,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.searchTerm, "Sony soundbar");
  assert.equal(result.value.additionalDetails, "Wireless subwoofer.");
});

test("AI refinement stays non-metered and does not invoke listing search", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  assert.equal(source.includes("reserve_my_feature_usage"), false);
  assert.equal(source.includes("commit_my_feature_usage"), false);
  assert.equal(source.includes("replacement-price-search"), false);
  assert.equal(source.includes("getUser(accessToken)"), true);
  assert.equal(source.includes('type: "json_schema"'), true);
  assert.equal(source.includes("OPENAI_TIMEOUT_MS"), true);
});
