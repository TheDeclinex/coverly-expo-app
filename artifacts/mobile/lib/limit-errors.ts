import type { GatedFeature } from "@/context/EntitlementsContext";

export type LimitFeature = Extract<GatedFeature, "ai_scan" | "replacement_pricing" | "property">;

export interface UsageLimitDetails {
  usedUnits?: number | null;
  limitUnits?: number | null;
  remainingUnits?: number | null;
}

export interface NormalizedLimitError {
  feature: LimitFeature;
  title: string;
  body: string;
  benefit: string;
  primaryCta: string;
  secondaryCta: string;
  dismissCta?: string;
  usage?: UsageLimitDetails;
  primaryAction?: "purchase" | "dismiss";
}

type LimitErrorInput = {
  errorCode?: string | null;
  status?: number | null;
  responseBody?: unknown;
  feature?: LimitFeature;
  resetAt?: string | null;
  ownsCoverly?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function extractUsageLimitDetails(value: unknown): UsageLimitDetails | undefined {
  if (!isRecord(value)) return undefined;
  const usage = isRecord(value.usage) ? value.usage : isRecord(value.diagnostics) && isRecord(value.diagnostics.usage) ? value.diagnostics.usage : null;
  if (!usage) return undefined;

  return {
    usedUnits: numberValue(usage.usedUnits),
    limitUnits: numberValue(usage.limitUnits),
    remainingUnits: numberValue(usage.remainingUnits),
  };
}

function replacementBody(usage?: UsageLimitDetails): string {
  if (usage?.usedUnits != null && usage.limitUnits != null) {
    return `You've used ${usage.usedUnits} of ${usage.limitUnits} replacement price searches this month. You can still enter an item value manually, and your current item value was not changed.`;
  }
  return "You've reached your free replacement search limit for this month. You can still enter an item value manually, and your current item value was not changed.";
}

function aiScanBody(usage?: UsageLimitDetails): string {
  if (usage?.usedUnits != null && usage.limitUnits != null) {
    return `You've used ${usage.usedUnits} of ${usage.limitUnits} AI scan credits this month. You can still add items manually for free, and no scan results were saved.`;
  }
  return "You've used your free AI scan credits for this month. You can still add items manually for free, and no scan results were saved.";
}

export function normalizeLimitError(input: LimitErrorInput): NormalizedLimitError | null {
  const code = input.errorCode ?? (isRecord(input.responseBody) && typeof input.responseBody.errorCode === "string" ? input.responseBody.errorCode : null);
  const ownerExhausted = code === "OWNER_FAIR_USE_EXHAUSTED" || (isRecord(input.responseBody) && input.responseBody.code === "OWNER_FAIR_USE_EXHAUSTED");
  if (ownerExhausted || (input.ownsCoverly && (input.status === 402 || /LIMIT_REACHED|ALLOWANCE_EXHAUSTED|CREDITS_EXCEEDED/.test(code ?? "")))) {
    const date = input.resetAt ? new Date(input.resetAt) : null;
    const reset = date && Number.isFinite(date.getTime()) ? " It refreshes on " + date.toLocaleDateString() + "." : " It refreshes at the next allowance reset.";
    return { feature: input.feature ?? "replacement_pricing", title: "Your included AI assistance is used for now",
      body: "You've used this month's included AI assistance." + reset + " Your inventory is unchanged, and manual tools remain available.",
      benefit: "", primaryCta: "Continue without AI", secondaryCta: input.feature === "ai_scan" ? "Add item manually" : "Back to item", primaryAction: "dismiss" };
  }
  const usage = extractUsageLimitDetails(input.responseBody);

  if (code === "REPLACEMENT_PRICING_LIMIT_REACHED") {
    return {
      feature: "replacement_pricing",
      title: "You've used your free replacement searches",
      body: replacementBody(usage),
      benefit: "Own Coverly with one purchase for AI assistance and claim-ready PDF exports.",
      primaryCta: "Own Coverly",
      secondaryCta: "Back to item",
      dismissCta: "Not now",
      usage,
    };
  }

  if (code === "AI_SCAN_LIMIT_REACHED" || code === "AI_SCAN_CREDITS_EXCEEDED") {
    return {
      feature: "ai_scan",
      title: "You've used your free AI scan credits",
      body: aiScanBody(usage),
      benefit: "Own Coverly with one purchase for AI assistance and claim-ready PDF exports.",
      primaryCta: "Own Coverly",
      secondaryCta: "Add item manually",
      dismissCta: "Not now",
      usage,
    };
  }

  if (code === "PROPERTY_LIMIT_REACHED") {
    return {
      feature: "property",
      title: "You've reached your property limit",
      body: "Free includes one property. Own Coverly to document up to 5 properties while continuing to manage your existing inventory.",
      benefit: "",
      primaryCta: "Own Coverly",
      secondaryCta: "Continue with current property",
      usage,
    };
  }

  if (input.status === 402 || code === "FREE_ALLOWANCE_EXHAUSTED") {
    return {
      feature: input.feature ?? "replacement_pricing",
      title: "You've reached this month's free limit",
      body: "You've reached a free monthly limit. Your current item or action was not changed, and manual inventory tools are still available.",
      benefit: "Own Coverly with one purchase for AI assistance and claim-ready PDF exports.",
      primaryCta: "Own Coverly",
      secondaryCta: "Not now",
      usage,
    };
  }

  return null;
}
