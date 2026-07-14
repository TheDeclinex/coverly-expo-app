/**
 * Supabase Edge Function: replacement-price-search
 * v27.0.0 — phase-one hybrid retrieval recovery
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
  validatePriceSearchRequest,
  type PriceSearchRequest,
} from './query-model.ts';
import {
  rankAndFilterReplacementResults,
  summarizeReplacementCandidates,
  type QualifiedReplacementResult,
  type ReplacementResultQualityContext,
} from './result-quality.ts';
import {
  countRawProviderResults,
  normalizeOrganicResults,
  normalizeShoppingResults,
} from './provider-normalization.ts';
import {
  evaluateExactModelShoppingCoverage,
  planReplacementProviders,
} from './retrieval-policy.ts';
import { finalizeReplacementResults } from './finalize-results.ts';
import {
  runUsageAccountingController,
  UsageAccountingControllerError,
} from './usage-accounting-controller.ts';

const EDGE_VERSION = 'v27.0.0-phase-one-hybrid-retrieval';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERPER_TIMEOUT_MS = 15_000;

// ── CORS ─────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(
  body: unknown,
  status = 200,
  _origin: string | null = null,
): Response {
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

function usageDiagnostics(
  result: UsageReservationResult | null,
): Record<string, unknown> | undefined {
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
): Promise<boolean> {
  if (!client || !reservationId) return false;

  const { error } = await client.rpc('refund_my_feature_usage', {
    reservation_id: reservationId,
    reason,
  });

  if (error) {
    console.error(
      JSON.stringify({
        source: 'replacement-price-search',
        edgeVersion: EDGE_VERSION,
        stage: 'usage_refund_failed',
        reason,
        message: error.message,
      }),
    );
    return false;
  }
  return true;
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

type SerperProvider = 'shopping' | 'organic';
type ProviderFailureKind = 'http' | 'invalid_json' | 'timeout' | 'network';

interface ProviderOutcome {
  provider: SerperProvider;
  status: number | null;
  data?: unknown;
  error?: string;
  failureKind?: ProviderFailureKind;
}

async function fetchProvider(
  provider: SerperProvider,
  query: string,
  num: number,
  apiKey: string,
): Promise<ProviderOutcome> {
  const url =
    provider === 'shopping' ? SERPER_SHOPPING_URL : SERPER_ORGANIC_URL;
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify({ q: query, gl: 'nz', hl: 'en', num }),
      },
      SERPER_TIMEOUT_MS,
    );
    if (!response.ok) {
      return {
        provider,
        status: response.status,
        error: (await response.text()).slice(0, 200),
        failureKind: 'http',
      };
    }
    try {
      return { provider, status: response.status, data: await response.json() };
    } catch (error) {
      return {
        provider,
        status: response.status,
        error: `Invalid JSON: ${errorMessage(error)}`,
        failureKind: 'invalid_json',
      };
    }
  } catch (error) {
    const timeout =
      error instanceof DOMException && error.name === 'AbortError';
    return {
      provider,
      status: null,
      error: errorMessage(error),
      failureKind: timeout ? 'timeout' : 'network',
    };
  }
}

function recordProviderDiagnostics(
  diagnostics: Record<string, unknown>,
  outcome: ProviderOutcome,
): void {
  diagnostics[`${outcome.provider}Status`] = outcome.status;
  if (outcome.error) diagnostics[`${outcome.provider}Error`] = outcome.error;
  if (outcome.failureKind) {
    diagnostics[`${outcome.provider}FailureKind`] = outcome.failureKind;
  }
}

function priceStats(
  prices: number[],
): { low: number; median: number; high: number } | null {
  const valid = prices.filter((p) => p > 0).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  const median =
    valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
  return {
    low: valid[0],
    median: Math.round(median * 100) / 100,
    high: valid[valid.length - 1],
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse(
      { success: false, errorCode: 'METHOD_NOT_ALLOWED', error: 'POST only' },
      405,
      origin,
    );
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
    return jsonResponse(
      {
        success: false,
        errorCode: 'UNAUTHORIZED',
        error:
          'Missing or malformed Authorization header — expected: Bearer <token>',
        diagnostics: authDiag,
      },
      401,
      origin,
    );
  }
  const jwt = authHeader.slice(7);

  let userClient: ReturnType<typeof createClient> | null = null;
  try {
    userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.auth.getUser(jwt);
    if (error) {
      authDiag.getUserErrorMessage = error.message;
      return jsonResponse(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: `auth.getUser() failed: ${error.message}`,
          diagnostics: authDiag,
        },
        401,
        origin,
      );
    }
    if (!data.user) {
      authDiag.getUserErrorMessage = 'No user returned from auth.getUser()';
      return jsonResponse(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: 'Invalid or expired session — no user found',
          diagnostics: authDiag,
        },
        401,
        origin,
      );
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    authDiag.getUserErrorMessage = err;
    return jsonResponse(
      {
        success: false,
        errorCode: 'UNAUTHORIZED',
        error: `Auth check threw: ${err}`,
        diagnostics: authDiag,
      },
      401,
      origin,
    );
  }

  const serperKey = Deno.env.get('SERPER_API_KEY');
  if (!serperKey) {
    return jsonResponse(
      {
        success: false,
        errorCode: 'MISSING_API_KEY',
        error: 'SERPER_API_KEY secret not configured',
      },
      500,
      origin,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(
      { success: false, errorCode: 'BAD_REQUEST', error: 'Invalid JSON body' },
      400,
      origin,
    );
  }

  // ── Input validation with fallback ──────────────────────────────────────────
  // Resolve itemName defensively: try itemName, searchQuery, category, fallback to 'item'
  const validation = validatePriceSearchRequest(rawBody);
  if (!validation.ok) {
    return jsonResponse(
      {
        success: false,
        errorCode: 'INVALID_SEARCH_INPUT',
        error: validation.error,
      },
      400,
      origin,
    );
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

  const usageIdempotencyKey = normaliseUsageIdempotencyKey(
    body.usageIdempotencyKey,
  );
  if (!usageIdempotencyKey) {
    return jsonResponse(
      {
        success: false,
        errorCode: 'MISSING_IDEMPOTENCY_KEY',
        error:
          'Replacement price search is missing a usage idempotency key. Please update the app and try again.',
      },
      400,
      origin,
    );
  }

  const diagnostics: Record<string, unknown> = {
    edgeVersion: EDGE_VERSION,
    queryUsed,
    itemNameFallbackUsed: validation.itemNameFallbackUsed,
    originalItemNamePresent: validation.originalItemNamePresent,
    searchQueryPresent: !!searchQueryFallback,
    categoryPresent: !!body.category,
    num,
  };

  try {
    const accounting = await runUsageAccountingController({
      authenticate: async () => userClient!,
      reserve: async (authenticatedClient) => {
        const usageReservation = await reserveUsage(
          authenticatedClient,
          usageIdempotencyKey,
          {
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
          },
        );
        diagnostics.usage = usageDiagnostics(usageReservation);
        return {
          allowed: usageReservation.allowed === true,
          reservationId: usageReservation.reservation_id ?? null,
        };
      },
      search: async () => {
        diagnostics.usageOutcome = 'reserved';
        const providerPlan = planReplacementProviders(qualityContext);
        diagnostics.providerStrategy = providerPlan.strategy;
        diagnostics.organicRequestedInParallel =
          providerPlan.requestOrganicInParallel;

        let shoppingOutcome: ProviderOutcome;
        let organicOutcome: ProviderOutcome | undefined;

        if (providerPlan.requestOrganicInParallel) {
          [shoppingOutcome, organicOutcome] = await Promise.all([
            fetchProvider('shopping', queryUsed, num, serperKey),
            fetchProvider('organic', queryUsed, num, serperKey),
          ]);
        } else {
          shoppingOutcome = await fetchProvider(
            'shopping',
            queryUsed,
            num,
            serperKey,
          );
        }

        recordProviderDiagnostics(diagnostics, shoppingOutcome);
        const shoppingCandidates =
          shoppingOutcome.data === undefined
            ? []
            : normalizeShoppingResults(shoppingOutcome.data, num);
        const shoppingQuality = summarizeReplacementCandidates(
          shoppingCandidates,
          qualityContext,
        );
        const acceptedShopping = rankAndFilterReplacementResults(
          shoppingCandidates,
          qualityContext,
          shoppingCandidates.length,
        );
        diagnostics.shoppingRawResultCount = countRawProviderResults(
          shoppingOutcome.data,
          'shopping',
        );
        diagnostics.shoppingNormalizedCount = shoppingQuality.candidateCount;
        diagnostics.shoppingAcceptedCount = shoppingQuality.acceptedCount;
        diagnostics.shoppingPricedAcceptedCount =
          shoppingQuality.pricedAcceptedCount;
        diagnostics.shoppingRejectedCount = shoppingQuality.rejectedCount;
        diagnostics.shoppingRejectedByReason = shoppingQuality.rejectionReasons;

        if (!providerPlan.requestOrganicInParallel) {
          const exactCoverage = evaluateExactModelShoppingCoverage(
            acceptedShopping,
            qualityContext,
          );
          diagnostics.exactModelCoverage = exactCoverage;
          if (!exactCoverage.adequate) {
            organicOutcome = await fetchProvider(
              'organic',
              queryUsed,
              num,
              serperKey,
            );
          }
        }

        if (organicOutcome)
          recordProviderDiagnostics(diagnostics, organicOutcome);
        diagnostics.organicRequested = Boolean(organicOutcome);
        diagnostics.organicSkippedForAdequateExactCoverage =
          !providerPlan.requestOrganicInParallel && !organicOutcome;

        const organicCandidates =
          organicOutcome?.data === undefined
            ? []
            : normalizeOrganicResults(organicOutcome.data, num);
        const organicQuality = summarizeReplacementCandidates(
          organicCandidates,
          qualityContext,
        );
        diagnostics.organicRawResultCount = countRawProviderResults(
          organicOutcome?.data,
          'organic',
        );
        diagnostics.organicNormalizedCount = organicQuality.candidateCount;
        diagnostics.organicAcceptedCount = organicQuality.acceptedCount;
        diagnostics.organicPricedAcceptedCount =
          organicQuality.pricedAcceptedCount;
        diagnostics.organicRejectedCount = organicQuality.rejectedCount;
        diagnostics.organicRejectedByReason = organicQuality.rejectionReasons;

        const requestedOutcomes = [shoppingOutcome, organicOutcome].filter(
          (outcome): outcome is ProviderOutcome => Boolean(outcome),
        );
        const successfulOutcomes = requestedOutcomes.filter(
          (outcome) => outcome.data !== undefined,
        );
        const mergedCandidates = [...shoppingCandidates, ...organicCandidates];
        diagnostics.mergedCandidateCount = mergedCandidates.length;

        if (
          successfulOutcomes.length === 0 ||
          (mergedCandidates.length === 0 &&
            requestedOutcomes.some((outcome) => outcome.failureKind))
        ) {
          const timedOut = requestedOutcomes.some(
            (outcome) => outcome.failureKind === 'timeout',
          );
          return {
            kind: 'refund' as const,
            reason: timedOut ? 'serper_timeout' : 'serper_provider_failure',
            value: jsonResponse(
              {
                success: false,
                errorCode: timedOut ? 'SERPER_TIMEOUT' : 'SERPER_ERROR',
                error: timedOut
                  ? 'Replacement price search timed out. Please try again.'
                  : 'Replacement price providers could not return usable data.',
                diagnostics,
              },
              timedOut ? 504 : 502,
              origin,
            ),
          };
        }

        const finalized = finalizeReplacementResults(
          mergedCandidates,
          qualityContext,
          num,
          body.minPrice,
          body.maxPrice,
        );
        const results = finalized.results;
        diagnostics.finalResultCountBeforePriceRange = finalized.rankedCount;
        if (body.minPrice != null || body.maxPrice != null) {
          diagnostics.priceRangeApplied = true;
          diagnostics.minPrice = body.minPrice;
          diagnostics.maxPrice = body.maxPrice;
          diagnostics.resultCountBeforePriceRange = finalized.rankedCount;
          diagnostics.resultCountAfterPriceRange = finalized.constrainedCount;
        }

        const prices = results
          .map((r) => r.price)
          .filter((p): p is number => p != null && p > 0);
        const stats = priceStats(prices);
        diagnostics.finalResultCount = results.length;
        diagnostics.finalPricedResultCount = prices.length;

        if (!prices.length) {
          diagnostics.usageRefunded = true;
          return {
            kind: 'refund' as const,
            reason: 'no_usable_priced_results',
            value: jsonResponse(
              {
                success: true,
                results,
                queryUsed,
                ...(stats ?? {}),
                diagnostics,
              },
              200,
              origin,
            ),
          };
        }

        return {
          kind: 'billable_success' as const,
          value: jsonResponse(
            {
              success: true,
              results,
              queryUsed,
              ...(stats ?? {}),
              diagnostics,
            },
            200,
            origin,
          ),
        };
      },
      commit: async (authenticatedClient, reservationId) => {
        await commitUsage(authenticatedClient, reservationId);
        diagnostics.usageCommitted = true;
        diagnostics.usageOutcome = 'committed';
      },
      refund: async (authenticatedClient, reservationId, reason) => {
        diagnostics.usageRefundReason = reason;
        diagnostics.usageOutcome = (await refundUsage(
          authenticatedClient,
          reservationId,
          reason,
        ))
          ? 'refunded'
          : 'refund_failed';
      },
    });

    if (accounting.kind === 'not_allowed') {
      diagnostics.usageOutcome = 'not_allowed';
      return jsonResponse(
        {
          success: false,
          errorCode: 'REPLACEMENT_PRICING_LIMIT_REACHED',
          error:
            'Your Free monthly replacement price lookups have been used. Upgrade to continue searching.',
          usage: diagnostics.usage,
          diagnostics,
        },
        402,
        origin,
      );
    }

    return accounting.value;
  } catch (error) {
    if (
      error instanceof UsageAccountingControllerError &&
      error.stage === 'reserve'
    ) {
      return jsonResponse(
        {
          success: false,
          errorCode: 'USAGE_RESERVE_FAILED',
          error:
            'Could not check replacement pricing allowance. Please try again.',
          diagnostics: {
            ...diagnostics,
            usageError: errorMessage(error.cause),
          },
        },
        500,
        origin,
      );
    }

    const cause =
      error instanceof UsageAccountingControllerError ? error.cause : error;
    const msg = errorMessage(cause);
    const isTimeout =
      cause instanceof DOMException && cause.name === 'AbortError';
    if (isTimeout) {
      return jsonResponse(
        {
          success: false,
          errorCode: 'SERPER_TIMEOUT',
          error: 'Replacement price search timed out. Please try again.',
          diagnostics,
        },
        504,
        origin,
      );
    }
    return jsonResponse(
      { success: false, errorCode: 'INTERNAL_ERROR', error: msg, diagnostics },
      500,
      origin,
    );
  }
});
