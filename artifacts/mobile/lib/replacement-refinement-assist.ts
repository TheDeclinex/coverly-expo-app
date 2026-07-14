import {
  REPLACEMENT_SEARCH_LIMITS,
  validateReplacementRefinement,
  type ReplacementSearchRefinementDraft,
} from "./replacement-pricing-model.ts";
import {
  extractPreferredRetailerIntent,
  sanitizeReplacementSearchText,
  sanitizeSceneDescription,
} from "./description-sanitizer.ts";

export interface ReplacementRefinementItemContext {
  itemName: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  condition?: string | null;
}

export type ReplacementRefinementVoiceTarget =
  | "searchTerm"
  | "brand"
  | "model"
  | "additionalDetails"
  | "combined";

export interface ReplacementVoicePatch {
  name?: string | null;
  brand_maker?: string | null;
  model_series?: string | null;
  description?: string | null;
}

export type ReplacementRefinementChipId =
  | "add_brand"
  | "add_model"
  | "exact_model"
  | "similar_replacement"
  | "new_only"
  | "used_only"
  | "nz_listings";

export interface ReplacementRefinementChip {
  id: ReplacementRefinementChipId;
  label: string;
  selected: boolean;
}

export interface ReplacementAiSuggestion {
  searchTerm: string | null;
  brandMaker: string | null;
  modelSeries: string | null;
  additionalDetails: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  rationale: string | null;
}

export type ReplacementAiValidation =
  | {
      ok: true;
      draft: ReplacementSearchRefinementDraft;
      rationale: string | null;
      rejectedFields: Array<"brand" | "model">;
    }
  | { ok: false; error: string };

function clean(
  value: string | null | undefined,
  maximum = Number.POSITIVE_INFINITY,
): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function normalised(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsTerm(value: string, term: string): boolean {
  const candidate = normalised(term);
  return Boolean(candidate) && normalised(value).includes(candidate);
}

function appendDistinct(value: string, addition: string): string {
  const current = clean(value);
  const next = clean(addition);
  if (!next || containsTerm(current, next)) return current;
  return `${current} ${next}`.trim();
}

export function dedupeReplacementSearchTerm(value: string): string {
  const seen = new Set<string>();
  return clean(value)
    .split(" ")
    .filter((word) => {
      const key = normalised(word);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

function removeTerm(value: string, term: string): string {
  const removeWords = new Set(normalised(term).split(" ").filter(Boolean));
  removeWords.add(normalised(term));
  if (!removeWords.size) return clean(value);
  return clean(value)
    .split(" ")
    .filter((word) => !removeWords.has(normalised(word)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function removePhrase(value: string, phrase: string): string {
  if (!phrase) return clean(value);
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return clean(
    value.replace(
      new RegExp(`\\b${escaped.replace(/\\s+/g, "\\\\s+")}\\b`, "gi"),
      "",
    ),
  );
}

function parseMoney(value: string): number | undefined {
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : undefined;
}

export function parseVoicePriceRange(transcript: string): {
  minPrice?: number;
  maxPrice?: number;
} {
  const text = transcript.toLowerCase();
  const range = text.match(
    /(?:between|around|from)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:to|through|and|[-–—])\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/i,
  );
  if (range) {
    const first = parseMoney(range[1]);
    const second = parseMoney(range[2]);
    if (first != null && second != null) {
      return {
        minPrice: Math.min(first, second),
        maxPrice: Math.max(first, second),
      };
    }
  }

  const minimum = text.match(
    /(?:over|above|at least|minimum|min)\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/i,
  );
  const maximum = text.match(
    /(?:under|below|up to|maximum|max)\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/i,
  );
  return {
    ...(minimum?.[1] ? { minPrice: parseMoney(minimum[1]) } : {}),
    ...(maximum?.[1] ? { maxPrice: parseMoney(maximum[1]) } : {}),
  };
}

export function applyVoiceRefinement(
  draft: ReplacementSearchRefinementDraft,
  target: ReplacementRefinementVoiceTarget,
  patch: ReplacementVoicePatch,
  transcript: string,
): ReplacementSearchRefinementDraft {
  const spoken = clean(transcript);
  if (!spoken) return draft;
  const preferredRetailer =
    extractPreferredRetailerIntent(spoken) ??
    extractPreferredRetailerIntent(patch.name) ??
    extractPreferredRetailerIntent(patch.description) ??
    draft.preferredRetailer;

  if (target !== "combined") {
    const proposedFieldValue =
      target === "searchTerm"
        ? sanitizeReplacementSearchText(clean(patch.name) || spoken)
        : target === "brand"
          ? clean(patch.brand_maker) || spoken
          : target === "model"
            ? clean(patch.model_series) || spoken
            : sanitizeReplacementSearchText(clean(patch.description) || spoken);
    const fieldValue =
      (target === "searchTerm" || target === "additionalDetails") &&
      !proposedFieldValue
        ? draft[target]
        : proposedFieldValue;
    return {
      ...draft,
      [target]: fieldValue,
      ...(preferredRetailer ? { preferredRetailer } : {}),
    };
  }

  const prices = parseVoicePriceRange(spoken);
  const combinedSearchTerm = sanitizeReplacementSearchText(patch.name);
  const combinedDetails = sanitizeReplacementSearchText(patch.description);
  return {
    ...draft,
    ...(combinedSearchTerm ? { searchTerm: combinedSearchTerm } : {}),
    ...(clean(patch.brand_maker) ? { brand: clean(patch.brand_maker) } : {}),
    ...(clean(patch.model_series) ? { model: clean(patch.model_series) } : {}),
    ...(combinedDetails ? { additionalDetails: combinedDetails } : {}),
    ...(preferredRetailer ? { preferredRetailer } : {}),
    ...(prices.minPrice != null ? { minPrice: String(prices.minPrice) } : {}),
    ...(prices.maxPrice != null ? { maxPrice: String(prices.maxPrice) } : {}),
  };
}

function hasQualifier(
  draft: ReplacementSearchRefinementDraft,
  value: "new" | "used",
): boolean {
  if (draft.condition) return draft.condition === value;
  return new RegExp(`\\b${value}(?:\\s+only)?\\b`, "i").test(
    `${draft.searchTerm} ${draft.additionalDetails}`,
  );
}

export function suggestedReplacementRefinementChips(
  draft: ReplacementSearchRefinementDraft,
  item: ReplacementRefinementItemContext,
): ReplacementRefinementChip[] {
  const model = clean(draft.model || item.model);
  const chips: ReplacementRefinementChip[] = [];
  if (!clean(draft.brand) && clean(item.brand)) {
    chips.push({ id: "add_brand", label: "Add brand", selected: false });
  }
  if (!clean(draft.model) && clean(item.model)) {
    chips.push({ id: "add_model", label: "Add model", selected: false });
  }
  if (model) {
    const exact =
      Boolean(clean(draft.model)) || containsTerm(draft.searchTerm, model);
    chips.push({ id: "exact_model", label: "Exact model", selected: exact });
    chips.push({
      id: "similar_replacement",
      label: "Similar replacement",
      selected: !exact,
    });
  }
  chips.push({
    id: "new_only",
    label: "New only",
    selected: hasQualifier(draft, "new"),
  });
  chips.push({
    id: "used_only",
    label: "Used only",
    selected: hasQualifier(draft, "used"),
  });
  chips.push({
    id: "nz_listings",
    label: "NZ listings",
    selected: (draft.country ?? "NZ") === "NZ",
  });
  return chips;
}

export function stripStructuredRefinementTerms(
  value: string,
  criteria: Pick<ReplacementSearchRefinementDraft, "condition" | "country">,
): string {
  let next = sanitizeReplacementSearchText(value);
  if (criteria.condition) {
    next = next.replace(/\b(?:new|used)(?:\s+only)?\b/gi, "");
  }
  if ((criteria.country ?? "NZ") === "NZ") {
    next = next.replace(/\b(?:new zealand|nz)(?:\s+listings?)?\b/gi, "");
  }
  return clean(next.replace(/\s+/g, " "));
}

export function applyReplacementRefinementChip(
  draft: ReplacementSearchRefinementDraft,
  item: ReplacementRefinementItemContext,
  chip: ReplacementRefinementChipId,
): ReplacementSearchRefinementDraft {
  if (chip === "add_brand") {
    const brand = clean(item.brand, REPLACEMENT_SEARCH_LIMITS.brand);
    return brand && !clean(draft.brand) ? { ...draft, brand } : draft;
  }
  if (chip === "add_model") {
    const model = clean(item.model, REPLACEMENT_SEARCH_LIMITS.model);
    return model && !clean(draft.model) ? { ...draft, model } : draft;
  }

  const model = clean(
    draft.model || item.model,
    REPLACEMENT_SEARCH_LIMITS.model,
  );
  if (chip === "exact_model") {
    return model
      ? { ...draft, model, searchTerm: appendDistinct(draft.searchTerm, model) }
      : draft;
  }
  if (chip === "similar_replacement") {
    return model
      ? {
          ...draft,
          model: "",
          searchTerm: removeTerm(draft.searchTerm, model),
        }
      : draft;
  }
  if (chip === "new_only" || chip === "used_only") {
    const condition = chip === "new_only" ? "new" : "used";
    return {
      ...draft,
      condition,
      additionalDetails: stripStructuredRefinementTerms(
        draft.additionalDetails,
        { ...draft, condition },
      ),
    };
  }
  return {
    ...draft,
    country: "NZ",
    searchTerm: stripStructuredRefinementTerms(draft.searchTerm, {
      ...draft,
      country: "NZ",
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function grounded(
  candidate: string,
  item: ReplacementRefinementItemContext,
  draft: ReplacementSearchRefinementDraft,
  supportingText: string,
): boolean {
  const context = [
    item.itemName,
    item.description,
    item.category,
    item.brand,
    item.model,
    item.condition,
    draft.searchTerm,
    draft.brand,
    draft.model,
    draft.additionalDetails,
    supportingText,
  ]
    .filter(Boolean)
    .join(" ");
  return containsTerm(context, candidate);
}

function validNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validNullableNumber(value: unknown): value is number | null {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

export function validateAndApplyAiRefinement(
  value: unknown,
  draft: ReplacementSearchRefinementDraft,
  item: ReplacementRefinementItemContext,
  supportingText = "",
): ReplacementAiValidation {
  if (!isRecord(value))
    return { ok: false, error: "AI refinement returned invalid data." };
  const allowed = new Set([
    "searchTerm",
    "brandMaker",
    "modelSeries",
    "additionalDetails",
    "minPrice",
    "maxPrice",
    "rationale",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return { ok: false, error: "AI refinement returned unexpected fields." };
  }
  if (
    !validNullableString(value.searchTerm) ||
    !validNullableString(value.brandMaker) ||
    !validNullableString(value.modelSeries) ||
    !validNullableString(value.additionalDetails) ||
    !validNullableNumber(value.minPrice) ||
    !validNullableNumber(value.maxPrice) ||
    !validNullableString(value.rationale)
  ) {
    return { ok: false, error: "AI refinement returned invalid field types." };
  }

  const rejectedFields: Array<"brand" | "model"> = [];
  const suggestedBrand = clean(
    value.brandMaker,
    REPLACEMENT_SEARCH_LIMITS.brand,
  );
  const suggestedModel = clean(
    value.modelSeries,
    REPLACEMENT_SEARCH_LIMITS.model,
  );
  const brand =
    suggestedBrand && grounded(suggestedBrand, item, draft, supportingText)
      ? suggestedBrand
      : draft.brand;
  const model =
    suggestedModel && grounded(suggestedModel, item, draft, supportingText)
      ? suggestedModel
      : draft.model;
  if (suggestedBrand && brand !== suggestedBrand) rejectedFields.push("brand");
  if (suggestedModel && model !== suggestedModel) rejectedFields.push("model");

  let proposedSearchTerm = dedupeReplacementSearchTerm(
    clean(value.searchTerm, REPLACEMENT_SEARCH_LIMITS.searchTerm) ||
      draft.searchTerm,
  );
  if (suggestedBrand && brand !== suggestedBrand)
    proposedSearchTerm = removePhrase(proposedSearchTerm, suggestedBrand);
  if (suggestedModel && model !== suggestedModel)
    proposedSearchTerm = removePhrase(proposedSearchTerm, suggestedModel);
  proposedSearchTerm =
    sanitizeReplacementSearchText(proposedSearchTerm) ||
    sanitizeReplacementSearchText(draft.searchTerm);

  const proposedAdditionalDetails = sanitizeReplacementSearchText(
    clean(value.additionalDetails, REPLACEMENT_SEARCH_LIMITS.additionalDetails),
  );

  const nextDraft: ReplacementSearchRefinementDraft = {
    searchTerm: stripStructuredRefinementTerms(proposedSearchTerm, draft),
    brand,
    model,
    additionalDetails: stripStructuredRefinementTerms(
      sanitizeSceneDescription(
        proposedAdditionalDetails || draft.additionalDetails,
        REPLACEMENT_SEARCH_LIMITS.additionalDetails,
      ),
      draft,
    ),
    ...(draft.preferredRetailer
      ? { preferredRetailer: draft.preferredRetailer }
      : {}),
    ...(draft.condition ? { condition: draft.condition } : {}),
    country: draft.country ?? "NZ",
    minPrice: draft.minPrice,
    maxPrice: draft.maxPrice,
  };
  const validation = validateReplacementRefinement(nextDraft);
  if (!validation.ok)
    return {
      ok: false,
      error: "AI refinement returned invalid search criteria.",
    };

  return {
    ok: true,
    draft: nextDraft,
    rationale: clean(value.rationale, 180) || null,
    rejectedFields,
  };
}

export function canStartReplacementAssist(
  submitting: boolean,
  voiceActive: boolean,
  aiActive: boolean,
): boolean {
  return !submitting && !voiceActive && !aiActive;
}

export function shouldApplyReplacementAssistResult(
  visible: boolean,
  requestId: number,
  activeRequestId: number,
): boolean {
  return visible && requestId === activeRequestId;
}
