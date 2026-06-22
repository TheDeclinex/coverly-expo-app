import type { InventoryItem, ItemPhoto } from "@/types";

/**
 * Central mapper for converting form data into a Supabase inventory_items insert payload.
 * Manual Add Item, AI Scan, and item import must all use this helper.
 *
 * Table: inventory_items
 * Real columns:
 *   id text NOT NULL (no default → must generate)
 *   sort_order integer nullable
 *   file_id text NOT NULL
 *   room_id uuid nullable
 *   room text nullable
 *   name text NOT NULL
 *   quantity integer NOT NULL default 1
 *   category text nullable
 *   confidence numeric nullable
 *   estimated_price numeric nullable default 0
 *   unit_estimated_price numeric nullable
 *   quantity_estimate text nullable
 *   valuation_basis text nullable
 *   price_source_type text nullable default 'estimated_gpt'
 *   image_url text nullable
 *   photo_url text nullable
 *   notes text nullable
 *   description text nullable
 *   image_pin jsonb nullable
 *   attachments jsonb nullable
 *   brand_maker text nullable
 *   model_series text nullable
 *   condition_label text nullable
 *   purchase_source text nullable
 *   original_purchase_price numeric nullable
 *   purchase_year_approx text nullable
 *   web_listing_url text nullable
 *   web_listing_title text nullable
 *   web_listing_price numeric nullable
 *   web_listing_source text nullable
 *   web_listing_match_type text nullable
 *
 * NOT in table: user_id
 */

export interface ItemFormData {
  fileId: string;
  roomId: string;
  roomName?: string | null;
  name: string;
  description?: string | null;
  notes?: string | null;
  category?: string | null;
  estimatedPrice?: number | null;
  unitEstimatedPrice?: number | null;
  quantity?: number | null;
  /** Accepts a display label ("high"/"medium"/"low") or a numeric value 0–1. Converted to numeric before saving. */
  confidence?: string | number | null;
  valuationBasis?: string | null;
  priceSourceType?: string | null;
  imageUrl?: string | null;
  photoUrl?: string | null;
  /** Ordered array of item photos with captions. First entry is the cover/primary photo. */
  photos?: ItemPhoto[] | null;
  brandMaker?: string | null;
  modelSeries?: string | null;
  conditionLabel?: string | null;
  purchaseSource?: string | null;
  originalPurchasePrice?: number | null;
  purchaseYearApprox?: string | null;
  /**
   * AI-detected visual pin for this item in the source photo.
   * Coordinates are in 0–100 percentage space from top-left.
   * Stored as 0–1 in inventory_items.image_pin after normalisation.
   */
  pin?: { x: number; y: number } | null;
  /** 0-based index into the scan images array for the source photo. */
  sourcePhotoIndex?: number | null;
}

/**
 * Convert a confidence display label or float to a numeric value for the DB.
 * inventory_items.confidence is a numeric column — never send a string.
 */
function confidenceLabelToNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Math.min(1, Math.max(0, v));
  switch (v.toLowerCase().trim()) {
    case "high":   return 0.9;
    case "medium": return 0.6;
    case "low":    return 0.3;
    default: {
      const n = parseFloat(v);
      return isNaN(n) ? null : Math.min(1, Math.max(0, n));
    }
  }
}

/**
 * Build the image_pin jsonb value from form data.
 * Normalises Edge Function coords (0–100) to 0–1 range for storage.
 * Returns null if no valid pin exists.
 */
function buildImagePin(form: ItemFormData): Record<string, unknown> | null {
  const p = form.pin;
  if (!p) return null;
  if (!isFinite(p.x) || !isFinite(p.y)) return null;
  return {
    x: Math.min(1, Math.max(0, p.x / 100)),
    y: Math.min(1, Math.max(0, p.y / 100)),
    sourcePhotoIndex: form.sourcePhotoIndex ?? 0,
    type: "ai",
  };
}

function generateItemId(): string {
  // Simple alphanumeric random id (text) for inventory_items.id which has no default
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

let lastGeneratedSortOrder = 0;

/**
 * Room lists sort by sort_order ascending. New items use negative Unix seconds,
 * which keeps legacy positive ordering intact while placing newer additions first.
 * The in-memory decrement also gives items created in the same second a stable order.
 */
function generateNewItemSortOrder(): number {
  const currentSecond = -Math.floor(Date.now() / 1000);
  const next = lastGeneratedSortOrder === 0
    ? currentSecond
    : Math.min(currentSecond, lastGeneratedSortOrder - 1);
  lastGeneratedSortOrder = next;
  return next;
}

export function buildItemInsertPayload(form: ItemFormData): InventoryItem {
  return {
    id: generateItemId(),
    sort_order: generateNewItemSortOrder(),
    file_id: form.fileId,
    room_id: form.roomId || null,
    room: form.roomName?.trim() || null,
    name: form.name.trim(),
    description: form.description?.trim() || null,
    notes: form.notes?.trim() || null,
    category: form.category?.trim() || null,
    estimated_price: form.estimatedPrice ?? null,
    unit_estimated_price: form.unitEstimatedPrice ?? null,
    quantity: form.quantity ?? 1,
    quantity_estimate: null,
    valuation_basis: form.valuationBasis ?? null,
    price_source_type: form.priceSourceType ?? "estimated_gpt",
    confidence: confidenceLabelToNumber(form.confidence),
    image_url: form.imageUrl ?? null,
    photo_url: form.photoUrl ?? null,
    brand_maker: form.brandMaker ?? null,
    model_series: form.modelSeries ?? null,
    condition_label: form.conditionLabel ?? null,
    purchase_source: form.purchaseSource ?? null,
    original_purchase_price: form.originalPurchasePrice ?? null,
    purchase_year_approx: form.purchaseYearApprox ?? null,
    image_pin: buildImagePin(form),
    attachments: null,
  };
}

export function buildItemUpdatePayload(
  form: Omit<ItemFormData, "fileId">
): Partial<InventoryItem> {
  // image_url / photo_url / attachments are ONLY included in the update when
  // form.photos is explicitly provided (not undefined).
  //
  //   form.photos === undefined  → caller did not touch photos → omit image fields
  //                                entirely so existing DB values are preserved.
  //   form.photos === []         → caller explicitly cleared all photos → write null.
  //   form.photos = [...]        → caller has photos → write first URL + attachments.
  //
  // This prevents accidental nullification when editing non-photo fields
  // (e.g. renaming an item) and also when all photo uploads fail.
  const photosProvided = form.photos !== undefined;
  const primaryUrl = photosProvided
    ? (form.photos?.[0]?.url ?? form.imageUrl ?? form.photoUrl ?? null)
    : undefined;

  return {
    room_id: form.roomId || null,
    room: form.roomName?.trim() || null,
    name: form.name.trim(),
    description: form.description?.trim() || null,
    ...(form.notes !== undefined ? { notes: form.notes?.trim() || null } : {}),
    category: form.category?.trim() || null,
    estimated_price: form.estimatedPrice ?? null,
    unit_estimated_price: form.unitEstimatedPrice ?? null,
    quantity: form.quantity ?? 1,
    ...(form.valuationBasis !== undefined ? { valuation_basis: form.valuationBasis ?? null } : {}),
    ...(form.priceSourceType !== undefined ? { price_source_type: form.priceSourceType ?? null } : {}),
    ...(photosProvided ? {
      image_url: primaryUrl ?? null,
      photo_url: primaryUrl ?? null,
      attachments: form.photos && form.photos.length > 0 ? form.photos : null,
    } : {}),
    ...(form.brandMaker !== undefined ? { brand_maker: form.brandMaker ?? null } : {}),
    ...(form.modelSeries !== undefined ? { model_series: form.modelSeries ?? null } : {}),
    ...(form.conditionLabel !== undefined ? { condition_label: form.conditionLabel ?? null } : {}),
    ...(form.purchaseSource !== undefined ? { purchase_source: form.purchaseSource ?? null } : {}),
    ...(form.originalPurchasePrice !== undefined ? { original_purchase_price: form.originalPurchasePrice ?? null } : {}),
    ...(form.purchaseYearApprox !== undefined ? { purchase_year_approx: form.purchaseYearApprox ?? null } : {}),
  };
}
