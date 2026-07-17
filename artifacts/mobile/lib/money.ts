import { resolveMarketConfig } from "../constants/market-config.ts";

const AMBIGUOUS_DOLLAR_SYMBOLS: Record<string, string> = {
  AUD: "A$", CAD: "CA$", HKD: "HK$", NZD: "NZ$", SGD: "S$", USD: "US$",
};

export interface FormatMoneyOptions {
  formal?: boolean;
  locale?: string;
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
  const locale = options.locale ?? "en";
  try {
    if (options.formal || options.showCode) {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "code",
      }).format(amount).replace(/\u00a0/g, " ");
    }
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    });
    const parts = formatter.formatToParts(amount);
    return parts.map((part) => part.type === "currency" ? (AMBIGUOUS_DOLLAR_SYMBOLS[currency] ?? part.value) : part.value).join("");
  } catch {
    return `${currency} ${amount.toLocaleString("en")}`;
  }
}

export function formatPropertyMoney(
  amount: number | null | undefined,
  countryCode: string | null | undefined,
  currencyCode: string | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  const market = resolveMarketConfig(countryCode ?? "NZ");
  const currency = isCurrencyCode(currencyCode) ? currencyCode : market?.currencyCode ?? "NZD";
  return formatMoney(amount, currency, { locale: options.locale ?? market?.locale, ...options });
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

export function formatCurrencyTotals(totals: Record<string, number>, formal = false): string {
  const entries = Object.entries(totals).filter(([, amount]) => Number.isFinite(amount));
  if (entries.length === 0) return "—";
  return entries.map(([currency, amount]) => formatMoney(amount, currency, { formal })).join(" · ");
}
