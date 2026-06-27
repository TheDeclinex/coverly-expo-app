/**
 * Supabase Edge Function: generate-claim-pack
 *
 * V1 creates an insurer-ready PDF, uploads it to the private claim-packs
 * bucket, inserts a public.claim_packs history row, emails a secure link when
 * an email provider is configured, and returns a short-lived signed URL.
 *
 * Deploy, when ready:
 *   npx supabase functions deploy generate-claim-pack
 *   Then check Supabase Dashboard > Edge Functions > generate-claim-pack > Logs
 *   while running the mobile export once from a real signed-in account.
 *
 * Required secrets:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional email secrets:
 *   COVERLY_EMAIL_FROM
 *   RESEND_API_KEY
 *   POSTMARK_SERVER_TOKEN
 *   CLAIM_PACK_EMAIL_LINK_TTL_SECONDS
 *
 * Local smoke-test shape:
 *   curl -i -X POST "$SUPABASE_URL/functions/v1/generate-claim-pack" \
 *     -H "Authorization: Bearer $ACCESS_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "propertyId": "property-id",
 *       "selectedRoomIds": ["room-id"],
 *       "selectedItemIds": ["item-id"],
 *       "scope": "selected_rooms",
 *       "clientDraftId": "cpd_123",
 *       "claimNote": "Kitchen smoke damage."
 *     }'
 *
 * Expected success: { "success": true, "claimPackId": "...", "signedUrl": "...", "emailSent": true|false }
 * Expected errors:  { "success": false, "error": "BAD_REQUEST", "message": "..." }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  PDFDocument,
  type PDFImage,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "https://esm.sh/pdf-lib@1.17.1";

const EDGE_VERSION = "claim-pack-v1-branded-email";
const RENDERER_VERSION = "branded-v1";
const CLAIM_PACK_BUCKET = "claim-packs";
const INVENTORY_PHOTOS_BUCKET = "inventory-photos";
const CLAIM_EVIDENCE_BUCKET = "claim-evidence";
const SIGNED_URL_TTL_SECONDS = 60 * 10;
const PDF_EVIDENCE_PAGE_LIMIT = 5;
const EMAIL_SIGNED_URL_TTL_SECONDS = Number(Deno.env.get("CLAIM_PACK_EMAIL_LINK_TTL_SECONDS") ?? 60 * 60 * 24 * 7);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const COVERLY_EMAIL_FROM = Deno.env.get("COVERLY_EMAIL_FROM") ?? "Coverly <hello@coverly.nz>";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const POSTMARK_SERVER_TOKEN = Deno.env.get("POSTMARK_SERVER_TOKEN") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupabaseClient = ReturnType<typeof createClient>;
type ClaimPackScope = "whole_property" | "selected_rooms";

interface GenerateClaimPackRequest {
  propertyId: string;
  selectedRoomIds: string[];
  selectedItemIds: string[];
  scope: ClaimPackScope;
  clientDraftId: string;
  claimNote?: string | null;
}

interface InventoryFileRow {
  id: string;
  name: string | null;
  property_type: string | null;
  contents_sum_insured: number | null;
  insurer_name: string | null;
  policy_number: string | null;
  user_id: string;
}

interface InventoryRoomRow {
  id: string;
  file_id: string;
  user_id?: string | null;
  name: string | null;
  sort_order?: number | null;
}

interface InventoryItemRow {
  id: string;
  file_id: string;
  room_id: string | null;
  room: string | null;
  name: string | null;
  category: string | null;
  quantity: number | null;
  quantity_estimate: string | null;
  estimated_price: number | null;
  unit_estimated_price?: number | null;
  valuation_basis: string | null;
  image_url: string | null;
  photo_url: string | null;
  attachments: Array<{ url?: string | null }> | null;
  description: string | null;
  notes: string | null;
  brand_maker: string | null;
  model_series: string | null;
  condition_label: string | null;
  sort_order?: number | null;
}

interface EvidenceLinkRow {
  item_id: string | null;
  evidence_id: string | null;
}

interface EvidenceRow {
  id: string;
  evidence_type: string | null;
  filename: string | null;
  caption: string | null;
  document_date: string | null;
  file_url: string | null;
  include_in_pack: boolean | null;
  file_id: string | null;
  user_id: string | null;
}

interface EvidenceSummary {
  id: string;
  item_id: string;
  evidence_type: string | null;
  filename: string | null;
  caption: string | null;
  document_date: string | null;
  file_url: string | null;
}

interface ItemSnapshot {
  id: string;
  room_id: string | null;
  room_name: string;
  name: string;
  category: string | null;
  quantity: number;
  estimated_value: number | null;
  valuation_basis: string | null;
  brand_maker: string | null;
  model_series: string | null;
  condition_label: string | null;
  description: string | null;
  notes: string | null;
  evidence_count: number;
  photo_url: string | null;
  evidence: EvidenceSummary[];
}

interface ClaimPackTotals {
  selectedRoomsCount: number;
  selectedItemsCount: number;
  includedEvidenceCount: number;
  totalEstimatedValue: number;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public error: string,
    message: string,
  ) {
    super(message);
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, message: string, status: number): Response {
  return response({ success: false, error, message }, status);
}

function log(stage: string, details?: Record<string, unknown>): void {
  console.log(JSON.stringify({
    source: "generate-claim-pack",
    edgeVersion: EDGE_VERSION,
    stage,
    ...details,
  }));
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function uniqueStrings(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be an array.`);
  const strings = value.map((entry) => cleanString(entry, 120)).filter((entry): entry is string => Boolean(entry));
  if (strings.length !== value.length) throw new HttpError(400, "BAD_REQUEST", `${fieldName} must contain only non-empty strings.`);
  return [...new Set(strings)];
}

function parseRequest(body: unknown): GenerateClaimPackRequest {
  if (!isPlainObject(body)) throw new HttpError(400, "BAD_REQUEST", "Request body must be a JSON object.");

  const propertyId = cleanString(body.propertyId, 120);
  const clientDraftId = cleanString(body.clientDraftId, 200);
  const scope = body.scope;
  const selectedRoomIds = uniqueStrings(body.selectedRoomIds, "selectedRoomIds");
  const selectedItemIds = uniqueStrings(body.selectedItemIds, "selectedItemIds");

  if (!propertyId) throw new HttpError(400, "BAD_REQUEST", "propertyId is required.");
  if (!clientDraftId) throw new HttpError(400, "BAD_REQUEST", "clientDraftId is required.");
  if (scope !== "whole_property" && scope !== "selected_rooms") {
    throw new HttpError(400, "BAD_REQUEST", "scope must be whole_property or selected_rooms.");
  }
  if (selectedItemIds.length === 0) {
    throw new HttpError(400, "BAD_REQUEST", "At least one selected item is required.");
  }
  if (selectedRoomIds.length > 500 || selectedItemIds.length > 1000) {
    throw new HttpError(400, "BAD_REQUEST", "Claim-pack selection is too large for V1.");
  }

  return {
    propertyId,
    selectedRoomIds,
    selectedItemIds,
    scope,
    clientDraftId,
    claimNote: cleanString(body.claimNote, 2_000),
  };
}

function currency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `$${value.toLocaleString("en-NZ", { maximumFractionDigits: 0 })}`;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function itemQuantity(item: InventoryItemRow): number {
  const direct = numberValue(item.quantity);
  if (direct && direct > 0) return Math.round(direct);
  const fromEstimate = numberValue(item.quantity_estimate);
  if (fromEstimate && fromEstimate > 0) return Math.round(fromEstimate);
  return 1;
}

function itemEstimatedValue(item: InventoryItemRow): number | null {
  const quantity = itemQuantity(item);
  const unit = numberValue(item.unit_estimated_price);
  if (unit != null) return Math.round(unit * quantity * 100) / 100;
  return numberValue(item.estimated_price);
}

function itemHasPhoto(item: InventoryItemRow): boolean {
  if (item.image_url || item.photo_url) return true;
  return Array.isArray(item.attachments) && item.attachments.some((photo) => Boolean(photo?.url));
}

function primaryPhotoReference(item: InventoryItemRow): string | null {
  if (item.image_url) return item.image_url;
  if (item.photo_url) return item.photo_url;
  if (Array.isArray(item.attachments)) {
    return item.attachments.find((photo) => Boolean(photo?.url))?.url ?? null;
  }
  return null;
}

function friendlyValuationBasis(value: string | null | undefined): string {
  const normalized = (value ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!normalized) return "Policyholder estimate";
  if (normalized.includes("verified")) return "Verified source";
  if (normalized.includes("receipt")) return "Receipt supplied";
  if (normalized.includes("replacement") || normalized.includes("listing")) return "Replacement listing selected";
  if (normalized.includes("manual") || normalized.includes("user") || normalized.includes("policyholder")) return "Policyholder estimate";
  if (normalized.includes("ai") || normalized.includes("estimate") || normalized.includes("estimated")) return "Estimated replacement value";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function evidenceLabel(value: string | null | undefined): string {
  const normalized = (value ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!normalized) return "Supporting document";
  if (normalized.includes("receipt")) return "Receipt";
  if (normalized.includes("photo") || normalized.includes("image")) return "Photo";
  if (normalized.includes("warranty")) return "Warranty";
  if (normalized.includes("manual")) return "Manual";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "property";
}

function makePackRef(generatedAt: string): string {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return `CP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, "");
  const timePart = date.toISOString().slice(11, 16).replace(":", "");
  return `CP-${datePart}-${timePart}`;
}

interface EmbeddedImage {
  image: PDFImage;
  width: number;
  height: number;
}

interface PdfEvidenceAsset {
  sourceDoc: PDFDocument;
  pageCount: number;
  includedPageCount: number;
  capped: boolean;
}

function titleCaseWords(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function friendlyPropertyType(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "-";
  const normalized = raw.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_").toLowerCase();
  const labels: Record<string, string> = {
    main_home: "Main home",
    rental_property: "Rental property",
    holiday_home: "Holiday home",
    storage_unit: "Storage unit",
  };
  return labels[normalized] ?? titleCaseWords(raw);
}

function safePdfText(value: string | null | undefined): string {
  return (value ?? "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "-";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-NZ", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fitImage(sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}

function isStoragePath(value: string | null | undefined): boolean {
  if (!value) return false;
  if (value.startsWith("http://") || value.startsWith("https://")) return false;
  if (value.startsWith("file://") || value.startsWith("content://") || value.startsWith("ph://") || value.startsWith("blob:")) return false;
  return true;
}

async function resolveStorageUrl(adminClient: SupabaseClient, bucket: string, pathOrUrl: string | null | undefined, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (!isStoragePath(pathOrUrl)) return pathOrUrl.startsWith("http") ? pathOrUrl : null;
  const { data, error } = await adminClient.storage.from(bucket).createSignedUrl(pathOrUrl, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function fetchStorageBytes(
  adminClient: SupabaseClient,
  bucket: string,
  pathOrUrl: string | null | undefined,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const url = await resolveStorageUrl(adminClient, bucket, pathOrUrl);
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
  };
}

async function embedImageFromReference(
  pdfDoc: PDFDocument,
  adminClient: SupabaseClient,
  bucket: string,
  pathOrUrl: string | null | undefined,
): Promise<EmbeddedImage | null> {
  try {
    const fetched = await fetchStorageBytes(adminClient, bucket, pathOrUrl);
    if (!fetched) return null;
    const image = fetched.contentType.includes("png")
      ? await pdfDoc.embedPng(fetched.bytes)
      : await pdfDoc.embedJpg(fetched.bytes);
    return { image, width: image.width, height: image.height };
  } catch (error) {
    log("image embed skipped", { message: safeErrorMessage(error) });
    return null;
  }
}

function isImageEvidence(evidence: EvidenceSummary): boolean {
  const type = (evidence.evidence_type ?? "").toLowerCase();
  const filename = (evidence.filename ?? evidence.file_url ?? "").toLowerCase();
  return (
    type.includes("photo") ||
    type.includes("image") ||
    /\.(jpg|jpeg|png|webp)$/i.test(filename)
  );
}

function isPdfEvidence(evidence: EvidenceSummary): boolean {
  const type = (evidence.evidence_type ?? "").toLowerCase();
  const filename = (evidence.filename ?? evidence.file_url ?? "").toLowerCase();
  return type.includes("pdf") || filename.endsWith(".pdf");
}

async function loadPdfEvidenceAsset(adminClient: SupabaseClient, evidence: EvidenceSummary): Promise<PdfEvidenceAsset | null> {
  try {
    const fetched = await fetchStorageBytes(adminClient, CLAIM_EVIDENCE_BUCKET, evidence.file_url);
    if (!fetched) return null;
    if (!fetched.contentType.includes("pdf") && !isPdfEvidence(evidence)) return null;
    const sourceDoc = await PDFDocument.load(fetched.bytes);
    const pageCount = sourceDoc.getPageCount();
    const includedPageCount = Math.min(pageCount, PDF_EVIDENCE_PAGE_LIMIT);
    return {
      sourceDoc,
      pageCount,
      includedPageCount,
      capped: pageCount > includedPageCount,
    };
  } catch (error) {
    log("pdf evidence skipped", { evidenceId: evidence.id, message: safeErrorMessage(error) });
    return null;
  }
}

async function verifyUser(req: Request): Promise<{ userId: string; userEmail: string | null; userClient: SupabaseClient }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or malformed Authorization header.");
  }
  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) throw new HttpError(401, "UNAUTHORIZED", "Missing authentication token.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new HttpError(500, "CONFIGURATION_ERROR", "Supabase auth environment is not configured.");
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Invalid or expired session.");
  }
  log("auth success", { userId: data.user.id });
  return {
    userId: data.user.id,
    userEmail: data.user.email ?? null,
    userClient,
  };
}

async function fetchValidatedData(
  userClient: SupabaseClient,
  payload: GenerateClaimPackRequest,
  userId: string,
): Promise<{ property: InventoryFileRow; rooms: InventoryRoomRow[]; items: InventoryItemRow[]; evidenceByItemId: Record<string, EvidenceSummary[]> }> {
  const { data: property, error: propertyError } = await userClient
    .from("inventory_files")
    .select("id,name,property_type,contents_sum_insured,insurer_name,policy_number,user_id")
    .eq("id", payload.propertyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (propertyError) throw new HttpError(500, "PROPERTY_FETCH_FAILED", propertyError.message);
  if (!property) throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property was not found for this user.");

  const items = await fetchSelectedItems(userClient, payload.propertyId, payload.selectedItemIds);
  if (items.length !== payload.selectedItemIds.length) {
    throw new HttpError(403, "INVALID_ITEM_SELECTION", "One or more selected items do not belong to this property.");
  }

  const selectedRoomIds = new Set(payload.selectedRoomIds);
  const itemRoomIds = new Set(items.map((item) => item.room_id).filter((id): id is string => Boolean(id)));
  const roomIdsToFetch = [...new Set([...payload.selectedRoomIds, ...itemRoomIds])];
  const rooms = roomIdsToFetch.length > 0
    ? await fetchSelectedRooms(userClient, payload.propertyId, roomIdsToFetch, userId)
    : [];

  const missingRoomIds = [...itemRoomIds].filter((roomId) => !selectedRoomIds.has(roomId));
  if (payload.scope === "selected_rooms" && missingRoomIds.length > 0) {
    throw new HttpError(400, "INVALID_ROOM_SELECTION", "Selected rooms must include the rooms for all selected items.");
  }

  const evidenceByItemId = await fetchEvidenceByItemId(userClient, payload.selectedItemIds, payload.propertyId, userId);
  log("validation success", {
    propertyId: property.id,
    selectedRoomCount: rooms.length,
    selectedItemCount: items.length,
  });

  return { property: property as InventoryFileRow, rooms, items, evidenceByItemId };
}

async function fetchSelectedRooms(
  userClient: SupabaseClient,
  propertyId: string,
  selectedRoomIds: string[],
  userId: string,
): Promise<InventoryRoomRow[]> {
  const { data, error } = await userClient
    .from("inventory_rooms")
    .select("id,file_id,user_id,name,sort_order")
    .eq("file_id", propertyId)
    .in("id", selectedRoomIds);

  if (error) throw new HttpError(500, "ROOM_FETCH_FAILED", error.message);
  const rooms = (data ?? []) as InventoryRoomRow[];
  if (rooms.length !== selectedRoomIds.length || rooms.some((room) => room.file_id !== propertyId || (room.user_id && room.user_id !== userId))) {
    throw new HttpError(403, "INVALID_ROOM_SELECTION", "One or more selected rooms do not belong to this property.");
  }
  return rooms;
}

async function fetchSelectedItems(
  userClient: SupabaseClient,
  propertyId: string,
  selectedItemIds: string[],
): Promise<InventoryItemRow[]> {
  const { data, error } = await userClient
    .from("inventory_items")
    .select("id,file_id,room_id,room,name,category,quantity,quantity_estimate,estimated_price,unit_estimated_price,valuation_basis,image_url,photo_url,attachments,description,notes,brand_maker,model_series,condition_label,sort_order")
    .eq("file_id", propertyId)
    .in("id", selectedItemIds);

  if (error) throw new HttpError(500, "ITEM_FETCH_FAILED", error.message);
  return (data ?? []) as InventoryItemRow[];
}

async function fetchEvidenceByItemId(
  userClient: SupabaseClient,
  selectedItemIds: string[],
  propertyId: string,
  userId: string,
): Promise<Record<string, EvidenceSummary[]>> {
  const { data: links, error: linkError } = await userClient
    .from("claim_evidence_items")
    .select("item_id,evidence_id")
    .in("item_id", selectedItemIds);
  if (linkError) throw new HttpError(500, "EVIDENCE_FETCH_FAILED", linkError.message);

  const evidenceIds = [...new Set(((links ?? []) as EvidenceLinkRow[]).map((link) => link.evidence_id).filter((id): id is string => Boolean(id)))];
  if (evidenceIds.length === 0) return {};

  const { data: evidenceRows, error: evidenceError } = await userClient
    .from("claim_evidence")
    .select("id,evidence_type,filename,caption,document_date,file_url,include_in_pack,file_id,user_id")
    .in("id", evidenceIds)
    .eq("include_in_pack", true);
  if (evidenceError) throw new HttpError(500, "EVIDENCE_FETCH_FAILED", evidenceError.message);

  const evidenceById = new Map(
    ((evidenceRows ?? []) as EvidenceRow[])
      .filter((row) => row.file_id === propertyId && row.user_id === userId)
      .map((row) => [row.id, row]),
  );

  return ((links ?? []) as EvidenceLinkRow[]).reduce<Record<string, EvidenceSummary[]>>((byItem, link) => {
    if (!link.item_id || !link.evidence_id) return byItem;
    const evidence = evidenceById.get(link.evidence_id);
    if (!evidence) return byItem;
    const list = byItem[link.item_id] ?? [];
    list.push({
      id: evidence.id,
      item_id: link.item_id,
      evidence_type: evidence.evidence_type,
      filename: evidence.filename,
      caption: evidence.caption,
      document_date: evidence.document_date,
      file_url: evidence.file_url,
    });
    byItem[link.item_id] = list;
    return byItem;
  }, {});
}

function buildSnapshots(
  rooms: InventoryRoomRow[],
  items: InventoryItemRow[],
  evidenceByItemId: Record<string, EvidenceSummary[]>,
): { snapshots: ItemSnapshot[]; totals: ClaimPackTotals; roomsIncluded: Array<{ id: string; name: string }> } {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const roomsIncluded = rooms
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.name ?? "").localeCompare(b.name ?? ""))
    .map((room) => ({ id: room.id, name: room.name ?? "Unnamed room" }));

  const snapshots = items
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.name ?? "").localeCompare(b.name ?? ""))
    .map((item) => {
      const estimatedValue = itemEstimatedValue(item);
      const evidence = evidenceByItemId[item.id] ?? [];
      const roomName = item.room_id ? roomById.get(item.room_id)?.name ?? item.room ?? "Unassigned" : item.room ?? "Unassigned";
      return {
        id: item.id,
        room_id: item.room_id,
        room_name: roomName,
        name: item.name?.trim() || "Unnamed item",
        category: item.category,
        quantity: itemQuantity(item),
        estimated_value: estimatedValue,
        valuation_basis: friendlyValuationBasis(item.valuation_basis),
        brand_maker: item.brand_maker,
        model_series: item.model_series,
        condition_label: item.condition_label,
        description: item.description,
        notes: item.notes,
        evidence_count: evidence.length,
        photo_url: primaryPhotoReference(item),
        evidence,
      };
    });

  const totals = snapshots.reduce<ClaimPackTotals>((summary, item) => ({
    selectedRoomsCount: roomsIncluded.length,
    selectedItemsCount: summary.selectedItemsCount + 1,
    includedEvidenceCount: summary.includedEvidenceCount + item.evidence.length,
    totalEstimatedValue: summary.totalEstimatedValue + (item.estimated_value ?? 0),
  }), {
    selectedRoomsCount: roomsIncluded.length,
    selectedItemsCount: 0,
    includedEvidenceCount: 0,
    totalEstimatedValue: 0,
  });

  return { snapshots, totals, roomsIncluded };
}

class PdfWriter {
  private page: PDFPage;
  private y = 0;
  private pageNumber = 0;
  readonly width = 595.28;
  readonly height = 841.89;
  readonly margin = 42;
  readonly contentWidth = this.width - this.margin * 2;
  readonly ink = rgb(0.09, 0.14, 0.2);
  readonly slate = rgb(0.2, 0.25, 0.33);
  readonly muted = rgb(0.4, 0.46, 0.55);
  readonly line = rgb(0.85, 0.89, 0.91);
  readonly soft = rgb(0.97, 0.98, 0.98);
  readonly teal = rgb(0.06, 0.56, 0.51);
  readonly tealSoft = rgb(0.93, 0.98, 0.97);

  constructor(
    private readonly pdfDoc: PDFDocument,
    private readonly regularFont: PDFFont,
    private readonly boldFont: PDFFont,
  ) {
    this.page = this.pdfDoc.addPage([this.width, this.height]);
    this.pageNumber = 1;
    this.y = this.height - this.margin;
  }

  cover(params: {
    title: string;
    packRef: string;
    generatedAt: string;
    propertyName: string;
    intro: string;
  }): void {
    this.drawBrandHeader(false, params.packRef);
    this.y -= 34;
    this.text("FINAL CLAIM PACK", this.margin, this.y, 9, this.boldFont, this.teal);
    this.y -= 42;
    this.text(params.title, this.margin, this.y, 42, this.boldFont, rgb(0.06, 0.15, 0.2));
    this.y -= 56;
    this.paragraph(params.intro, 13, this.slate, this.contentWidth * 0.75);
    this.y -= 20;
    this.metricStrip([
      { label: "Property", value: params.propertyName },
      { label: "Generated", value: formatDateTime(params.generatedAt) },
      { label: "Claim Pack Reference", value: params.packRef },
    ]);
  }

  newPage(packRef: string): void {
    this.page = this.pdfDoc.addPage([this.width, this.height]);
    this.pageNumber += 1;
    this.y = this.height - this.margin;
    this.drawBrandHeader(true, packRef);
  }

  section(title: string, packRef: string): void {
    this.ensureSpace(50, packRef);
    this.y -= 6;
    this.text(title, this.margin, this.y, 17, this.boldFont, this.ink);
    this.page.drawLine({
      start: { x: this.margin, y: this.y - 8 },
      end: { x: this.width - this.margin, y: this.y - 8 },
      thickness: 1.6,
      color: this.teal,
    });
    this.y -= 28;
  }

  paragraph(text: string, size = 10, color = this.ink, maxWidth = this.contentWidth): void {
    const lines = this.wrap(text, size, maxWidth);
    for (const line of lines) {
      this.ensureSpace(14, "");
      this.text(line, this.margin, this.y, size, this.regularFont, color);
      this.y -= size + 4;
    }
    this.y -= 3;
  }

  detailGrid(details: Array<{ label: string; value: string | number | null | undefined }>, packRef: string): void {
    const colGap = 12;
    const colWidth = (this.contentWidth - colGap) / 2;
    const rowHeight = 40;
    for (let index = 0; index < details.length; index += 2) {
      this.ensureSpace(rowHeight + 8, packRef);
      const row = details.slice(index, index + 2);
      for (const [offset, detail] of row.entries()) {
        const x = this.margin + offset * (colWidth + colGap);
        this.box(x, this.y - rowHeight + 8, colWidth, rowHeight, this.soft, this.line);
        this.text(detail.label.toUpperCase(), x + 10, this.y - 10, 7.5, this.boldFont, this.muted);
        this.text(String(detail.value ?? "-"), x + 10, this.y - 25, 10.5, this.boldFont, this.ink, colWidth - 20);
      }
      this.y -= rowHeight + 8;
    }
  }

  metricStrip(metrics: Array<{ label: string; value: string | number }>): void {
    const gap = 8;
    const width = (this.contentWidth - gap * (metrics.length - 1)) / metrics.length;
    const height = 58;
    for (const [index, metric] of metrics.entries()) {
      const x = this.margin + index * (width + gap);
      this.box(x, this.y - height, width, height, index === 0 ? this.tealSoft : this.soft, this.line);
      this.text(metric.label.toUpperCase(), x + 10, this.y - 17, 7.5, this.boldFont, this.muted);
      this.text(String(metric.value), x + 10, this.y - 36, 12.5, this.boldFont, this.ink, width - 20);
    }
    this.y -= height + 18;
  }

  tableHeader(columns: Array<{ label: string; width: number; align?: "left" | "right" }>, packRef: string): void {
    this.ensureSpace(28, packRef);
    let x = this.margin;
    this.box(this.margin, this.y - 22, this.contentWidth, 22, this.soft, this.line);
    for (const column of columns) {
      this.text(column.label.toUpperCase(), x + 6, this.y - 14, 7, this.boldFont, this.muted, column.width - 12, column.align);
      x += column.width;
    }
    this.y -= 25;
  }

  tableRow(values: string[], columns: Array<{ label: string; width: number; align?: "left" | "right" }>, packRef: string): void {
    const rowHeight = 34;
    this.ensureSpace(rowHeight + 4, packRef);
    let x = this.margin;
    this.page.drawLine({
      start: { x: this.margin, y: this.y - rowHeight + 7 },
      end: { x: this.width - this.margin, y: this.y - rowHeight + 7 },
      thickness: 0.6,
      color: this.line,
    });
    values.forEach((value, index) => {
      const column = columns[index];
      this.text(value || "-", x + 6, this.y - 14, 8.5, this.regularFont, this.ink, column.width - 12, column.align);
      x += column.width;
    });
    this.y -= rowHeight;
  }

  roomHeading(roomName: string, count: number, total: number, packRef: string): void {
    this.ensureSpace(48, packRef);
    this.box(this.margin, this.y - 32, this.contentWidth, 32, this.tealSoft, rgb(0.73, 0.89, 0.86));
    this.text(roomName, this.margin + 10, this.y - 20, 12, this.boldFont, this.ink);
    this.text(`${count} items · ${currency(total)}`, this.width - this.margin - 150, this.y - 20, 9, this.boldFont, this.teal, 140, "right");
    this.y -= 42;
  }

  evidenceGroupHeading(itemName: string, count: number, packRef: string): void {
    this.ensureSpace(42, packRef);
    this.box(this.margin, this.y - 28, this.contentWidth, 28, this.tealSoft, rgb(0.73, 0.89, 0.86));
    this.text(itemName, this.margin + 10, this.y - 18, 11, this.boldFont, this.ink);
    this.text(`${count} evidence ${count === 1 ? "file" : "files"}`, this.width - this.margin - 130, this.y - 18, 8.5, this.boldFont, this.teal, 120, "right");
    this.y -= 36;
  }

  itemCard(item: ItemSnapshot, image: EmbeddedImage | null, packRef: string): void {
    const height = image ? 112 : 88;
    this.ensureSpace(height + 14, packRef);
    const top = this.y;
    this.box(this.margin, top - height, this.contentWidth, height, rgb(1, 1, 1), this.line);
    const imageBox = 88;
    let textX = this.margin + 12;
    if (image) {
      this.box(this.margin + 10, top - imageBox - 12, imageBox, imageBox, this.soft, this.line);
      const fitted = fitImage(image.width, image.height, imageBox - 8, imageBox - 8);
      this.page.drawImage(image.image, {
        x: this.margin + 10 + (imageBox - fitted.width) / 2,
        y: top - imageBox - 12 + (imageBox - fitted.height) / 2,
        width: fitted.width,
        height: fitted.height,
      });
      textX = this.margin + 112;
    }
    const textWidth = this.width - this.margin - textX - 12;
    this.text(item.name, textX, top - 18, 12, this.boldFont, this.ink, textWidth);
    this.text(
      [item.category, item.brand_maker, item.model_series].filter(Boolean).join(" · ") || "Household contents item",
      textX,
      top - 35,
      8.5,
      this.regularFont,
      this.muted,
      textWidth,
    );
    this.text(`Qty ${item.quantity} · ${currency(item.estimated_value)} · ${item.valuation_basis ?? "Policyholder estimate"}`, textX, top - 52, 9.5, this.boldFont, this.teal, textWidth);
    const detail = [
      item.condition_label ? `Condition: ${item.condition_label}` : null,
      item.photo_url ? "Photo supplied" : "No photo attached",
      item.evidence_count > 0 ? `${item.evidence_count} additional evidence ${item.evidence_count === 1 ? "file" : "files"} supplied` : "No additional evidence files",
    ].filter(Boolean).join(" · ");
    this.text(detail, textX, top - 69, 8.5, this.regularFont, this.slate, textWidth);
    const note = item.description || item.notes;
    if (note) this.text(note, textX, top - 86, 8, this.regularFont, this.muted, textWidth);
    this.y -= height + 10;
  }

  evidenceCard(item: ItemSnapshot, evidence: EvidenceSummary, image: EmbeddedImage | null, pdfAsset: PdfEvidenceAsset | null, packRef: string): void {
    const isPdf = isPdfEvidence(evidence);
    const height = image ? 82 : pdfAsset || isPdf ? 76 : 58;
    this.ensureSpace(height + 10, packRef);
    const top = this.y;
    this.box(this.margin, top - height, this.contentWidth, height, rgb(1, 1, 1), this.line);
    let textX = this.margin + 12;
    if (image) {
      const boxSize = 58;
      this.box(this.margin + 10, top - boxSize - 12, boxSize, boxSize, this.soft, this.line);
      const fitted = fitImage(image.width, image.height, boxSize - 6, boxSize - 6);
      this.page.drawImage(image.image, {
        x: this.margin + 10 + (boxSize - fitted.width) / 2,
        y: top - boxSize - 12 + (boxSize - fitted.height) / 2,
        width: fitted.width,
        height: fitted.height,
      });
      textX = this.margin + 82;
    }
    const textWidth = this.width - this.margin - textX - 12;
    this.text(item.name, textX, top - 16, 10.5, this.boldFont, this.ink, textWidth);
    this.text(evidenceLabel(evidence.evidence_type), textX, top - 32, 9, this.boldFont, this.teal, textWidth);
    this.text(evidence.filename ?? evidence.caption ?? "Supporting document supplied", textX, top - 48, 8.5, this.regularFont, this.slate, textWidth);
    if (pdfAsset) {
      const pageLabel = `${pdfAsset.pageCount} PDF ${pdfAsset.pageCount === 1 ? "page" : "pages"}`;
      const capLabel = pdfAsset.capped
        ? `First ${pdfAsset.includedPageCount} pages included; original PDF evidence file retained.`
        : "PDF pages included in Evidence Attachments.";
      this.text(`${pageLabel}. ${capLabel}`, textX, top - 64, 8, this.regularFont, this.muted, textWidth);
    } else if (isPdf) {
      this.text("PDF evidence file retained in Coverly.", textX, top - 64, 8, this.regularFont, this.muted, textWidth);
    }
    if (evidence.document_date) {
      this.text(new Date(evidence.document_date).toLocaleDateString("en-NZ"), this.width - this.margin - 90, top - 16, 8, this.regularFont, this.muted, 80, "right");
    }
    this.y -= height + 8;
  }

  attachmentNote(item: ItemSnapshot, evidence: EvidenceSummary, pdfAsset: PdfEvidenceAsset, packRef: string): void {
    const height = 58;
    this.ensureSpace(height + 10, packRef);
    const top = this.y;
    this.box(this.margin, top - height, this.contentWidth, height, rgb(1, 1, 1), this.line);
    this.text(item.name, this.margin + 12, top - 16, 10, this.boldFont, this.ink, this.contentWidth - 24);
    this.text(evidence.filename ?? "PDF evidence attachment", this.margin + 12, top - 32, 8.5, this.regularFont, this.slate, this.contentWidth - 24);
    const capLabel = pdfAsset.capped
      ? `First ${pdfAsset.includedPageCount} of ${pdfAsset.pageCount} pages copied below; original PDF evidence file retained.`
      : `${pdfAsset.pageCount} PDF ${pdfAsset.pageCount === 1 ? "page" : "pages"} copied below.`;
    this.text(capLabel, this.margin + 12, top - 48, 8, this.regularFont, this.muted, this.contentWidth - 24);
    this.y -= height + 8;
  }

  signatureBoxes(packRef: string): void {
    this.ensureSpace(145, packRef);
    const gap = 14;
    const width = (this.contentWidth - gap) / 2;
    for (const [index, title] of ["Policyholder signature", "Additional policyholder signature"].entries()) {
      const x = this.margin + index * (width + gap);
      this.box(x, this.y - 92, width, 92, rgb(1, 1, 1), this.line);
      this.text(title, x + 10, this.y - 18, 9, this.boldFont, this.ink);
      this.page.drawLine({ start: { x: x + 10, y: this.y - 58 }, end: { x: x + width - 10, y: this.y - 58 }, thickness: 0.7, color: this.line });
      this.text("Date", x + 10, this.y - 76, 8, this.regularFont, this.muted);
    }
    this.y -= 110;
    this.box(this.margin, this.y - 74, this.contentWidth, 74, this.soft, this.line);
    this.text("Additional Policyholder Notes / Insurer or Assessor Notes", this.margin + 10, this.y - 18, 9, this.boldFont, this.ink);
    this.y -= 90;
  }

  footer(packRef: string): void {
    this.text(`Coverly Claim Pack · ${packRef}`, this.margin, 24, 8, this.regularFont, this.muted);
    this.text(`Page ${this.pageNumber}`, this.width - this.margin - 70, 24, 8, this.regularFont, this.muted, 70, "right");
  }

  private drawBrandHeader(compact: boolean, packRef: string): void {
    this.box(this.margin, this.y - 38, 38, 38, this.tealSoft, rgb(0.72, 0.89, 0.86));
    this.text("C", this.margin + 13, this.y - 24, 16, this.boldFont, this.teal);
    this.text("Coverly", this.margin + 50, this.y - 14, compact ? 16 : 20, this.boldFont, this.ink);
    this.text("Know what you own.", this.margin + 50, this.y - 30, 8.5, this.regularFont, this.muted);
    this.text(packRef, this.width - this.margin - 170, this.y - 18, 8.5, this.regularFont, this.muted, 170, "right");
    this.y -= compact ? 62 : 48;
  }

  private ensureSpace(required: number, packRef: string): void {
    if (this.y - required >= 58) return;
    this.footer(packRef || "Coverly");
    this.newPage(packRef || "Coverly");
  }

  private box(x: number, y: number, width: number, height: number, fill: ReturnType<typeof rgb>, border: ReturnType<typeof rgb>): void {
    this.page.drawRectangle({ x, y, width, height, color: fill, borderColor: border, borderWidth: 0.8 });
  }

  private text(
    text: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    color: ReturnType<typeof rgb>,
    maxWidth = this.contentWidth,
    align: "left" | "right" = "left",
  ): void {
    const clean = safePdfText(text);
    const lines = this.wrap(clean, size, maxWidth).slice(0, 3);
    lines.forEach((line, index) => {
      const lineWidth = font.widthOfTextAtSize(line, size);
      this.page.drawText(line, {
        x: align === "right" ? x + maxWidth - lineWidth : x,
        y: y - index * (size + 3),
        size,
        font,
        color,
      });
    });
  }

  private wrap(text: string, size: number, maxWidth: number): string[] {
    const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (this.regularFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
}

async function generatePdfBytes(params: {
  adminClient: SupabaseClient;
  property: InventoryFileRow;
  roomsIncluded: Array<{ id: string; name: string }>;
  itemSnapshots: ItemSnapshot[];
  totals: ClaimPackTotals;
  generatedAt: string;
  claimNote: string | null;
  packRef: string;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const writer = new PdfWriter(pdfDoc, regularFont, boldFont);
  const imageByItemId = new Map<string, EmbeddedImage | null>();
  await Promise.all(params.itemSnapshots.slice(0, 80).map(async (item) => {
    imageByItemId.set(item.id, await embedImageFromReference(pdfDoc, params.adminClient, INVENTORY_PHOTOS_BUCKET, item.photo_url));
  }));
  const allEvidence = params.itemSnapshots.flatMap((item) => item.evidence.map((evidence) => ({ item, evidence })));
  const imageByEvidenceId = new Map<string, EmbeddedImage | null>();
  await Promise.all(allEvidence.slice(0, 80).map(async ({ evidence }) => {
    imageByEvidenceId.set(
      evidence.id,
      isImageEvidence(evidence) && !isPdfEvidence(evidence)
        ? await embedImageFromReference(pdfDoc, params.adminClient, CLAIM_EVIDENCE_BUCKET, evidence.file_url)
        : null,
    );
  }));
  const pdfByEvidenceId = new Map<string, PdfEvidenceAsset | null>();
  await Promise.all(allEvidence.slice(0, 40).map(async ({ evidence }) => {
    if (!isPdfEvidence(evidence)) return;
    pdfByEvidenceId.set(evidence.id, await loadPdfEvidenceAsset(params.adminClient, evidence));
  }));

  writer.cover({
    title: "Claim Pack",
    packRef: params.packRef,
    generatedAt: params.generatedAt,
    propertyName: params.property.name ?? "Unnamed property",
    intro: "This Coverly Claim Pack presents selected household contents, replacement value estimates, and supporting evidence references for insurer, broker, assessor, or loss-adjuster review.",
  });
  writer.footer(params.packRef);

  writer.newPage(params.packRef);
  writer.section("Claim and Property Details", params.packRef);
  writer.detailGrid([
    { label: "Property name", value: params.property.name ?? "Unnamed property" },
    { label: "Property type", value: friendlyPropertyType(params.property.property_type) },
    { label: "Insurer name", value: params.property.insurer_name },
    { label: "Policy number", value: params.property.policy_number },
    { label: "Policy Information Supplied", value: params.property.contents_sum_insured != null ? currency(params.property.contents_sum_insured) : null },
    { label: "Generated date", value: formatDateTime(params.generatedAt) },
  ], params.packRef);

  if (params.claimNote) {
    writer.section("Claim Note", params.packRef);
    writer.paragraph(params.claimNote, 10.5, writer.slate);
  }

  writer.section("Executive Summary", params.packRef);
  writer.metricStrip([
    { label: "Total claimed value", value: currency(params.totals.totalEstimatedValue) },
    { label: "Selected rooms", value: params.totals.selectedRoomsCount },
    { label: "Selected items", value: params.totals.selectedItemsCount },
    { label: "Evidence references", value: params.totals.includedEvidenceCount },
  ]);
  writer.paragraph("Only selected claim-pack items are included. Values are presented as policyholder-supplied or estimated replacement values to support the claims assessment process.", 10, writer.slate);

  writer.section("Rooms Included", params.packRef);
  const roomColumns = [
    { label: "Room", width: writer.contentWidth * 0.5 },
    { label: "Items", width: writer.contentWidth * 0.2, align: "right" as const },
    { label: "Estimated value", width: writer.contentWidth * 0.3, align: "right" as const },
  ];
  writer.tableHeader(roomColumns, params.packRef);
  const snapshotsByRoom = new Map<string, ItemSnapshot[]>();
  for (const item of params.itemSnapshots) {
    const list = snapshotsByRoom.get(item.room_name) ?? [];
    list.push(item);
    snapshotsByRoom.set(item.room_name, list);
  }
  for (const [roomName, items] of snapshotsByRoom.entries()) {
    const total = items.reduce((sum, item) => sum + (item.estimated_value ?? 0), 0);
    writer.tableRow([roomName, String(items.length), currency(total)], roomColumns, params.packRef);
  }

  writer.section("Selected Item Schedule", params.packRef);
  const itemColumns = [
    { label: "Item", width: writer.contentWidth * 0.34 },
    { label: "Room", width: writer.contentWidth * 0.2 },
    { label: "Qty", width: writer.contentWidth * 0.08, align: "right" as const },
    { label: "Evidence", width: writer.contentWidth * 0.13, align: "right" as const },
    { label: "Value", width: writer.contentWidth * 0.25, align: "right" as const },
  ];
  writer.tableHeader(itemColumns, params.packRef);
  for (const item of params.itemSnapshots) {
    writer.tableRow([
      item.name,
      item.room_name,
      String(item.quantity),
      String(item.evidence_count),
      currency(item.estimated_value),
    ], itemColumns, params.packRef);
  }

  writer.section("Item Details and Photo References", params.packRef);
  const grouped = new Map<string, ItemSnapshot[]>();
  for (const item of params.itemSnapshots) {
    const list = grouped.get(item.room_name) ?? [];
    list.push(item);
    grouped.set(item.room_name, list);
  }
  for (const [roomName, items] of grouped.entries()) {
    const total = items.reduce((sum, item) => sum + (item.estimated_value ?? 0), 0);
    writer.roomHeading(roomName, items.length, total, params.packRef);
    for (const item of items) {
      writer.itemCard(item, imageByItemId.get(item.id) ?? null, params.packRef);
    }
  }

  if (allEvidence.length > 0) {
    writer.section("Evidence Appendix", params.packRef);
    writer.paragraph("This appendix includes only additional evidence records explicitly attached to claim-pack items, such as receipts, warranties, manuals, valuation documents, and supporting evidence photos.", 9.5, writer.slate);
    const evidenceByItem = new Map<ItemSnapshot, EvidenceSummary[]>();
    for (const { item, evidence } of allEvidence) {
      const list = evidenceByItem.get(item) ?? [];
      list.push(evidence);
      evidenceByItem.set(item, list);
    }
    for (const [item, evidenceList] of evidenceByItem.entries()) {
      writer.evidenceGroupHeading(item.name, evidenceList.length, params.packRef);
      for (const evidence of evidenceList) {
        writer.evidenceCard(item, evidence, imageByEvidenceId.get(evidence.id) ?? null, pdfByEvidenceId.get(evidence.id) ?? null, params.packRef);
      }
    }
  }

  writer.section("Declaration and Notes", params.packRef);
  writer.paragraph("I confirm that the contents listed in this Claim Pack represent, to the best of my knowledge, selected household contents and supporting information relevant to the claim or insurer conversation.", 10, writer.slate);
  writer.signatureBoxes(params.packRef);
  writer.section("Important Notes", params.packRef);
  writer.paragraph("Values shown are estimates based on the policyholder's inventory, available evidence, and replacement pricing information. This document does not guarantee claim approval or settlement value. The insurer retains the right to verify, adjust, or decline items according to the applicable policy terms.", 9.5, writer.muted);

  const pdfAttachments = allEvidence
    .map(({ item, evidence }) => ({ item, evidence, pdfAsset: pdfByEvidenceId.get(evidence.id) ?? null }))
    .filter((entry): entry is { item: ItemSnapshot; evidence: EvidenceSummary; pdfAsset: PdfEvidenceAsset } => entry.pdfAsset !== null);
  if (pdfAttachments.length > 0) {
    writer.section("Evidence Attachments", params.packRef);
    writer.paragraph("The following pages are copied from attached PDF evidence files. Long PDF evidence files are capped in this Claim Pack and the original evidence file is retained in Coverly.", 9.5, writer.slate);
    for (const { item, evidence, pdfAsset } of pdfAttachments) {
      writer.attachmentNote(item, evidence, pdfAsset, params.packRef);
    }
  }
  writer.footer(params.packRef);

  for (const { pdfAsset } of pdfAttachments) {
    const pageIndexes = Array.from({ length: pdfAsset.includedPageCount }, (_, index) => index);
    const copiedPages = await pdfDoc.copyPages(pdfAsset.sourceDoc, pageIndexes);
    for (const page of copiedPages) {
      pdfDoc.addPage(page);
    }
  }

  return pdfDoc.save();
}

async function sendClaimPackEmail(params: {
  to: string | null;
  signedUrl: string;
  filename: string;
  propertyName: string;
  generatedAt: string;
}): Promise<{ emailSent: boolean; emailWarning?: string }> {
  const provider = RESEND_API_KEY ? "resend" : POSTMARK_SERVER_TOKEN ? "postmark" : "none";
  log("email provider detected", { provider, emailAttempted: Boolean(params.to && provider !== "none") });
  if (!params.to) {
    log("email skipped", { provider, reason: "No account email address was available" });
    return { emailSent: false, emailWarning: "No account email address was available." };
  }
  const subject = "Your Coverly claim pack is ready";
  const text = [
    "Your Coverly claim pack PDF is ready.",
    "",
    `Property: ${params.propertyName}`,
    `File: ${params.filename}`,
    `Generated: ${formatDateTime(params.generatedAt)}`,
    "",
    "Open your secure temporary PDF link:",
    params.signedUrl,
    "",
    "This link is temporary. You can also open the PDF from Coverly while the link is active.",
  ].join("\n");
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#172333;line-height:1.5">
      <h2 style="color:#0f766e">Your Coverly claim pack is ready</h2>
      <p>Your claim pack PDF has been generated for <strong>${escapeHtml(params.propertyName)}</strong>.</p>
      <p><a href="${escapeHtml(params.signedUrl)}" style="display:inline-block;background:#0f8f83;color:white;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">Open claim pack PDF</a></p>
      <p style="color:#64748b;font-size:13px">This is a secure temporary link. File: ${escapeHtml(params.filename)}</p>
    </div>
  `;

  try {
    if (RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: COVERLY_EMAIL_FROM, to: [params.to], subject, text, html }),
      });
      log("email attempted", { provider, status: res.status, ok: res.ok });
      if (!res.ok) throw new Error(`Resend returned ${res.status}`);
      log("email sent", { provider, emailSent: true });
      return { emailSent: true };
    }

    if (POSTMARK_SERVER_TOKEN) {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ From: COVERLY_EMAIL_FROM, To: params.to, Subject: subject, TextBody: text, HtmlBody: html }),
      });
      log("email attempted", { provider, status: res.status, ok: res.ok });
      if (!res.ok) throw new Error(`Postmark returned ${res.status}`);
      log("email sent", { provider, emailSent: true });
      return { emailSent: true };
    }

    log("email skipped", { provider, reason: "No email provider secret configured" });
    return { emailSent: false, emailWarning: "Email provider is not configured." };
  } catch (error) {
    log("email failed", { provider, emailSent: false, message: safeErrorMessage(error) });
    return { emailSent: false, emailWarning: "We could not email the PDF, but it is ready to open." };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function insertClaimPack(adminClient: SupabaseClient, row: Record<string, unknown>): Promise<string | number> {
  const { data, error } = await adminClient
    .from("claim_packs")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new HttpError(500, "CLAIM_PACK_INSERT_FAILED", error.message);
  return (data as { id: string | number }).id;
}

serve(async (req: Request) => {
  log("request received", { method: req.method });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", "POST only.", 405);

  let claimPackId: string | number | null = null;
  let adminClient: SupabaseClient | null = null;
  let uploadedStoragePath: string | null = null;

  try {
    const { userId, userEmail, userClient } = await verifyUser(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "BAD_REQUEST", "Invalid JSON body.");
    }
    const payload = parseRequest(body);
    const { property, rooms, items, evidenceByItemId } = await fetchValidatedData(userClient, payload, userId);

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new HttpError(500, "CONFIGURATION_ERROR", "SUPABASE_SERVICE_ROLE_KEY is not configured.");
    }
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { snapshots, totals, roomsIncluded } = buildSnapshots(rooms, items, evidenceByItemId);
    const generatedAt = new Date().toISOString();
    const exportId = crypto.randomUUID();
    const propertyName = property.name ?? "property";
    const filename = `coverly-claim-pack-${slugify(propertyName)}-${generatedAt.slice(0, 10)}.pdf`;
    const storagePath = `${userId}/${property.id}/${exportId}.pdf`;
    const packRef = makePackRef(generatedAt);

    const pdfBytes = await generatePdfBytes({
      adminClient,
      property,
      roomsIncluded,
      itemSnapshots: snapshots,
      totals,
      generatedAt,
      claimNote: payload.claimNote ?? null,
      packRef,
    });
    log("PDF generated", { byteLength: pdfBytes.byteLength, selectedItemsCount: totals.selectedItemsCount });

    const { error: uploadError } = await adminClient.storage
      .from(CLAIM_PACK_BUCKET)
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        cacheControl: "private, max-age=0",
        upsert: false,
      });
    if (uploadError) throw new HttpError(500, "PDF_UPLOAD_FAILED", uploadError.message);
    uploadedStoragePath = storagePath;
    log("storage uploaded", { storagePath });

    const insertRow = {
      user_id: userId,
      user_email: userEmail,
      file_id: property.id,
      pack_ref: packRef,
      scope: payload.scope,
      items_snapshot: snapshots,
      rooms_included: roomsIncluded,
      total_value: totals.totalEstimatedValue,
      item_count: totals.selectedItemsCount,
      claim_note: payload.claimNote ?? null,
      status: "ready",
      storage_path: storagePath,
      filename,
      file_size_bytes: pdfBytes.byteLength,
      generated_at: generatedAt,
      selected_room_ids: payload.selectedRoomIds,
      selected_item_ids: payload.selectedItemIds,
      totals,
      generation_error: null,
    };

    claimPackId = await insertClaimPack(adminClient, insertRow);
    log("claim_packs inserted", { claimPackId });

    const { data: signedData, error: signedError } = await adminClient.storage
      .from(CLAIM_PACK_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signedError || !signedData?.signedUrl) {
      throw new HttpError(500, "SIGNED_URL_FAILED", signedError?.message ?? "Signed URL was not created.");
    }
    log("signed URL created", { claimPackId, ttlSeconds: SIGNED_URL_TTL_SECONDS });

    const { data: emailSignedData, error: emailSignedError } = await adminClient.storage
      .from(CLAIM_PACK_BUCKET)
      .createSignedUrl(storagePath, EMAIL_SIGNED_URL_TTL_SECONDS);
    const emailResult = emailSignedError || !emailSignedData?.signedUrl
      ? { emailSent: false, emailWarning: "We could not create an email download link." }
      : await sendClaimPackEmail({
          to: userEmail,
          signedUrl: emailSignedData.signedUrl,
          filename,
          propertyName: property.name ?? "Coverly property",
          generatedAt,
        });

    return response({
      success: true,
      claimPackId,
      signedUrl: signedData.signedUrl,
      rendererVersion: RENDERER_VERSION,
      filename,
      generatedAt,
      totals,
      emailSent: emailResult.emailSent,
      emailWarning: emailResult.emailWarning ?? null,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.error : "INTERNAL_ERROR";
    const message = safeErrorMessage(error);

    if (adminClient && claimPackId != null) {
      const { error: updateError } = await adminClient
        .from("claim_packs")
        .update({ status: "failed", generation_error: message })
        .eq("id", claimPackId);
      if (updateError) log("failed status update failed", { claimPackId, message: updateError.message });
    } else if (adminClient && uploadedStoragePath) {
      const { error: removeError } = await adminClient.storage
        .from(CLAIM_PACK_BUCKET)
        .remove([uploadedStoragePath]);
      if (removeError) log("orphan upload cleanup failed", { storagePath: uploadedStoragePath, message: removeError.message });
    }

    log("response returned", { status, error: code, message });
    return errorResponse(code, message, status);
  }
});
