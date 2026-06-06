/**
 * Scan service for Coverly AI-assisted inventory detection.
 *
 * ARCHITECTURE RULES (do not violate):
 * - The mobile app MUST NOT call OpenAI directly. All AI processing goes through
 *   the scan-room-photo Supabase Edge Function so API keys never leave the backend.
 * - Images are base64-encoded at pick time (ImagePicker base64:true option).
 *   The encoded data is sent directly in the Edge Function request body.
 *   No storage upload is required for AI scanning.
 * - Scan results are normalised to ScanDetectedItem[] then saved via
 *   buildItemInsertPayload — the same path as Manual Add Item.
 *
 * Deployment checklist (manual steps required):
 *   1. supabase functions deploy scan-room-photo --no-verify-jwt
 *   2. Set OPENAI_API_KEY in Supabase dashboard → Edge Functions → Secrets
 *   3. After deployment, SCAN_EDGE_FUNCTION_NAME below is already set correctly.
 */

import { supabase } from "@/lib/supabase";
import type { ScanDetectedItem, ScanInput, ScanResult } from "@/types/scan";

/**
 * Name of the Supabase Edge Function that handles AI scan processing.
 * Set to null to show the "not configured" state without throwing.
 */
const SCAN_EDGE_FUNCTION_NAME: string | null = "scan-room-photo";

/**
 * Maximum images allowed per multi-photo scan batch.
 */
export const MAX_MULTI_PHOTO_IMAGES = 5;

/**
 * Map mobile ScanMode values to the production scan-room-photo mode strings.
 * single_item has no dedicated production mode — single_photo detects what is visible.
 */
function toProductionMode(
  mode: ScanInput["mode"]
): "single_photo" | "multi_photo" | "video_frames" {
  switch (mode) {
    case "single_photo_room":
    case "single_item":
      return "single_photo";
    case "multi_photo_room":
      return "multi_photo";
    case "video_room":
      return "video_frames";
  }
}

/**
 * Convert a production confidence float (0.0–1.0) to a display string.
 */
function confidenceToLabel(n: number): string {
  if (n >= 0.75) return "high";
  if (n >= 0.45) return "medium";
  return "low";
}

/**
 * Run an AI-assisted inventory scan via the scan-room-photo Edge Function.
 *
 * ScanInput.images must be pre-encoded (base64 from ImagePicker base64:true option).
 * The function maps the mobile payload to the production contract, handles
 * success/error envelopes, and normalises returned items to ScanDetectedItem[].
 */
export async function runAiScan(input: ScanInput): Promise<ScanResult> {
  if (!SCAN_EDGE_FUNCTION_NAME) {
    return {
      status: "not_configured",
      items: [],
      errorMessage:
        "AI scan endpoint not configured. Deploy the scan-room-photo Edge Function and update SCAN_EDGE_FUNCTION_NAME.",
    };
  }

  if (input.images.length === 0) {
    return {
      status: "error",
      items: [],
      errorMessage: "No images to scan.",
    };
  }

  try {
    const productionPayload = {
      mode: toProductionMode(input.mode),
      images: input.images.map((img, i) => ({
        id: `photo_${i + 1}`,
        imageBase64: img.base64,
        mimeType: img.mimeType,
        sourceName: `photo_${i + 1}`,
      })),
      context: {
        fileId: input.fileId,
        roomName: input.roomName ?? undefined,
      },
    };

    const { data, error } = await supabase.functions.invoke(
      SCAN_EDGE_FUNCTION_NAME,
      { body: productionPayload }
    );

    if (error) {
      return {
        status: "error",
        items: [],
        errorMessage: error.message,
      };
    }

    // Production function returns { success: bool, items?, errorCode?, message? }
    if (data?.success === false) {
      return {
        status: "error",
        items: [],
        errorMessage: data.message ?? data.errorCode ?? "Scan failed",
      };
    }

    const rawItems: unknown[] = Array.isArray(data?.items) ? data.items : [];

    // TODO: map sourcePhotoIndex from rawItems when multi-photo per-item thumbnail routing is needed.
    // TODO: production inventory_items has image_pin jsonb. Map pin {x,y} here when the Edge Function
    //       returns coordinates and the review screen supports it. Currently image_pin is not saved
    //       unless the response includes a valid pin object.
    const items: ScanDetectedItem[] = rawItems
      .filter(
        (r): r is Record<string, unknown> =>
          typeof r === "object" && r !== null && typeof (r as Record<string, unknown>).name === "string"
      )
      .map((raw) => ({
        name: (raw.name as string).trim(),
        description:
          typeof raw.description === "string" ? raw.description.trim() || null : null,
        category:
          typeof raw.category === "string" ? raw.category : null,
        quantity:
          typeof raw.quantity === "number" && raw.quantity >= 1
            ? Math.round(raw.quantity)
            : 1,
        estimatedPrice:
          typeof raw.estimatedPrice === "number" ? raw.estimatedPrice : null,
        unitEstimatedPrice:
          typeof raw.unitEstimatedPrice === "number" ? raw.unitEstimatedPrice : null,
        brandMaker:
          typeof raw.brand_guess === "string" ? raw.brand_guess : null,
        modelSeries: null,
        conditionLabel: null,
        confidence:
          typeof raw.confidence === "number"
            ? confidenceToLabel(raw.confidence)
            : null,
        valuationBasis: "ai_estimate",
        priceSourceType: "ai_scan",
        imageUrl: null,
        photoUrl: null,
        sourceImageUri: null,
      }));

    return { status: "success", items };
  } catch (err) {
    return {
      status: "error",
      items: [],
      errorMessage: err instanceof Error ? err.message : "Unknown scan error",
    };
  }
}

/**
 * Validate a scan input before submitting.
 */
export function validateScanInput(input: ScanInput): string | null {
  if (!input.fileId) return "Property required";
  if (!input.roomId) return "Room required";

  if (input.mode === "video_room") {
    if (!input.videoUri) return "Video required for video scan";
    return null;
  }

  if (input.images.length === 0) return "At least one photo required";

  if (
    input.mode === "multi_photo_room" &&
    input.images.length > MAX_MULTI_PHOTO_IMAGES
  ) {
    return `Maximum ${MAX_MULTI_PHOTO_IMAGES} photos per multi-photo scan`;
  }

  return null;
}
