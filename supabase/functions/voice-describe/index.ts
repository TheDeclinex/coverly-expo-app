/**
 * Local source for the existing authenticated `voice-describe` Edge Function.
 * This file is not deployed by the mobile build. It preserves the UI Bakery
 * request/response contract and adds optional item-edit targeting + quantity.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const EDGE_VERSION = "mobile-foundation-v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MAX_AUDIO_BASE64_LEN = 28_000_000;
const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const RESPONSES_URL = "https://api.openai.com/v1/responses";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ItemVoiceField =
  | "name" | "quantity" | "brand_maker" | "model_series"
  | "purchase_source" | "purchase_year_approx"
  | "original_purchase_price" | "replacement_price"
  | "description" | "notes";

interface VoiceDescribeRequest {
  audioBase64: string;
  mimeType: string;
  ext?: string;
  itemId?: string;
  currentName?: string;
  currentCategory?: string;
  currentDescription?: string;
  mode?: "item_edit";
  targetField?: ItemVoiceField;
  currentValues?: Record<string, string | number | null>;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeText(value: unknown): string {
  return String(value ?? "").slice(0, 4_000);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return response({ success: false, errorCode: "METHOD_NOT_ALLOWED", error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return response({ success: false, errorCode: "UNAUTHORIZED", error: "Missing auth token" }, 401);
  }

  try {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) {
      return response({ success: false, errorCode: "UNAUTHORIZED", error: "Invalid or expired session" }, 401);
    }
  } catch {
    return response({ success: false, errorCode: "UNAUTHORIZED", error: "Auth check failed" }, 401);
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    return response({ success: false, errorCode: "MISSING_API_KEY", error: "OPENAI_API_KEY secret not configured" }, 500);
  }

  let body: VoiceDescribeRequest;
  try {
    body = await req.json() as VoiceDescribeRequest;
  } catch {
    return response({ success: false, errorCode: "BAD_REQUEST", error: "Invalid JSON body" }, 400);
  }

  if (!body.audioBase64?.trim()) {
    return response({ success: false, errorCode: "BAD_REQUEST", error: "audioBase64 is required" }, 400);
  }
  if (body.audioBase64.length > MAX_AUDIO_BASE64_LEN) {
    return response({ success: false, errorCode: "PAYLOAD_TOO_LARGE", error: "Audio payload exceeds 20 MB limit" }, 413);
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(body.audioBase64.slice(0, 100))) {
    return response({ success: false, errorCode: "BAD_REQUEST", error: "audioBase64 contains invalid characters" }, 400);
  }

  const diagnostics: Record<string, unknown> = { edgeVersion: EDGE_VERSION };

  try {
    const mimeType = body.mimeType || "audio/webm";
    const ext = body.ext || (mimeType.includes("webm") ? "webm" : "m4a");
    const binary = atob(body.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const audioBlob = new Blob([bytes], { type: mimeType });
    diagnostics.audioSizeKb = Math.round(audioBlob.size / 1024);

    const audioForm = new FormData();
    audioForm.append("file", new File([audioBlob], `recording.${ext}`, { type: mimeType }));
    audioForm.append("model", "gpt-4o-transcribe");
    audioForm.append("response_format", "text");
    audioForm.append("prompt", "A spoken household inventory item description. Preserve brands, models, quantities, retailers, years and monetary values accurately.");

    const transcriptionResponse = await fetch(TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: audioForm,
    });
    diagnostics.transcribeStatus = transcriptionResponse.status;
    if (!transcriptionResponse.ok) {
      return response({ success: false, errorCode: "TRANSCRIBE_ERROR", error: `OpenAI transcription returned ${transcriptionResponse.status}`, diagnostics }, 502);
    }

    const transcript = (await transcriptionResponse.text()).trim();
    if (!transcript) return response({ success: false, errorCode: "EMPTY_TRANSCRIPT", error: "Empty transcript returned", diagnostics }, 502);
    diagnostics.transcriptLength = transcript.length;

    const targetInstruction = body.targetField
      ? `Only extract the requested target field: ${body.targetField}. Leave unrelated fields null.`
      : "Extract all explicitly stated supported item fields.";
    const currentContext = body.currentValues
      ? JSON.stringify(body.currentValues).slice(0, 6_000)
      : JSON.stringify({ name: body.currentName, category: body.currentCategory, description: body.currentDescription });

    const extractionResponse = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiKey}` },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        store: false,
        input: [
          {
            role: "system",
            content: "Extract structured household inventory item details. Extract only explicitly stated or strongly implied information; never guess. Return null and mark uncertain fields when unsure. Do not create commands or actions. " + targetInstruction,
          },
          {
            role: "user",
            content: `Current item context:\n${safeText(currentContext)}\n\nTranscript:\n${safeText(transcript)}`,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            strict: true,
            name: "item_voice_extraction",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                display_name: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
                category: { type: ["string", "null"] },
                brand: { type: ["string", "null"] },
                make: { type: ["string", "null"] },
                model: { type: ["string", "null"] },
                maker_artist_brand: { type: ["string", "null"] },
                model_title: { type: ["string", "null"] },
                serial_number: { type: ["string", "null"] },
                year_or_era: { type: ["string", "null"] },
                purchase_year: { type: ["string", "null"] },
                retailer_store_purchased_from: { type: ["string", "null"] },
                seller: { type: ["string", "null"] },
                purchase_source_type: { type: ["string", "null"], enum: [null, "retail_store", "online_store", "auction", "private_sale", "gift", "inheritance", "unknown"] },
                purchase_price: { type: ["number", "null"] },
                estimated_value: { type: ["number", "null"] },
                quantity: { type: ["number", "null"] },
                currency: { type: ["string", "null"] },
                condition: { type: ["string", "null"] },
                material_medium: { type: ["string", "null"] },
                original_or_copy: { type: ["string", "null"] },
                pricing_match_terms: { type: "array", items: { type: "string" } },
                notes: { type: ["string", "null"] },
                raw_summary: { type: ["string", "null"] },
                uncertain_fields: { type: "array", items: { type: "string" } },
              },
              required: [
                "display_name", "description", "category", "brand", "make", "model",
                "maker_artist_brand", "model_title", "serial_number", "year_or_era",
                "purchase_year", "retailer_store_purchased_from", "seller",
                "purchase_source_type", "purchase_price", "estimated_value", "quantity",
                "currency", "condition", "material_medium", "original_or_copy",
                "pricing_match_terms", "notes", "raw_summary", "uncertain_fields",
              ],
            },
          },
        },
      }),
    });
    diagnostics.extractStatus = extractionResponse.status;
    if (!extractionResponse.ok) {
      return response({ success: true, transcript, extraction: null, extractionError: `Field extraction returned ${extractionResponse.status}`, diagnostics });
    }

    const extractionEnvelope = await extractionResponse.json() as Record<string, unknown>;
    let extraction: unknown = null;
    try {
      const output = extractionEnvelope.output as Array<{ content?: Array<{ text?: string }> }> | undefined;
      const content = output?.[0]?.content?.[0]?.text ?? "";
      extraction = JSON.parse(content);
    } catch {
      diagnostics.extractParseError = true;
    }
    return response({ success: true, transcript, extraction, diagnostics });
  } catch (error) {
    return response({ success: false, errorCode: "INTERNAL_ERROR", error: error instanceof Error ? error.message : "Unknown voice processing error", diagnostics }, 500);
  }
});
