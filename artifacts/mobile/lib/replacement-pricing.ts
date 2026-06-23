import { supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";

export interface ReplacementPriceSearchRequest {
  itemName: string;
  description?: string;
  category?: string;
  brand?: string;
  country?: string;
  minPrice?: number;
  maxPrice?: number;
  searchQuery?: string;
  num?: number;
  itemId?: string;
  usageIdempotencyKey?: string;
}

export type ReplacementMatchType =
  | "best_match"
  | "close_match"
  | "similar_item";

export interface ReplacementPriceResult {
  title: string;
  source: string;
  price: number | null;
  priceRaw: string;
  link: string;
  snippet?: string;
  thumbnail?: string;
  position: number;
  matchType: ReplacementMatchType;
}

interface ReplacementPriceSearchSuccess {
  success: true;
  results: ReplacementPriceResult[];
  queryUsed: string;
  low?: number;
  median?: number;
  high?: number;
}

interface ReplacementPriceSearchFailure {
  success: false;
  errorCode: string;
  error: string;
}

type ReplacementPriceSearchResponse =
  | ReplacementPriceSearchSuccess
  | ReplacementPriceSearchFailure;

export type ReplacementPriceFilter = "all" | "lower" | "around" | "premium";

export function getItemUnitEstimate(item: InventoryItem): number | null {
  const value = item.estimated_price ?? item.unit_estimated_price;
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildReplacementSearchQuery(item: InventoryItem): string {
  const terms = [item.brand_maker, item.model_series, item.name]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  const uniqueTerms = terms.filter(
    (term, index) =>
      terms.findIndex((candidate) => candidate.toLowerCase() === term.toLowerCase()) ===
      index,
  );

  return `${uniqueTerms.join(" ")} NZ`.trim();
}

export function filterReplacementResults(
  results: ReplacementPriceResult[],
  filter: ReplacementPriceFilter,
  estimate: number | null,
): ReplacementPriceResult[] {
  if (filter === "all" || estimate == null) return results;

  const lowerBoundary = estimate * 0.75;
  const upperBoundary = estimate * 1.25;

  return results.filter((result) => {
    if (result.price == null) return false;
    if (filter === "lower") return result.price < lowerBoundary;
    if (filter === "around") {
      return result.price >= lowerBoundary && result.price <= upperBoundary;
    }
    return result.price > upperBoundary;
  });
}

function createReplacementPricingUsageKey(): string {
  const randomUuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });

  return `replacement-pricing:${Date.now()}:${randomUuid}`;
}

export async function searchReplacementPrices(
  body: ReplacementPriceSearchRequest,
): Promise<ReplacementPriceSearchSuccess> {
  const requestBody: ReplacementPriceSearchRequest = {
    ...body,
    usageIdempotencyKey:
      body.usageIdempotencyKey ?? createReplacementPricingUsageKey(),
  };

  const { data, error } = await supabase.functions.invoke<ReplacementPriceSearchResponse>(
    "replacement-price-search",
    { body: requestBody },
  );

  if (error && !data) throw new Error(error.message || "Replacement price search failed");
  if (!data) throw new Error("Replacement price search returned no data");
  if (!data.success) throw new Error(data.error || "Replacement price search failed");

  return data;
}
