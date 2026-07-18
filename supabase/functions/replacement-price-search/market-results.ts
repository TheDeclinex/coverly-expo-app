import { COUNTRY_CURRENCY_PAIRS, type MarketConfig } from '../_shared/market-config.ts';

export interface MarketPriceResultLike {
  price: number | null;
  currencyCode: string | null;
}

const COMPLETE_PROVIDER_NUMBER = /^(?:\d+|\d+\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/;

/** Extracts one complete positive provider price token while retaining descriptive text support. */
export function parseProviderPrice(rawPriceText: string | null | undefined): number | null {
  if (!rawPriceText?.trim()) return null;
  if (/-\s*(?:[A-Za-z]{2,3}\s*)?[$£€¥]?\s*\d/.test(rawPriceText)) return null;
  const candidates = [...rawPriceText.matchAll(/(?:^|[^A-Za-z0-9])([-+]?\d[\d,]*(?:\.\d+)*(?:[eE][+-]?\d+)?)(?=$|[^A-Za-z0-9])/g)]
    .map((match) => match[1]);
  if (candidates.length !== 1 || !COMPLETE_PROVIDER_NUMBER.test(candidates[0])) return null;
  const value = Number(candidates[0].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const DOLLAR_CURRENCIES = new Set([
  'AUD', 'BBD', 'BMD', 'BND', 'BSD', 'BZD', 'CAD', 'FJD', 'GYD', 'HKD',
  'JMD', 'KYD', 'LRD', 'MXN', 'NAD', 'NZD', 'SBD', 'SGD', 'SRD', 'TTD',
  'TWD', 'USD', 'XCD', 'ZWL',
]);
const CONFIGURED_COUNTRIES = new Set<string>(COUNTRY_CURRENCY_PAIRS.map(([countryCode]) => countryCode));
const CONFIGURED_CURRENCIES = new Set<string>(COUNTRY_CURRENCY_PAIRS.map(([, currencyCode]) => currencyCode));
const AMBIGUOUS_WORD_CODES = new Set(['ALL', 'TRY']);
type ConfiguredCountryCode = (typeof COUNTRY_CURRENCY_PAIRS)[number][0];

/** Generic-domain retailers whose primary operating market is sufficiently clear. */
export const KNOWN_RETAILER_COUNTRY_BY_DOMAIN = {
  'boulanger.com': 'FR',
  'cdiscount.com': 'FR',
  'cultura.com': 'FR',
} as const satisfies Record<string, ConfiguredCountryCode>;

const EXPLICIT_DOLLAR_PREFIXES: Array<[RegExp, string]> = [
  [/\bNZ\s?\$/i, 'NZD'], [/\bAU\s?\$|\bA\$/i, 'AUD'],
  [/\bUS\s?\$/i, 'USD'], [/\bCA\s?\$|\bC\$/i, 'CAD'],
  [/\bSG\s?\$/i, 'SGD'], [/\bHK\s?\$/i, 'HKD'], [/\bMX\s?\$/i, 'MXN'],
];

export function countryCodeFromRetailerLink(link: string): string | null {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/\.$/, '');
    for (const [domain, countryCode] of Object.entries(KNOWN_RETAILER_COUNTRY_BY_DOMAIN)) {
      if (host === domain || host.endsWith(`.${domain}`)) return countryCode;
    }
    if (host.endsWith('.uk')) return 'GB';
    const suffix = host.match(/\.([a-z]{2})$/)?.[1];
    const countryCode = suffix?.toUpperCase();
    return countryCode && CONFIGURED_COUNTRIES.has(countryCode) ? countryCode : null;
  } catch {
    return null;
  }
}

export interface RetailerMarketClassification {
  retailerCountryCode: string | null;
  fulfilmentType: 'local' | 'overseas' | 'unknown';
  warnings: string[];
}

export function classifyRetailerMarket(
  link: string,
  currencyCode: string | null,
  market: MarketConfig,
): RetailerMarketClassification {
  const retailerCountryCode = countryCodeFromRetailerLink(link);
  const localRetailerMarket = retailerCountryCode === market.countryCode;
  const foreignRetailerMarket = retailerCountryCode != null
    && retailerCountryCode !== market.countryCode;
  const foreignCurrency = currencyCode != null && currencyCode !== market.currencyCode;

  if (foreignCurrency) {
    return {
      retailerCountryCode,
      fulfilmentType: 'overseas',
      warnings: [`Listed in ${currencyCode}, not ${market.currencyCode}. No conversion is applied.`],
    };
  }
  if (foreignRetailerMarket) {
    return {
      retailerCountryCode,
      fulfilmentType: 'overseas',
      warnings: [`Retailer market ${retailerCountryCode} differs from the property market ${market.countryCode}.`],
    };
  }
  if (localRetailerMarket && currencyCode === market.currencyCode) {
    return { retailerCountryCode: market.countryCode, fulfilmentType: 'local', warnings: [] };
  }
  if (localRetailerMarket) {
    return {
      retailerCountryCode: market.countryCode,
      fulfilmentType: 'local',
      warnings: ['The listing currency could not be confirmed. Review the raw retailer price before using it.'],
    };
  }
  return {
    retailerCountryCode: null,
    fulfilmentType: 'unknown',
    warnings: ['Retailer location could not be confirmed.'],
  };
}

export function detectResultCurrency(
  rawPriceText: string,
  market: MarketConfig,
  evidence?: { retailerLink?: string | null; retailerCountryCode?: string | null; providerCurrencyCode?: string | null },
): string | null {
  const upper = rawPriceText.toUpperCase();
  const providerCurrency = evidence?.providerCurrencyCode?.trim().toUpperCase();
  if (providerCurrency && CONFIGURED_CURRENCIES.has(providerCurrency)) return providerCurrency;
  const codeBefore = upper.match(/(?:^|[^A-Z])([A-Z]{3})\s*([$£€¥]?)\s*(?=\d)/)?.slice(1) as [string, string] | undefined;
  const codeAfter = upper.match(/\d(?:[\d,.]*\d)?\s+([A-Z]{3})(?:$|[^A-Z])/)?.[1];
  if (codeBefore && CONFIGURED_CURRENCIES.has(codeBefore[0]) && !AMBIGUOUS_WORD_CODES.has(codeBefore[0])) {
    const [currencyCode, symbol] = codeBefore;
    const symbolMatches = !symbol
      || (symbol === '$' && DOLLAR_CURRENCIES.has(currencyCode))
      || (symbol === '£' && currencyCode === 'GBP')
      || (symbol === '€' && currencyCode === 'EUR')
      || (symbol === '¥' && (currencyCode === 'JPY' || currencyCode === 'CNY'));
    if (symbolMatches) return currencyCode;
  }
  if (codeAfter && CONFIGURED_CURRENCIES.has(codeAfter)) return codeAfter;
  for (const [pattern, currencyCode] of EXPLICIT_DOLLAR_PREFIXES) {
    if (pattern.test(rawPriceText)) return currencyCode;
  }
  if (/£/.test(rawPriceText)) return 'GBP';
  if (/€/.test(rawPriceText)) return 'EUR';
  if (/CHF/i.test(rawPriceText)) return 'CHF';
  if (/[¥￥]/.test(rawPriceText)) return market.currencyCode === 'CNY' ? 'CNY' : 'JPY';
  if (!/\$/.test(rawPriceText)) return null;

  const retailerCountryCode = evidence?.retailerCountryCode?.toUpperCase()
    ?? countryCodeFromRetailerLink(evidence?.retailerLink ?? '');
  return retailerCountryCode === market.countryCode && DOLLAR_CURRENCIES.has(market.currencyCode)
    ? market.currencyCode
    : null;
}

export function confirmedPropertyCurrencyStats(
  results: MarketPriceResultLike[],
  propertyCurrencyCode: string,
): { low: number; median: number; high: number } | null {
  const valid = results
    .filter((result) => result.currencyCode === propertyCurrencyCode)
    .map((result) => result.price)
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  const median = valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
  return { low: valid[0], median: Math.round(median * 100) / 100, high: valid[valid.length - 1] };
}
