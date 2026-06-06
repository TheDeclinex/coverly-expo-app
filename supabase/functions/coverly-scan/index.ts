/**
 * coverly-scan — Supabase Edge Function (Deno runtime)
 *
 * Receives storage paths for user-uploaded images, creates short-lived signed
 * URLs server-side, calls OpenAI Vision (gpt-4o), and returns normalized
 * detected items.
 *
 * Required secrets (set in Supabase dashboard → Edge Functions → Secrets):
 *   OPENAI_API_KEY       — OpenAI API key (never exposed to mobile)
 *
 * Auto-available in all Edge Functions:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Storage policy requirement:
 *   inventory-photos bucket must allow service-role signed URL creation.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STORAGE_BUCKET = "inventory-photos";
const SIGNED_URL_EXPIRY_SECONDS = 120;
const OPENAI_MODEL = "gpt-4o";
const OPENAI_MAX_TOKENS = 2048;

type ScanMode =
  | "single_photo_room"
  | "single_item"
  | "multi_photo_room"
  | "video_room";

interface ScanRequestBody {
  mode: ScanMode;
  fileId: string;
  roomId: string;
  roomName?: string | null;
  imagePaths: string[];
}

interface DetectedItem {
  name: string;
  category: string | null;
  description: string | null;
  estimatedPrice: number | null;
  unitEstimatedPrice: number | null;
  quantity: number | null;
  brandMaker: string | null;
  modelSeries: string | null;
  conditionLabel: string | null;
  confidence: string | null;
  valuationBasis: string;
  priceSourceType: string;
  imageUrl: string | null;
  photoUrl: string | null;
}

function buildPrompt(mode: ScanMode, roomName?: string | null): string {
  const roomCtx = roomName ? ` in the ${roomName}` : "";

  if (mode === "single_item") {
    return `You are a home contents inventory assistant for UK households.
Analyse this close-up image of a single item and return detailed information.

Return ONLY a valid JSON object with this exact structure:
{
  "items": [
    {
      "name": "Specific item name",
      "category": "Electronics|Furniture|Appliances|Clothing|Jewellery|Art|Books|Sports|Tools|Kitchen|Bedroom|Bathroom|Garden|Other",
      "description": "Detailed description of the item including key features",
      "estimated_price": 150,
      "unit_estimated_price": 150,
      "quantity": 1,
      "confidence": "high|medium|low",
      "brand_maker": "Brand or manufacturer name, or null if unknown",
      "model_series": "Model or series name, or null if unknown",
      "condition_label": "Excellent|Good|Fair|Poor",
      "valuation_basis": "ai_estimate"
    }
  ]
}

Rules:
- Return exactly ONE item in the array.
- estimated_price is the current UK retail replacement cost in GBP (no currency symbol).
- Be specific about brand and model if visible.
- Use null for any fields you cannot determine.
- Do not include any text outside the JSON object.`;
  }

  if (mode === "multi_photo_room") {
    return `You are a home contents inventory assistant for UK households.
Analyse these multiple photos of the same room${roomCtx} and detect ALL distinct visible items.
Avoid listing the same item more than once across photos.

Return ONLY a valid JSON object with this exact structure:
{
  "items": [
    {
      "name": "Item name",
      "category": "Electronics|Furniture|Appliances|Clothing|Jewellery|Art|Books|Sports|Tools|Kitchen|Bedroom|Bathroom|Garden|Other",
      "description": "Brief description",
      "estimated_price": 150,
      "unit_estimated_price": null,
      "quantity": 1,
      "confidence": "high|medium|low",
      "brand_maker": null,
      "model_series": null,
      "condition_label": "Excellent|Good|Fair|Poor",
      "valuation_basis": "ai_estimate"
    }
  ]
}

Rules:
- List every distinct visible item — furniture, electronics, appliances, art, decorations.
- Do not duplicate items that appear in multiple photos.
- estimated_price is the current UK retail replacement cost in GBP (no currency symbol).
- Use null for fields you cannot determine.
- Do not include any text outside the JSON object.`;
  }

  return `You are a home contents inventory assistant for UK households.
Analyse this room photo${roomCtx} and detect ALL distinct visible items.

Return ONLY a valid JSON object with this exact structure:
{
  "items": [
    {
      "name": "Item name",
      "category": "Electronics|Furniture|Appliances|Clothing|Jewellery|Art|Books|Sports|Tools|Kitchen|Bedroom|Bathroom|Garden|Other",
      "description": "Brief description",
      "estimated_price": 150,
      "unit_estimated_price": null,
      "quantity": 1,
      "confidence": "high|medium|low",
      "brand_maker": null,
      "model_series": null,
      "condition_label": "Excellent|Good|Fair|Poor",
      "valuation_basis": "ai_estimate"
    }
  ]
}

Rules:
- List every distinct visible item — furniture, electronics, appliances, art, decorations, soft furnishings.
- estimated_price is the current UK retail replacement cost in GBP (no currency symbol).
- Use null for fields you cannot determine.
- Do not include any text outside the JSON object.`;
}

// deno-lint-ignore no-explicit-any
function normalizeItem(raw: any, mode: ScanMode, storagePath?: string): DetectedItem {
  return {
    name: typeof raw.name === "string" ? raw.name.trim() : "Unknown item",
    category: typeof raw.category === "string" ? raw.category : null,
    description: typeof raw.description === "string" ? raw.description : null,
    estimatedPrice:
      typeof raw.estimated_price === "number" ? raw.estimated_price : null,
    unitEstimatedPrice:
      typeof raw.unit_estimated_price === "number"
        ? raw.unit_estimated_price
        : null,
    quantity: typeof raw.quantity === "number" ? raw.quantity : 1,
    brandMaker:
      typeof raw.brand_maker === "string" ? raw.brand_maker : null,
    modelSeries:
      typeof raw.model_series === "string" ? raw.model_series : null,
    conditionLabel:
      typeof raw.condition_label === "string" ? raw.condition_label : null,
    confidence:
      typeof raw.confidence === "string" ? raw.confidence : null,
    valuationBasis: "ai_estimate",
    priceSourceType: "ai_scan",
    imageUrl:
      mode === "single_item" && storagePath ? storagePath : null,
    photoUrl: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "OpenAI not configured on this server" }, 500);
  }

  let body: ScanRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { mode, fileId, roomId, roomName, imagePaths } = body;

  if (!mode || !fileId || !roomId) {
    return jsonResponse({ error: "mode, fileId, and roomId are required" }, 400);
  }

  if (!imagePaths || imagePaths.length === 0) {
    return jsonResponse({ error: "imagePaths must be a non-empty array" }, 400);
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const signedUrls: string[] = [];
  for (const storagePath of imagePaths) {
    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

    if (error || !data?.signedUrl) {
      console.error(
        "[coverly-scan] Failed to sign URL for path:",
        storagePath,
        error?.message
      );
      continue;
    }
    signedUrls.push(data.signedUrl);
  }

  if (signedUrls.length === 0) {
    return jsonResponse(
      { error: "Could not generate signed URLs for the provided image paths" },
      400
    );
  }

  const prompt = buildPrompt(mode, roomName);

  const imageContent = signedUrls.map((url) => ({
    type: "image_url",
    image_url: { url, detail: "high" },
  }));

  let openaiResponse: Response;
  try {
    openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        max_tokens: OPENAI_MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...imageContent],
          },
        ],
      }),
    });
  } catch (err) {
    console.error("[coverly-scan] OpenAI fetch error:", err);
    return jsonResponse({ error: "Failed to reach OpenAI" }, 502);
  }

  if (!openaiResponse.ok) {
    const errText = await openaiResponse.text();
    console.error("[coverly-scan] OpenAI error:", openaiResponse.status, errText);
    return jsonResponse({ error: `OpenAI returned ${openaiResponse.status}` }, 502);
  }

  // deno-lint-ignore no-explicit-any
  let openaiData: any;
  try {
    openaiData = await openaiResponse.json();
  } catch {
    return jsonResponse({ error: "Failed to parse OpenAI response" }, 502);
  }

  const content: string = openaiData?.choices?.[0]?.message?.content ?? "{}";

  // deno-lint-ignore no-explicit-any
  let parsed: { items?: any[] } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    console.warn("[coverly-scan] Failed to parse GPT response as JSON:", content);
    parsed = { items: [] };
  }

  const rawItems: unknown[] = Array.isArray(parsed.items) ? parsed.items : [];
  const firstStoragePath = imagePaths[0];
  const items: DetectedItem[] = rawItems
    // deno-lint-ignore no-explicit-any
    .filter((r): r is Record<string, any> => typeof r === "object" && r !== null)
    .map((raw) => normalizeItem(raw, mode, firstStoragePath));

  console.log(
    `[coverly-scan] mode=${mode} fileId=${fileId} roomId=${roomId} imagesIn=${imagePaths.length} itemsOut=${items.length}`
  );

  return jsonResponse({ items });
});
