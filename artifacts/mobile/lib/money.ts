import { resolveMarketConfig } from "../constants/market-config.ts";

export type MoneyDisplayMode = "compact" | "explicit" | "formal";
export type MoneyPrecisionMode = "summary" | "value" | "listing" | "formal";

const COMPACT_SYMBOLS: Record<string, string> = {
  AUD: "$", CAD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥",
  KRW: "₩", NZD: "$", USD: "$",
};

const EXPLICIT_SYMBOLS: Record<string, string> = {
  AUD: "A$", CAD: "CA$", EUR: "€", GBP: "£", HKD: "HK$", INR: "₹",
  JPY: "¥", KRW: "₩", NZD: "NZ$", SGD: "S$", USD: "US$",
};
export interface FormatMoneyOptions {
  contextCurrency?: string | null;
  formal?: boolean;
  locale?: string;
  mode?: MoneyDisplayMode;
  precision?: MoneyPrecisionMode;
  showCode?: boolean;
}

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value.trim().toUpperCase());
}

function normalizeMoneySpacing(value: string): string {
  return value.replace(/\u00a0/g, " ");
}

export function currencyFractionDigits(currencyCode: string, locale = "en"): { minimum: number; maximum: number } {
  const currency = currencyCode.trim().toUpperCase();
  const fallback = currency === "JPY" || currency === "KRW" ? 0 : 2;
  try {
    const resolved = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions();
    return {
      minimum: resolved.minimumFractionDigits ?? fallback,
      maximum: resolved.maximumFractionDigits ?? fallback,
    };
  } catch {
    return { minimum: fallback, maximum: fallback };
  }
}

export function formatMoneyInputValue(
  amount: number,
  currencyCode: string,
  locale = "en",
): string {
  if (!Number.isFinite(amount)) return "";
  const currency = currencyCode.trim().toUpperCase();
  if (!isCurrencyCode(currency)) return "";
  const digits = currencyFractionDigits(currency, locale);
  return new Intl.NumberFormat(locale, {
    useGrouping: true,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : digits.minimum,
    maximumFractionDigits: digits.maximum,
  }).format(amount);
}

function fractionDigitOptions(
  amount: number,
  currency: string,
  locale: string,
  precision: MoneyPrecisionMode,
): Pick<Intl.NumberFormatOptions, "minimumFractionDigits" | "maximumFractionDigits"> {
  if (precision === "summary") {
    return { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  }

  const defaults = currencyFractionDigits(currency, locale);
  if (precision === "formal") {
    return {
      minimumFractionDigits: defaults.minimum,
      maximumFractionDigits: defaults.maximum,
    };
  }

  return {
    minimumFractionDigits: precision === "listing" || Number.isInteger(amount) ? 0 : defaults.minimum,
    maximumFractionDigits: defaults.maximum,
  };
}

function formatSymbolWithoutParts(
  amount: number,
  locale: string,
  token: string,
  currencyOptions: Intl.NumberFormatOptions,
  currencyFormatter: Intl.NumberFormat,
): string {
  const resolved = currencyFormatter.resolvedOptions();
  const decimalOptions: Intl.NumberFormatOptions = {
    numberingSystem: resolved.numberingSystem,
    useGrouping: resolved.useGrouping,
    minimumFractionDigits: resolved.minimumFractionDigits,
    maximumFractionDigits: resolved.maximumFractionDigits,
  };
  const decimalFormatter = new Intl.NumberFormat(locale, decimalOptions);
  const formattedAmount = decimalFormatter.format(Math.abs(amount));
  const placementSample = 1234.5;
  const formattedSample = decimalFormatter.format(placementSample);
  const codeSample = new Intl.NumberFormat(locale, {
    ...currencyOptions,
    currencyDisplay: "code",
  }).format(placementSample);
  const numberPosition = codeSample.indexOf(formattedSample);
  const tokenFirst = numberPosition > 0 || numberPosition === -1;
  const sign = amount < 0 ? "-" : "";
  return tokenFirst
    ? `${sign}${token}${formattedAmount}`
    : `${sign}${formattedAmount} ${token}`;
}

function manualMoneyFallback(
  amount: number,
  currency: string,
  locale: string,
  token: string,
  fractionOptions: Pick<Intl.NumberFormatOptions, "minimumFractionDigits" | "maximumFractionDigits">,
): string {
  const formattedAmount = Math.abs(amount).toLocaleString(locale, {
    minimumFractionDigits: fractionOptions.minimumFractionDigits,
    maximumFractionDigits: fractionOptions.maximumFractionDigits,
  });
  const sign = amount < 0 ? "-" : "";
  return token === currency
    ? `${sign}${currency} ${formattedAmount}`
    : `${sign}${token}${formattedAmount}`;
}

export function formatMoney(
  amount: number | null | undefined,
  currencyCode: string,
  options: FormatMoneyOptions = {},
): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const currency = currencyCode.trim().toUpperCase();
  if (!isCurrencyCode(currency)) return "—";
  const contextCurrency = isCurrencyCode(options.contextCurrency) ? options.contextCurrency.trim().toUpperCase() : null;
  const mode: MoneyDisplayMode = options.formal || options.showCode
    ? "formal"
    : options.mode ?? (contextCurrency ? (currency === contextCurrency ? "compact" : "explicit") : "explicit");
  const locale = options.locale ?? "en";
  const precision = options.precision ?? (mode === "formal" ? "formal" : "value");
  const token = mode === "formal"
    ? currency
    : mode === "compact"
      ? COMPACT_SYMBOLS[currency] ?? currency
      : EXPLICIT_SYMBOLS[currency] ?? currency;
  const useCodeSpacing = token === currency;
  const fractionOptions = fractionDigitOptions(amount, currency, locale, precision);
  const formatOptions: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    currencyDisplay: useCodeSpacing ? "code" : "narrowSymbol",
    ...fractionOptions,
  };
  try {
    let formatter: Intl.NumberFormat;
    try {
      formatter = new Intl.NumberFormat(locale, formatOptions);
    } catch {
      formatter = new Intl.NumberFormat(locale, {
        ...formatOptions,
        currencyDisplay: useCodeSpacing ? "code" : "symbol",
      });
    }

    if (typeof formatter.formatToParts === "function") {
      try {
        const parts = formatter.formatToParts(amount);
        return normalizeMoneySpacing(
          parts.map((part) => part.type === "currency" ? token : part.value).join(""),
        );
      } catch {
        // Hermes on Apple does not expose NumberFormat#formatToParts.
      }
    }

    if (useCodeSpacing) return normalizeMoneySpacing(formatter.format(amount));
    return normalizeMoneySpacing(
      formatSymbolWithoutParts(amount, locale, token, formatOptions, formatter),
    );
  } catch {
    // Fall through to a symbol-aware last resort for limited Intl runtimes.
  }
  return manualMoneyFallback(
    amount,
    currency,
    locale,
    token,
    fractionOptions,
  );
}

export function moneyDisplayToken(
  currencyCode: string,
  contextCurrency: string | null | undefined = currencyCode,
): string {
  const currency = currencyCode.trim().toUpperCase();
  if (!isCurrencyCode(currency)) return currencyCode;
  const context = isCurrencyCode(contextCurrency) ? contextCurrency.trim().toUpperCase() : null;
  return context && context !== currency
    ? EXPLICIT_SYMBOLS[currency] ?? currency
    : COMPACT_SYMBOLS[currency] ?? currency;
}

export function formatPropertyMoney(
  amount: number | null | undefined,
  countryCode: string | null | undefined,
  currencyCode: string | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  const market = resolveMarketConfig(countryCode ?? "NZ");
  const currency = isCurrencyCode(currencyCode) ? currencyCode : market?.currencyCode ?? "NZD";
  return formatMoney(amount, currency, {
    contextCurrency: options.contextCurrency ?? currency,
    locale: options.locale ?? market?.locale,
    ...options,
  });
}

export function groupAmountsByCurrency<T>(
  values: readonly T[],
  amountFor: (value: T) => number,
  currencyFor: (value: T) => string | null | undefined,
): Record<string, number> {
  return values.reduce<Record<string, number>>((totals, value) => {
    const currency = currencyFor(value)?.trim().toUpperCase();
    const amount = amountFor(value);
    if (!isCurrencyCode(currency) || !Number.isFinite(amount)) return totals;
    totals[currency] = (totals[currency] ?? 0) + amount;
    return totals;
  }, {});
}

export function formatCurrencyTotals(
  totals: Record<string, number>,
  options: boolean | { contextCurrency?: string | null; formal?: boolean; precision?: MoneyPrecisionMode } = {},
): string {
  const entries = Object.entries(totals).filter(([, amount]) => Number.isFinite(amount));
  if (entries.length === 0) return "—";
  const normalizedOptions = typeof options === "boolean" ? { formal: options } : options;
  const mixed = entries.length > 1;
  return entries.map(([currency, amount]) => formatMoney(amount, currency, {
    contextCurrency: mixed ? null : normalizedOptions.contextCurrency,
    mode: normalizedOptions.formal ? "formal" : mixed ? "explicit" : undefined,
    precision: normalizedOptions.precision ?? "summary",
  })).join(" · ");
}
