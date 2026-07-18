export interface RefinementPricedResult {
  price: number | null;
  currencyCode: string | null;
  priceRaw?: string;
}

export type ReplacementRangeCandidateReason =
  | 'inside_range'
  | 'below_range'
  | 'above_range'
  | 'foreign_currency'
  | 'unknown_currency'
  | 'invalid_price'
  | 'unpriced';

export function hasReplacementPriceRange(minimumPrice?: number, maximumPrice?: number): boolean {
  return minimumPrice != null || maximumPrice != null;
}

export function isAuthoritativeReplacementPriceRangeActive(
  refinementVersion: unknown,
  minimumPrice?: number,
  maximumPrice?: number,
): boolean {
  return refinementVersion === 2 && hasReplacementPriceRange(minimumPrice, maximumPrice);
}

export function applyAuthoritativeReplacementPriceRange<T extends RefinementPricedResult>(
  results: readonly T[],
  propertyCurrencyCode: string,
  minimumPrice: number | undefined,
  maximumPrice: number | undefined,
  limit: number,
): T[] {
  if (!hasReplacementPriceRange(minimumPrice, maximumPrice)) return results.slice(0, limit);
  return results.filter((result) => classifyReplacementRangeCandidate(
    result,
    propertyCurrencyCode,
    minimumPrice,
    maximumPrice,
  ) === 'inside_range').slice(0, limit);
}

export function classifyReplacementRangeCandidate(
  result: RefinementPricedResult,
  propertyCurrencyCode: string,
  minimumPrice?: number,
  maximumPrice?: number,
): ReplacementRangeCandidateReason {
  if (result.price == null) return result.priceRaw?.trim() ? 'invalid_price' : 'unpriced';
  if (!Number.isFinite(result.price) || result.price <= 0) return 'invalid_price';
  if (result.currencyCode == null) return 'unknown_currency';
  if (result.currencyCode !== propertyCurrencyCode) return 'foreign_currency';
  if (minimumPrice != null && result.price < minimumPrice) return 'below_range';
  if (maximumPrice != null && result.price > maximumPrice) return 'above_range';
  return 'inside_range';
}
