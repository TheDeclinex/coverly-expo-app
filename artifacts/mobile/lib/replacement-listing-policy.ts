import { formatMoney, isCurrencyCode } from "./money.ts";
import type { ReplacementPriceResult } from "./replacement-pricing.ts";

export interface ReplacementListingCurrencyDecision {
  canUse: boolean;
  currencyCode: string | null;
  requiresForeignCurrencyConfirmation: boolean;
  source: "listing" | "search_context" | "unresolved";
  warning: string | null;
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
