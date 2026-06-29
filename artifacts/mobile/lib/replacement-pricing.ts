import { friendlyNetworkErrorMessage } from "@/lib/network-errors";
import { anonKey, debugSupabaseUrl, supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";
export { replacementVoiceTranscriptToQuery } from "./replacement-pricing-query.ts";

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
  diagnostics?: unknown;
  usage?: unknown;
}

type ReplacementPriceSearchResponse =
  | ReplacementPriceSearchSuccess
  | ReplacementPriceSearchFailure;

const REPLACEMENT_PRICE_FUNCTION_NAME = "replacement-price-search";

export class ReplacementPriceSearchError extends Error {
  status?: number;
  errorCode?: string;
  responseBody?: unknown;

  constructor(
    message: string,
    details?: { status?: number; errorCode?: string; responseBody?: unknown },
  ) {
    super(message);
    this.name = "ReplacementPriceSearchError";
    this.status = details?.status;
    this.errorCode = details?.errorCode;
    this.responseBody = details?.responseBody;
  }
}

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

function safeRequestLogBody(body: ReplacementPriceSearchRequest): Record<string, unknown> {
  return {
    functionName: REPLACEMENT_PRICE_FUNCTION_NAME,
    itemId: body.itemId,
    itemName: body.itemName,
    descriptionPresent: !!body.description,
    category: body.category,
    brand: body.brand,
    country: body.country,
    searchQuery: body.searchQuery,
    num: body.num,
    hasUsageIdempotencyKey: !!body.usageIdempotencyKey,
  };
}

function messageForFailure(
  status: number,
  response: ReplacementPriceSearchFailure | null,
): string {
  if (status === 402 && response?.errorCode === "REPLACEMENT_PRICING_LIMIT_REACHED") {
    return response.error || "Your Free monthly replacement price lookups have been used. Upgrade to continue searching.";
  }

  return response?.error || response?.errorCode || `Replacement price search failed (${status}).`;
}

export async function searchReplacementPrices(
  body: ReplacementPriceSearchRequest,
): Promise<ReplacementPriceSearchSuccess> {
  const requestBody: ReplacementPriceSearchRequest = {
    ...body,
    usageIdempotencyKey:
      body.usageIdempotencyKey ?? createReplacementPricingUsageKey(),
  };

  if (__DEV__) {
    if (__DEV__) console.info("[replacement-pricing] function request", safeRequestLogBody(requestBody));
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    if (__DEV__) {
      if (__DEV__) console.error("[replacement-pricing] missing auth session", {
        hasSessionError: !!sessionError,
        sessionErrorMessage: sessionError?.message,
        hasAccessToken: !!accessToken,
      });
    }
    throw new ReplacementPriceSearchError("You must be signed in to search replacement prices.", {
      errorCode: "UNAUTHORIZED",
    });
  }

  const functionUrl = `${debugSupabaseUrl.replace(/\/$/, "")}/functions/v1/${REPLACEMENT_PRICE_FUNCTION_NAME}`;
  let httpResponse: Response;
  try {
    httpResponse = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(requestBody),
    });
  } catch (error) {
    const friendlyMessage = friendlyNetworkErrorMessage(error);
    if (friendlyMessage) {
      throw new ReplacementPriceSearchError(friendlyMessage, { errorCode: "NETWORK_UNAVAILABLE" });
    }
    throw error;
  }

  const responseText = await httpResponse.text();
  let data: ReplacementPriceSearchResponse | null = null;
  try {
    data = responseText ? (JSON.parse(responseText) as ReplacementPriceSearchResponse) : null;
  } catch {
    if (__DEV__) {
      if (__DEV__) console.error("[replacement-pricing] function invalid response", {
        status: httpResponse.status,
        ok: httpResponse.ok,
        responseBody: responseText.slice(0, 1000),
      });
    }
    throw new ReplacementPriceSearchError(
      `Replacement price search returned an invalid response (${httpResponse.status}).`,
      { status: httpResponse.status, responseBody: responseText },
    );
  }

  if (__DEV__) {
    if (__DEV__) console.info("[replacement-pricing] function response", {
      status: httpResponse.status,
      ok: httpResponse.ok,
      errorCode: data?.success === false ? data.errorCode : undefined,
      responseBody: data,
    });
  }

  if (!httpResponse.ok) {
    const failure = data && data.success === false ? data : null;
    throw new ReplacementPriceSearchError(
      messageForFailure(httpResponse.status, failure),
      {
        status: httpResponse.status,
        errorCode: failure?.errorCode,
        responseBody: data,
      },
    );
  }

  if (!data) {
    throw new ReplacementPriceSearchError("Replacement price search returned no data", {
      status: httpResponse.status,
    });
  }
  if (!data.success) {
    throw new ReplacementPriceSearchError(data.error || "Replacement price search failed", {
      status: httpResponse.status,
      errorCode: data.errorCode,
      responseBody: data,
    });
  }

  return data;
}
