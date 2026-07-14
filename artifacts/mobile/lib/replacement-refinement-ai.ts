import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

import { debugSupabaseProjectRef, supabase } from "@/lib/supabase";
import {
  sanitizeReplacementSearchText,
  sanitizeSceneDescription,
} from "./description-sanitizer.ts";
import type {
  ReplacementAiSuggestion,
  ReplacementRefinementItemContext,
} from "./replacement-refinement-assist.ts";
import type { ReplacementSearchRefinementDraft } from "./replacement-pricing-model.ts";
import {
  refinementFailureMessage,
  safeFunctionFailure,
  validateRefinementFunctionEnvelope,
} from "./replacement-refinement-transport.ts";

export const REPLACEMENT_REFINEMENT_FUNCTION_NAME = "replacement-search-refine";
const CLIENT_TIMEOUT_MS = 18_000;

export class ReplacementRefinementAiError extends Error {
  errorCode?: string;
  status?: number;
  functionsErrorType?: string;

  constructor(
    message: string,
    details?: {
      errorCode?: string;
      status?: number;
      functionsErrorType?: string;
    },
  ) {
    super(message);
    this.name = "ReplacementRefinementAiError";
    this.errorCode = details?.errorCode;
    this.status = details?.status;
    this.functionsErrorType = details?.functionsErrorType;
  }
}

function price(value: string): number | undefined {
  const cleaned = value.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requestBody(
  item: ReplacementRefinementItemContext,
  draft: ReplacementSearchRefinementDraft,
  voiceTranscript?: string,
) {
  const minPrice = price(draft.minPrice);
  const maxPrice = price(draft.maxPrice);
  const itemDescription = sanitizeReplacementSearchText(
    sanitizeSceneDescription(item.description, 600),
    600,
  );
  return {
    item: {
      itemName: item.itemName,
      ...(itemDescription ? { description: itemDescription } : {}),
      ...(item.category ? { category: item.category } : {}),
      ...(item.brand ? { brandMaker: item.brand } : {}),
      ...(item.model ? { modelSeries: item.model } : {}),
      ...(item.condition ? { condition: item.condition } : {}),
    },
    draft: {
      searchTerm: sanitizeReplacementSearchText(draft.searchTerm),
      ...(draft.brand.trim() ? { brandMaker: draft.brand.trim() } : {}),
      ...(draft.model.trim() ? { modelSeries: draft.model.trim() } : {}),
      ...(sanitizeReplacementSearchText(draft.additionalDetails)
        ? {
            additionalDetails: sanitizeReplacementSearchText(
              draft.additionalDetails,
            ),
          }
        : {}),
      ...(minPrice != null ? { minPrice } : {}),
      ...(maxPrice != null ? { maxPrice } : {}),
      selectedCriteria: {
        condition: draft.condition ?? null,
        country: draft.country ?? "NZ",
      },
    },
    ...(sanitizeReplacementSearchText(voiceTranscript)
      ? { voiceTranscript: sanitizeReplacementSearchText(voiceTranscript) }
      : {}),
  };
}

function functionErrorType(error: unknown): string {
  if (error instanceof FunctionsHttpError) return "FunctionsHttpError";
  if (error instanceof FunctionsRelayError) return "FunctionsRelayError";
  if (error instanceof FunctionsFetchError) return "FunctionsFetchError";
  return error instanceof Error ? error.name : "UnknownError";
}

async function readSafeFailure(response?: Response): Promise<{
  errorCode?: string;
  message?: string;
}> {
  if (!response) return {};
  try {
    const text = await response.clone().text();
    if (!text) return {};
    try {
      return safeFunctionFailure(JSON.parse(text));
    } catch {
      return { message: "Non-JSON function error response" };
    }
  } catch {
    return {};
  }
}

function diagnosticLog(
  event: "request" | "response" | "failure",
  details: Record<string, unknown>,
): void {
  if (!__DEV__) return;
  const method = event === "failure" ? console.warn : console.info;
  method("[replacement-refinement-ai]", {
    event,
    functionName: REPLACEMENT_REFINEMENT_FUNCTION_NAME,
    projectRef: debugSupabaseProjectRef,
    ...details,
  });
}

export async function improveReplacementRefinementWithAi(
  item: ReplacementRefinementItemContext,
  draft: ReplacementSearchRefinementDraft,
  options?: { voiceTranscript?: string; signal?: AbortSignal },
): Promise<ReplacementAiSuggestion> {
  const startedAt = Date.now();
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const hasAuthenticatedSession = Boolean(accessToken && !sessionError);

  if (!hasAuthenticatedSession || !accessToken) {
    diagnosticLog("failure", {
      status: 401,
      functionsErrorType: "MissingSession",
      responseMessage: sessionError?.message ?? "No authenticated session",
      hasAuthenticatedSession: false,
    });
    throw new ReplacementRefinementAiError(
      refinementFailureMessage({ status: 401, errorCode: "UNAUTHORIZED" }),
      {
        status: 401,
        errorCode: "UNAUTHORIZED",
        functionsErrorType: "MissingSession",
      },
    );
  }
  if (options?.signal?.aborted) {
    throw new ReplacementRefinementAiError("AI refinement was cancelled.", {
      errorCode: "AI_REFINEMENT_CANCELLED",
    });
  }

  diagnosticLog("request", {
    hasAuthenticatedSession: true,
    hasBrand: Boolean(draft.brand.trim()),
    hasModel: Boolean(draft.model.trim()),
    hasDetails: Boolean(draft.additionalDetails.trim()),
    hasExplicitPriceRange: Boolean(
      draft.minPrice.trim() || draft.maxPrice.trim(),
    ),
    hasVoiceContext: Boolean(options?.voiceTranscript?.trim()),
  });

  const { data, error, response } = await supabase.functions.invoke(
    REPLACEMENT_REFINEMENT_FUNCTION_NAME,
    {
      body: requestBody(item, draft, options?.voiceTranscript),
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: options?.signal,
      timeout: CLIENT_TIMEOUT_MS,
    },
  );

  if (error) {
    const failure = await readSafeFailure(response);
    const status = response?.status;
    const errorType = functionErrorType(error);
    diagnosticLog("failure", {
      status,
      functionsErrorType: errorType,
      errorCode: failure.errorCode,
      responseMessage: failure.message ?? error.message,
      hasAuthenticatedSession: true,
      durationMs: Date.now() - startedAt,
    });
    throw new ReplacementRefinementAiError(
      refinementFailureMessage({
        status,
        errorType,
        errorCode: failure.errorCode,
      }),
      {
        status,
        errorCode: failure.errorCode,
        functionsErrorType: errorType,
      },
    );
  }

  const envelope = validateRefinementFunctionEnvelope(data);
  if (!envelope.ok) {
    diagnosticLog("failure", {
      status: response?.status ?? 200,
      functionsErrorType: "InvalidResponse",
      responseMessage: "Missing success suggestion envelope",
      hasAuthenticatedSession: true,
      durationMs: Date.now() - startedAt,
    });
    throw new ReplacementRefinementAiError(
      refinementFailureMessage({ errorCode: "INVALID_AI_RESPONSE" }),
      {
        status: response?.status,
        errorCode: "INVALID_AI_RESPONSE",
        functionsErrorType: "InvalidResponse",
      },
    );
  }

  diagnosticLog("response", {
    status: response?.status ?? 200,
    hasAuthenticatedSession: true,
    durationMs: Date.now() - startedAt,
  });
  return envelope.suggestion;
}
