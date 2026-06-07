/**
 * Shared photo upload helper for scan-created inventory items.
 *
 * Uploads local device images to the `inventory-photos` Supabase storage bucket
 * and returns a public URL. Includes an in-memory dedupe cache so save-all
 * workflows upload each unique source image only once per session.
 *
 * NOTE: All photo uploads (scan, add-item, edit-item, cover photos) use the
 * `inventory-photos` bucket. Do not use a separate bucket.
 */

import { supabase } from "@/lib/supabase";

const SCAN_PHOTOS_BUCKET = "inventory-photos";

/** Per-session upload cache: localUri → public URL */
const uploadCache = new Map<string, string>();

/**
 * Upload a local image URI to `inventory-photos` and return its public URL.
 *
 * @param localUri   - Local device URI (file:// or content://) from ImagePicker.
 * @param userId     - Supabase user ID used as the storage path prefix.
 * @param dedupeKey  - Optional key for de-duplication (default: localUri).
 *                     Pass the same key for multiple items sharing the same source photo.
 * @returns The public HTTPS URL of the uploaded file, or null on failure.
 */
export async function uploadScanPhoto(
  localUri: string,
  userId: string,
  dedupeKey?: string
): Promise<string | null> {
  const cacheKey = dedupeKey ?? localUri;

  // Return cached result if this image was already uploaded in this session
  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(localUri);
    if (!response.ok) {
      console.warn("[photoUpload] fetch failed for:", localUri, response.status);
      return null;
    }
    const blob = await response.blob();

    // Derive extension from MIME type; fallback to jpg
    const mime = blob.type || "image/jpeg";
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";

    // Path: {userId}/scan-{timestamp}-{random}.{ext}
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const path = `${userId}/scan-${timestamp}-${rand}.${ext}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(SCAN_PHOTOS_BUCKET)
      .upload(path, blob, { contentType: mime, upsert: false });

    if (uploadError) {
      console.warn("[photoUpload] upload error:", uploadError.message, "path:", path);
      return null;
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(SCAN_PHOTOS_BUCKET)
      .createSignedUrl(uploadData.path, 31536000);

    if (signedError || !signedData?.signedUrl) {
      console.warn("[photoUpload] signed URL error:", signedError?.message);
      return null;
    }
    const signedUrl = signedData.signedUrl;
    uploadCache.set(cacheKey, signedUrl);
    return signedUrl;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[photoUpload] unexpected error:", msg);
    return null;
  }
}

/**
 * Clear the upload cache. Call this when the scan session resets so the next
 * scan session doesn't reuse stale URLs from a previous session.
 */
export function clearScanPhotoUploadCache(): void {
  uploadCache.clear();
}

/**
 * Upload a local image URI as a cover photo for a property or room.
 * Stores in the same `inventory-photos` bucket as scan photos but uses
 * a `cover-` path prefix to distinguish them.
 *
 * @param localUri  - Local device URI from ImagePicker (file:// or content://)
 * @param userId    - Supabase user ID used as the storage path prefix.
 * @returns The public HTTPS URL of the uploaded file, or null on failure.
 */
export async function uploadCoverPhoto(
  localUri: string,
  userId: string
): Promise<string | null> {
  try {
    const response = await fetch(localUri);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mime = blob.type || "image/jpeg";
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const path = `${userId}/cover-${timestamp}-${rand}.${ext}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(SCAN_PHOTOS_BUCKET)
      .upload(path, blob, { contentType: mime, upsert: false });
    if (uploadError) {
      console.warn("[photoUpload] cover upload error:", uploadError.message);
      return null;
    }
    const { data: signedData, error: signedError } = await supabase.storage
      .from(SCAN_PHOTOS_BUCKET)
      .createSignedUrl(uploadData.path, 31536000);
    if (signedError || !signedData?.signedUrl) {
      console.warn("[photoUpload] cover signed URL error:", signedError?.message);
      return null;
    }
    return signedData.signedUrl;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[photoUpload] cover upload unexpected error:", msg);
    return null;
  }
}
