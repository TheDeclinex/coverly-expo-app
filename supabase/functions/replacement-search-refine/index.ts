import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import {
  REFINEMENT_LIMITS,
  extractAiResponseText,
  validateAiSuggestion,
  validateRefinementRequest,
} from "./model.ts";

const EDGE_VERSION = "v1.1.0-auth-contract-cleanup";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 15_000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function log(event: string, details: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      source: "replacement-search-refine",
      edgeVersion: EDGE_VERSION,
      event,
      ...details,
    }),
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return response(
      { success: false, errorCode: "METHOD_NOT_ALLOWED", error: "POST only" },
      405,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return response(
      {
        success: false,
        errorCode: "UNAUTHORIZED",
        error: "Missing auth token",
      },
      401,
    );
  }
  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) {
    return response(
      {
        success: false,
        errorCode: "UNAUTHORIZED",
        error: "Missing auth token",
      },
      401,
    );
  }
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) {
      log("auth_failed", {
        authErrorCode: error?.code ?? "USER_NOT_FOUND",
        hasBearerToken: true,
      });
      return response(
        {
          success: false,
          errorCode: "UNAUTHORIZED",
          error: "Invalid or expired session",
        },
        401,
      );
    }
  } catch {
    log("auth_check_failed", { hasBearerToken: true });
    return response(
      { success: false, errorCode: "UNAUTHORIZED", error: "Auth check failed" },
      401,
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > REFINEMENT_LIMITS.request) {
    return response(
      {
        success: false,
        errorCode: "PAYLOAD_TOO_LARGE",
        error: "Refinement request is too large",
      },
      413,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return response(
      { success: false, errorCode: "BAD_REQUEST", error: "Invalid JSON body" },
      400,
    );
  }
  const validation = validateRefinementRequest(rawBody);
  if (!validation.ok) {
    return response(
      {
        success: false,
        errorCode: "INVALID_REFINEMENT_INPUT",
        error: validation.error,
      },
      400,
    );
  }
  const request = validation.value;

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    return response(
      {
        success: false,
        errorCode: "MISSING_API_KEY",
        error: "AI refinement is unavailable",
      },
      500,
    );
  }
  const model =
    Deno.env.get("OPENAI_REPLACEMENT_REFINEMENT_MODEL")?.trim() ||
    "gpt-4.1-mini";
  const startedAt = Date.now();
  log("request_started", {
    model,
    hasBrand: Boolean(request.draft.brandMaker || request.item.brandMaker),
    hasModel: Boolean(request.draft.modelSeries || request.item.modelSeries),
    hasDetails: Boolean(
      request.draft.additionalDetails || request.item.description,
    ),
    hasPriceRange:
      request.draft.minPrice != null || request.draft.maxPrice != null,
    hasVoiceContext: Boolean(request.voiceTranscript),
  });

  try {
    const openAiResponse = await fetchWithTimeout(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: "system",
            content: [
              "Improve replacement-listing search criteria for a New Zealand household inventory app.",
              "Return structured fields only. Produce a concise commerce-oriented search term and remove duplicates.",
              "Preserve useful user-entered values. Never invent a brand or model.",
              "Only return brand/model values explicitly supported by the supplied item, draft, or voice context.",
              "Remove room position, surrounding-object, camera-composition, and generic photographic narration.",
              "Remove original purchase-source history such as purchased from, bought at, or originally purchased from a retailer. Do not turn saved retailer history into a replacement-search constraint.",
              "Keep useful intrinsic attributes such as product type, colour, material, size, capacity, variant, distinctive visible features, and observable condition.",
              "The draft selectedCriteria contains condition and country preferences. Respect them but do not repeat new, used, NZ, or New Zealand wording in searchTerm or additionalDetails.",
              "Return minPrice or maxPrice only when the same explicit bound exists in the supplied draft; never infer a price from the item.",
              "Prefer retail-relevant attributes. Do not run a listing search and do not suggest item database changes.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify(request),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            strict: true,
            name: "replacement_search_refinement",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                searchTerm: {
                  type: ["string", "null"],
                  maxLength: REFINEMENT_LIMITS.searchTerm,
                },
                brandMaker: {
                  type: ["string", "null"],
                  maxLength: REFINEMENT_LIMITS.brand,
                },
                modelSeries: {
                  type: ["string", "null"],
                  maxLength: REFINEMENT_LIMITS.model,
                },
                additionalDetails: {
                  type: ["string", "null"],
                  maxLength: REFINEMENT_LIMITS.details,
                },
                minPrice: {
                  type: ["number", "null"],
                  minimum: 0,
                  maximum: REFINEMENT_LIMITS.maxPrice,
                },
                maxPrice: {
                  type: ["number", "null"],
                  minimum: 0,
                  maximum: REFINEMENT_LIMITS.maxPrice,
                },
                rationale: {
                  type: ["string", "null"],
                  maxLength: REFINEMENT_LIMITS.rationale,
                },
              },
              required: [
                "searchTerm",
                "brandMaker",
                "modelSeries",
                "additionalDetails",
                "minPrice",
                "maxPrice",
                "rationale",
              ],
            },
          },
        },
      }),
    });
    if (!openAiResponse.ok) {
      log("openai_failed", {
        status: openAiResponse.status,
        durationMs: Date.now() - startedAt,
      });
      return response(
        {
          success: false,
          errorCode: "AI_REFINEMENT_UNAVAILABLE",
          error:
            "AI refinement is temporarily unavailable. You can continue manually.",
        },
        502,
      );
    }

    const envelope = (await openAiResponse.json()) as Record<string, unknown>;
    let rawSuggestion: unknown;
    try {
      rawSuggestion = JSON.parse(extractAiResponseText(envelope) ?? "");
    } catch {
      log("response_parse_failed", { durationMs: Date.now() - startedAt });
      return response(
        {
          success: false,
          errorCode: "INVALID_AI_RESPONSE",
          error:
            "AI refinement is temporarily unavailable. You can continue manually.",
        },
        502,
      );
    }

    const suggestion = validateAiSuggestion(rawSuggestion, request);
    if (!suggestion.ok) {
      log("response_validation_failed", { durationMs: Date.now() - startedAt });
      return response(
        {
          success: false,
          errorCode: "INVALID_AI_RESPONSE",
          error:
            "AI refinement is temporarily unavailable. You can continue manually.",
        },
        502,
      );
    }

    log("request_completed", {
      durationMs: Date.now() - startedAt,
      rejectedIdentityFieldCount: suggestion.rejectedFields?.length ?? 0,
    });
    return response({ success: true, suggestion: suggestion.value }, 200);
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "AbortError";
    log(timedOut ? "request_timed_out" : "request_failed", {
      durationMs: Date.now() - startedAt,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return response(
      {
        success: false,
        errorCode: timedOut
          ? "AI_REFINEMENT_TIMEOUT"
          : "AI_REFINEMENT_UNAVAILABLE",
        error: timedOut
          ? "AI refinement took too long. You can still edit the search manually."
          : "AI refinement is temporarily unavailable. You can continue manually.",
      },
      timedOut ? 504 : 502,
    );
  }
});
