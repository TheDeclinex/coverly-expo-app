/**
 * Supabase Edge Function: scan-room-photo
 * v2 — Quality prompts, quantity-aware detection, descriptive naming, extended diagnostics.
 *
 * Deploy:
 *   npx supabase functions deploy scan-room-photo --no-verify-jwt
 *
 * Set secret:
 *   supabase secrets set OPENAI_API_KEY=sk-...
 *   supabase secrets set OPENAI_SCAN_MODEL=gpt-5.6-luna # optional; this is the default
 */

import type { createClient as ClientFactory, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { TrustedUsage, UsageError, usageFailure, boundedJson } from '../_shared/trusted-usage.ts';
import { prepareScanWorkload, validateScanWorkload } from './workload.ts';
import { finitePositiveScanEstimate, scanModelForMode, type ScanMode } from './scan-model.ts';
import { resolveMarketConfig, type MarketConfig } from '../_shared/market-config.ts';

export function createScanHandler(createClient: typeof ClientFactory, env: (key: string) => string | undefined, fetch: typeof globalThis.fetch = globalThis.fetch) {
// Version marker — bump this whenever the edge function is redeployed so the
// client can confirm it is running the expected version via diagnostics.
const EDGE_FUNCTION_VERSION = 'v24.6.0-trusted-usage';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const SUPABASE_URL = env('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY') ?? '';
const CONFIGURED_SCAN_MODEL = env('OPENAI_SCAN_MODEL');
const INVENTORY_PHOTOS_BUCKET = 'inventory-photos';
const SCAN_SIGNED_URL_TTL_SECONDS = 600;
const OPENAI_TIMEOUT_MS = 45_000;
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
  imageBase64?: string;
  storagePath?: string;
  mimeType?: string;
  sourceName?: string;
}

interface ScanRequest {
  mode: ScanMode;
  images: ScanImage[];
  context?: { propertyId?: string; fileId?: string; roomId?: string; roomName?: string };
  usageIdempotencyKey?: string;
}

interface OpenAiImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail: 'high';
  };
}

interface RawItem {
  name?: string;
  description?: string;
  category?: string;
  confidence?: number;
  estimatedPrice?: number | null;
  unitEstimatedPrice?: number | null;
  currencyCode?: string | null;
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

function scanLog(stage: string, details?: Record<string, unknown>) {
  console.log(JSON.stringify({
    source: 'scan-room-photo',
    edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    stage,
    ...details,
  }));
}

function scanError(stage: string, details?: Record<string, unknown>) {
  console.error(JSON.stringify({
    source: 'scan-room-photo',
    edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    stage,
    ...details,
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    scanError('openai_timeout_fired', { timeoutMs });
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function operationForMode(mode: ScanRequest['mode']): 'single_photo_scan' | 'multi_photo_scan' | 'video_frame_scan' | null {
  if (mode === 'single_photo') return 'single_photo_scan';
  if (mode === 'single_item') return 'single_photo_scan';
  if (mode === 'multi_photo') return 'multi_photo_scan';
  if (mode === 'video_frames') return 'video_frame_scan';
  return null;
}

function normaliseUsageIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
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
- unitEstimatedPrice = replacement value for ONE unit in the authoritative property currency
- estimatedPrice = TOTAL value for the grouped record = unitEstimatedPrice × quantity
- For single items (quantity 1): estimatedPrice = unitEstimatedPrice
- Use realistic values for the authoritative property market supplied below
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
function buildUserPrompt(mode: ScanRequest['mode'], imageCount: number, market: MarketConfig): string {
  const FIELDS = `Each item must have EXACTLY these fields:
{
  "name": "short descriptive label with colour+material+type",
  "description": "REQUIRED — exactly 2 sentences",
  "category": "one of the allowed Coverly categories",
  "quantity": 1,
  "unitEstimatedPrice": null,
  "estimatedPrice": null,
  "currencyCode": "${market.currencyCode}",
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

  if (mode === 'single_item') {
    return `Inspect this close-up item photo and identify ONE primary household item only.

If multiple objects are visible, choose the most central, prominent, clearly identifiable replaceable item.
Do NOT list background objects, nearby accessories, packaging, surfaces, walls, floors, or secondary items.
Return exactly one item when a clear primary item is visible. Return an empty array only if no replaceable item is clear enough to identify.

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
Use quantity only for genuinely identical or matching multiples. Never combine different visible objects into a generic "assorted decor items", "assorted electronics", or broad-category record.
Create separate records for distinct objects a homeowner would reasonably list separately for insurance, including visible books, controllers, consoles, lamps, vases, shelf units, chairs, and tables.
Do not merge nearby objects merely because they share a shelf, surface, or category. De-duplicate across photos only when the visual attributes and room position indicate the same physical item.

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
function buildMarketPricingPrompt(market: MarketConfig): string {
  if (!market.aiEstimatesEnabled) {
    return `AUTHORITATIVE MARKET OVERRIDE: The property is in ${market.countryName} (${market.countryCode}). Local AI pricing is not enabled. Continue object recognition, but return null for unitEstimatedPrice and estimatedPrice. Do not substitute another country or currency.`;
  }
  return `AUTHORITATIVE MARKET OVERRIDE: Estimate the current retail replacement cost of an equivalent new item reasonably available to a consumer in ${market.countryName} (${market.countryCode}). Return amounts in ${market.currencyCode}. unitEstimatedPrice is one unit and estimatedPrice is unitEstimatedPrice multiplied by quantity. Numbers only, with no currency symbols.`;
}

function buildLocalizedSystemPrompt(market: MarketConfig): string {
  return SYSTEM_PROMPT.replace(
    /PRICING RULES:[\s\S]*?PIN RULES:/,
    `PRICING RULES:\n${buildMarketPricingPrompt(market)}\n\nPIN RULES:`,
  );
}

function buildOpenAiBody(req: ScanRequest, imageContent: OpenAiImageContent[], market: MarketConfig): object {
  const model = scanModelForMode(req.mode, CONFIGURED_SCAN_MODEL);

  const userPrompt = buildUserPrompt(req.mode, req.images.length, market);

  return {
    model,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: buildLocalizedSystemPrompt(market) },
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
function resolveSourcePhotoIndex(i: RawItem, imageCount: number): number | undefined {
  let resolved: number | undefined;
  if (i.sourceImageId !== undefined) {
    const str = String(i.sourceImageId).toLowerCase().replace('photo_', '').trim();
    const parsed = Number(str);
    if (Number.isFinite(parsed)) {
      resolved = parsed > 0 ? Math.round(parsed) - 1 : 0;
    }
  } else if (typeof i.sourcePhotoIndex === 'number' && Number.isFinite(i.sourcePhotoIndex)) {
    resolved = Math.round(i.sourcePhotoIndex);
  }

  return resolved !== undefined && resolved >= 0 && resolved < imageCount ? resolved : undefined;
}

function resolveSeenInPhotos(i: RawItem, sourcePhotoIndex: number | undefined, imageCount: number): number[] | undefined {
  if (Array.isArray(i.seenInPhotos)) {
    const resolved = i.seenInPhotos.map((n: number | string) => {
      const str = String(n).toLowerCase().replace('photo_', '').trim();
      const parsed = Number(str);
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) - 1 : -1;
    }).filter((index) => index >= 0 && index < imageCount);
    return resolved.length > 0 ? [...new Set(resolved)] : undefined;
  }
  return sourcePhotoIndex !== undefined ? [sourcePhotoIndex] : undefined;
}

// ── Main handler ──────────────────────────────────────────────────────────────
return async (req: Request) => {
  scanLog('request_received');
  if (req.method === 'OPTIONS') {
    scanLog('method_checked', { method: req.method });
    scanLog('response_returned', { status: 200, corsPreflight: true });
    return new Response('ok', { headers: CORS_HEADERS });
  }
  scanLog('method_checked', { method: req.method });
  if (req.method !== 'POST') {
    scanLog('response_returned', { status: 405, errorCode: 'METHOD_NOT_ALLOWED' });
    return jsonResponse({ success: false, errorCode: 'METHOD_NOT_ALLOWED', message: 'POST only', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 405);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  scanLog('auth_header_checked', { hasAuthHeader: authHeader.startsWith('Bearer ') });
  if (!authHeader.startsWith('Bearer ')) {
    scanLog('response_returned', { status: 401, errorCode: 'UNAUTHORIZED' });
    return jsonResponse({ success: false, errorCode: 'UNAUTHORIZED', message: 'Missing authentication token', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 401);
  }
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  scanLog('auth_token_extracted', { hasAccessToken: accessToken.length > 0 });
  if (!accessToken) {
    scanLog('response_returned', { status: 401, errorCode: 'UNAUTHORIZED' });
    return jsonResponse({ success: false, errorCode: 'UNAUTHORIZED', message: 'Missing authentication token', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 401);
  }

  let userClient: SupabaseClient | null = null;
  let authUserId: string | null = null;
  try {
    scanLog('auth_verification_started');
    userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.auth.getUser(accessToken);
    if (error || !data.user) {
      scanError('auth_verification_failed', { message: error?.message ?? 'Missing user' });
      scanLog('response_returned', { status: 401, errorCode: 'UNAUTHORIZED' });
      return jsonResponse({ success: false, errorCode: 'UNAUTHORIZED', message: 'Invalid or expired session', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 401);
    }
    authUserId = data.user.id;
    scanLog('auth_verification_completed', { hasUser: true });
  } catch (error) {
    scanError('auth_verification_failed', { message: errorMessage(error) });
    scanLog('response_returned', { status: 401, errorCode: 'UNAUTHORIZED' });
    return jsonResponse({ success: false, errorCode: 'UNAUTHORIZED', message: 'Authentication check failed', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 401);
  }

  const openAiKey = env('OPENAI_API_KEY');
  if (!openAiKey) {
    scanLog('response_returned', { status: 500, errorCode: 'MISSING_API_KEY' });
    return jsonResponse({ success: false, errorCode: 'MISSING_API_KEY', message: 'OPENAI_API_KEY secret not configured', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 500);
  }

  let scanReq: ScanRequest;
  try {
    scanLog('body_parse_started');
    scanReq = await boundedJson(req, 34 * 1024 * 1024) as ScanRequest;
    validateScanWorkload(scanReq);
    scanLog('body_parse_completed');
  } catch (error) {
    scanError('body_parse_failed', { message: errorMessage(error) });
    scanLog('response_returned', { status: 400, errorCode: 'INVALID_WORKLOAD' });
    return jsonResponse({ success: false, errorCode: 'INVALID_WORKLOAD', message: 'Invalid or oversized scan workload', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 400);
  }

  if (!scanReq.images || scanReq.images.length === 0) {
    scanLog('response_returned', { status: 400, errorCode: 'NO_IMAGES' });
    return jsonResponse({ success: false, errorCode: 'NO_IMAGES', message: 'images array is required and must not be empty', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 400);
  }

  const operation = operationForMode(scanReq.mode);
  if (!operation) {
    scanLog('response_returned', { status: 400, errorCode: 'BAD_SCAN_MODE' });
    return jsonResponse({ success: false, errorCode: 'BAD_SCAN_MODE', message: 'Unsupported scan mode', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 400);
  }

  const usageIdempotencyKey = normaliseUsageIdempotencyKey(scanReq.usageIdempotencyKey);
  if (!usageIdempotencyKey) {
    scanLog('response_returned', { status: 400, errorCode: 'MISSING_IDEMPOTENCY_KEY' });
    return jsonResponse({
      success: false,
      errorCode: 'MISSING_IDEMPOTENCY_KEY',
      message: 'Scan request is missing a usage idempotency key. Please update the app and try again.',
      edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    }, 400);
  }

  const fileId = scanReq.context?.fileId ?? scanReq.context?.propertyId;
  if (!fileId) {
    return jsonResponse({ success: false, errorCode: 'PROPERTY_CONTEXT_REQUIRED', message: 'Choose a property before scanning.' }, 400);
  }
  const { data: property, error: propertyError } = await userClient!
    .from('inventory_files').select('id,country_code,currency_code').eq('id', fileId).single();
  if (propertyError || !property) {
    return jsonResponse({ success: false, errorCode: 'PROPERTY_NOT_FOUND', message: 'The selected property could not be accessed.' }, 404);
  }
  const market = resolveMarketConfig(property.country_code);
  if (!market || market.currencyCode !== property.currency_code) {
    return jsonResponse({ success: false, errorCode: 'INVALID_PROPERTY_MARKET', message: 'The property market configuration needs review.' }, 409);
  }

  let usage: TrustedUsage;
  let openAiImageContent: OpenAiImageContent[];
  try {
    const workload = await prepareScanWorkload(scanReq, authUserId!, fileId, async path => {
      const { data, error } = await userClient!.storage.from(INVENTORY_PHOTOS_BUCKET).download(path);
      if (error || !data) throw new UsageError('INVALID_WORKLOAD', 400);
      return data;
    });
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) throw new UsageError('USAGE_SERVICE_UNAVAILABLE');
    usage = new TrustedUsage(createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }), authUserId!);
    await usage.reserve('ai_scan', workload.operation, usageIdempotencyKey, {
      version: 1, mode: scanReq.mode, images: workload.identities, context: scanReq.context,
      countryCode: market.countryCode, currencyCode: market.currencyCode, model: scanModelForMode(scanReq.mode, CONFIGURED_SCAN_MODEL),
    }, fileId, { imageCount: workload.imageCount, payloadBytes: workload.bytes, mode: scanReq.mode });
    openAiImageContent = workload.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.imageBase64}`, detail: 'high' } }));
  } catch (error) {
    return jsonResponse({ ...usageFailure(error), edgeFunctionVersion: EDGE_FUNCTION_VERSION }, error instanceof UsageError ? error.status : 503);
  }

  const diagnostics: Record<string, unknown> = {
    edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    model: scanModelForMode(scanReq.mode, CONFIGURED_SCAN_MODEL),
    mode: scanReq.mode ?? 'single_photo',
    imageCount: scanReq.images.length,
    usage: usage.diagnostics(),
    maxTokens: MAX_TOKENS,
    rawItemCount: 0,
    validItemCount: 0,
    quantityItemCount: 0,
    totalQuantityCount: 0,
    finishReason: null,
    responseContentLength: 0,
  };

  try {
    const openAiBody = buildOpenAiBody(scanReq, openAiImageContent, market);
    scanLog('openai_call_started', {
      model: scanModelForMode(scanReq.mode, CONFIGURED_SCAN_MODEL),
      imageCount: scanReq.images.length,
      timeoutMs: OPENAI_TIMEOUT_MS,
    });
    const openAiRes = await usage.provider('openai_scan', () => fetchWithTimeout(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
      body: JSON.stringify(openAiBody),
    }, OPENAI_TIMEOUT_MS));
    scanLog('openai_call_completed', { status: openAiRes.status, ok: openAiRes.ok });

    const openAiJson = await openAiRes.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      error?: { message: string; code?: string };
      usage?: { completion_tokens?: number; prompt_tokens?: number; total_tokens?: number };
    };

    if (!openAiRes.ok || openAiJson.error) {
      scanError('openai_call_failed', {
        status: openAiRes.status,
        code: openAiJson.error?.code ?? 'OPENAI_ERROR',
        message: openAiJson.error?.message ?? 'OpenAI request failed',
      });
      await usage.settle('refunded', openAiJson.error?.code ?? 'openai_error');
      scanLog('response_returned', { status: 502, errorCode: openAiJson.error?.code ?? 'OPENAI_ERROR' });
      return jsonResponse({
        success: false,
        errorCode: openAiJson.error?.code ?? 'OPENAI_ERROR',
        message: openAiJson.error?.message ?? 'OpenAI request failed',
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
      scanError('openai_call_failed', { status: openAiRes.status, code: 'EMPTY_RESPONSE' });
      await usage.settle('refunded', 'empty_openai_response');
      scanLog('response_returned', { status: 502, errorCode: 'EMPTY_RESPONSE' });
      return jsonResponse({ success: false, errorCode: 'EMPTY_RESPONSE', message: 'OpenAI returned no content', diagnostics }, 502);
    }

    diagnostics.responseContentLength = content.length;
    const rawItems = extractJson(content) as RawItem[];
    diagnostics.rawItemCount = rawItems.length;

    const pinDiagnostics: Array<Record<string, unknown>> = [];
    const validItems = rawItems
      .filter(i => i.name && typeof i.name === 'string' && i.name.trim())
      .map((i, itemIndex) => {
        const quantity = typeof i.quantity === 'number' && i.quantity >= 1 ? Math.round(i.quantity) : 1;
        const rawUnit = finitePositiveScanEstimate(i.unitEstimatedPrice);
        const rawTotal = finitePositiveScanEstimate(i.estimatedPrice);
        const currencyMatches = typeof i.currencyCode === 'string' && i.currencyCode.trim().toUpperCase() === market.currencyCode;
        let unitEstimatedPrice: number | null;
        let estimatedPrice: number | null;

        if (market.aiEstimatesEnabled && currencyMatches && rawUnit != null) {
          unitEstimatedPrice = rawUnit;
          estimatedPrice = quantity > 1 ? Math.round(rawUnit * quantity * 100) / 100 : rawUnit;
        } else if (market.aiEstimatesEnabled && currencyMatches && rawTotal != null) {
          estimatedPrice = rawTotal;
          unitEstimatedPrice = quantity > 1 ? Math.round((rawTotal / quantity) * 100) / 100 : rawTotal;
        } else {
          unitEstimatedPrice = null;
          estimatedPrice = null;
        }

        const sourcePhotoIndex = resolveSourcePhotoIndex(i, scanReq.images.length);
        const seenInPhotos = resolveSeenInPhotos(i, sourcePhotoIndex, scanReq.images.length);
        const category = normaliseCategory(i.category);
        const normalizedPin = i.pin
          && Number.isFinite(i.pin.x)
          && Number.isFinite(i.pin.y)
          ? { x: Math.min(100, Math.max(0, i.pin.x)), y: Math.min(100, Math.max(0, i.pin.y)) }
          : undefined;

        if (i.pin || i.sourceImageId !== undefined || i.sourcePhotoIndex !== undefined) {
          pinDiagnostics.push({
            itemIndex,
            imageCount: scanReq.images.length,
            rawPin: i.pin ?? null,
            normalizedPin: normalizedPin ?? null,
            rawSourceImageId: i.sourceImageId ?? null,
            rawSourcePhotoIndex: i.sourcePhotoIndex ?? null,
            resolvedSourcePhotoIndex: sourcePhotoIndex ?? null,
          });
        }

        return {
          name: i.name!.trim(),
          description: i.description?.trim() || '',
          category,
          quantity,
          unitEstimatedPrice,
          estimatedPrice,
          estimatedCurrency: unitEstimatedPrice == null ? null : market.currencyCode,
          valuationMarket: unitEstimatedPrice == null ? null : market.countryCode,
          estimatedAt: unitEstimatedPrice == null ? null : new Date().toISOString(),
          pricingSupportTier: market.pricingSupportTier,
          confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0.8)),
          brand_guess: i.brand_guess ?? undefined,
          pin: normalizedPin,
          sourcePhotoIndex,
          sourceImageId: i.sourceImageId,
          seenInPhotos,
          mergeConfidence: i.mergeConfidence,
        };
      });

    if (pinDiagnostics.length > 0) {
      scanLog('pin_diagnostics', { imageCount: scanReq.images.length, items: pinDiagnostics });
    }

    diagnostics.validItemCount = validItems.length;
    diagnostics.quantityItemCount = validItems.filter(i => i.quantity > 1).length;
    diagnostics.totalQuantityCount = validItems.reduce((s, i) => s + i.quantity, 0);

    if (validItems.length === 0) {
      await usage.settle('refunded', 'no_usable_items');
      scanLog('response_returned', { status: 200, success: true, validItemCount: 0, usageRefunded: true });
      return jsonResponse({ success: true, items: validItems, diagnostics });
    }

    await usage.settle('committed');

    scanLog('response_returned', { status: 200, success: true, validItemCount: validItems.length });
    return jsonResponse({ success: true, items: validItems, market, diagnostics });
  } catch (e) {
    if (e instanceof UsageError) return jsonResponse({ ...usageFailure(e), diagnostics }, e.status);
    const msg = e instanceof Error ? e.message : String(e);
    scanError('catch_block_error', { message: msg });
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    if (isTimeout) {
      try { await usage.settle('refunded', 'openai_timeout'); } catch (error) { return jsonResponse({ ...usageFailure(error), diagnostics }, 503); }
      scanLog('response_returned', { status: 504, errorCode: 'OPENAI_TIMEOUT' });
      return jsonResponse({
        success: false,
        errorCode: 'OPENAI_TIMEOUT',
        message: 'AI scan timed out before completion. Please try again.',
        diagnostics,
      }, 504);
    }
    try { await usage.settle('refunded', 'scan_processing_error'); } catch (error) { return jsonResponse({ ...usageFailure(error), diagnostics }, 503); }
    scanLog('response_returned', { status: 500, errorCode: 'INTERNAL_ERROR' });
    return jsonResponse({ success: false, errorCode: 'INTERNAL_ERROR', message: msg, diagnostics }, 500);
  }
};
}
