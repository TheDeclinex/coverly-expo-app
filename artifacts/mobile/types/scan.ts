/**
 * Scan types for Coverly AI-assisted inventory scanning.
 * All scan results flow through ScanDetectedItem → buildItemInsertPayload before saving.
 */

export type ScanMode =
  | "single_photo_room"   // 1 photo → detect all visible room items (1 credit)
  | "multi_photo_room"    // up to 5 photos → exhaustive detect + merge (3 credits/batch)
  | "video_room"          // video → frame extraction + dedup (coming soon)
  | "single_item";        // close-up → 1 item with rich brand/model/value detail (1 credit)

export interface ScanInput {
  mode: ScanMode;
  fileId: string;
  roomId: string;
  /** Local URIs for images selected by the user */
  imageUris: string[];
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
  category?: string | null;
  estimatedPrice?: number | null;
  quantity?: number | null;
  brandMaker?: string | null;
  modelSeries?: string | null;
  conditionLabel?: string | null;
  confidence?: string | null;
  valuationBasis?: string | null;
  /** Supabase storage URL after upload, or null */
  imageUrl?: string | null;
  /** Source image URI (local, used for preview before upload) */
  sourceImageUri?: string | null;
}

export type ScanStatus =
  | "idle"
  | "picking"
  | "uploading"
  | "scanning"
  | "reviewing"
  | "saving"
  | "done"
  | "error";

export interface ScanResult {
  status: "success" | "not_configured" | "error";
  items: ScanDetectedItem[];
  errorMessage?: string;
}
