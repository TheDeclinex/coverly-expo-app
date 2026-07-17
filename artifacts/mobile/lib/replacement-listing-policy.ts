import { formatMoney, isCurrencyCode } from "./money.ts";
import type { ReplacementPriceResult } from "./replacement-pricing.ts";

export interface ReplacementListingCurrencyDecision {
  canUse: boolean;
  currencyCode: string | null;
  requiresForeignCurrencyConfirmation: boolean;
  source: "listing" | "search_context" | "unresolved";
  warning: string | null;
}

export interface ReplacementListingUpdate {
  estimated_price: number;
  unit_estimated_price: number;
  estimated_currency: string;
  valuation_market: string | null;
  estimated_at: string;
  price_source_type: "web_listing";
  valuation_basis: "replacement_listing";
  web_listing_url: string;
  web_listing_title: string;
  web_listing_price: number;
  web_listing_source: string;
  web_listing_match_type: ReplacementPriceResult["matchType"];
  web_listing_currency: string;
  web_listing_price_raw: string;
  web_listing_fulfilment_type: ReplacementPriceResult["fulfilmentType"];
}

function normalizedCurrency(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return isCurrencyCode(normalized) ? normalized : null;
}

function explicitCurrencyWarning(warnings: readonly string[]): string | null {
  return warnings.find((warning) =>
    /\b(?:ambiguous|conflicting|foreign currency|different currency)\b/i.test(warning)
      || /\blisted in [A-Z]{3}\b.*\bnot [A-Z]{3}\b/i.test(warning),
  ) ?? null;
}

export function resolveReplacementListingCurrency(
  result: ReplacementPriceResult,
  searchCurrency: string | null | undefined,
): ReplacementListingCurrencyDecision {
  const listingCurrency = normalizedCurrency(result.currencyCode);
  const contextCurrency = normalizedCurrency(searchCurrency);
  const hasUsablePrice = result.price != null && Number.isFinite(result.price) && result.price > 0;

  if (listingCurrency) {
    const conflictsWithContext = contextCurrency != null && listingCurrency !== contextCurrency;
    return {
      canUse: hasUsablePrice,
      currencyCode: listingCurrency,
      requiresForeignCurrencyConfirmation: conflictsWithContext,
      source: "listing",
      warning: conflictsWithContext
        ? result.warnings.find((warning) => /currency|conversion|listed in/i.test(warning))
          ?? `Listed in ${listingCurrency}, not ${contextCurrency}. No conversion is applied.`
        : null,
    };
  }

  const blockingWarning = explicitCurrencyWarning(result.warnings);
  if (blockingWarning || result.fulfilmentType === "overseas") {
    return {
      canUse: false,
      currencyCode: null,
      requiresForeignCurrencyConfirmation: false,
      source: "unresolved",
      warning: blockingWarning ?? result.warnings[0] ?? "The listing currency conflicts with the search market.",
    };
  }

  if (contextCurrency) {
    return {
      canUse: hasUsablePrice,
      currencyCode: contextCurrency,
      requiresForeignCurrencyConfirmation: false,
      source: "search_context",
      warning: null,
    };
  }

  return {
    canUse: false,
    currencyCode: null,
    requiresForeignCurrencyConfirmation: false,
    source: "unresolved",
    warning: hasUsablePrice
      ? "Currency unconfirmed. Open the listing and review the raw retailer price."
      : null,
  };
}

export function formatReplacementListingPrice(
  result: ReplacementPriceResult,
  searchCurrency: string | null | undefined,
): string {
  const decision = resolveReplacementListingCurrency(result, searchCurrency);
  if (result.price != null && decision.currencyCode) {
    return formatMoney(result.price, decision.currencyCode, {
      contextCurrency: searchCurrency,
      precision: "listing",
    });
  }
  return result.priceRaw || (result.price != null ? String(result.price) : "Price unavailable");
}

export function buildReplacementListingUpdate(
  result: ReplacementPriceResult,
  currencyCode: string,
  options: {
    quantity?: number | null;
    marketCountryCode?: string | null;
    estimatedAt?: string;
  } = {},
): ReplacementListingUpdate | null {
  const currency = normalizedCurrency(currencyCode);
  const country = options.marketCountryCode?.trim().toUpperCase() ?? null;
  if (
    result.price == null
    || !Number.isFinite(result.price)
    || result.price <= 0
    || !currency
    || (country != null && !/^[A-Z]{2}$/.test(country))
  ) {
    return null;
  }

  const quantity = Number.isFinite(options.quantity) && (options.quantity ?? 0) > 0
    ? Math.max(1, options.quantity ?? 1)
    : 1;

  return {
    estimated_price: result.price * quantity,
    unit_estimated_price: result.price,
    estimated_currency: currency,
    valuation_market: country,
    estimated_at: options.estimatedAt ?? new Date().toISOString(),
    price_source_type: "web_listing",
    valuation_basis: "replacement_listing",
    web_listing_url: result.link,
    web_listing_title: result.title,
    web_listing_price: result.price,
    web_listing_source: result.source,
    web_listing_match_type: result.matchType,
    web_listing_currency: currency,
    web_listing_price_raw: result.priceRaw,
    web_listing_fulfilment_type: result.fulfilmentType,
  };
}
