/**
 * Scan service scaffold for Coverly AI-assisted inventory detection.
 *
 * ARCHITECTURE RULES (do not violate):
 * - The mobile app MUST NOT call OpenAI directly. All AI processing goes through
 *   a Supabase Edge Function so API keys never leave the backend.
 * - Scan results are normalised to ScanDetectedItem[] then saved via
 *   buildItemInsertPayload — the same path as Manual Add Item.
 *
 * TODO: When the Supabase Edge Function is ready, set SCAN_EDGE_FUNCTION_NAME
 * and the runAiScan call will activate automatically.
 */

import { supabase } from "@/lib/supabase";
import type { ScanInput, ScanResult } from "@/types/scan";

/**
 * Name of the Supabase Edge Function that handles AI scan processing.
 * Set to null until the function is deployed.
 * TODO: Replace with your deployed Edge Function name, e.g. "coverly-scan"
 */
const SCAN_EDGE_FUNCTION_NAME: string | null = null;

/**
 * Maximum images allowed per multi-photo scan batch.
 * Single photo and single item modes always send exactly 1 image.
 */
export const MAX_MULTI_PHOTO_IMAGES = 5;

/**
 * Run an AI-assisted inventory scan.
 *
 * If the Edge Function is not yet configured, returns a clear not_configured result.
 * This allows the UI to handle the state gracefully without throwing.
 *
 * Scan mode guidance (encode in Edge Function prompt):
 *   single_photo_room  → detect ALL visible items in one room photo
 *   multi_photo_room   → detect exhaustively per photo, merge only clearly same object
 *   video_room         → extract representative frames, avoid duplicate items (future)
 *   single_item        → focus on one item, enrich brand/model/condition/value fields
 */
export async function runAiScan(input: ScanInput): Promise<ScanResult> {
  if (!SCAN_EDGE_FUNCTION_NAME) {
    return {
      status: "not_configured",
      items: [],
      errorMessage:
        "AI scan endpoint not configured yet. Deploy a Supabase Edge Function and set SCAN_EDGE_FUNCTION_NAME in lib/scan-service.ts.",
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke(
      SCAN_EDGE_FUNCTION_NAME,
      {
        body: {
          mode: input.mode,
          fileId: input.fileId,
          roomId: input.roomId,
          imageUris: input.imageUris,
          videoUri: input.videoUri ?? null,
        },
      }
    );

    if (error) {
      return {
        status: "error",
        items: [],
        errorMessage: error.message,
      };
    }

    return {
      status: "success",
      items: data?.items ?? [],
    };
  } catch (err) {
    return {
      status: "error",
      items: [],
      errorMessage:
        err instanceof Error ? err.message : "Unknown scan error",
    };
  }
}

/**
 * Validate the number of images for the given scan mode.
 * Returns an error string or null if valid.
 */
export function validateScanInput(input: ScanInput): string | null {
  if (!input.fileId) return "Property required";
  if (!input.roomId) return "Room required";

  if (input.mode === "video_room") {
    if (!input.videoUri) return "Video required for video scan";
    return null;
  }

  if (input.imageUris.length === 0) return "At least one photo required";

  if (
    input.mode === "multi_photo_room" &&
    input.imageUris.length > MAX_MULTI_PHOTO_IMAGES
  ) {
    return `Maximum ${MAX_MULTI_PHOTO_IMAGES} photos per multi-photo scan`;
  }

  if (
    (input.mode === "single_photo_room" || input.mode === "single_item") &&
    input.imageUris.length > 1
  ) {
    return "Single scan mode accepts exactly 1 photo";
  }

  return null;
}
