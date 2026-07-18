import type { PricingSupportTier } from "./market-config.ts";

export interface PricingSupportContent {
  label: string;
  shortDescription: string;
  expandedDescription: string;
}

const PRICING_SUPPORT_CONTENT = {
  verified: {
    label: "Full pricing support",
    shortDescription: "AI estimates and local retailer searches are available and tested for this market.",
    expandedDescription: "Coverly can estimate replacement values during AI scans and search local retailers for replacement pricing. Automated results are suggestions and should still be reviewed by the user.",
  },
  preview: {
    label: "Pricing preview",
    shortDescription: "AI estimates and local retailer searches are available but still undergoing market validation.",
    expandedDescription: "Coverly can estimate replacement values and search retailers in this market, but pricing quality and local search results have not yet been tested to the same level as fully supported markets.",
  },
  limited: {
    label: "Manual pricing",
    shortDescription: "AI item recognition and best-effort local retailer search are available; replacement values can still be entered manually.",
    expandedDescription: "Coverly can identify, name, describe, categorise and count items from photos or video, and can attempt local retailer price searches for this market. Automatic AI replacement-value estimates are not currently available, so search results and manually entered values should be reviewed.",
  },
} satisfies Record<PricingSupportTier, PricingSupportContent>;

export const PRICING_SUPPORT_TIERS = ["verified", "preview", "limited"] as const satisfies readonly PricingSupportTier[];

export function getPricingSupportContent(tier: PricingSupportTier): PricingSupportContent {
  return PRICING_SUPPORT_CONTENT[tier];
}
