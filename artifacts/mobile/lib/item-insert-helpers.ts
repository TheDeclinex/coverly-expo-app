import type { InventoryItem } from "@/types";

/**
 * Central mapper for converting form data into a Supabase inventory_items insert payload.
 * Manual Add Item, AI Scan, and item import must all use this helper.
 *
 * Table: inventory_items
 * Real columns:
 *   id text NOT NULL (no default → must generate)
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
 *
 * NOT in table: user_id, sort_order, web_listing_url, web_listing_title, web_listing_price, web_listing_source
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

export function buildItemInsertPayload(form: ItemFormData): InventoryItem {
  return {
    id: generateItemId(),
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
  return {
    room_id: form.roomId || null,
    room: form.roomName?.trim() || null,
    name: form.name.trim(),
    description: form.description?.trim() || null,
    notes: form.notes?.trim() || null,
    category: form.category?.trim() || null,
    estimated_price: form.estimatedPrice ?? null,
    unit_estimated_price: form.unitEstimatedPrice ?? null,
    quantity: form.quantity ?? 1,
    valuation_basis: form.valuationBasis ?? null,
    price_source_type: form.priceSourceType ?? null,
    image_url: form.imageUrl ?? null,
    photo_url: form.photoUrl ?? null,
    brand_maker: form.brandMaker ?? null,
    model_series: form.modelSeries ?? null,
    condition_label: form.conditionLabel ?? null,
    purchase_source: form.purchaseSource ?? null,
    original_purchase_price: form.originalPurchasePrice ?? null,
    purchase_year_approx: form.purchaseYearApprox ?? null,
  };
}
