import { COUNTRY_CURRENCY_PAIRS } from "../constants/market-config.ts";

export type ReplacementPriceParseStatus = "value" | "empty" | "zero" | "invalid";

export interface ReplacementPriceParseResult {
  status: ReplacementPriceParseStatus;
  value: number | null;
}

const CURRENCY_SYMBOL = "[$£€¥₹₩₽₺₫₴₦₱฿₪₡₲₵₸₭₮₼₾₿]";
const PLAIN_DECIMAL = "(?:\\d+|\\d+\\.\\d+)";
const GROUPED_DECIMAL = "(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?)";
const COMPLETE_MONEY = new RegExp(`^(?:${CURRENCY_SYMBOL}\\s*)?(${GROUPED_DECIMAL}|${PLAIN_DECIMAL})(?:\\s*${CURRENCY_SYMBOL})?$`);
const SUPPORTED_CURRENCIES = new Set<string>(COUNTRY_CURRENCY_PAIRS.map(([, currencyCode]) => currencyCode));

/** Strictly parses a complete manual replacement-price input without salvaging substrings. */
export function parseReplacementPriceInput(input: string): ReplacementPriceParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { status: "empty", value: null };
  const match = COMPLETE_MONEY.exec(trimmed);
  if (!match) return { status: "invalid", value: null };
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) return { status: "invalid", value: null };
  if (value === 0) return { status: "zero", value: null };
  return { status: "value", value };
}

export function parseReplacementPrice(input: string): number | null {
  return parseReplacementPriceInput(input).value;
}

export function supportedCurrencyCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && SUPPORTED_CURRENCIES.has(normalized) ? normalized : null;
}

/** Stored value currency wins; property currency is fallback; NZD is historic compatibility only. */
export function resolveStoredValueCurrency(
  storedCurrency: string | null | undefined,
  propertyCurrency: string | null | undefined,
): string {
  return supportedCurrencyCode(storedCurrency) ?? supportedCurrencyCode(propertyCurrency) ?? "NZD";
}

/** An explicit reviewed voice currency wins, then the existing stored/property resolution. */
export function resolveReviewedValueCurrency(
  voiceCurrency: string | null | undefined,
  storedCurrency: string | null | undefined,
  propertyCurrency: string | null | undefined,
): string {
  return supportedCurrencyCode(voiceCurrency) ?? resolveStoredValueCurrency(storedCurrency, propertyCurrency);
}

export function resolveValueMarket(
  valueCurrency: string,
  storedCurrency: string | null | undefined,
  storedMarket: string | null | undefined,
  propertyCurrency: string | null | undefined,
  propertyCountry: string | null | undefined,
): string | null {
  const normalizedStoredMarket = storedMarket?.trim().toUpperCase();
  if (valueCurrency === supportedCurrencyCode(storedCurrency) && normalizedStoredMarket && /^[A-Z]{2}$/.test(normalizedStoredMarket)) {
    return normalizedStoredMarket;
  }
  const normalizedPropertyCountry = propertyCountry?.trim().toUpperCase();
  if (valueCurrency === supportedCurrencyCode(propertyCurrency) && normalizedPropertyCountry && /^[A-Z]{2}$/.test(normalizedPropertyCountry)) {
    return normalizedPropertyCountry;
  }
  return null;
}

export function buildManualScanValuePatch(
  input: string,
  quantity: number | null | undefined,
  property: { countryCode: string | null | undefined; currencyCode: string | null | undefined },
  estimatedAt = new Date().toISOString(),
): {
  status: ReplacementPriceParseStatus;
  patch: {
    unitEstimatedPrice: number | null;
    estimatedPrice: number | null;
    estimatedCurrency: string | null;
    valuationMarket: string | null;
    estimatedAt: string | null;
    priceSourceType: string | null;
    valuationBasis: string | null;
  };
} {
  const parsed = parseReplacementPriceInput(input);
  const currencyCode = supportedCurrencyCode(property.currencyCode);
  const countryCode = property.countryCode?.trim().toUpperCase();
  const validCountry = countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
  if (parsed.status !== "value" || !currencyCode || !validCountry) {
    return {
      status: parsed.status === "value" ? "invalid" : parsed.status,
      patch: {
        unitEstimatedPrice: null, estimatedPrice: null, estimatedCurrency: null,
        valuationMarket: null, estimatedAt: null, priceSourceType: null, valuationBasis: null,
      },
    };
  }
  const itemQuantity = Math.max(1, Math.trunc(quantity ?? 1));
  return {
    status: "value",
    patch: {
      unitEstimatedPrice: parsed.value,
      estimatedPrice: parsed.value! * itemQuantity,
      estimatedCurrency: currencyCode,
      valuationMarket: validCountry,
      estimatedAt,
      priceSourceType: "user_entered",
      valuationBasis: "manual",
    },
  };
}
