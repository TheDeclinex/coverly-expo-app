/**
 * Supabase Storage helpers for the inventory-photos bucket.
 *
 * Architecture:
 *   - New uploads store the object *path* (e.g. "userId/cover-123.jpg") in DB columns.
 *   - Display code calls getSignedDisplayUrl / getSignedDisplayUrls to get a fresh
 *     1-hour signed URL at render time.
 *   - Legacy records may contain a full https:// signed URL from before this change;
 *     those are returned as-is.
 */

import { supabase } from "@/lib/supabase";

export const INVENTORY_PHOTOS_BUCKET = "inventory-photos";

/**
 * Expiry in seconds for signed display URLs.
 * 1 hour — short enough to rotate regularly, long enough for a browsing session.
 */
export const SIGNED_URL_EXPIRY_SECS = 3600;

/**
 * Returns true if `value` is a Supabase Storage object path rather than a full URL
 * or a local device URI.
 *
 * Storage paths are bare relative paths like "userId/cover-123.jpg".
 * Everything else is passed through as-is by the display helpers:
 *   - https:// / http://  → legacy signed URL or public URL
 *   - file:// / ph://     → iOS local device URI (freshly picked from camera/library)
 *   - content://          → Android content URI
 */
export function isStoragePath(value: string | null | undefined): value is string {
  if (!value) return false;
  if (value.startsWith("http://") || value.startsWith("https://")) return false;
  if (value.startsWith("file://") || value.startsWith("ph://") || value.startsWith("content://")) return false;
  return true;
}

/**
 * Resolve a stored value (storage path or legacy signed URL) to a display URL.
 *
 * - Storage path  → generate fresh SIGNED_URL_EXPIRY_SECS signed URL via createSignedUrl.
 * - https:// URL  → return as-is (legacy; may expire ≤ 1 year from upload time).
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
  console.log("[storage] signed URL generated for path:", pathOrUrl.slice(0, 40) + "...");
  return data.signedUrl;
}

/**
 * Batch-resolve an array of storage paths / legacy URLs to signed display URLs.
 * Uses individual createSignedUrl calls in parallel (proven API) rather than the
 * createSignedUrls batch endpoint, which can silently fail or return mismatched paths.
 *
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

  if (storagePaths.length === 0) return result;

  console.log("[storage] resolving", storagePaths.length, "storage path(s) to signed URLs");

  // Use individual createSignedUrl calls in parallel — more reliable than the batch endpoint.
  const settled = await Promise.allSettled(
    storagePaths.map(async (path) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, SIGNED_URL_EXPIRY_SECS);
      if (error || !data?.signedUrl) {
        console.warn("[storage] failed to sign path:", path, error?.message);
        return null;
      }
      return { path, signedUrl: data.signedUrl };
    }),
  );

  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value) {
      result.set(outcome.value.path, outcome.value.signedUrl);
    }
  }

  console.log("[storage] resolved", result.size - (pathsOrUrls.filter(v => v && !isStoragePath(v)).length), "storage path(s) successfully");

  return result;
}
