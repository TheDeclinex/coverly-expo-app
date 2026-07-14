import { sanitizeReplacementSearchText } from "../_shared/description-sanitizer.ts";

export const PRICE_SEARCH_LIMITS = {
  query: 300,
  itemName: 200,
  category: 100,
  brand: 100,
  model: 120,
  additionalDetails: 400,
  preferredRetailer: 100,
  condition: 4,
  description: 500,
  barcode: 100,
  country: 3,
  itemId: 100,
  idempotencyKey: 200,
  maxPrice: 10_000_000,
} as const;

export interface PriceSearchRequest {
  itemName: string;
  description?: string;
  category?: string;
  brand?: string;
  model?: string;
  additionalDetails?: string;
  preferredRetailer?: string;
  condition?: "new" | "used";
  barcode?: string;
  country: string;
  minPrice?: number;
  maxPrice?: number;
  searchQuery?: string;
  num: number;
  itemId?: string;
  usageIdempotencyKey?: string;
}

export type PriceSearchValidation =
  | {
      ok: true;
      value: PriceSearchRequest;
      itemNameFallbackUsed: boolean;
      originalItemNamePresent: boolean;
    }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, maximum) : undefined;
}

function invalidTextField(value: unknown, maximum: number): boolean {
  return (
    value != null &&
    (typeof value !== "string" || value.trim().length > maximum)
  );
}

function optionalPrice(
  value: unknown,
  field: "minimum" | "maximum",
): { ok: true; value?: number } | { ok: false; error: string } {
  if (value == null) return { ok: true };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      ok: false,
      error: `${field === "minimum" ? "Minimum" : "Maximum"} price must be a number.`,
    };
  }
  if (value < 0 || (field === "maximum" && value === 0)) {
    return {
      ok: false,
      error: `${field === "minimum" ? "Minimum" : "Maximum"} price is outside the allowed range.`,
    };
  }
  if (value > PRICE_SEARCH_LIMITS.maxPrice) {
    return {
      ok: false,
      error: `${field === "minimum" ? "Minimum" : "Maximum"} price is too high.`,
    };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}

export function validatePriceSearchRequest(
  input: unknown,
): PriceSearchValidation {
  if (!isRecord(input))
    return { ok: false, error: "Request body must be an object." };

  if (invalidTextField(input.searchQuery, PRICE_SEARCH_LIMITS.query)) {
    return {
      ok: false,
      error: `Search term must be text no longer than ${PRICE_SEARCH_LIMITS.query} characters.`,
    };
  }
  if (invalidTextField(input.brand, PRICE_SEARCH_LIMITS.brand)) {
    return {
      ok: false,
      error: `Brand must be text no longer than ${PRICE_SEARCH_LIMITS.brand} characters.`,
    };
  }
  if (invalidTextField(input.model, PRICE_SEARCH_LIMITS.model)) {
    return {
      ok: false,
      error: `Model must be text no longer than ${PRICE_SEARCH_LIMITS.model} characters.`,
    };
  }
  if (
    invalidTextField(
      input.additionalDetails,
      PRICE_SEARCH_LIMITS.additionalDetails,
    )
  ) {
    return {
      ok: false,
      error: `Additional details must be text no longer than ${PRICE_SEARCH_LIMITS.additionalDetails} characters.`,
    };
  }
  if (
    invalidTextField(
      input.preferredRetailer,
      PRICE_SEARCH_LIMITS.preferredRetailer,
    )
  ) {
    return {
      ok: false,
      error: `Preferred retailer must be text no longer than ${PRICE_SEARCH_LIMITS.preferredRetailer} characters.`,
    };
  }
  if (
    input.condition != null &&
    input.condition !== "new" &&
    input.condition !== "used"
  ) {
    return { ok: false, error: "Condition must be new or used." };
  }
  const minPrice = optionalPrice(input.minPrice, "minimum");
  if (!minPrice.ok) return minPrice;
  const maxPrice = optionalPrice(input.maxPrice, "maximum");
  if (!maxPrice.ok) return maxPrice;
  if (
    minPrice.value != null &&
    maxPrice.value != null &&
    minPrice.value > maxPrice.value
  ) {
    return {
      ok: false,
      error: "Maximum price must be at least the minimum price.",
    };
  }

  const rawItemName = optionalText(
    sanitizeReplacementSearchText(
      typeof input.itemName === "string" ? input.itemName : undefined,
      PRICE_SEARCH_LIMITS.itemName,
    ),
    PRICE_SEARCH_LIMITS.itemName,
  );
  const searchQuery = optionalText(
    sanitizeReplacementSearchText(
      typeof input.searchQuery === "string" ? input.searchQuery : undefined,
      PRICE_SEARCH_LIMITS.query,
    ),
    PRICE_SEARCH_LIMITS.query,
  );
  const category = optionalText(input.category, PRICE_SEARCH_LIMITS.category);
  const itemName =
    rawItemName ?? searchQuery ?? (category ? `${category} item` : "item");
  const requestedNum =
    typeof input.num === "number" && Number.isFinite(input.num)
      ? Math.round(input.num)
      : 5;

  return {
    ok: true,
    itemNameFallbackUsed: !rawItemName,
    originalItemNamePresent: Boolean(rawItemName),
    value: {
      itemName: itemName.slice(0, PRICE_SEARCH_LIMITS.itemName),
      ...(optionalText(
        sanitizeReplacementSearchText(
          typeof input.description === "string" ? input.description : undefined,
          PRICE_SEARCH_LIMITS.description,
        ),
        PRICE_SEARCH_LIMITS.description,
      )
        ? {
            description: optionalText(
              sanitizeReplacementSearchText(
                typeof input.description === "string"
                  ? input.description
                  : undefined,
                PRICE_SEARCH_LIMITS.description,
              ),
              PRICE_SEARCH_LIMITS.description,
            ),
          }
        : {}),
      ...(category ? { category } : {}),
      ...(optionalText(input.brand, PRICE_SEARCH_LIMITS.brand)
        ? { brand: optionalText(input.brand, PRICE_SEARCH_LIMITS.brand) }
        : {}),
      ...(optionalText(input.model, PRICE_SEARCH_LIMITS.model)
        ? { model: optionalText(input.model, PRICE_SEARCH_LIMITS.model) }
        : {}),
      ...(optionalText(
        sanitizeReplacementSearchText(
          typeof input.additionalDetails === "string"
            ? input.additionalDetails
            : undefined,
          PRICE_SEARCH_LIMITS.additionalDetails,
        ),
        PRICE_SEARCH_LIMITS.additionalDetails,
      )
        ? {
            additionalDetails: optionalText(
              sanitizeReplacementSearchText(
                typeof input.additionalDetails === "string"
                  ? input.additionalDetails
                  : undefined,
                PRICE_SEARCH_LIMITS.additionalDetails,
              ),
              PRICE_SEARCH_LIMITS.additionalDetails,
            ),
          }
        : {}),
      ...(optionalText(
        input.preferredRetailer,
        PRICE_SEARCH_LIMITS.preferredRetailer,
      )
        ? {
            preferredRetailer: optionalText(
              input.preferredRetailer,
              PRICE_SEARCH_LIMITS.preferredRetailer,
            ),
          }
        : {}),
      ...(input.condition === "new" || input.condition === "used"
        ? { condition: input.condition }
        : {}),
      ...(optionalText(input.barcode, PRICE_SEARCH_LIMITS.barcode)
        ? { barcode: optionalText(input.barcode, PRICE_SEARCH_LIMITS.barcode) }
        : {}),
      country: (
        optionalText(input.country, PRICE_SEARCH_LIMITS.country) ?? "NZ"
      ).toUpperCase(),
      ...(minPrice.value != null ? { minPrice: minPrice.value } : {}),
      ...(maxPrice.value != null ? { maxPrice: maxPrice.value } : {}),
      ...(searchQuery ? { searchQuery } : {}),
      num: Math.min(Math.max(1, requestedNum), 10),
      ...(optionalText(input.itemId, PRICE_SEARCH_LIMITS.itemId)
        ? { itemId: optionalText(input.itemId, PRICE_SEARCH_LIMITS.itemId) }
        : {}),
      ...(optionalText(
        input.usageIdempotencyKey,
        PRICE_SEARCH_LIMITS.idempotencyKey,
      )
        ? {
            usageIdempotencyKey: optionalText(
              input.usageIdempotencyKey,
              PRICE_SEARCH_LIMITS.idempotencyKey,
            ),
          }
        : {}),
    },
  };
}

function normaliseForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function appendDistinct(parts: string[], candidate: string | undefined): void {
  if (!candidate) return;
  const normalisedCandidate = normaliseForComparison(candidate);
  if (!normalisedCandidate) return;
  const current = normaliseForComparison(parts.join(" "));
  if (current.includes(normalisedCandidate)) return;
  parts.push(candidate);
}

function priceIntent(minPrice?: number, maxPrice?: number): string {
  if (minPrice != null && maxPrice != null) return `$${minPrice}-$${maxPrice}`;
  if (minPrice != null) return `over $${minPrice}`;
  if (maxPrice != null) return `under $${maxPrice}`;
  return "";
}

function dedupeQueryWords(value: string): string {
  const seen = new Set<string>();
  return value
    .split(/\s+/)
    .map((word) => word.replace(/^[,.;:]+|[,.;:]+$/g, ""))
    .filter((word) => {
      const key = normaliseForComparison(word);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

function normaliseProductTypePhrases(value: string): string {
  return value
    .replace(/\bsubwoofer\s+speakers?\b/gi, "subwoofer")
    .replace(/\bspeakers?\s+subwoofer\b/gi, "subwoofer")
    .replace(/\bmonitor\s+riser\s+stand\b/gi, "monitor riser")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildReplacementExternalQuery(
  request: PriceSearchRequest,
): string {
  const parts: string[] = [];
  if (request.searchQuery) {
    appendDistinct(parts, request.brand);
    appendDistinct(parts, request.model);
    appendDistinct(parts, request.searchQuery);
    appendDistinct(parts, request.additionalDetails);
  } else {
    // Preserve the existing initial-search shape while allowing a supplied model
    // to sharpen older clients that do not send an explicit searchQuery.
    appendDistinct(parts, request.brand);
    appendDistinct(parts, request.model);
    appendDistinct(parts, request.itemName);
    if (request.category && request.category !== "General")
      appendDistinct(parts, request.category);
  }

  appendDistinct(
    parts,
    request.condition ? `${request.condition} only` : undefined,
  );
  appendDistinct(parts, request.country);
  appendDistinct(parts, request.preferredRetailer);

  const range = priceIntent(request.minPrice, request.maxPrice);
  const rangeAllowance = range ? range.length + 1 : 0;
  const base = dedupeQueryWords(normaliseProductTypePhrases(parts.join(" ")))
    .slice(0, PRICE_SEARCH_LIMITS.query - rangeAllowance)
    .trim();
  return `${base}${range ? ` ${range}` : ""}`.trim();
}

export function filterResultsToPriceRange<T extends { price: number | null }>(
  results: T[],
  minPrice?: number,
  maxPrice?: number,
): T[] {
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
