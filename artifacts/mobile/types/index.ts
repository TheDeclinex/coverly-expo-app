export interface InventoryFile {
  id: string;
  user_id: string;
  /** Per-user sequential bigint reference number. NOT NULL in the database. */
  file_number: number;
  name: string;
  status: string | null;
  contents_sum_insured: number | null;
  created_by_email: string | null;
  property_type: string | null;
  property_cover_image_url: string | null;
  created_date: string | null;
  last_modified: string | null;
}

export interface InventoryRoom {
  id: string;
  file_id: string;
  user_id: string;
  name: string;
  room_type: string | null;
  sort_order: number | null;
  cover_photo_url: string | null;
  notes: string | null;
  description: string | null;
  archived_at: string | null;
}

export interface ItemPhoto {
  url: string;
  caption: string;
}

export interface InventoryItem {
  id: string;
  /** Negative newest-first ordering value assigned when an item is created. */
  sort_order?: number | null;
  file_id: string;
  room_id: string | null;
  room: string | null;
  name: string;
  category: string | null;
  confidence: number | null;
  estimated_price: number | null;
  unit_estimated_price: number | null;
  quantity: number | null;
  quantity_estimate: string | null;
  valuation_basis: string | null;
  price_source_type: string | null;
  web_listing_url?: string | null;
  web_listing_title?: string | null;
  web_listing_price?: number | null;
  web_listing_source?: string | null;
  web_listing_match_type?: string | null;
  description: string | null;
  image_url: string | null;
  photo_url: string | null;
  notes: string | null;
  brand_maker: string | null;
  model_series: string | null;
  barcode?: string | null;
  barcode_verified?: boolean | null;
  condition_label: string | null;
  purchase_source: string | null;
  original_purchase_price: number | null;
  purchase_year_approx: string | null;
  image_pin: unknown | null;
  attachments: ItemPhoto[] | null;
  // Optional — populated only if inventory_items.scan_date column exists in DB
  scan_date?: string | null;
}
