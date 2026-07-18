import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyAiTextUpdate,
  cloneReplacementRefinementDraft,
  createOriginalReplacementRefinementDraft,
  deterministicRefinementChips,
  effectiveRefinementFieldValue,
  toggleRefinementChip,
  validateReplacementPriceRange,
  type ReplacementRefinementDraft,
} from "../replacement-refinement-model.ts";
import { formatMoneyInputValue } from "../money.ts";
import {
  APPROVED_REPLACEMENT_REFINEMENT_MODEL,
  isSupportedRefinementRewrite,
  resolveReplacementRefinementModel,
  validateAiRefinementCandidate,
} from "../../../../supabase/functions/replacement-refinement-v2/model.ts";
import {
  applyAuthoritativeReplacementPriceRange,
  isAuthoritativeReplacementPriceRangeActive,
} from "../../../../supabase/functions/replacement-price-search/refinement-results.ts";

const draft = (overrides: Partial<ReplacementRefinementDraft> = {}): ReplacementRefinementDraft => ({
  searchTerm: "Sony OLED television",
  brand: "Sony",
  model: "Bravia",
  additionalDetails: "65 inch 4K",
  minimumPrice: "",
  maximumPrice: "",
  chipContributions: [],
  ...overrides,
});

test("replacement refinement uses the approved model fallback and preserves an explicit override", () => {
  assert.equal(APPROVED_REPLACEMENT_REFINEMENT_MODEL, "gpt-5.6-luna");
  assert.equal(resolveReplacementRefinementModel(undefined), "gpt-5.6-luna");
  assert.equal(resolveReplacementRefinementModel("   "), "gpt-5.6-luna");
  assert.equal(resolveReplacementRefinementModel(" approved-override "), "approved-override");
});

test("original, working, and submitted drafts can remain independent", () => {
  const original = createOriginalReplacementRefinementDraft({
    name: "Television",
    brand_maker: "Sony",
    model_series: "Bravia",
    description: "65 inch OLED",
  });
  const working = cloneReplacementRefinementDraft(original);
  working.searchTerm = "Sony OLED television";
  working.minimumPrice = "2000";
  assert.equal(original.searchTerm, "Sony Bravia Television");
  assert.equal(original.minimumPrice, "");

  const submitted = cloneReplacementRefinementDraft(working);
  working.model = "Edited later";
  assert.equal(submitted.model, "Bravia");
});

test("AI text update preserves price and chip state and provides an exact undo snapshot", () => {
  const selected = toggleRefinementChip(draft({ minimumPrice: "2000", maximumPrice: "3500" }), {
    id: "chip:oled",
    label: "OLED",
    value: "OLED",
    field: "additionalDetails",
    source: "deterministic",
  });
  const applied = applyAiTextUpdate(selected, {
    searchTerm: "Sony television",
    brand: "Sony",
    model: "Bravia",
    additionalDetails: "OLED 65 inch 4K",
  });
  assert.equal(applied.draft.minimumPrice, "2000");
  assert.equal(applied.draft.maximumPrice, "3500");
  assert.equal(applied.draft.chipContributions.length, 1);
  assert.deepEqual(applied.undoDraft, selected);
});

test("chip provenance is separate from manual content and removal removes only that contribution", () => {
  const chip = {
    id: "chip:bravia",
    label: "Bravia",
    value: "Bravia",
    field: "searchTerm" as const,
    source: "deterministic" as const,
  };
  const manual = draft({ searchTerm: "Sony OLED television" });
  const selected = toggleRefinementChip(manual, chip);
  assert.equal(effectiveRefinementFieldValue(selected, "searchTerm"), "Sony OLED television Bravia");
  const manuallyEdited = { ...selected, searchTerm: "Sony OLED television with warranty" };
  const removed = toggleRefinementChip(manuallyEdited, chip);
  assert.equal(removed.searchTerm, "Sony OLED television with warranty");
  assert.equal(effectiveRefinementFieldValue(removed, "searchTerm"), "Sony OLED television with warranty");
});

test("deterministic chips use only explicit high-confidence draft context", () => {
  const chips = deterministicRefinementChips(draft());
  assert.equal(chips.some((chip) => chip.label === "65 in"), true);
  assert.equal(chips.some((chip) => chip.label.toLowerCase() === "4k"), true);
  assert.equal(chips.some((chip) => chip.label === "Bravia"), true);
});

test("price validation is inclusive and reuses currency precision", () => {
  assert.equal(validateReplacementPriceRange("2,000", "2,000", "NZD").valid, true);
  assert.equal(validateReplacementPriceRange("2,001", "2,000", "NZD").rangeError, "Minimum price cannot be greater than maximum price.");
  assert.equal(validateReplacementPriceRange("100.50", "", "JPY").minimumError, "JPY supports up to 0 decimal places.");
  assert.equal(validateReplacementPriceRange("1.234,50", "2.000,00", "EUR", "de-DE").parsed.minimumPrice, 1234.5);
  assert.equal(validateReplacementPriceRange("1.234,50", "2.000,00", "EUR", "de-DE").parsed.maximumPrice, 2000);
  assert.equal(formatMoneyInputValue(1234.5, "NZD"), "1,234.50");
  assert.equal(formatMoneyInputValue(1234, "JPY"), "1,234");
});

test("authoritative range filtering excludes unknown and foreign currencies before limiting", () => {
  const results = [
    { id: "below", price: 99, currencyCode: "NZD" },
    { id: "minimum", price: 100, currencyCode: "NZD" },
    { id: "maximum", price: 200, currencyCode: "NZD" },
    { id: "above", price: 201, currencyCode: "NZD" },
    { id: "foreign", price: 150, currencyCode: "USD" },
    { id: "unknown", price: 150, currencyCode: null },
    { id: "zero", price: 0, currencyCode: "NZD" },
    { id: "invalid", price: -5, currencyCode: "NZD" },
    { id: "unpriced", price: null, currencyCode: "NZD" },
  ];
  assert.deepEqual(
    applyAuthoritativeReplacementPriceRange(results, "NZD", 100, 200, 10).map((result) => result.id),
    ["minimum", "maximum"],
  );
  assert.deepEqual(
    applyAuthoritativeReplacementPriceRange(results, "NZD", undefined, undefined, 10).map((result) => result.id),
    results.map((result) => result.id),
  );
  assert.equal(isAuthoritativeReplacementPriceRangeActive(2, 0, undefined), true);
  assert.equal(isAuthoritativeReplacementPriceRangeActive(2, undefined, 0), true);
  assert.equal(isAuthoritativeReplacementPriceRangeActive(2, undefined, undefined), false);
  assert.equal(isAuthoritativeReplacementPriceRangeActive(undefined, 100, 200), false);
});

test("AI guard accepts organization but rejects unsupported product facts", () => {
  const current = {
    searchTerm: "Sony television OLED",
    brand: "Sony",
    model: "",
    additionalDetails: "65 inch",
  };
  const validated = validateAiRefinementCandidate({
    searchTerm: "Sony OLED television",
    brand: "Samsung",
    model: "Bravia X90L",
    additionalDetails: "65 inch stainless steel",
    suggestedChips: ["OLED", "Samsung", "65 inch"],
  }, current, { name: "Television", brand: "Sony", description: "OLED 65 inch" });
  assert.equal(validated.searchTerm, "Sony OLED television");
  assert.equal(validated.brand, "Sony");
  assert.equal(validated.model, "");
  assert.equal(validated.additionalDetails, "65 inch");
  assert.deepEqual(validated.suggestedChips, ["OLED", "65 inch"]);
  assert.equal(isSupportedRefinementRewrite("blue television", "black television"), false);
});

test("screen contract preserves old results, separates refined billing retry, and embeds voice", () => {
  const screen = readFileSync(new URL("../../app/(tabs)/replacement-pricing/[id].tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../../components/ReplacementSearchRefinementSheet.tsx", import.meta.url), "utf8");
  const transport = readFileSync(new URL("../replacement-pricing.ts", import.meta.url), "utf8");
  const edge = readFileSync(new URL("../../../../supabase/functions/replacement-price-search/index.ts", import.meta.url), "utf8");
  assert.match(screen, /results \? \(/);
  assert.match(screen, /opacity: refinedSearching \? 0\.56/);
  assert.match(screen, /Try again/);
  assert.match(screen, /handleRunRefinedSearch\(lastFailedRefinement\.draft/);
  assert.match(transport, /const requestBody[\s\S]*const maximumAttempts/);
  assert.match(transport, /automaticTransportRetry/);
  assert.match(screen, /if \(searchAttemptInFlight\.current\) return/);
  assert.match(screen, /activeSearchSequence\.current \+= 1;[\s\S]*refinedAbortController\.current\?\.abort\(\)/);
  assert.match(screen, /refinementSeededItemId\.current !== item\.id/);
  assert.match(screen, /filterReplacementResults\(results \?\? \[\], filter, estimate\)/);
  assert.match(sheet, /aiRequestIsCurrent/);
  assert.match(sheet, /voiceRequestIsCurrent/);
  assert.match(sheet, /applyAiTextUpdate\(draftRef\.current/);
  assert.match(screen, /refinement: isRefined \?/);
  assert.match(screen, /automaticTransportRetry: Boolean\(isRefined\)/);
  assert.match(edge, /isAuthoritativeReplacementPriceRangeActive\(body\.refinement\?\.version/);
  assert.match(edge, /results = rangeActive[\s\S]*: results\.slice\(0, num\)/);
  const reserveIndex = edge.indexOf("usageReservation = await reserveUsage");
  for (const validation of ["SEARCH_TERM_REQUIRED", "INVALID_PRICE_RANGE", "MISSING_IDEMPOTENCY_KEY", "ITEM_CONTEXT_REQUIRED", "INVALID_PROPERTY_MARKET"]) {
    assert.ok(edge.indexOf(validation) >= 0 && edge.indexOf(validation) < reserveIndex, validation);
  }
  assert.match(edge, /reserveUsage/);
  assert.match(edge, /commitUsage/);
  assert.match(edge, /refundUsage/);
  assert.equal((sheet.match(/<Modal\b/g) ?? []).length, 1);
  assert.doesNotMatch(sheet, /VoiceInputSheet/);
  assert.match(sheet, /Searches retailers again using your refined criteria/);
  assert.match(sheet, /Clear refinements/);
  assert.match(sheet, /Restore last search/);
});
