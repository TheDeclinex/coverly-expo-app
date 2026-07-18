import { resolveMarketConfig } from "../constants/market-config.ts";
import { isCurrencyCode } from "./money.ts";

export interface ReplacementMarketPresentationInput {
  countryCode?: string | null;
  countryName?: string | null;
  currencyCode?: string | null;
}

export interface ReplacementMarketPresentation {
  countryCode: string | null;
  countryName: string | null;
  currencyCode: string | null;
  listingAdjective: string | null;
  retailerLabel: string;
  introLead: string;
  loadingSubtitle: string;
  resultContext: string;
  searchAccessibilityLabel: string;
}

type MarketWording = {
  listingAdjective: string;
  retailerAdjective: string;
};

// Preserve polished English attributive forms for the markets that have them.
// Every other configured country uses its canonical country name rather than
// requiring a hard-coded wording entry before retailer search can be offered.
const MARKET_WORDING: Record<string, MarketWording> = {
  AT: { listingAdjective: "Austrian", retailerAdjective: "Austrian" },
  AU: { listingAdjective: "Australian", retailerAdjective: "Australian" },
  BE: { listingAdjective: "Belgian", retailerAdjective: "Belgian" },
  BR: { listingAdjective: "Brazilian", retailerAdjective: "Brazilian" },
  CA: { listingAdjective: "Canadian", retailerAdjective: "Canadian" },
  CH: { listingAdjective: "Swiss", retailerAdjective: "Swiss" },
  DE: { listingAdjective: "German", retailerAdjective: "German" },
  DK: { listingAdjective: "Danish", retailerAdjective: "Danish" },
  ES: { listingAdjective: "Spanish", retailerAdjective: "Spanish" },
  FI: { listingAdjective: "Finnish", retailerAdjective: "Finnish" },
  FR: { listingAdjective: "French", retailerAdjective: "French" },
  GB: { listingAdjective: "UK", retailerAdjective: "UK" },
  IE: { listingAdjective: "Irish", retailerAdjective: "Irish" },
  IN: { listingAdjective: "Indian", retailerAdjective: "Indian" },
  IT: { listingAdjective: "Italian", retailerAdjective: "Italian" },
  JP: { listingAdjective: "Japanese", retailerAdjective: "Japanese" },
  KR: { listingAdjective: "South Korean", retailerAdjective: "South Korean" },
  MX: { listingAdjective: "Mexican", retailerAdjective: "Mexican" },
  NL: { listingAdjective: "Dutch", retailerAdjective: "Dutch" },
  NO: { listingAdjective: "Norwegian", retailerAdjective: "Norwegian" },
  NZ: { listingAdjective: "NZ", retailerAdjective: "New Zealand" },
  PT: { listingAdjective: "Portuguese", retailerAdjective: "Portuguese" },
  SE: { listingAdjective: "Swedish", retailerAdjective: "Swedish" },
  SG: { listingAdjective: "Singaporean", retailerAdjective: "Singaporean" },
  US: { listingAdjective: "US", retailerAdjective: "US" },
  ZA: { listingAdjective: "South African", retailerAdjective: "South African" },
};

function normalizeCurrency(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return isCurrencyCode(normalized) ? normalized : null;
}

export function replacementMarketPresentation(
  input: ReplacementMarketPresentationInput | null | undefined,
): ReplacementMarketPresentation {
  const market = resolveMarketConfig(input?.countryCode);
  const suppliedCurrency = normalizeCurrency(input?.currencyCode);
  const currencyCode = suppliedCurrency ?? market?.currencyCode ?? null;
  const marketMatchesCurrency = market != null
    && (suppliedCurrency == null || suppliedCurrency === market.currencyCode);
  const wording = marketMatchesCurrency ? MARKET_WORDING[market.countryCode] : null;

  if (!marketMatchesCurrency || !market) {
    const suppliedName = input?.countryName?.trim() || null;
    const resultContext = `Searching retailers${currencyCode ? ` · ${currencyCode}` : ""}`;
    return {
      countryCode: marketMatchesCurrency ? market?.countryCode ?? null : null,
      countryName: marketMatchesCurrency ? market?.countryName ?? suppliedName : suppliedName,
      currencyCode,
      listingAdjective: null,
      retailerLabel: "retailers",
      introLead: "Find comparable listings.",
      loadingSubtitle: "Checking current listings for similar items...",
      resultContext,
      searchAccessibilityLabel: "Search replacement listings",
    };
  }

  if (!wording) {
    const countryName = input?.countryName?.trim() || market.countryName;
    const retailerLabel = `retailers in ${countryName}`;
    return {
      countryCode: market.countryCode,
      countryName,
      currencyCode,
      listingAdjective: null,
      retailerLabel,
      introLead: `Find comparable listings in ${countryName}.`,
      loadingSubtitle: `Checking current listings in ${countryName} for similar items...`,
      resultContext: `Searching ${retailerLabel}${currencyCode ? ` · ${currencyCode}` : ""}`,
      searchAccessibilityLabel: `Search replacement listings in ${countryName}`,
    };
  }

  const retailerLabel = `${wording.retailerAdjective} retailers`;
  return {
    countryCode: market.countryCode,
    countryName: input?.countryName?.trim() || market.countryName,
    currencyCode,
    listingAdjective: wording.listingAdjective,
    retailerLabel,
    introLead: `Find comparable ${wording.listingAdjective} listings.`,
    loadingSubtitle: `Checking current ${wording.listingAdjective} listings for similar items...`,
    resultContext: `Searching ${retailerLabel}${currencyCode ? ` · ${currencyCode}` : ""}`,
    searchAccessibilityLabel: `Search ${wording.listingAdjective} replacement listings`,
  };
}
