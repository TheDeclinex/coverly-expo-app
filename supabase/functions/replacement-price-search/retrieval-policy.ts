import type {
  QualifiedReplacementResult,
  ReplacementResultQualityContext,
} from "./result-quality.ts";

export type ReplacementProviderStrategy =
  | "parallel_broad_search"
  | "shopping_then_exact_model_check";

export interface ReplacementProviderPlan {
  strategy: ReplacementProviderStrategy;
  requestShopping: true;
  requestOrganicInParallel: boolean;
}

export interface ExactModelCoverage {
  adequate: boolean;
  requiredPricedExactOffers: number;
  requiredDistinctRetailers: number;
  pricedExactOfferCount: number;
  distinctRetailerCount: number;
}

const REQUIRED_PRICED_EXACT_OFFERS = 2;
const REQUIRED_DISTINCT_RETAILERS = 2;

function normalise(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function retailerIdentity(result: QualifiedReplacementResult): string {
  const source = normalise(result.source);
  if (source && source !== "unknown retailer" && source !== "unknown") {
    return source;
  }
  try {
    return new URL(result.link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return normalise(result.link);
  }
}

export function planReplacementProviders(
  context: ReplacementResultQualityContext,
): ReplacementProviderPlan {
  if (context.model?.trim()) {
    return {
      strategy: "shopping_then_exact_model_check",
      requestShopping: true,
      requestOrganicInParallel: false,
    };
  }
  return {
    strategy: "parallel_broad_search",
    requestShopping: true,
    requestOrganicInParallel: true,
  };
}

export function evaluateExactModelShoppingCoverage(
  shoppingResults: QualifiedReplacementResult[],
  context: ReplacementResultQualityContext,
): ExactModelCoverage {
  const pricedExactOffers = context.model?.trim()
    ? shoppingResults.filter(
        (result) =>
          result.matchType === "best_match" &&
          result.price != null &&
          Number.isFinite(result.price) &&
          result.price > 0,
      )
    : [];
  const retailers = new Set(
    pricedExactOffers.map(retailerIdentity).filter(Boolean),
  );
  return {
    adequate:
      pricedExactOffers.length >= REQUIRED_PRICED_EXACT_OFFERS &&
      retailers.size >= REQUIRED_DISTINCT_RETAILERS,
    requiredPricedExactOffers: REQUIRED_PRICED_EXACT_OFFERS,
    requiredDistinctRetailers: REQUIRED_DISTINCT_RETAILERS,
    pricedExactOfferCount: pricedExactOffers.length,
    distinctRetailerCount: retailers.size,
  };
}
