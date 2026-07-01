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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// Version marker — bump this whenever the edge function is redeployed so the
// client can confirm it is running the expected version via diagnostics.
const EDGE_FUNCTION_VERSION = 'v24.3.0-storage-image-refs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
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
  mode: 'single_photo' | 'multi_photo' | 'video_frames' | 'single_item';
  images: ScanImage[];
  context?: { propertyId?: string; fileId?: string; roomId?: string; roomName?: string };
  model?: string;
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

function usageDiagnostics(result: UsageReservationResult | null): Record<string, unknown> | undefined {
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
  operation: string,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
): Promise<UsageReservationResult> {
  const { data, error } = await client.rpc('reserve_my_feature_usage', {
    feature: 'ai_scan',
    operation,
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
): Promise<void> {
  if (!client || !reservationId) return;

  const { error } = await client.rpc('refund_my_feature_usage', {
    reservation_id: reservationId,
    reason,
  });

  if (error) {
    scanError('usage_refund_failed', {
      reservationId,
      reason,
      message: error.message,
    });
  } else {
    scanLog('usage_refunded', { reservationId, reason });
  }
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

function isSafeStoragePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.startsWith('http://') || path.startsWith('https://')) return false;
  if (path.includes('..') || path.includes('\\')) return false;
  return true;
}

function validateScanStoragePath(
  path: string,
  userId: string,
  fileId: string | null | undefined,
): string | null {
  const trimmed = path.trim();
  if (!isSafeStoragePath(trimmed)) return null;
  if (!trimmed.startsWith(`${userId}/`)) return null;
  if (fileId && !trimmed.startsWith(`${userId}/${fileId}/`)) return null;
  return trimmed;
}

async function prepareOpenAiImageContent(
  req: ScanRequest,
  userClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<OpenAiImageContent[]> {
  const fileId = req.context?.fileId;
  const content: OpenAiImageContent[] = [];
  let storagePathCount = 0;
  let legacyBase64Count = 0;

  for (const [index, img] of req.images.entries()) {
    if (typeof img.storagePath === 'string' && img.storagePath.trim()) {
      const storagePath = validateScanStoragePath(img.storagePath, userId, fileId);
      if (!storagePath) {
        throw Object.assign(new Error(`Invalid scan image storage path at index ${index}`), {
          status: 400,
          errorCode: 'INVALID_IMAGE_STORAGE_PATH',
        });
      }

      const { data, error } = await userClient.storage
        .from(INVENTORY_PHOTOS_BUCKET)
        .createSignedUrl(storagePath, SCAN_SIGNED_URL_TTL_SECONDS);

      if (error || !data?.signedUrl) {
        throw Object.assign(new Error('Could not prepare scan image for AI processing'), {
          status: 500,
          errorCode: 'IMAGE_REFERENCE_SIGNING_FAILED',
          details: error?.message,
        });
      }

      storagePathCount += 1;
      content.push({
        type: 'image_url',
        image_url: {
          url: data.signedUrl,
          detail: 'high',
        },
      });
      continue;
    }

    if (typeof img.imageBase64 === 'string' && img.imageBase64.trim()) {
      legacyBase64Count += 1;
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType ?? 'image/jpeg'};base64,${img.imageBase64}`,
          detail: 'high',
        },
      });
      continue;
    }

    throw Object.assign(new Error(`Scan image at index ${index} is missing a storage path or base64 data`), {
      status: 400,
      errorCode: 'INVALID_IMAGE_PAYLOAD',
    });
  }

  scanLog('image_references_prepared', {
    imageCount: req.images.length,
    storagePathCount,
    legacyBase64Count,
  });

  return content;
}

// ── Build OpenAI request body ─────────────────────────────────────────────────
function buildOpenAiBody(req: ScanRequest, imageContent: OpenAiImageContent[]): object {
  const model = req.model ?? DEFAULT_MODEL;

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

  let userClient: ReturnType<typeof createClient> | null = null;
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

  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) {
    scanLog('response_returned', { status: 500, errorCode: 'MISSING_API_KEY' });
    return jsonResponse({ success: false, errorCode: 'MISSING_API_KEY', message: 'OPENAI_API_KEY secret not configured', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 500);
  }

  let scanReq: ScanRequest;
  try {
    scanLog('body_parse_started');
    scanReq = await req.json() as ScanRequest;
    scanLog('body_parse_completed');
  } catch (error) {
    scanError('body_parse_failed', { message: errorMessage(error) });
    scanLog('response_returned', { status: 400, errorCode: 'BAD_REQUEST' });
    return jsonResponse({ success: false, errorCode: 'BAD_REQUEST', message: 'Invalid JSON body', edgeFunctionVersion: EDGE_FUNCTION_VERSION }, 400);
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

  const approximateBase64Length = scanReq.images.reduce((sum, image) => sum + (image.imageBase64?.length ?? 0), 0);
  const storagePathCount = scanReq.images.filter((image) => typeof image.storagePath === 'string' && image.storagePath.trim()).length;
  const legacyBase64Count = scanReq.images.filter((image) => typeof image.imageBase64 === 'string' && image.imageBase64.trim()).length;
  scanLog('image_payload_checked', {
    imageCount: scanReq.images.length,
    approximateBase64Length,
    storagePathCount,
    legacyBase64Count,
  });

  let openAiImageContent: OpenAiImageContent[];
  try {
    scanLog('image_references_prepare_started', {
      imageCount: scanReq.images.length,
      storagePathCount,
      legacyBase64Count,
    });
    openAiImageContent = await prepareOpenAiImageContent(scanReq, userClient!, authUserId!);
  } catch (error) {
    const record = error as { status?: number; errorCode?: string; details?: string };
    const status = record.status ?? 400;
    const errorCode = record.errorCode ?? 'INVALID_IMAGE_PAYLOAD';
    scanError('image_references_prepare_failed', {
      errorCode,
      message: errorMessage(error),
      details: record.details,
    });
    scanLog('response_returned', { status, errorCode });
    return jsonResponse({
      success: false,
      errorCode,
      message: errorMessage(error),
      edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    }, status);
  }

  let usageReservation: UsageReservationResult | null = null;
  let usageReservationId: string | null = null;
  try {
    scanLog('usage_reserve_started', {
      feature: 'ai_scan',
      operation,
      imageCount: scanReq.images.length,
      hasIdempotencyKey: true,
    });
    usageReservation = await reserveUsage(userClient!, operation, usageIdempotencyKey, {
      mode: scanReq.mode,
      imageCount: scanReq.images.length,
      context: {
        fileId: scanReq.context?.fileId ?? null,
        propertyId: scanReq.context?.propertyId ?? null,
        roomNamePresent: !!scanReq.context?.roomName,
      },
      edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    });
    usageReservationId = usageReservation.reservation_id ?? null;
    scanLog('usage_reserve_completed', {
      reservationId: usageReservationId,
      allowed: usageReservation.allowed,
      status: usageReservation.status,
      wouldHaveBlocked: usageReservation.would_have_blocked,
      operation: usageReservation.operation,
      units: usageReservation.units,
      remainingUnits: usageReservation.remaining_units,
    });
  } catch (error) {
    scanError('usage_reserve_failed', { message: errorMessage(error), operation });
    scanLog('response_returned', { status: 500, errorCode: 'USAGE_RESERVE_FAILED' });
    return jsonResponse({
      success: false,
      errorCode: 'USAGE_RESERVE_FAILED',
      message: 'Could not check AI scan allowance. Please try again.',
      edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    }, 500);
  }

  if (usageReservation.allowed !== true) {
    scanLog('response_returned', {
      status: 402,
      errorCode: 'AI_SCAN_LIMIT_REACHED',
      operation,
      wouldHaveBlocked: usageReservation.would_have_blocked,
    });
    return jsonResponse({
      success: false,
      errorCode: 'AI_SCAN_LIMIT_REACHED',
      message: 'Your Free monthly AI scan credits have been used. Upgrade to continue scanning.',
      edgeFunctionVersion: EDGE_FUNCTION_VERSION,
      usage: usageDiagnostics(usageReservation),
    }, 402);
  }

  const diagnostics: Record<string, unknown> = {
    edgeFunctionVersion: EDGE_FUNCTION_VERSION,
    model: scanReq.model ?? DEFAULT_MODEL,
    mode: scanReq.mode ?? 'single_photo',
    imageCount: scanReq.images.length,
    usage: usageDiagnostics(usageReservation),
    maxTokens: MAX_TOKENS,
    rawItemCount: 0,
    validItemCount: 0,
    quantityItemCount: 0,
    totalQuantityCount: 0,
    finishReason: null,
    responseContentLength: 0,
  };

  try {
    const openAiBody = buildOpenAiBody(scanReq, openAiImageContent);
    scanLog('openai_call_started', {
      model: scanReq.model ?? DEFAULT_MODEL,
      imageCount: scanReq.images.length,
      timeoutMs: OPENAI_TIMEOUT_MS,
    });
    const openAiRes = await fetchWithTimeout(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
      body: JSON.stringify(openAiBody),
    }, OPENAI_TIMEOUT_MS);
    scanLog('openai_call_completed', { status: openAiRes.status, ok: openAiRes.ok });

    const openAiJson = await openAiRes.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      error?: { message: string; code?: string };
      usage?: { completion_tokens?: number; prompt_tokens?: number; total_tokens?: number };
    };

    if (openAiJson.error) {
      scanError('openai_call_failed', {
        status: openAiRes.status,
        code: openAiJson.error.code ?? 'OPENAI_ERROR',
        message: openAiJson.error.message,
      });
      await refundUsage(userClient, usageReservationId, openAiJson.error.code ?? 'openai_error');
      scanLog('response_returned', { status: 502, errorCode: openAiJson.error.code ?? 'OPENAI_ERROR' });
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
      scanError('openai_call_failed', { status: openAiRes.status, code: 'EMPTY_RESPONSE' });
      await refundUsage(userClient, usageReservationId, 'empty_openai_response');
      scanLog('response_returned', { status: 502, errorCode: 'EMPTY_RESPONSE' });
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

    if (validItems.length === 0) {
      await refundUsage(userClient, usageReservationId, 'no_usable_items');
      scanLog('response_returned', { status: 200, success: true, validItemCount: 0, usageRefunded: true });
      return jsonResponse({ success: true, items: validItems, diagnostics });
    }

    if (usageReservationId) {
      scanLog('usage_commit_started', { reservationId: usageReservationId, validItemCount: validItems.length });
      await commitUsage(userClient!, usageReservationId);
      scanLog('usage_commit_completed', { reservationId: usageReservationId });
    }

    scanLog('response_returned', { status: 200, success: true, validItemCount: validItems.length });
    return jsonResponse({ success: true, items: validItems, diagnostics });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    scanError('catch_block_error', { message: msg });
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    if (isTimeout) {
      await refundUsage(userClient, usageReservationId, 'openai_timeout');
      scanLog('response_returned', { status: 504, errorCode: 'OPENAI_TIMEOUT' });
      return jsonResponse({
        success: false,
        errorCode: 'OPENAI_TIMEOUT',
        message: 'AI scan timed out before completion. Please try again.',
        diagnostics,
      }, 504);
    }
    await refundUsage(userClient, usageReservationId, 'scan_processing_error');
    scanLog('response_returned', { status: 500, errorCode: 'INTERNAL_ERROR' });
    return jsonResponse({ success: false, errorCode: 'INTERNAL_ERROR', message: msg, diagnostics }, 500);
  }
});
