/**
 * Supabase Storage helpers for the inventory-photos bucket.
 *
 * Architecture:
 *   - New uploads store the object *path* (e.g. "userId/cover-123.jpg") in DB columns.
 *   - Display code calls getSignedDisplayUrl / getSignedDisplayUrls to get a fresh
 *     1-hour signed URL at render time.
 *   - Legacy records may contain a full https:// signed URL from before this change;
 *     those are returned as-is (they expire after 1 year from the time they were stored).
 *
 * TODO (DB migration): Add dedicated storage-path columns once service-role access is
 *   available:
 *     ALTER TABLE inventory_items      ADD COLUMN IF NOT EXISTS image_storage_path text;
 *     ALTER TABLE inventory_rooms      ADD COLUMN IF NOT EXISTS cover_photo_storage_path text;
 *     ALTER TABLE inventory_files      ADD COLUMN IF NOT EXISTS property_cover_storage_path text;
 *   Until then, paths are stored in the existing *_url columns (text fields, so valid).
 */

import { supabase } from "@/lib/supabase";

export const INVENTORY_PHOTOS_BUCKET = "inventory-photos";

/**
 * Expiry in seconds for signed display URLs.
 * 1 hour — short enough to rotate regularly, long enough for a browsing session.
 */
export const SIGNED_URL_EXPIRY_SECS = 3600;

/**
 * Returns true if `value` is a Supabase Storage object path rather than a full URL.
 * New uploads store bare paths; legacy records stored https:// signed URLs.
 */
export function isStoragePath(value: string | null | undefined): value is string {
  if (!value) return false;
  return !value.startsWith("http://") && !value.startsWith("https://");
}

/**
 * Resolve a stored value (storage path or legacy signed URL) to a display URL.
 *
 * - Storage path  → generate fresh SIGNED_URL_EXPIRY_SECS signed URL.
 * - https:// URL  → return as-is (legacy; may expire in ≤ 1 year from upload time).
 * - null/empty    → return null.
 */
export async function getSignedDisplayUrl(
  bucket: string,
  pathOrUrl: string | null | undefined,
): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (!isStoragePath(pathOrUrl)) return pathOrUrl; // legacy full URL — pass through

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(pathOrUrl, SIGNED_URL_EXPIRY_SECS);

  if (error || !data?.signedUrl) {
    console.warn("[storage] createSignedUrl failed:", error?.message, "path:", pathOrUrl);
    return null;
  }
  return data.signedUrl;
}

/**
 * Batch-resolve an array of storage paths / legacy URLs to signed display URLs.
 * Uses createSignedUrls() for storage paths (single round-trip regardless of count).
 * Returns a Map<originalValue, signedUrl> for successful entries only.
 */
export async function getSignedDisplayUrls(
  bucket: string,
  pathsOrUrls: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const storagePaths: string[] = [];

  for (const v of pathsOrUrls) {
    if (!v) continue;
    if (isStoragePath(v)) {
      storagePaths.push(v);
    } else {
      // Legacy full URL — pass through as-is
      result.set(v, v);
    }
  }

  if (storagePaths.length > 0) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(storagePaths, SIGNED_URL_EXPIRY_SECS);

    if (error) {
      console.warn("[storage] createSignedUrls batch failed:", error.message);
    } else {
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) {
          result.set(entry.path, entry.signedUrl);
        }
      }
    }
  }

  return result;
}
