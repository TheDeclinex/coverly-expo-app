/**
 * Scan service for Coverly AI-assisted inventory detection.
 *
 * ARCHITECTURE RULES (do not violate):
 * - The mobile app MUST NOT call OpenAI directly. All AI processing goes through
 *   a Supabase Edge Function so API keys never leave the backend.
 * - Images are uploaded to inventory-photos (private bucket) first. Storage paths
 *   are sent to the Edge Function, which creates short-lived signed URLs server-side
 *   before passing them to OpenAI Vision.
 * - Scan results are normalised to ScanDetectedItem[] then saved via
 *   buildItemInsertPayload — the same path as Manual Add Item.
 *
 * Deployment checklist (manual steps required after code is merged):
 *   1. supabase functions deploy coverly-scan
 *   2. Set OPENAI_API_KEY in Supabase dashboard → Edge Functions → Secrets
 *   3. Confirm inventory-photos bucket policies allow:
 *        - authenticated upload (for mobile upload step)
 *        - service-role signed URL generation (for Edge Function)
 *   4. Set SCAN_EDGE_FUNCTION_NAME = "coverly-scan" below (already done)
 */

import { supabase } from "@/lib/supabase";
import type { ScanInput, ScanResult } from "@/types/scan";

/**
 * Name of the Supabase Edge Function that handles AI scan processing.
 * Set to null until the function is deployed.
 * After deploying coverly-scan, this constant activates the AI call.
 */
const SCAN_EDGE_FUNCTION_NAME: string | null = "coverly-scan";

/**
 * Supabase Storage bucket for inventory photos (private/prod-style).
 * Images are uploaded here; the Edge Function creates signed URLs server-side.
 */
const SCAN_PHOTOS_BUCKET = "inventory-photos";

/**
 * Maximum images allowed per multi-photo scan batch.
 * Single photo and single item modes always send exactly 1 image.
 */
export const MAX_MULTI_PHOTO_IMAGES = 5;

/**
 * Upload local image URIs to Supabase Storage.
 * Returns storage object paths (not public URLs) for the Edge Function.
 *
 * @param imageUris   Local device file:// URIs selected by the user
 * @param fileId      Property (inventory_files) ID — used in storage path
 * @param userId      Authenticated user ID — used in storage path
 */
export async function uploadScanImages(
  imageUris: string[],
  fileId: string,
  userId: string
): Promise<{ uploadedPaths: string[]; failedCount: number }> {
  const uploadedPaths: string[] = [];
  let failedCount = 0;

  for (let i = 0; i < imageUris.length; i++) {
    const uri = imageUris[i];
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const filename = uri.split("/").pop()?.split("?")[0] ?? "";
      const ext = filename.includes(".")
        ? (filename.split(".").pop()?.toLowerCase() ?? "jpeg")
        : "jpeg";
      const path = `${userId}/${fileId}/scan-${Date.now()}-${i}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(SCAN_PHOTOS_BUCKET)
        .upload(path, blob, { contentType: `image/${ext}`, upsert: false });

      if (uploadError) {
        console.warn("[Scan] Image upload failed:", uploadError.message, "path:", path);
        failedCount++;
      } else {
        uploadedPaths.push(uploadData.path);
      }
    } catch (err) {
      console.warn(
        "[Scan] Image upload error:",
        err instanceof Error ? err.message : String(err)
      );
      failedCount++;
    }
  }

  return { uploadedPaths, failedCount };
}

/**
 * Run an AI-assisted inventory scan via the Supabase Edge Function.
 *
 * Expects ScanInput.imagePaths to contain Supabase Storage paths (after upload).
 * The Edge Function creates signed URLs server-side and passes them to OpenAI.
 *
 * If the Edge Function is not yet configured, returns a clear not_configured result.
 */
export async function runAiScan(input: ScanInput): Promise<ScanResult> {
  if (!SCAN_EDGE_FUNCTION_NAME) {
    return {
      status: "not_configured",
      items: [],
      errorMessage:
        "AI scan endpoint not configured. Deploy the coverly-scan Edge Function and update SCAN_EDGE_FUNCTION_NAME.",
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
          roomName: input.roomName ?? null,
          imagePaths: input.imagePaths,
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

    if (data?.error) {
      return {
        status: "error",
        items: [],
        errorMessage: data.error,
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
      errorMessage: err instanceof Error ? err.message : "Unknown scan error",
    };
  }
}

/**
 * Validate a scan input before submitting.
 * Call this after upload (imagePaths must be populated).
 */
export function validateScanInput(input: ScanInput): string | null {
  if (!input.fileId) return "Property required";
  if (!input.roomId) return "Room required";

  if (input.mode === "video_room") {
    if (!input.videoUri) return "Video required for video scan";
    return null;
  }

  if (input.imagePaths.length === 0) return "At least one photo required";

  if (
    input.mode === "multi_photo_room" &&
    input.imagePaths.length > MAX_MULTI_PHOTO_IMAGES
  ) {
    return `Maximum ${MAX_MULTI_PHOTO_IMAGES} photos per multi-photo scan`;
  }

  return null;
}
