import {
  extractPreferredRetailerIntent,
  sanitizeReplacementSearchText,
  sanitizeSceneDescription,
} from "./description-sanitizer.ts";

export const REPLACEMENT_SEARCH_LIMITS = {
  searchTerm: 300,
  brand: 100,
  model: 120,
  additionalDetails: 400,
  preferredRetailer: 100,
  maxPrice: 10_000_000,
} as const;

export interface ReplacementSearchItem {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  brand_maker?: string | null;
  model_series?: string | null;
}

export interface ReplacementSearchCriteria {
  searchTerm: string;
  brand?: string;
  model?: string;
  additionalDetails?: string;
  preferredRetailer?: string;
  condition?: "new" | "used";
  country?: "NZ";
  minPrice?: number;
  maxPrice?: number;
}

export interface ReplacementSearchRefinementDraft {
  searchTerm: string;
  brand: string;
  model: string;
  additionalDetails: string;
  preferredRetailer?: string;
  condition?: "new" | "used";
  country?: "NZ";
  minPrice: string;
  maxPrice: string;
}

export type ReplacementRefinementField = keyof ReplacementSearchRefinementDraft;
export type ReplacementRefinementErrors = Partial<
  Record<ReplacementRefinementField, string>
>;

export type ReplacementRefinementValidation =
  | { ok: true; criteria: ReplacementSearchCriteria }
  | { ok: false; errors: ReplacementRefinementErrors };

export interface ReplacementPriceSearchRequest {
  itemName: string;
  description?: string;
  category?: string;
  brand?: string;
  model?: string;
  additionalDetails?: string;
  preferredRetailer?: string;
  condition?: "new" | "used";
  country?: string;
  minPrice?: number;
  maxPrice?: number;
  searchQuery?: string;
  num?: number;
  itemId?: string;
  usageIdempotencyKey?: string;
}

export type ReplacementMatchType =
  | "best_match"
  | "close_match"
  | "similar_item";

export interface ReplacementPriceResult {
  title: string;
  source: string;
  price: number | null;
  priceRaw: string;
  link: string;
  snippet?: string;
  thumbnail?: string;
  position: number;
  matchType: ReplacementMatchType;
}

export type ReplacementPriceFilter = "all" | "lower" | "around" | "premium";

function cleanText(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
}

function priceDraft(value: number | undefined): string {
  return value == null ? "" : String(value);
}

function inferredCondition(value: string): "new" | "used" | undefined {
  if (/\bnew(?:\s+only)?\b/i.test(value)) return "new";
  if (/\bused(?:\s+only)?\b/i.test(value)) return "used";
  return undefined;
}

function stripStructuredTerms(
  value: string,
  condition: "new" | "used" | undefined,
  country: "NZ",
): string {
  let next = value;
  if (condition) next = next.replace(/\b(?:new|used)(?:\s+only)?\b/gi, "");
  if (country === "NZ")
    next = next.replace(/\b(?:new zealand|nz)(?:\s+listings?)?\b/gi, "");
  return next.trim().replace(/\s+/g, " ");
}

function parsePriceDraft(
  raw: string,
  field: "minPrice" | "maxPrice",
  errors: ReplacementRefinementErrors,
): number | undefined {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  const label = field === "minPrice" ? "Minimum price" : "Maximum price";
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (field === "maxPrice" && value === 0)
  ) {
    errors[field] = `${label} must be a valid positive amount.`;
    return undefined;
  }
  if (value > REPLACEMENT_SEARCH_LIMITS.maxPrice) {
    errors[field] = `${label} is too high.`;
    return undefined;
  }
  return Math.round(value * 100) / 100;
}

function addLengthError(
  field: ReplacementRefinementField,
  value: string,
  maximum: number,
  errors: ReplacementRefinementErrors,
): void {
  if (value.length > maximum)
    errors[field] = `Use ${maximum} characters or fewer.`;
}

export function buildOriginalReplacementCriteria(
  item: ReplacementSearchItem,
  searchTerm: string,
): ReplacementSearchCriteria {
  return {
    searchTerm: cleanText(searchTerm) ?? cleanText(item.name) ?? "",
    country: "NZ",
    ...(cleanText(item.brand_maker)
      ? { brand: cleanText(item.brand_maker) }
      : {}),
    ...(cleanText(item.model_series)
      ? { model: cleanText(item.model_series) }
      : {}),
  };
}

export function buildReplacementRefinementDraft(
  criteria: ReplacementSearchCriteria,
  editableSearchTerm?: string,
  defaults?: Pick<
    ReplacementSearchRefinementDraft,
    "brand" | "model" | "additionalDetails"
  >,
): ReplacementSearchRefinementDraft {
  const country = criteria.country ?? "NZ";
  const rawDetails =
    criteria.additionalDetails ?? defaults?.additionalDetails ?? "";
  const rawSearchTerm = editableSearchTerm ?? criteria.searchTerm;
  const preferredRetailer =
    cleanText(criteria.preferredRetailer) ??
    extractPreferredRetailerIntent(rawSearchTerm) ??
    (criteria.additionalDetails
      ? extractPreferredRetailerIntent(rawDetails)
      : null);
  const condition =
    criteria.condition ?? inferredCondition(`${rawSearchTerm} ${rawDetails}`);
  return {
    searchTerm: stripStructuredTerms(
      sanitizeReplacementSearchText(
        rawSearchTerm,
        REPLACEMENT_SEARCH_LIMITS.searchTerm,
      ),
      condition,
      country,
    ),
    brand: criteria.brand ?? defaults?.brand ?? "",
    model: criteria.model ?? defaults?.model ?? "",
    additionalDetails: stripStructuredTerms(
      sanitizeSceneDescription(
        sanitizeReplacementSearchText(rawDetails),
        REPLACEMENT_SEARCH_LIMITS.additionalDetails,
      ),
      condition,
      country,
    ),
    ...(preferredRetailer ? { preferredRetailer } : {}),
    ...(condition ? { condition } : {}),
    country,
    minPrice: priceDraft(criteria.minPrice),
    maxPrice: priceDraft(criteria.maxPrice),
  };
}

export function validateReplacementRefinement(
  draft: ReplacementSearchRefinementDraft,
): ReplacementRefinementValidation {
  const errors: ReplacementRefinementErrors = {};
  const condition = draft.condition;
  const country = draft.country ?? "NZ";
  const inferredPreferredRetailer =
    extractPreferredRetailerIntent(draft.searchTerm) ??
    extractPreferredRetailerIntent(draft.additionalDetails);
  const preferredRetailer = cleanText(
    draft.preferredRetailer ?? inferredPreferredRetailer,
  );
  const searchTerm = stripStructuredTerms(
    sanitizeReplacementSearchText(draft.searchTerm),
    condition,
    country,
  );
  const brand = cleanText(draft.brand);
  const model = cleanText(draft.model);
  const additionalDetails = cleanText(
    stripStructuredTerms(
      sanitizeSceneDescription(
        sanitizeReplacementSearchText(draft.additionalDetails),
        REPLACEMENT_SEARCH_LIMITS.additionalDetails,
      ),
      condition,
      country,
    ),
  );

  if (!searchTerm) errors.searchTerm = "Enter a search term.";
  addLengthError(
    "searchTerm",
    searchTerm,
    REPLACEMENT_SEARCH_LIMITS.searchTerm,
    errors,
  );
  addLengthError(
    "preferredRetailer",
    preferredRetailer ?? "",
    REPLACEMENT_SEARCH_LIMITS.preferredRetailer,
    errors,
  );
  addLengthError("brand", brand ?? "", REPLACEMENT_SEARCH_LIMITS.brand, errors);
  addLengthError("model", model ?? "", REPLACEMENT_SEARCH_LIMITS.model, errors);
  addLengthError(
    "additionalDetails",
    additionalDetails ?? "",
    REPLACEMENT_SEARCH_LIMITS.additionalDetails,
    errors,
  );

  const minPrice = parsePriceDraft(draft.minPrice, "minPrice", errors);
  const maxPrice = parsePriceDraft(draft.maxPrice, "maxPrice", errors);
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    errors.maxPrice = "Maximum price must be at least the minimum price.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    criteria: {
      searchTerm,
      ...(brand ? { brand } : {}),
      ...(model ? { model } : {}),
      ...(additionalDetails ? { additionalDetails } : {}),
      ...(preferredRetailer ? { preferredRetailer } : {}),
      ...(condition ? { condition } : {}),
      country,
      ...(minPrice != null ? { minPrice } : {}),
      ...(maxPrice != null ? { maxPrice } : {}),
    },
  };
}

export function buildReplacementPriceSearchRequest(
  item: ReplacementSearchItem,
  criteria: ReplacementSearchCriteria,
): ReplacementPriceSearchRequest {
  return {
    itemName: item.name.trim(),
    ...(sanitizeReplacementSearchText(
      sanitizeSceneDescription(item.description),
    )
      ? {
          description: sanitizeReplacementSearchText(
            sanitizeSceneDescription(item.description),
          ),
        }
      : {}),
    ...(cleanText(item.category) ? { category: cleanText(item.category) } : {}),
    ...(criteria.brand ? { brand: criteria.brand } : {}),
    ...(criteria.model ? { model: criteria.model } : {}),
    ...(criteria.additionalDetails
      ? { additionalDetails: criteria.additionalDetails }
      : {}),
    ...(criteria.preferredRetailer
      ? { preferredRetailer: criteria.preferredRetailer }
      : {}),
    ...(criteria.condition ? { condition: criteria.condition } : {}),
    country: criteria.country ?? "NZ",
    ...(criteria.minPrice != null ? { minPrice: criteria.minPrice } : {}),
    ...(criteria.maxPrice != null ? { maxPrice: criteria.maxPrice } : {}),
    searchQuery: criteria.searchTerm,
    num: 10,
    itemId: item.id,
  };
}

export function areReplacementCriteriaEqual(
  left: ReplacementSearchCriteria | null,
  right: ReplacementSearchCriteria | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.searchTerm === right.searchTerm &&
    left.brand === right.brand &&
    left.model === right.model &&
    left.additionalDetails === right.additionalDetails &&
    left.preferredRetailer === right.preferredRetailer &&
    left.condition === right.condition &&
    (left.country ?? "NZ") === (right.country ?? "NZ") &&
    left.minPrice === right.minPrice &&
    left.maxPrice === right.maxPrice
  );
}

export function replacementCriteriaDetails(
  criteria: ReplacementSearchCriteria,
): string[] {
  const details: string[] = [];
  if (criteria.brand) details.push(`Brand: ${criteria.brand}`);
  if (criteria.model) details.push(`Model: ${criteria.model}`);
  if (criteria.additionalDetails)
    details.push(`Details: ${criteria.additionalDetails}`);
  if (criteria.preferredRetailer)
    details.push(`Preferred retailer: ${criteria.preferredRetailer}`);
  if (criteria.condition) details.push(`Condition: ${criteria.condition} only`);
  if ((criteria.country ?? "NZ") === "NZ") details.push("Country: NZ");
  if (criteria.minPrice != null && criteria.maxPrice != null) {
    details.push(`Price: $${criteria.minPrice}–$${criteria.maxPrice}`);
  } else if (criteria.minPrice != null) {
    details.push(`Price: $${criteria.minPrice}+`);
  } else if (criteria.maxPrice != null) {
    details.push(`Price: up to $${criteria.maxPrice}`);
  }
  return details;
}

export function filterReplacementResults(
  results: ReplacementPriceResult[],
  filter: ReplacementPriceFilter,
  estimate: number | null,
): ReplacementPriceResult[] {
  if (filter === "all" || estimate == null) return results;

  const lowerBoundary = estimate * 0.75;
  const upperBoundary = estimate * 1.25;

  return results.filter((result) => {
    if (result.price == null) return false;
    if (filter === "lower") return result.price < lowerBoundary;
    if (filter === "around") {
      return result.price >= lowerBoundary && result.price <= upperBoundary;
    }
    return result.price > upperBoundary;
  });
}

export function filterReplacementResultsToPriceRange(
  results: ReplacementPriceResult[],
  minPrice?: number,
  maxPrice?: number,
): ReplacementPriceResult[] {
  if (minPrice == null && maxPrice == null) return results;

  return results.filter((result) => {
    if (
      result.price == null ||
      !Number.isFinite(result.price) ||
      result.price <= 0
    ) {
      return false;
    }
    if (minPrice != null && result.price < minPrice) return false;
    if (maxPrice != null && result.price > maxPrice) return false;
    return true;
  });
}

function formatRangePrice(value: number): string {
  return `$${value.toLocaleString("en-NZ", { maximumFractionDigits: 2 })}`;
}

export function replacementPriceRangeDescription(
  criteria: Pick<ReplacementSearchCriteria, "minPrice" | "maxPrice">,
): string | null {
  if (criteria.minPrice != null && criteria.maxPrice != null) {
    return `within ${formatRangePrice(criteria.minPrice)}–${formatRangePrice(criteria.maxPrice)}`;
  }
  if (criteria.minPrice != null)
    return `at or above ${formatRangePrice(criteria.minPrice)}`;
  if (criteria.maxPrice != null)
    return `at or below ${formatRangePrice(criteria.maxPrice)}`;
  return null;
}

export function replacementSearchSucceeded<T>(
  nextResults: T[],
  options?: {
    currentResults?: T[] | null;
    currentFilter?: ReplacementPriceFilter;
    preservePreviousWhenEmpty?: boolean;
  },
): {
  results: T[];
  filter: ReplacementPriceFilter;
  preservedPrevious: boolean;
} {
  if (
    options?.preservePreviousWhenEmpty &&
    nextResults.length === 0 &&
    options.currentResults != null
  ) {
    return {
      results: options.currentResults,
      filter: options.currentFilter ?? "all",
      preservedPrevious: true,
    };
  }
  return { results: nextResults, filter: "all", preservedPrevious: false };
}

export function replacementSearchFailed<T>(
  currentResults: T[] | null,
): T[] | null {
  return currentResults;
}

export function canStartReplacementSearch(
  isPending: boolean,
  searchTerm: string,
): boolean {
  return !isPending && Boolean(cleanText(searchTerm));
}
