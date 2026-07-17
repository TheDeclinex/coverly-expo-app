import { COUNTRY_NAME_BY_CODE } from "./country-names.ts";

export type PricingSupportTier = "verified" | "preview" | "limited";

export interface MarketConfig {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  locale: string;
  searchLanguage: string;
  serperGl: string | null;
  serperHl: string;
  pricingSupportTier: PricingSupportTier;
  aiEstimatesEnabled: boolean;
  replacementSearchEnabled: boolean;
  materialItemThreshold: number | null;
}

// Generated mobile representation. Keep in parity with the authoritative Edge
// configuration; market-config.test.ts fails if country/currency pairs diverge.
export const COUNTRY_CURRENCY_PAIRS = [
  ['AD','EUR'],['AE','AED'],['AF','AFN'],['AG','XCD'],['AI','XCD'],['AL','ALL'],['AM','AMD'],['AO','AOA'],['AQ','USD'],['AR','ARS'],['AS','USD'],['AT','EUR'],['AU','AUD'],['AW','AWG'],['AX','EUR'],['AZ','AZN'],['BA','BAM'],['BB','BBD'],['BD','BDT'],['BE','EUR'],['BF','XOF'],['BG','BGN'],['BH','BHD'],['BI','BIF'],['BJ','XOF'],['BL','EUR'],['BM','BMD'],['BN','BND'],['BO','BOB'],['BQ','USD'],['BR','BRL'],['BS','BSD'],['BT','BTN'],['BV','NOK'],['BW','BWP'],['BY','BYN'],['BZ','BZD'],['CA','CAD'],['CC','AUD'],['CD','CDF'],['CF','XAF'],['CG','XAF'],['CH','CHF'],['CI','XOF'],['CK','NZD'],['CL','CLP'],['CM','XAF'],['CN','CNY'],['CO','COP'],['CR','CRC'],['CU','CUP'],['CV','CVE'],['CW','ANG'],['CX','AUD'],['CY','EUR'],['CZ','CZK'],['DE','EUR'],['DJ','DJF'],['DK','DKK'],['DM','XCD'],['DO','DOP'],['DZ','DZD'],['EC','USD'],['EE','EUR'],['EG','EGP'],['EH','MAD'],['ER','ERN'],['ES','EUR'],['ET','ETB'],['FI','EUR'],['FJ','FJD'],['FK','FKP'],['FM','USD'],['FO','DKK'],['FR','EUR'],['GA','XAF'],['GB','GBP'],['GD','XCD'],['GE','GEL'],['GF','EUR'],['GG','GBP'],['GH','GHS'],['GI','GIP'],['GL','DKK'],['GM','GMD'],['GN','GNF'],['GP','EUR'],['GQ','XAF'],['GR','EUR'],['GS','GBP'],['GT','GTQ'],['GU','USD'],['GW','XOF'],['GY','GYD'],['HK','HKD'],['HM','AUD'],['HN','HNL'],['HR','EUR'],['HT','HTG'],['HU','HUF'],['ID','IDR'],['IE','EUR'],['IL','ILS'],['IM','GBP'],['IN','INR'],['IO','USD'],['IQ','IQD'],['IR','IRR'],['IS','ISK'],['IT','EUR'],['JE','GBP'],['JM','JMD'],['JO','JOD'],['JP','JPY'],['KE','KES'],['KG','KGS'],['KH','KHR'],['KI','AUD'],['KM','KMF'],['KN','XCD'],['KP','KPW'],['KR','KRW'],['KW','KWD'],['KY','KYD'],['KZ','KZT'],['LA','LAK'],['LB','LBP'],['LC','XCD'],['LI','CHF'],['LK','LKR'],['LR','LRD'],['LS','ZAR'],['LT','EUR'],['LU','EUR'],['LV','EUR'],['LY','LYD'],['MA','MAD'],['MC','EUR'],['MD','MDL'],['ME','EUR'],['MF','EUR'],['MG','MGA'],['MH','USD'],['MK','MKD'],['ML','XOF'],['MM','MMK'],['MN','MNT'],['MO','MOP'],['MP','USD'],['MQ','EUR'],['MR','MRU'],['MS','XCD'],['MT','EUR'],['MU','MUR'],['MV','MVR'],['MW','MWK'],['MX','MXN'],['MY','MYR'],['MZ','MZN'],['NA','NAD'],['NC','XPF'],['NE','XOF'],['NF','AUD'],['NG','NGN'],['NI','NIO'],['NL','EUR'],['NO','NOK'],['NP','NPR'],['NR','AUD'],['NU','NZD'],['NZ','NZD'],['OM','OMR'],['PA','PAB'],['PE','PEN'],['PF','XPF'],['PG','PGK'],['PH','PHP'],['PK','PKR'],['PL','PLN'],['PM','EUR'],['PN','NZD'],['PR','USD'],['PS','ILS'],['PT','EUR'],['PW','USD'],['PY','PYG'],['QA','QAR'],['RE','EUR'],['RO','RON'],['RS','RSD'],['RU','RUB'],['RW','RWF'],['SA','SAR'],['SB','SBD'],['SC','SCR'],['SD','SDG'],['SE','SEK'],['SG','SGD'],['SH','SHP'],['SI','EUR'],['SJ','NOK'],['SK','EUR'],['SL','SLL'],['SM','EUR'],['SN','XOF'],['SO','SOS'],['SR','SRD'],['SS','SSP'],['ST','STN'],['SV','USD'],['SX','ANG'],['SY','SYP'],['SZ','SZL'],['TC','USD'],['TD','XAF'],['TF','EUR'],['TG','XOF'],['TH','THB'],['TJ','TJS'],['TK','NZD'],['TL','USD'],['TM','TMT'],['TN','TND'],['TO','TOP'],['TR','TRY'],['TT','TTD'],['TV','AUD'],['TW','TWD'],['TZ','TZS'],['UA','UAH'],['UG','UGX'],['UM','USD'],['US','USD'],['UY','UYU'],['UZ','UZS'],['VA','EUR'],['VC','XCD'],['VE','VES'],['VG','USD'],['VI','USD'],['VN','VND'],['VU','VUV'],['WF','XPF'],['WS','WST'],['YE','YER'],['YT','EUR'],['ZA','ZAR'],['ZM','ZMW'],['ZW','USD'],
] as const;

const VERIFIED = new Set(["NZ", "AU", "US", "CA", "GB"]);
const PREVIEW = new Set([
  "AT","BE","BR","CH","DE","DK","ES","FI","FR","IE","IN","IT","JP","KR","MX","NL","NO","PT","SE","SG","ZA",
]);
const LOCALE_BY_COUNTRY: Record<string, string> = {
  NZ:"en-NZ", AU:"en-AU", US:"en-US", CA:"en-CA", GB:"en-GB",
  AT:"de-AT", BE:"nl-BE", BR:"pt-BR", CH:"de-CH", DE:"de-DE", DK:"da-DK", ES:"es-ES",
  FI:"fi-FI", FR:"fr-FR", IE:"en-IE", IN:"en-IN", IT:"it-IT", JP:"ja-JP", KR:"ko-KR",
  MX:"es-MX", NL:"nl-NL", NO:"nb-NO", PT:"pt-PT", SE:"sv-SE", SG:"en-SG", ZA:"en-ZA",
};
const SEARCH_LANGUAGE_BY_COUNTRY: Record<string, string> = {
  AT:"de", BE:"nl", BR:"pt", CH:"de", DE:"de", DK:"da", ES:"es", FI:"fi", FR:"fr", IT:"it",
  JP:"ja", KR:"ko", MX:"es", NL:"nl", NO:"no", PT:"pt", SE:"sv",
};
const VERIFIED_THRESHOLDS: Record<string, number> = { NZ:500, AU:500, US:400, CA:500, GB:300 };
const currencyByCountry = new Map<string, string>(COUNTRY_CURRENCY_PAIRS);
export function normaliseCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && currencyByCountry.has(code) ? code : null;
}

export function resolveMarketConfig(value: unknown): MarketConfig | null {
  const countryCode = normaliseCountryCode(value);
  if (!countryCode) return null;
  const currencyCode = currencyByCountry.get(countryCode)!;
  const pricingSupportTier: PricingSupportTier = VERIFIED.has(countryCode) ? "verified" : PREVIEW.has(countryCode) ? "preview" : "limited";
  const pricingEnabled = pricingSupportTier !== "limited";
  const locale = LOCALE_BY_COUNTRY[countryCode] ?? `en-${countryCode}`;
  const searchLanguage = SEARCH_LANGUAGE_BY_COUNTRY[countryCode] ?? "en";
  return {
    countryCode,
    countryName: COUNTRY_NAME_BY_CODE[countryCode] ?? countryCode,
    currencyCode,
    locale,
    searchLanguage,
    serperGl: pricingEnabled ? countryCode.toLowerCase() : null,
    serperHl: searchLanguage,
    pricingSupportTier,
    aiEstimatesEnabled: pricingEnabled,
    replacementSearchEnabled: pricingEnabled,
    materialItemThreshold: VERIFIED_THRESHOLDS[countryCode] ?? null,
  };
}

export const MARKET_CONFIGS = COUNTRY_CURRENCY_PAIRS.map(([countryCode]) => resolveMarketConfig(countryCode)!).sort((a, b) => a.countryName.localeCompare(b.countryName));
export const COUNTRY_OPTIONS = MARKET_CONFIGS.map((market) => ({ code: market.countryCode, label: market.countryName, currencyCode: market.currencyCode, supportTier: market.pricingSupportTier }));

export function filterCountryOptions(query: string) {
  const needle = query.trim().toLocaleLowerCase("en");
  if (!needle) return COUNTRY_OPTIONS;
  return COUNTRY_OPTIONS.filter((option) =>
    option.label.toLocaleLowerCase("en").includes(needle)
    || option.code.toLowerCase().includes(needle)
    || option.currencyCode.toLowerCase().includes(needle));
}
