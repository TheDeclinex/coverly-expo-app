import { COUNTRY_CURRENCY_PAIRS, type MarketConfig } from '../_shared/market-config.ts';

export interface MarketPriceResultLike {
  price: number | null;
  currencyCode: string | null;
}

export interface ProviderShoppingResultEvidence {
  price?: unknown;
  link?: unknown;
  source?: unknown;
  country?: unknown;
  countryCode?: unknown;
  currency?: unknown;
  currencyCode?: unknown;
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

/** Exact retailer labels that identify one primary configured market. */
export const KNOWN_RETAILER_COUNTRY_BY_SOURCE = {
  'noel leeming': 'NZ',
  'smiths city': 'NZ',
  'heathcotes': 'NZ',
  'the warehouse': 'NZ',
  'the good guys': 'AU',
  'best buy': 'US',
  'canadian tire': 'CA',
} as const satisfies Record<string, ConfiguredCountryCode>;

const EXPLICIT_DOLLAR_PREFIXES: Array<[RegExp, string]> = [
  [/\bNZ\s?\$/i, 'NZD'], [/\bAU\s?\$|\bA\$/i, 'AUD'],
  [/\bUS\s?\$/i, 'USD'], [/\bCA\s?\$|\bC\$/i, 'CAD'],
  [/\bSG\s?\$/i, 'SGD'], [/\bHK\s?\$/i, 'HKD'], [/\bMX\s?\$/i, 'MXN'],
];

export function countryCodeFromRetailerLink(link: string): string | null {
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    for (const [domain, countryCode] of Object.entries(KNOWN_RETAILER_COUNTRY_BY_DOMAIN)) {
      if (host === domain || host.endsWith(`.${domain}`)) return countryCode;
    }
    if (host.endsWith('.uk')) return 'GB';
    const suffix = host.match(/\.([a-z]{2})$/)?.[1];
    const countryCode = suffix?.toUpperCase();
    if (countryCode && CONFIGURED_COUNTRIES.has(countryCode)) return countryCode;
    for (const key of ['country', 'countryCode', 'country_code']) {
      const explicitCountry = url.searchParams.get(key)?.trim().toUpperCase();
      if (explicitCountry && CONFIGURED_COUNTRIES.has(explicitCountry)) return explicitCountry;
    }
    return null;
  } catch {
    return null;
  }
}

export function countryCodeFromRetailerSource(source: string): string | null {
  const normalized = source.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
  if (!normalized) return null;
  const known = KNOWN_RETAILER_COUNTRY_BY_SOURCE[normalized as keyof typeof KNOWN_RETAILER_COUNTRY_BY_SOURCE];
  if (known) return known;
  if (/\b(?:new zealand|aotearoa)\b/i.test(normalized)) return 'NZ';
  if (/\baustralia\b/i.test(normalized)) return 'AU';
  if (/\bcanada\b/i.test(normalized)) return 'CA';
  if (/\bunited states\b/i.test(normalized)) return 'US';
  return null;
}

function configuredCode(value: unknown, configured: Set<string>): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return configured.has(normalized) ? normalized : null;
}

function currencyCodeFromRetailerLink(link: string): string | null {
  try {
    const url = new URL(link);
    for (const key of ['currency', 'currencyCode', 'currency_code']) {
      const currencyCode = configuredCode(url.searchParams.get(key), CONFIGURED_CURRENCIES);
      if (currencyCode) return currencyCode;
    }
  } catch {
    // An invalid link supplies no evidence.
  }
  return null;
}

export function providerShoppingResultEvidence(result: ProviderShoppingResultEvidence): {
  retailerCountryCode: string | null;
  providerCurrencyCode: string | null;
} {
  const link = typeof result.link === 'string' ? result.link : '';
  const source = typeof result.source === 'string' ? result.source : '';
  return {
    retailerCountryCode: configuredCode(result.countryCode, CONFIGURED_COUNTRIES)
      ?? configuredCode(result.country, CONFIGURED_COUNTRIES)
      ?? countryCodeFromRetailerLink(link)
      ?? countryCodeFromRetailerSource(source),
    providerCurrencyCode: configuredCode(result.currencyCode, CONFIGURED_CURRENCIES)
      ?? configuredCode(result.currency, CONFIGURED_CURRENCIES)
      ?? currencyCodeFromRetailerLink(link),
  };
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
  retailerCountryCodeEvidence?: string | null,
): RetailerMarketClassification {
  const retailerCountryCode = configuredCode(retailerCountryCodeEvidence, CONFIGURED_COUNTRIES)
    ?? countryCodeFromRetailerLink(link);
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
  const providerCurrency = evidence?.providerCurrencyCode?.trim().toUpperCase();
  if (providerCurrency && CONFIGURED_CURRENCIES.has(providerCurrency)) return providerCurrency;
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
