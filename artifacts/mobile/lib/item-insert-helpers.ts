import type { InventoryItem } from "@/types";

/**
 * Central mapper for converting form data into a Supabase inventory_items insert/update payload.
 * Manual Add Item, AI Scan, and item import must all use this helper so column names stay consistent.
 *
 * Table: inventory_items
 * Required columns: file_id, room_id, name, user_id (required by RLS)
 */
export interface ItemFormData {
  fileId: string;
  roomId: string;
  userId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  estimatedPrice?: number | null;
  quantity?: number | null;
  imageUrl?: string | null;
  brandMaker?: string | null;
  modelSeries?: string | null;
  conditionLabel?: string | null;
  confidence?: string | null;
  valuationBasis?: string | null;
  notes?: string | null;
}

export function buildItemInsertPayload(
  form: ItemFormData
): Omit<InventoryItem, "id"> & { user_id: string } {
  return {
    file_id: form.fileId,
    room_id: form.roomId,
    user_id: form.userId,
    name: form.name.trim(),
    description: form.description?.trim() || null,
    category: form.category?.trim() || null,
    estimated_price: form.estimatedPrice ?? null,
    unit_estimated_price: null,
    quantity: form.quantity ?? 1,
    quantity_estimate: null,
    valuation_basis: form.valuationBasis ?? null,
    confidence: form.confidence ?? null,
    image_url: form.imageUrl ?? null,
    photo_url: null,
    notes: form.notes?.trim() || null,
    brand_maker: form.brandMaker ?? null,
    model_series: form.modelSeries ?? null,
    condition_label: form.conditionLabel ?? null,
    purchase_source: null,
    original_purchase_price: null,
    purchase_year_approx: null,
    web_listing_url: null,
    web_listing_title: null,
    web_listing_price: null,
    web_listing_source: null,
    sort_order: null,
  };
}

export function buildItemUpdatePayload(
  form: Omit<ItemFormData, "fileId" | "userId">
): Partial<InventoryItem> {
  return {
    room_id: form.roomId,
    name: form.name.trim(),
    description: form.description?.trim() || null,
    category: form.category?.trim() || null,
    estimated_price: form.estimatedPrice ?? null,
    quantity: form.quantity ?? 1,
    image_url: form.imageUrl ?? null,
    brand_maker: form.brandMaker ?? null,
    model_series: form.modelSeries ?? null,
    condition_label: form.conditionLabel ?? null,
    notes: form.notes?.trim() || null,
  };
}
