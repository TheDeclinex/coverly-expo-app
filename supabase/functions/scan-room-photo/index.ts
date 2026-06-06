/**
 * Supabase Edge Function: scan-room-photo
 * v2 — Quality prompts, quantity-aware detection, descriptive naming, extended diagnostics.
 *
 * Deploy:
 *   npx supabase functions deploy scan-room-photo --no-verify-jwt
 *
 * Set secret:
 *   supabase secrets set OPENAI_API_KEY=sk-...
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Version marker — bump this whenever the edge function is redeployed so the
// client can confirm it is running the expected version via diagnostics.
const EDGE_FUNCTION_VERSION = 'v24.2.2-scan-quality';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
// 8000 tokens — enough for busy scenes, 5-6 photo batches, video frames, full descriptions
const MAX_TOKENS = 8000;

// Coverly canonical category list
const VALID_CATEGORIES = new Set([
  'General', 'Furniture', 'Electronics', 'Appliances', 'Lighting',
  'Decor', 'Clothing', 'Sporting', 'Tools', 'Art', 'Jewellery',
  'Outdoor', 'Kitchen', 'Garden',
]);

// Map old/AI-hallucinated category names → Coverly canonical names
const CATEGORY_MAP: Record<string, string> = {
  'kitchenware': 'Kitchen',
  'kitchen': 'Kitchen',
  'bathroom': 'General',
  'bedding': 'General',
  'bedroom': 'Furniture',
  'storage': 'Furniture',
  'collectibles': 'Decor',
  'musical instruments': 'General',
  'toys': 'General',
  'books': 'General',
  'artwork': 'Art',
  'sports': 'Sporting',
  'sport': 'Sporting',
  'sporting goods': 'Sporting',
  'electronics': 'Electronics',
  'appliance': 'Appliances',
  'light': 'Lighting',
  'lamp': 'Lighting',
  'tool': 'Tools',
  'jewel': 'Jewellery',
  'jewelry': 'Jewellery',
  'outdoor': 'Outdoor',
  'garden': 'Garden',
  'clothing': 'Clothing',
  'clothes': 'Clothing',
  'furniture': 'Furniture',
  'decor': 'Decor',
  'decoration': 'Decor',
  'decorative': 'Decor',
  'art': 'Art',
};

function normaliseCategory(raw: string | undefined): string {
  if (!raw) return 'General';
  if (VALID_CATEGORIES.has(raw)) return raw;
  const lower = raw.toLowerCase().trim();
  if (VALID_CATEGORIES.has(lower.charAt(0).toUpperCase() + lower.slice(1))) {
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) return val;
  }
  return 'General';
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScanImage {
  id: string;
  imageBase64: string;
  mimeType?: string;
  sourceName?: string;
}

interface ScanRequest {
  mode: 'single_photo' | 'multi_photo' | 'video_frames';
  images: ScanImage[];
  context?: { propertyId?: string; fileId?: string; roomName?: string };
  model?: string;
}

interface RawItem {
  name?: string;
  description?: string;
  category?: string;
  confidence?: number;
  estimatedPrice?: number;
  unitEstimatedPrice?: number;
  brand_guess?: string | null;
  pin?: { x: number; y: number };
  sourceImageId?: string | number;
  sourcePhotoIndex?: number;
  seenInPhotos?: number[];
  mergeConfidence?: number;
  quantity?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function extractJson(content: string): unknown[] {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : content).trim();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { /* fall through to recovery */ }

  const items: unknown[] = [];
  let depth = 0; let start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (raw[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { items.push(JSON.parse(raw.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  return items;
}

// ── System prompt (shared across all modes) ───────────────────────────────────
const SYSTEM_PROMPT = `You are an expert household contents inventory assistant. Your task is to create a thorough replacement-value home contents inventory from one or more room photos.

DETECTION RULES — what to include:
- All clearly visible, individually replaceable household contents
- Furniture (sofas, chairs, tables, beds, desks, dressers, shelving, wardrobes, etc.)
- Electronics (TVs, computers, monitors, speakers, gaming consoles, cameras, tablets, phones, etc.)
- Appliances (fridges, washing machines, dishwashers, microwaves, kettles, toasters, coffee machines, etc.)
- Lighting (floor lamps, table lamps, pendant lights, desk lamps, wall lights, etc.)
- Decor (ornaments, vases, picture frames, clocks, candles, cushions, throws, rugs, mirrors, plants in pots, etc.)
- Clothing (visible jackets, shoes, bags, visible clothing items, etc.)
- Sporting equipment
- Tools
- Art (paintings, prints, sculptures, etc.)
- Jewellery if visible
- Outdoor and garden items if visible
- Kitchen items (utensils, cookware, crockery, cutlery, appliances, etc.)
- Books, board games, toys, instruments
- Freestanding storage units
- Soft furnishings (rugs, cushions, throws, curtains, blinds)
- Any visible household contents a user would want in a home contents insurance inventory

Be thorough. Do NOT stop after listing only the most obvious items. Busy photos may contain 20+ valid items. Return ALL valid items you can reasonably identify.

DETECTION RULES — what to exclude:
- Walls, floors, ceilings, tiles, benchtops, skirting boards, window frames
- Power outlets, light switches, fixed wiring
- Handles, hinges, knobs, drawer pulls
- Cords and cables (unless a clearly distinct valuable item)
- Built-in cabinetry, countertops, fixed shelving (unless freestanding)
- Shadows, reflections, blurry unidentifiable objects
- Labels or text as standalone items
- Sub-parts of larger items (chair legs, keyboard keys, TV stand legs, shelf dividers, cabinet doors)

NAMING RULES:
Item names must be short but descriptive. Never use generic placeholder names.

BAD: TV, Chair, Table, Lamp, Cabinet, Storage, Object, Appliance, Furniture
GOOD: Black flat-screen TV, Light grey fabric armchair, Round black coffee table, Cream fabric 3-seat sofa, Timber 6-drawer dresser, Stainless steel electric kettle

Include in name where visible:
- Colour
- Material or texture
- Form factor or size
- Item type and function
- Distinguishing visible feature

Include brand in name ONLY when clearly printed or visible on that specific item. Never guess brand.

DESCRIPTION RULES:
Description is MANDATORY. Never leave blank. Exactly 2 sentences.
Sentence 1: visible colour, material, form factor, and item type.
Sentence 2: visible distinguishing features, condition, placement, or visible brand/model.
No hedging language (do not use: appears to be, possibly, maybe, looks like). Describe only what is clearly visible.

QUANTITY RULES:
For repeated identical or near-identical items, create ONE grouped item record with quantity instead of many separate cards.
- 6 matching dining chairs → one item, quantity 6
- Many books on a shelf → one item "Assorted paperback books", quantity = visible estimate
- Forks in a drawer → one item "Stainless steel forks", quantity = visible count
- Matching plates, glasses, bowls, cups, tools → group with quantity
- quantity must be a positive integer (minimum 1)
- For a single item, quantity = 1
- Count visible units; for dense groups estimate as accurately as possible
- Do NOT count appearances across photos as separate quantity — count physical items

PRICING RULES:
- unitEstimatedPrice = NZD replacement value for ONE unit
- estimatedPrice = TOTAL NZD value for the grouped record = unitEstimatedPrice × quantity
- For single items (quantity 1): estimatedPrice = unitEstimatedPrice
- Use realistic NZD market/replacement values
- Numbers only, no currency symbols

PIN RULES:
- Every item MUST have a pin
- pin = approximate visual centre of the actual item, as { "x": 0-100, "y": 0-100 } percentage from top-left
- For large objects: centre of the visible object
- For partially visible objects: centre of the visible portion
- For grouped bulk items: centre of the visible cluster
- Do NOT pin the general room area or a nearby item

CATEGORY — use ONLY these values:
General | Furniture | Electronics | Appliances | Lighting | Decor | Clothing | Sporting | Tools | Art | Jewellery | Outdoor | Kitchen | Garden

OUTPUT RULES:
- Return ONLY a raw JSON array
- No markdown, no code fences, no explanation text
- Every item must be a complete JSON object with all required fields`;

// ── Per-mode user prompt ──────────────────────────────────────────────────────
function buildUserPrompt(mode: ScanRequest['mode'], imageCount: number): string {
  const FIELDS = `Each item must have EXACTLY these fields:
{
  "name": "short descriptive label with colour+material+type",
  "description": "REQUIRED — exactly 2 sentences",
  "category": "one of the allowed Coverly categories",
  "quantity": 1,
  "unitEstimatedPrice": 0,
  "estimatedPrice": 0,
  "confidence": 0.0,
  "brand_guess": null,
  "pin": { "x": 0, "y": 0 },
  "sourceImageId": "photo_1"
}`;

  if (mode === 'single_photo') {
    return `Inspect this room photo carefully and thoroughly.

List EVERY clearly visible, individually replaceable household item.
Do NOT stop after the most obvious items. Look carefully at the entire image including corners, shelves, walls, and surfaces.

Group repeated identical items (e.g. matching chairs, stacked books, sets of utensils) into one record with quantity > 1.

${FIELDS}

For sourceImageId use "photo_1".
Return ONLY the raw JSON array.`;
  }

  if (mode === 'multi_photo') {
    return `You are given ${imageCount} room photo${imageCount > 1 ? 's' : ''}. Photo IDs are photo_1, photo_2, … photo_${imageCount} (1-based).

━━━ PHASE 1 — EXHAUSTIVE PER-PHOTO DETECTION ━━━
Work through each photo in order.
For EACH photo independently, identify EVERY clearly visible, individually replaceable household item.
- Be thorough on EVERY photo — do not reduce effort for later photos
- ${imageCount > 1 ? `Photo batches of ${imageCount} photos must still receive full detection per photo` : ''}
- List all items you see — furniture, electronics, decor, appliances, art, soft furnishings, kitchenware, clothing, books, and all valid household contents

━━━ PHASE 2 — CROSS-PHOTO DEDUPLICATE ━━━
After completing detection across all photos, review your full list.
Merge ONLY when confident the SAME physical object appears in multiple photos.
Merge criteria: same object type + same colour/material/features + same approximate room position.
When uncertain — keep separate entries. Prefer under-merging over over-merging.

QUANTITY RULE FOR MULTI-PHOTO:
Count physical items, NOT appearances.
If 6 dining chairs appear in photo 1 and the same chairs appear in photo 2, quantity = 6 (not 12).
Only increase quantity if ADDITIONAL distinct physical items are visible.

For each item in the final list:
- sourceImageId = photo ID where item is most clearly visible (e.g. "photo_2")
- seenInPhotos = array of all photo IDs where item appears (e.g. ["photo_1", "photo_2"])
- mergeConfidence = 0.0–1.0 confidence that seenInPhotos entries are the same physical object

${FIELDS}

Return ONLY the raw JSON array.`;
  }

  // video_frames
  return `You are given ${imageCount} sequential video frame${imageCount > 1 ? 's' : ''} from a continuous room sweep. Frame IDs are photo_1 … photo_${imageCount} (1-based, in order).

Process all frames as one continuous scene.
Build a running inventory as you move through the frames.
If an item already listed reappears in a later frame — DO NOT list it again.
Use the frame where the item is most clearly visible for its pin and sourceImageId.

Be exhaustive — detect furniture, electronics, appliances, decor, soft furnishings, art, and all visible replaceable household contents.

${FIELDS}

Return ONLY the raw JSON array.`;
}

// ── Build OpenAI request body ─────────────────────────────────────────────────
function buildOpenAiBody(req: ScanRequest): object {
  const model = req.model ?? DEFAULT_MODEL;

  const imageContent = req.images.map((img) => ({
    type: 'image_url',
    image_url: {
      url: `data:${img.mimeType ?? 'image/jpeg'};base64,${img.imageBase64}`,
      detail: 'high',
    },
  }));

  const userPrompt = buildUserPrompt(req.mode, req.images.length);

  return {
    model,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          ...imageContent,
        ],
      },
    ],
  };
}

// ── Normalise sourceImageId → 0-based sourcePhotoIndex ───────────────────────
function resolveSourcePhotoIndex(i: RawItem): number | undefined {
  if (typeof i.sourcePhotoIndex === 'number') return i.sourcePhotoIndex;
  if (i.sourceImageId !== undefined) {
    const str = String(i.sourceImageId).toLowerCase().replace('photo_', '').trim();
    const parsed = Number(str);
    if (!isNaN(parsed)) {
      return parsed > 0 ? parsed - 1 : 0;
    }
  }
  return undefined;
}

function resolveSeenInPhotos(i: RawItem, sourcePhotoIndex: number | undefined): number[] | undefined {
  if (Array.isArray(i.seenInPhotos)) {
    return i.seenInPhotos.map((n: number | string) => {
      const str = String(n).toLowerCase().replace('photo_', '').trim();
      const parsed = Number(str);
      return !isNaN(parsed) && parsed > 0 ? parsed - 1 : 0;
    });
  }
  return sourcePhotoIndex !== undefined ? [sourcePhotoIndex] : undefined;
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, errorCode: 'METHOD_NOT_ALLOWED', message: 'POST only', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 405);
  }

  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) {
    return jsonResponse({ success: false, errorCode: 'MISSING_API_KEY', message: 'OPENAI_API_KEY secret not configured', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 500);
  }

  let scanReq: ScanRequest;
  try {
    scanReq = await req.json() as ScanRequest;
  } catch {
    return jsonResponse({ success: false, errorCode: 'BAD_REQUEST', message: 'Invalid JSON body', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 400);
  }

  if (!scanReq.images || scanReq.images.length === 0) {
    return jsonResponse({ success: false, errorCode: 'NO_IMAGES', message: 'images array is required and must not be empty', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 400);
  }

  const diagnostics: Record<string, unknown> = {
    edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    model: scanReq.model ?? DEFAULT_MODEL,
    mode: scanReq.mode ?? 'single_photo',
    imageCount: scanReq.images.length,
    maxTokens: MAX_TOKENS,
    rawItemCount: 0,
    validItemCount: 0,
    quantityItemCount: 0,
    totalQuantityCount: 0,
    finishReason: null,
    responseContentLength: 0,
  };

  try {
    const openAiBody = buildOpenAiBody(scanReq);
    const openAiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
      body: JSON.stringify(openAiBody),
    });

    const openAiJson = await openAiRes.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      error?: { message: string; code?: string };
      usage?: { completion_tokens?: number; prompt_tokens?: number; total_tokens?: number };
    };

    if (openAiJson.error) {
      return jsonResponse({
        success: false,
        errorCode: openAiJson.error.code ?? 'OPENAI_ERROR',
        message: openAiJson.error.message,
        diagnostics,
      }, 502);
    }

    const choice = openAiJson.choices?.[0];
    diagnostics.finishReason = choice?.finish_reason ?? null;
    if (openAiJson.usage) {
      diagnostics.completionTokens = openAiJson.usage.completion_tokens ?? null;
      diagnostics.promptTokens = openAiJson.usage.prompt_tokens ?? null;
    }

    const content = choice?.message?.content;
    if (!content) {
      return jsonResponse({ success: false, errorCode: 'EMPTY_RESPONSE', message: 'OpenAI returned no content', diagnostics }, 502);
    }

    diagnostics.responseContentLength = content.length;
    const rawItems = extractJson(content) as RawItem[];
    diagnostics.rawItemCount = rawItems.length;

    const validItems = rawItems
      .filter(i => i.name && typeof i.name === 'string' && i.name.trim())
      .map(i => {
        const quantity = typeof i.quantity === 'number' && i.quantity >= 1 ? Math.round(i.quantity) : 1;
        const rawUnit = Number(i.unitEstimatedPrice);
        const rawTotal = Number(i.estimatedPrice);
        let unitEstimatedPrice: number;
        let estimatedPrice: number;

        if (!isNaN(rawUnit) && rawUnit > 0) {
          unitEstimatedPrice = rawUnit;
          estimatedPrice = quantity > 1 ? Math.round(rawUnit * quantity * 100) / 100 : rawUnit;
        } else if (!isNaN(rawTotal) && rawTotal > 0) {
          estimatedPrice = rawTotal;
          unitEstimatedPrice = quantity > 1 ? Math.round((rawTotal / quantity) * 100) / 100 : rawTotal;
        } else {
          unitEstimatedPrice = 1;
          estimatedPrice = quantity;
        }

        const sourcePhotoIndex = resolveSourcePhotoIndex(i);
        const seenInPhotos = resolveSeenInPhotos(i, sourcePhotoIndex);
        const category = normaliseCategory(i.category);

        return {
          name: i.name!.trim(),
          description: i.description?.trim() || '',
          category,
          quantity,
          unitEstimatedPrice,
          estimatedPrice,
          confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0.8)),
          brand_guess: i.brand_guess ?? undefined,
          pin: i.pin ? { x: Math.min(100, Math.max(0, i.pin.x)), y: Math.min(100, Math.max(0, i.pin.y)) } : undefined,
          sourcePhotoIndex,
          sourceImageId: i.sourceImageId,
          seenInPhotos,
          mergeConfidence: i.mergeConfidence,
        };
      });

    diagnostics.validItemCount = validItems.length;
    diagnostics.quantityItemCount = validItems.filter(i => i.quantity > 1).length;
    diagnostics.totalQuantityCount = validItems.reduce((s, i) => s + i.quantity, 0);

    return jsonResponse({ success: true, items: validItems, diagnostics });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ success: false, errorCode: 'INTERNAL_ERROR', message: msg, diagnostics }, 500);
  }
});
