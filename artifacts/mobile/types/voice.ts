export type VoiceItemField =
  | "name"
  | "quantity"
  | "brand_maker"
  | "model_series"
  | "purchase_source"
  | "purchase_year_approx"
  | "original_purchase_price"
  | "replacement_price"
  | "description"
  | "notes";

export type VoiceChangeField = VoiceItemField | "ambiguous_price";
export type VoiceScalar = string | number | null;

export interface VoiceItemValues {
  name?: string | null;
  quantity?: number | null;
  brand_maker?: string | null;
  model_series?: string | null;
  purchase_source?: string | null;
  purchase_year_approx?: string | null;
  original_purchase_price?: number | null;
  estimated_price?: number | null;
  unit_estimated_price?: number | null;
  description?: string | null;
  notes?: string | null;
  price_source_type?: string | null;
  valuation_basis?: string | null;
}

export type VoiceItemPatch = Partial<VoiceItemValues>;

export interface VoiceExtractionResult {
  display_name: string | null;
  description: string | null;
  category: string | null;
  brand: string | null;
  make: string | null;
  model: string | null;
  maker_artist_brand: string | null;
  model_title: string | null;
  serial_number: string | null;
  year_or_era: string | null;
  purchase_year: string | null;
  retailer_store_purchased_from: string | null;
  seller: string | null;
  purchase_source_type: string | null;
  purchase_price: number | null;
  estimated_value: number | null;
  quantity: number | null;
  currency: string | null;
  condition: string | null;
  material_medium: string | null;
  original_or_copy: string | null;
  pricing_match_terms: string[];
  notes: string | null;
  raw_summary: string | null;
  uncertain_fields: string[];
}

export interface VoiceDescribeRequest {
  audioBase64: string;
  mimeType: string;
  ext?: string;
  itemId?: string;
  currentName?: string;
  currentCategory?: string;
  currentDescription?: string;
  mode?: "item_edit";
  targetField?: VoiceItemField;
  currentValues?: Partial<VoiceItemValues>;
}

export interface VoiceDescribeSuccess {
  success: true;
  transcript: string;
  extraction: VoiceExtractionResult | null;
  extractionError?: string;
  diagnostics?: Record<string, unknown>;
}

export interface VoiceDescribeFailure {
  success: false;
  errorCode: string;
  error: string;
  diagnostics?: Record<string, unknown>;
}

export type VoiceDescribeResponse = VoiceDescribeSuccess | VoiceDescribeFailure;

export interface VoiceCallResult {
  response: VoiceDescribeResponse | null;
  httpStatus: number | null;
  networkError: string | null;
  durationMs: number;
}

export interface VoiceMappedChange {
  id: string;
  field: VoiceChangeField;
  label: string;
  currentValue: VoiceScalar;
  nextValue: VoiceScalar;
  patch: VoiceItemPatch;
  uncertain: boolean;
  selectedByDefault: boolean;
  requiresResolution?: boolean;
}

export type VoiceInputPhase =
  | "permission"
  | "ready"
  | "recording"
  | "processing"
  | "review"
  | "error";
