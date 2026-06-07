/**
 * Shared photo upload helper for all inventory photos.
 *
 * All photo uploads (scan items, add-item, edit-item, cover photos) use the
 * `inventory-photos` bucket. The bucket is PRIVATE — display code must use
 * getSignedDisplayUrl / getSignedDisplayUrls from storage-helpers.ts.
 *
 * Architecture:
 *   - Callers receive { path, displayUrl }.
 *   - `path` is the durable Supabase Storage object path — store this in the DB.
 *   - `displayUrl` is a 1-hour signed URL for immediate UI feedback only.
 *     Do NOT persist displayUrl to the database.
 */

import {
  INVENTORY_PHOTOS_BUCKET,
  SIGNED_URL_EXPIRY_SECS,
} from "@/lib/storage-helpers";
import { supabase } from "@/lib/supabase";

export interface UploadResult {
  /** Durable Supabase Storage object path. Store this in the database. */
  path: string;
  /**
   * Signed display URL valid for SIGNED_URL_EXPIRY_SECS seconds.
   * Use for immediate optimistic UI only — do NOT persist to the database.
   */
  displayUrl: string | null;
}

/** Per-session upload cache: localUri → UploadResult */
const uploadCache = new Map<string, UploadResult>();

/**
 * Upload a local image URI to `inventory-photos` and return its storage path
 * plus a short-lived signed URL for immediate display.
 *
 * @param localUri   - Local device URI (file:// or content://) from ImagePicker.
 * @param userId     - Supabase user ID used as the storage path prefix.
 * @param dedupeKey  - Optional key for de-duplication (default: localUri).
 *                     Pass the same key for multiple items sharing one source photo.
 * @returns UploadResult or null on failure.
 */
export async function uploadScanPhoto(
  localUri: string,
  userId: string,
  dedupeKey?: string,
): Promise<UploadResult | null> {
  const cacheKey = dedupeKey ?? localUri;

  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(localUri);
    if (!response.ok) {
      console.warn("[photoUpload] fetch failed:", localUri, response.status);
      return null;
    }
    const blob = await response.blob();
    const mime = blob.type || "image/jpeg";
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const path = `${userId}/scan-${timestamp}-${rand}.${ext}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(INVENTORY_PHOTOS_BUCKET)
      .upload(path, blob, { contentType: mime, upsert: false });

    if (uploadError) {
      console.warn("[photoUpload] upload error:", uploadError.message, "path:", path);
      return null;
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(INVENTORY_PHOTOS_BUCKET)
      .createSignedUrl(uploadData.path, SIGNED_URL_EXPIRY_SECS);

    if (signedError) {
      console.warn("[photoUpload] signed URL error:", signedError.message);
    }

    const result: UploadResult = {
      path: uploadData.path,
      displayUrl: signedData?.signedUrl ?? null,
    };
    uploadCache.set(cacheKey, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[photoUpload] unexpected error:", msg);
    return null;
  }
}

/**
 * Clear the upload cache. Call this when the scan session resets.
 */
export function clearScanPhotoUploadCache(): void {
  uploadCache.clear();
}

/**
 * Upload a local image URI as a cover photo for a property or room.
 *
 * @param localUri  - Local device URI from ImagePicker (file:// or content://)
 * @param userId    - Supabase user ID used as the storage path prefix.
 * @returns UploadResult or null on failure.
 */
export async function uploadCoverPhoto(
  localUri: string,
  userId: string,
): Promise<UploadResult | null> {
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
      .from(INVENTORY_PHOTOS_BUCKET)
      .upload(path, blob, { contentType: mime, upsert: false });

    if (uploadError) {
      console.warn("[photoUpload] cover upload error:", uploadError.message);
      return null;
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(INVENTORY_PHOTOS_BUCKET)
      .createSignedUrl(uploadData.path, SIGNED_URL_EXPIRY_SECS);

    if (signedError) {
      console.warn("[photoUpload] cover signed URL error:", signedError.message);
    }

    return {
      path: uploadData.path,
      displayUrl: signedData?.signedUrl ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[photoUpload] cover unexpected error:", msg);
    return null;
  }
}
