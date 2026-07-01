/**
 * Scan types for Coverly AI-assisted inventory scanning.
 * All scan results flow through ScanDetectedItem → buildItemInsertPayload before saving.
 */

export type ScanMode =
  | "single_photo_room"   // 1 photo → detect all visible room items (1 credit)
  | "multi_photo_room"    // up to 5 photos → exhaustive detect + merge (3 credits/batch)
  | "video_room"          // video → frame extraction + dedup (coming soon)
  | "single_item";        // close-up → 1 item with rich brand/model/value detail (1 credit)

/**
 * A single image captured or picked by the user, ready to scan.
 * Local URI is uploaded to Storage before invoking the Edge Function.
 * base64 is optional legacy fallback data only.
 */
export interface ScanEncodedImage {
  /** Local device URI — used for thumbnail display only */
  uri: string;
  /** Optional legacy base64 data (no data: prefix) for Edge Function fallback payloads */
  base64?: string;
  /** MIME type e.g. "image/jpeg" */
  mimeType: string;
  /** Durable Supabase Storage path uploaded before scan invoke */
  storagePath?: string;
}

export interface ScanInput {
  mode: ScanMode;
  fileId: string;
  roomId: string;
  roomName?: string;
  /** Stable per-scan key used by backend usage accounting to avoid double-charging retries */
  usageIdempotencyKey?: string;
  /** Pre-encoded images captured/picked by the user */
  images: ScanEncodedImage[];
  /** Local URI for video (mode: video_room only) */
  videoUri?: string;
}

/**
 * Normalized detected item from AI scan.
 * Maps to inventory_items columns via buildItemInsertPayload.
 */
export interface ScanDetectedItem {
  name: string;
  description?: string | null;
  notes?: string | null;
  category?: string | null;
  estimatedPrice?: number | null;
  unitEstimatedPrice?: number | null;
  quantity?: number | null;
  brandMaker?: string | null;
  modelSeries?: string | null;
  conditionLabel?: string | null;
  confidence?: string | null;
  valuationBasis?: string | null;
  priceSourceType?: string | null;
  imageUrl?: string | null;
  photoUrl?: string | null;
  /** Source image local URI for thumbnail preview in review screen */
  sourceImageUri?: string | null;
  /**
   * Visual centre of this item in the source photo, as returned by the Edge Function.
   * Coordinates are in 0–100 percentage space from top-left.
   */
  pin?: { x: number; y: number } | null;
  /**
   * 0-based index into the scan images array indicating which source photo this item
   * was most clearly visible in (used for multi-photo scans).
   */
  sourcePhotoIndex?: number | null;
}

export type ScanStatus =
  | "idle"
  | "picking"
  | "scanning"
  | "reviewing"
  | "saving"
  | "done"
  | "error";

export interface ScanResult {
  status: "success" | "not_configured" | "error";
  items: ScanDetectedItem[];
  errorMessage?: string;
  errorCode?: string;
  httpStatus?: number;
  responseBody?: unknown;
}
