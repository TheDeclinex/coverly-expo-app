export interface RefinementPricedResult {
  price: number | null;
  currencyCode: string | null;
}

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
  return results.filter((result) => {
    if (result.price == null || !Number.isFinite(result.price) || result.price <= 0) return false;
    if (result.currencyCode !== propertyCurrencyCode) return false;
    if (minimumPrice != null && result.price < minimumPrice) return false;
    if (maximumPrice != null && result.price > maximumPrice) return false;
    return true;
  }).slice(0, limit);
}
