import { resolveMarketConfig } from "../constants/market-config.ts";

export type MoneyDisplayMode = "compact" | "explicit" | "formal";

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
  showCode?: boolean;
}

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value.trim().toUpperCase());
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
  try {
    const token = mode === "formal"
      ? currency
      : mode === "compact"
        ? COMPACT_SYMBOLS[currency] ?? currency
        : EXPLICIT_SYMBOLS[currency] ?? currency;
    const useCodeSpacing = token === currency;
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: useCodeSpacing ? "code" : "narrowSymbol",
      ...(mode !== "formal" && Number.isInteger(amount) ? { minimumFractionDigits: 0 } : {}),
    });
    const parts = formatter.formatToParts(amount);
    return parts.map((part) => part.type === "currency" ? token : part.value).join("").replace(/\u00a0/g, " ");
  } catch {
    return `${currency} ${amount.toLocaleString("en")}`;
  }
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
  options: boolean | { contextCurrency?: string | null; formal?: boolean } = {},
): string {
  const entries = Object.entries(totals).filter(([, amount]) => Number.isFinite(amount));
  if (entries.length === 0) return "—";
  const normalizedOptions = typeof options === "boolean" ? { formal: options } : options;
  const mixed = entries.length > 1;
  return entries.map(([currency, amount]) => formatMoney(amount, currency, {
    contextCurrency: mixed ? null : normalizedOptions.contextCurrency,
    mode: normalizedOptions.formal ? "formal" : mixed ? "explicit" : undefined,
  })).join(" · ");
}
