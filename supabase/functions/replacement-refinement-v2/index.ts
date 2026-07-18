import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  resolveReplacementRefinementModel,
  validateAiRefinementCandidate,
  type AiRefinementCandidate,
  type RefinementTextDraft,
} from "./model.ts";

const EDGE_VERSION = "replacement-refinement-v2-1";
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return response({ success: false, errorCode: "METHOD_NOT_ALLOWED", error: "POST only" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return response({ success: false, errorCode: "UNAUTHORIZED", error: "Missing auth token" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return response({ success: false, errorCode: "UNAUTHORIZED", error: "Invalid or expired session" }, 401);
  }

  let body: RefinementRequest;
  try {
    body = await req.json() as RefinementRequest;
  } catch {
    return response({ success: false, errorCode: "BAD_REQUEST", error: "Invalid JSON body" }, 400);
  }
  if (!body.itemId) {
    return response({ success: false, errorCode: "ITEM_CONTEXT_REQUIRED", error: "Choose an inventory item first" }, 400);
  }
  const draft = cleanDraft(body.draft);
  if (!draft.searchTerm) {
    return response({ success: false, errorCode: "SEARCH_TERM_REQUIRED", error: "Add a Search Term before using AI" }, 400);
  }

  const { data: item, error: itemError } = await userClient
    .from("inventory_items")
    .select("id,name,brand_maker,model_series,description,category")
    .eq("id", body.itemId)
    .single();
  if (itemError || !item) {
    return response({ success: false, errorCode: "ITEM_NOT_FOUND", error: "The item could not be accessed" }, 404);
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    return response({ success: false, errorCode: "MISSING_API_KEY", error: "AI assistance is not configured" }, 500);
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
      return response({ success: false, errorCode: "AI_REQUEST_FAILED", error: "AI could not improve the search right now" }, 502);
    }
    const envelope = await aiResponse.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const outputText = envelope.output?.[0]?.content?.[0]?.text ?? "";
    const candidate = JSON.parse(outputText) as AiRefinementCandidate;
    const validated = validateAiRefinementCandidate(candidate, draft, {
      name: item.name,
      brand: item.brand_maker,
      model: item.model_series,
      description: item.description,
      category: item.category,
    });
    return response({ success: true, draft: validated, edgeVersion: EDGE_VERSION });
  } catch {
    return response({ success: false, errorCode: "AI_RESPONSE_INVALID", error: "AI could not improve the search right now" }, 502);
  }
});
