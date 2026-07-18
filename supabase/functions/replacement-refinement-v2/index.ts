import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  classifyOpenAiRefinementFailure,
  extractReplacementRefinementOutputText,
  resolveReplacementRefinementModel,
  validateAiRefinementCandidate,
  type AiRefinementCandidate,
  type RefinementTextDraft,
} from "./model.ts";

const EDGE_VERSION = "replacement-refinement-v2-3";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RESPONSES_URL = "https://api.openai.com/v1/responses";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RefinementRequest {
  itemId?: string;
  draft?: Partial<RefinementTextDraft>;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function failureResponse(requestId: string, code: string, message: string, status: number) {
  return response({
    success: false,
    code,
    message,
    errorCode: code,
    error: message,
    requestId,
    edgeVersion: EDGE_VERSION,
  }, status);
}

function cleanDraft(value: Partial<RefinementTextDraft> | undefined): RefinementTextDraft {
  const clean = (field: unknown, max: number) => typeof field === "string"
    ? field.trim().replace(/\s+/g, " ").slice(0, max)
    : "";
  return {
    searchTerm: clean(value?.searchTerm, 120),
    brand: clean(value?.brand, 80),
    model: clean(value?.model, 100),
    additionalDetails: clean(value?.additionalDetails, 500),
  };
}

serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return failureResponse(requestId, "METHOD_NOT_ALLOWED", "POST only", 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return failureResponse(requestId, "MISSING_AUTH_TOKEN", "Missing auth token", 401);
  }
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return failureResponse(requestId, "MISSING_AUTH_TOKEN", "Missing auth token", 401);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return failureResponse(requestId, "FUNCTION_CONFIGURATION_ERROR", "AI assistance is not configured", 500);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError) {
    console.warn(JSON.stringify({
      source: "replacement-refinement-v2",
      edgeVersion: EDGE_VERSION,
      stage: "auth_token_rejected",
      requestId,
      authStatus: typeof authError.status === "number" ? authError.status : undefined,
      authCode: typeof authError.code === "string" ? authError.code : undefined,
    }));
    return failureResponse(requestId, "INVALID_AUTH_TOKEN", "Invalid or expired session", 401);
  }
  if (!authData.user) {
    return failureResponse(requestId, "AUTHENTICATED_USER_NOT_FOUND", "Authenticated user was not found", 401);
  }

  let body: RefinementRequest;
  try {
    body = await req.json() as RefinementRequest;
  } catch {
    return failureResponse(requestId, "BAD_REQUEST", "Invalid JSON body", 400);
  }
  if (!body.itemId) {
    return failureResponse(requestId, "ITEM_CONTEXT_REQUIRED", "Choose an inventory item first", 400);
  }
  const draft = cleanDraft(body.draft);
  if (!draft.searchTerm) {
    return failureResponse(requestId, "SEARCH_TERM_REQUIRED", "Add a Search Term before using AI", 400);
  }

  const { data: item, error: itemError } = await userClient
    .from("inventory_items")
    .select("id,name,brand_maker,model_series,description,category")
    .eq("id", body.itemId)
    .single();
  if (itemError || !item) {
    return failureResponse(requestId, "ITEM_NOT_FOUND", "The item could not be accessed", 404);
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    return failureResponse(requestId, "FUNCTION_CONFIGURATION_ERROR", "AI assistance is not configured", 500);
  }

  const model = resolveReplacementRefinementModel(Deno.env.get("OPENAI_REFINEMENT_V2_MODEL"));
  try {
    const aiResponse = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiKey}` },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: "system",
            content: [
              "You edit replacement-product search criteria. You are an editor, not a product expert.",
              "Use only facts explicitly present in the supplied draft or item context.",
              "Never invent or infer brand, model, size, capacity, colour, material, technical specifications, product series, price, or condition.",
              "You may improve wording, organize existing details, remove duplication, clarify unambiguous units, and move existing facts to the correct field.",
              "When uncertain, preserve the user's wording or leave the field unchanged.",
              "Do not return prices or actions.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              draft,
              itemContext: {
                name: item.name,
                brand: item.brand_maker,
                model: item.model_series,
                description: item.description,
                category: item.category,
              },
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            strict: true,
            name: "replacement_refinement_v2",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                searchTerm: { type: "string" },
                brand: { type: "string" },
                model: { type: "string" },
                additionalDetails: { type: "string" },
                suggestedChips: { type: "array", items: { type: "string" }, maxItems: 6 },
              },
              required: ["searchTerm", "brand", "model", "additionalDetails", "suggestedChips"],
            },
          },
        },
      }),
    });
    if (!aiResponse.ok) {
      let providerPayload: unknown = null;
      try {
        providerPayload = await aiResponse.json();
      } catch {
        // A non-JSON provider error is still classified by HTTP status.
      }
      const code = classifyOpenAiRefinementFailure(aiResponse.status, providerPayload);
      const providerError = providerPayload && typeof providerPayload === "object" && "error" in providerPayload
        ? (providerPayload as { error?: { type?: unknown; code?: unknown } }).error
        : null;
      console.error(JSON.stringify({
        source: "replacement-refinement-v2",
        edgeVersion: EDGE_VERSION,
        stage: "openai_request_failed",
        requestId,
        model,
        providerStatus: aiResponse.status,
        providerErrorType: typeof providerError?.type === "string" ? providerError.type : undefined,
        providerErrorCode: typeof providerError?.code === "string" ? providerError.code : undefined,
        code,
      }));
      const status = code === "AI_RATE_LIMITED" ? 429 : 502;
      return failureResponse(requestId, code, "AI could not improve the search right now", status);
    }
    const envelope = await aiResponse.json() as unknown;
    const outputText = extractReplacementRefinementOutputText(envelope);
    if (!outputText) {
      const output = envelope && typeof envelope === "object" && Array.isArray((envelope as { output?: unknown }).output)
        ? (envelope as { output: Array<{ type?: unknown }> }).output
        : [];
      console.error(JSON.stringify({
        source: "replacement-refinement-v2",
        edgeVersion: EDGE_VERSION,
        stage: "openai_output_text_missing",
        requestId,
        model,
        providerResponseId: envelope && typeof envelope === "object" && typeof (envelope as { id?: unknown }).id === "string"
          ? (envelope as { id: string }).id
          : undefined,
        outputTypes: output.map((item) => item?.type).filter((value) => typeof value === "string"),
      }));
      return failureResponse(requestId, "AI_RESPONSE_INVALID", "AI could not improve the search right now", 502);
    }
    const candidate = JSON.parse(outputText) as AiRefinementCandidate;
    const validated = validateAiRefinementCandidate(candidate, draft, {
      name: item.name,
      brand: item.brand_maker,
      model: item.model_series,
      description: item.description,
      category: item.category,
    });
    return response({ success: true, draft: validated, requestId, edgeVersion: EDGE_VERSION });
  } catch (error) {
    const code = error instanceof SyntaxError ? "AI_RESPONSE_INVALID" : "AI_REQUEST_FAILED";
    console.error(JSON.stringify({
      source: "replacement-refinement-v2",
      edgeVersion: EDGE_VERSION,
      stage: code === "AI_RESPONSE_INVALID" ? "ai_response_invalid" : "ai_request_exception",
      requestId,
      model,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    return failureResponse(requestId, code, "AI could not improve the search right now", 502);
  }
});
