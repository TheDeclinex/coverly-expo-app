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
  confidence?: string | null;
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
    confidence: form.confidence ?? null,
    image_url: form.imageUrl ?? null,
    photo_url: form.photoUrl ?? null,
    brand_maker: form.brandMaker ?? null,
    model_series: form.modelSeries ?? null,
    condition_label: form.conditionLabel ?? null,
    purchase_source: form.purchaseSource ?? null,
    original_purchase_price: form.originalPurchasePrice ?? null,
    purchase_year_approx: form.purchaseYearApprox ?? null,
    image_pin: null,
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
