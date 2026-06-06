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
  roomName?: string;
  /**
   * Supabase Storage object paths after upload to inventory-photos bucket.
   * These are NOT local device file:// URIs — upload first, then pass paths.
   */
  imagePaths: string[];
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
  /** Supabase storage path for the item's photo (set for single_item scans) */
  imageUrl?: string | null;
  photoUrl?: string | null;
  /** Source image local URI for thumbnail preview in review screen */
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
