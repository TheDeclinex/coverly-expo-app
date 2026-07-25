/**
 * Supabase Edge Function: barcode-verify
 * v26.2.1 — fix: client.auth.getUser(jwt) to avoid "Auth session missing!" error
 *
 * Two-step barcode verification:
 *   1. Optional: GPT-4o vision to extract barcode/model from an image (if no barcode supplied)
 *   2. UPCitemdb lookup for the barcode value
 * API keys stay server-side in OPENAI_API_KEY and UPCITEMDB_KEY secrets.
 *
 * Deploy (JWT verification ENABLED — authenticated Coverly users only):
 *   npx supabase functions deploy barcode-verify
 *
 * Set secrets:
 *   supabase secrets set OPENAI_API_KEY=sk-...
 *   supabase secrets set UPCITEMDB_KEY=<key>   (optional — uses free trial endpoint if absent)
 *
 * Auth: Supabase platform verifies the Bearer JWT before the handler runs.
 * Handler also validates the token server-side as defense-in-depth.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const EDGE_VERSION = 'v26.2.1';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// ── CORS ─────────────────────────────────────────────────────────────────────
// Wildcard — mirrors scan-room-photo (proven working). JWT is the real gate.
// Known live origins:
//   https://app.coverly.nz    — live app
//   https://cloud.uibakery.io — UIBakery builder + deployed host
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

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const UPCITEMDB_URL = 'https://api.upcitemdb.com/prod/trial/lookup';

// Max image payload: ~5 MB base64 ≈ ~3.75 MB raw
const MAX_IMAGE_BASE64_LEN = 6_700_000;
// Barcode sanity: UPC/EAN/model numbers are short
const MAX_BARCODE_LEN = 200;

interface BarcodeVerifyRequest {
  barcode?: string;
  imageBase64?: string;
  itemName?: string;
  category?: string;
  itemId?: string;
}

interface BarcodeExtractResult {
  found: boolean;
  type: 'barcode' | 'model_number' | 'serial_number' | 'qr_code' | 'none';
  value: string | null;
  confidence: number;
  brand: string | null;
  product_name: string | null;
}

interface UpcProduct {
  title?: string;
  brand?: string;
  model?: string;
  description?: string;
  images?: string[];
  offers?: Array<{ merchant?: string; price?: string; link?: string }>;
}

const GPT_BARCODE_SYSTEM = `You are a product label reader specialised in extracting model numbers and barcodes from appliance rating plates, packaging, and stickers. The image may be upside-down or at an angle — read all text regardless of orientation. Return ONLY a raw JSON object, no markdown, no explanation.`;

const GPT_BARCODE_USER = `Examine every line of text in this image carefully, including upside-down or rotated text.

Extraction priority (highest first):
1. Any line whose label is a synonym of 'model' (Model, Model No, Type, Item No, Part No, Cat No, Product No, Ref No, Art No, etc.)
2. A UPC or EAN barcode number (8–14 digits, usually under a barcode graphic).
3. Any other alphanumeric product/part number that looks like a model code.
4. A QR code — ONLY if you can clearly read the encoded text content.

Do NOT return serial numbers, approval numbers, voltage/frequency specs, or pure numeric serial/batch codes.

Return a JSON object with EXACTLY these fields:
- found: true if any identifier was found, false if none
- type: "barcode" | "model_number" | "serial_number" | "qr_code" | "none"
- value: the exact text of the best identifier (null if not found)
- confidence: 0–1 confidence you read it correctly
- brand: brand name if visible (null if not visible)
- product_name: product name or description from the label (null if not visible)`;

async function extractBarcodeFromImage(imageBase64: string, openAiKey: string): Promise<BarcodeExtractResult | null> {
  const body = {
    model: 'gpt-4o',
    max_completion_tokens: 500,
    messages: [
      { role: 'system', content: GPT_BARCODE_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: GPT_BARCODE_USER },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } },
        ],
      },
    ],
  };

  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;

  const json = await res.json() as any;
  const content = json?.choices?.[0]?.message?.content ?? '';
  try {
    const clean = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    return JSON.parse(clean) as BarcodeExtractResult;
  } catch {
    return null;
  }
}

async function lookupUpc(barcode: string, upcKey?: string): Promise<UpcProduct | null> {
  const url = `${UPCITEMDB_URL}?upc=${encodeURIComponent(barcode)}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (upcKey) headers['user_key'] = upcKey;

  const res = await fetch(url, { headers });
  if (!res.ok) return null;

  const json = await res.json() as any;
  const items: any[] = json?.items ?? [];
  if (!items.length) return null;

  const item = items[0];
  return {
    title: item.title || item.description || undefined,
    brand: item.brand || undefined,
    model: item.model || undefined,
    description: item.description || undefined,
    images: Array.isArray(item.images) ? item.images.slice(0, 3) : [],
    offers: Array.isArray(item.offers) ? item.offers.slice(0, 3) : [],
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, errorCode: 'METHOD_NOT_ALLOWED', error: 'POST only' }, 405, origin);
  }

  // ── JWT guard (layer 2)
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ success: false, errorCode: 'UNAUTHORIZED', error: 'Missing auth token' }, 401, origin);
  }
  const jwt = authHeader.slice(7);

  let userId: string | null = null;
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data, error } = await client.auth.getUser(jwt);
    if (error || !data.user) {
      return jsonResponse({ success: false, errorCode: 'UNAUTHORIZED', error: 'Invalid or expired session' }, 401, origin);
    }
    userId = data.user.id;
  } catch {
    return jsonResponse({ success: false, errorCode: 'UNAUTHORIZED', error: 'Auth check failed' }, 401, origin);
  }

  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  const upcKey = Deno.env.get('UPCITEMDB_KEY');

  let body: BarcodeVerifyRequest;
  try {
    body = await req.json() as BarcodeVerifyRequest;
  } catch {
    return jsonResponse({ success: false, errorCode: 'BAD_REQUEST', error: 'Invalid JSON body' }, 400, origin);
  }

  if (!body.barcode && !body.imageBase64) {
    return jsonResponse({ success: false, errorCode: 'BAD_REQUEST', error: 'Either barcode or imageBase64 is required' }, 400, origin);
  }

  // ── Input validation
  if (body.barcode && body.barcode.length > MAX_BARCODE_LEN) {
    return jsonResponse({ success: false, errorCode: 'BAD_REQUEST', error: 'barcode value too long' }, 400, origin);
  }
  if (body.imageBase64) {
    if (body.imageBase64.length > MAX_IMAGE_BASE64_LEN) {
      return jsonResponse({ success: false, errorCode: 'PAYLOAD_TOO_LARGE', error: 'Image payload exceeds 5 MB limit' }, 413, origin);
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(body.imageBase64.slice(0, 100))) {
      return jsonResponse({ success: false, errorCode: 'BAD_REQUEST', error: 'imageBase64 contains invalid characters' }, 400, origin);
    }
    if (!openAiKey) {
      return jsonResponse({ success: false, errorCode: 'MISSING_API_KEY', error: 'OPENAI_API_KEY secret not configured' }, 500, origin);
    }
  }

  const diagnostics: Record<string, unknown> = { edgeVersion: EDGE_VERSION, userId, requestOrigin: origin };

  try {
    let barcodeValue = body.barcode?.trim() ?? null;
    let extractResult: BarcodeExtractResult | null = null;

    // ── Step 1: GPT vision (only if no barcode supplied)
    if (!barcodeValue && body.imageBase64) {
      diagnostics.gptExtractionUsed = true;
      extractResult = await extractBarcodeFromImage(body.imageBase64, openAiKey!);
      diagnostics.gptExtractResult = extractResult
        ? { found: extractResult.found, type: extractResult.type, confidence: extractResult.confidence }
        : null;

      if (extractResult?.found && extractResult.value && extractResult.confidence >= 0.5) {
        barcodeValue = extractResult.value;
      } else {
        return jsonResponse({
          success: false, errorCode: 'BARCODE_NOT_FOUND',
          error: 'Could not read a barcode or model number from the image',
          extraction: extractResult, diagnostics,
        }, 200, origin);
      }
    }

    // ── Step 2: Model numbers / QR codes — skip UPC lookup, return synthetic product
    const isModelOrQr = extractResult?.type === 'model_number' || extractResult?.type === 'qr_code';
    if (isModelOrQr) {
      diagnostics.upcLookupSkipped = true;
      return jsonResponse({
        success: true, barcode: barcodeValue, barcodeType: extractResult?.type ?? 'model_number',
        productName: extractResult?.product_name ?? undefined, brand: extractResult?.brand ?? undefined,
        matchedProduct: null, confidence: extractResult?.confidence ?? 0.8,
        source: 'gpt_vision', diagnostics,
      }, 200, origin);
    }

    // ── Step 3: UPCitemdb lookup
    diagnostics.upcLookupBarcode = barcodeValue;
    const product = barcodeValue ? await lookupUpc(barcodeValue, upcKey) : null;
    diagnostics.upcFound = !!product;

    if (!product) {
      return jsonResponse({
        success: false, errorCode: 'PRODUCT_NOT_FOUND',
        error: `Barcode ${barcodeValue} not found in product database`,
        barcode: barcodeValue, extraction: extractResult, diagnostics,
      }, 200, origin);
    }

    return jsonResponse({
      success: true, barcode: barcodeValue, barcodeType: extractResult?.type ?? 'barcode',
      productName: product.title, brand: product.brand, matchedProduct: product,
      confidence: extractResult?.confidence ?? 1.0,
      source: extractResult ? 'gpt_vision' : 'supplied',
      diagnostics,
    }, 200, origin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ success: false, errorCode: 'INTERNAL_ERROR', error: msg, diagnostics }, 500, origin);
  }
});
