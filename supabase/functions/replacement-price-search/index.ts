/**
 * Supabase Edge Function: replacement-price-search
 * v26.5.0 — enforce optional refinement price bounds on returned listings
 *
 * Searches Google Shopping via Serper.dev for NZ replacement listings.
 * API key stays server-side in SERPER_API_KEY secret.
 *
 * DEPLOY INSTRUCTIONS:
 *   1. supabase link --project-ref <ref>
 *   2. npx supabase functions deploy replacement-price-search
 *      NOTE: Do NOT use --no-verify-jwt flag.
 *
 * SET SECRETS (after deployment):
 *   supabase secrets set SERPER_API_KEY=<your-serper-api-key>
 *   (SUPABASE_URL and SUPABASE_ANON_KEY are auto-provided by Supabase platform)
 *
 * AUTH FLOW:
 *   Layer 1: Supabase platform verifies Bearer JWT before handler runs
 *   Layer 2: Handler manually checks Authorization header + calls auth.getUser()
 *   Layer 3: Returns detailed diagnostics on any auth failure
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  buildReplacementExternalQuery,
  filterResultsToPriceRange,
  validatePriceSearchRequest,
  type PriceSearchRequest,
} from './query-model.ts';
import {
  rankAndFilterReplacementResults,
  type QualifiedReplacementResult,
  type ReplacementResultCandidate,
  type ReplacementResultQualityContext,
} from './result-quality.ts';

const EDGE_VERSION = 'v26.7.0-result-quality';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERPER_TIMEOUT_MS = 15_000;

// ── CORS ─────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200, _origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const SERPER_SHOPPING_URL = 'https://google.serper.dev/shopping';
const SERPER_ORGANIC_URL = 'https://google.serper.dev/search';

// ── Input validation ──────────────────────────────────────────────────────────
type PriceSearchResult = QualifiedReplacementResult;

interface UsageReservationResult {
  reservation_id?: string;
  feature?: string;
  operation?: string;
  status?: string;
  allowed?: boolean;
  would_have_blocked?: boolean;
  entitlement_mode?: string;
  effective_plan?: string;
  units?: number;
  limit_units?: number;
  used_units?: number;
  reserved_units?: number;
  remaining_units?: number | null;
  expires_at?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normaliseUsageIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

function usageDiagnostics(result: UsageReservationResult | null): Record<string, unknown> | undefined {
  if (!result) return undefined;
  return {
    reservationId: result.reservation_id,
    feature: result.feature,
    operation: result.operation,
    status: result.status,
    allowed: result.allowed,
    wouldHaveBlocked: result.would_have_blocked,
    entitlementMode: result.entitlement_mode,
    effectivePlan: result.effective_plan,
    units: result.units,
    limitUnits: result.limit_units,
    usedUnits: result.used_units,
    reservedUnits: result.reserved_units,
    remainingUnits: result.remaining_units,
    expiresAt: result.expires_at,
  };
}

async function reserveUsage(
  client: ReturnType<typeof createClient>,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
): Promise<UsageReservationResult> {
  const { data, error } = await client.rpc('reserve_my_feature_usage', {
    feature: 'replacement_pricing',
    operation: 'search',
    idempotency_key: idempotencyKey,
    metadata,
  });

  if (error) {
    throw new Error(`Usage reserve failed: ${error.message}`);
  }

  return (data ?? {}) as UsageReservationResult;
}

async function commitUsage(
  client: ReturnType<typeof createClient>,
  reservationId: string,
): Promise<void> {
  const { error } = await client.rpc('commit_my_feature_usage', {
    reservation_id: reservationId,
  });

  if (error) {
    throw new Error(`Usage commit failed: ${error.message}`);
  }
}

async function refundUsage(
  client: ReturnType<typeof createClient> | null,
  reservationId: string | null,
  reason: string,
): Promise<void> {
  if (!client || !reservationId) return;

  const { error } = await client.rpc('refund_my_feature_usage', {
    reservation_id: reservationId,
    reason,
  });

  if (error) {
    console.error(JSON.stringify({
      source: 'replacement-price-search',
      edgeVersion: EDGE_VERSION,
      stage: 'usage_refund_failed',
      reservationId,
      reason,
      message: error.message,
    }));
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/[\d]+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return isNaN(n) ? null : n;
}

function priceStats(prices: number[]): { low: number; median: number; high: number } | null {
  const valid = prices.filter(p => p > 0).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  const median = valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
  return { low: valid[0], median: Math.round(median * 100) / 100, high: valid[valid.length - 1] };
}

function mapShoppingResults(data: unknown, num: number): ReplacementResultCandidate[] {
  const shopping = (data as any)?.shopping ?? [];
  return (shopping as any[]).slice(0, num).map((r: any, idx: number) => ({
    title: r.title ?? 'Unknown product',
    source: r.source ?? 'Unknown retailer',
    price: parsePrice(r.price),
    priceRaw: r.price ?? '',
    link: r.link ?? '',
    snippet: r.snippet,
    thumbnail: r.imageUrl || r.thumbnail,
    position: r.position ?? idx + 1,
  }));
}

function mapOrganicResults(data: unknown, num: number): ReplacementResultCandidate[] {
  const organic = (data as any)?.organic ?? [];
  return (organic as any[]).slice(0, num).map((r: any, idx: number) => ({
    title: r.title ?? 'Unknown',
    source: r.displayLink ?? r.link ?? 'Unknown',
    price: null,
    priceRaw: '',
    link: r.link ?? '',
    snippet: r.snippet,
    thumbnail: undefined,
    position: idx + 1,
  }));
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, errorCode: 'METHOD_NOT_ALLOWED', error: 'POST only' }, 405, origin);
  }

  // ── Auth: Layer 1 = Supabase platform JWT check (deploy without --no-verify-jwt)
  // ── Auth: Layer 2 = manual defence-in-depth check with full diagnostics
  const authHeader = req.headers.get('Authorization') ?? '';
  const authDiag = {
    authHeaderPresent: !!authHeader,
    tokenPrefixPresent: authHeader.startsWith('Bearer '),
    hasSupabaseUrl: !!SUPABASE_URL,
    hasSupabaseAnonKey: !!SUPABASE_ANON_KEY,
    getUserErrorMessage: '',
  };

  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({
      success: false,
      errorCode: 'UNAUTHORIZED',
      error: 'Missing or malformed Authorization header — expected: Bearer <token>',
      diagnostics: authDiag,
    }, 401, origin);
  }
  const jwt = authHeader.slice(7);

  let userId: string | null = null;
  let userClient: ReturnType<typeof createClient> | null = null;
  try {
    userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.auth.getUser(jwt);
    if (error) {
      authDiag.getUserErrorMessage = error.message;
      return jsonResponse({
        success: false,
        errorCode: 'UNAUTHORIZED',
        error: `auth.getUser() failed: ${error.message}`,
        diagnostics: authDiag,
      }, 401, origin);
    }
    if (!data.user) {
      authDiag.getUserErrorMessage = 'No user returned from auth.getUser()';
      return jsonResponse({
        success: false,
        errorCode: 'UNAUTHORIZED',
        error: 'Invalid or expired session — no user found',
        diagnostics: authDiag,
      }, 401, origin);
    }
    userId = data.user.id;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    authDiag.getUserErrorMessage = err;
    return jsonResponse({
      success: false,
      errorCode: 'UNAUTHORIZED',
      error: `Auth check threw: ${err}`,
      diagnostics: authDiag,
    }, 401, origin);
  }

  const serperKey = Deno.env.get('SERPER_API_KEY');
  if (!serperKey) {
    return jsonResponse({ success: false, errorCode: 'MISSING_API_KEY', error: 'SERPER_API_KEY secret not configured' }, 500, origin);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ success: false, errorCode: 'BAD_REQUEST', error: 'Invalid JSON body' }, 400, origin);
  }

  // ── Input validation with fallback ──────────────────────────────────────────
  // Resolve itemName defensively: try itemName, searchQuery, category, fallback to 'item'
  const validation = validatePriceSearchRequest(rawBody);
  if (!validation.ok) {
    return jsonResponse({
      success: false,
      errorCode: 'INVALID_SEARCH_INPUT',
      error: validation.error,
    }, 400, origin);
  }

  const body: PriceSearchRequest = validation.value;
  const itemName = body.itemName;
  const num = body.num;
  const searchQueryFallback = body.searchQuery ?? '';
  const queryUsed = buildReplacementExternalQuery(body);
  const qualityContext: ReplacementResultQualityContext = {
    itemName,
    ...(body.searchQuery ? { searchTerm: body.searchQuery } : {}),
    ...(body.brand ? { brand: body.brand } : {}),
    ...(body.model ? { model: body.model } : {}),
    ...(body.category ? { category: body.category } : {}),
    ...(body.preferredRetailer
      ? { preferredRetailer: body.preferredRetailer }
      : {}),
  };

  const usageIdempotencyKey = normaliseUsageIdempotencyKey(body.usageIdempotencyKey);
  if (!usageIdempotencyKey) {
    return jsonResponse({
      success: false,
      errorCode: 'MISSING_IDEMPOTENCY_KEY',
      error: 'Replacement price search is missing a usage idempotency key. Please update the app and try again.',
    }, 400, origin);
  }

  const diagnostics: Record<string, unknown> = {
    edgeVersion: EDGE_VERSION,
    queryUsed,
    itemName,
    itemNameFallbackUsed: validation.itemNameFallbackUsed,
    originalItemNamePresent: validation.originalItemNamePresent,
    resolvedItemName: itemName,
    searchQueryPresent: !!searchQueryFallback,
    categoryPresent: !!body.category,
    num,
    userId,
    requestOrigin: origin,
  };

  let usageReservation: UsageReservationResult | null = null;
  let usageReservationId: string | null = null;

  try {
    usageReservation = await reserveUsage(userClient!, usageIdempotencyKey, {
      itemId: body.itemId ?? null,
      country: body.country,
      num,
      hasSearchQuery: !!searchQueryFallback,
      hasBrand: !!body.brand,
      hasModel: !!body.model,
      hasAdditionalDetails: !!body.additionalDetails,
      hasPreferredRetailer: !!body.preferredRetailer,
      hasPriceRange: body.minPrice != null || body.maxPrice != null,
      hasBarcode: !!body.barcode,
      edgeVersion: EDGE_VERSION,
    });
    usageReservationId = usageReservation.reservation_id ?? null;
    diagnostics.usage = usageDiagnostics(usageReservation);
  } catch (error) {
    return jsonResponse({
      success: false,
      errorCode: 'USAGE_RESERVE_FAILED',
      error: 'Could not check replacement pricing allowance. Please try again.',
      diagnostics: {
        ...diagnostics,
        usageError: errorMessage(error),
      },
    }, 500, origin);
  }

  if (usageReservation.allowed !== true) {
    return jsonResponse({
      success: false,
      errorCode: 'REPLACEMENT_PRICING_LIMIT_REACHED',
      error: 'Your Free monthly replacement price lookups have been used. Upgrade to continue searching.',
      usage: usageDiagnostics(usageReservation),
      diagnostics,
    }, 402, origin);
  }

  try {
    const shopRes = await fetchWithTimeout(SERPER_SHOPPING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
      body: JSON.stringify({ q: queryUsed, gl: 'nz', hl: 'en', num }),
    }, SERPER_TIMEOUT_MS);

    diagnostics.shoppingStatus = shopRes.status;

    if (!shopRes.ok) {
      const errText = await shopRes.text();
      diagnostics.shoppingError = errText.slice(0, 200);
      await refundUsage(userClient, usageReservationId, 'serper_shopping_provider_failure');
      return jsonResponse({
        success: false, errorCode: 'SERPER_ERROR',
        error: `Serper Shopping returned ${shopRes.status}`, diagnostics,
      }, 502, origin);
    }

    let shopData: unknown;
    try {
      shopData = await shopRes.json();
    } catch (error) {
      await refundUsage(userClient, usageReservationId, 'serper_shopping_invalid_response');
      return jsonResponse({
        success: false,
        errorCode: 'SERPER_INVALID_RESPONSE',
        error: `Serper Shopping returned invalid JSON: ${errorMessage(error)}`,
        diagnostics,
      }, 502, origin);
    }
    const shoppingCandidates = mapShoppingResults(shopData, num);
    let results = rankAndFilterReplacementResults(
      shoppingCandidates,
      qualityContext,
      num,
    );
    diagnostics.shoppingCandidateCount = shoppingCandidates.length;
    diagnostics.shoppingResultCount = results.length;

    // Organic fallback if no priced results
    if (results.filter(r => r.price != null && r.price > 0).length === 0) {
      diagnostics.organicFallback = true;
      const orgRes = await fetchWithTimeout(SERPER_ORGANIC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
        body: JSON.stringify({ q: queryUsed, gl: 'nz', hl: 'en', num }),
      }, SERPER_TIMEOUT_MS);
      diagnostics.organicStatus = orgRes.status;
      if (orgRes.ok) {
        let orgData: unknown;
        try {
          orgData = await orgRes.json();
        } catch (error) {
          await refundUsage(userClient, usageReservationId, 'serper_organic_invalid_response');
          return jsonResponse({
            success: false,
            errorCode: 'SERPER_INVALID_RESPONSE',
            error: `Serper Organic returned invalid JSON: ${errorMessage(error)}`,
            diagnostics,
          }, 502, origin);
        }
        const organicCandidates = mapOrganicResults(orgData, num);
        results = rankAndFilterReplacementResults(
          [...shoppingCandidates, ...organicCandidates],
          qualityContext,
          num,
        );
        diagnostics.organicCandidateCount = organicCandidates.length;
        diagnostics.organicResultCount = results.length;
      } else {
        diagnostics.organicError = (await orgRes.text()).slice(0, 200);
        await refundUsage(userClient, usageReservationId, 'serper_organic_provider_failure');
        return jsonResponse({
          success: false,
          errorCode: 'SERPER_ERROR',
          error: `Serper Organic returned ${orgRes.status}`,
          diagnostics,
        }, 502, origin);
      }
    }

    const resultCountBeforePriceRange = results.length;
    results = filterResultsToPriceRange(results, body.minPrice, body.maxPrice);
    if (body.minPrice != null || body.maxPrice != null) {
      diagnostics.priceRangeApplied = true;
      diagnostics.minPrice = body.minPrice;
      diagnostics.maxPrice = body.maxPrice;
      diagnostics.resultCountBeforePriceRange = resultCountBeforePriceRange;
      diagnostics.resultCountAfterPriceRange = results.length;
    }

    const prices = results.map(r => r.price).filter((p): p is number => p != null && p > 0);
    const stats = priceStats(prices);

    if (!prices.length) {
      await refundUsage(userClient, usageReservationId, 'no_usable_priced_results');
      diagnostics.usageRefunded = true;
      return jsonResponse({ success: true, results, queryUsed, ...(stats ?? {}), diagnostics }, 200, origin);
    }

    if (usageReservationId) {
      await commitUsage(userClient!, usageReservationId);
      diagnostics.usageCommitted = true;
    }

    return jsonResponse({ success: true, results, queryUsed, ...(stats ?? {}), diagnostics }, 200, origin);
  } catch (e) {
    const msg = errorMessage(e);
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    if (isTimeout) {
      await refundUsage(userClient, usageReservationId, 'serper_timeout');
      return jsonResponse({
        success: false,
        errorCode: 'SERPER_TIMEOUT',
        error: 'Replacement price search timed out. Please try again.',
        diagnostics,
      }, 504, origin);
    }

    await refundUsage(userClient, usageReservationId, 'replacement_price_search_error');
    return jsonResponse({ success: false, errorCode: 'INTERNAL_ERROR', error: msg, diagnostics }, 500, origin);
  }
});
