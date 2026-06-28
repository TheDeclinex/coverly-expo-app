/**
 * Supabase Storage helpers for the inventory-photos bucket.
 *
 * Architecture:
 *   - New uploads store the object *path* (e.g. "userId/scan-xxx.jpg") in DB columns.
 *   - Display code calls getSignedDisplayUrl / getSignedDisplayUrls to get a fresh
 *     1-hour signed URL at render time.
 *   - Legacy records may contain a full https:// signed URL from before this change;
 *     those are returned as-is (logged as legacy).
 *   - Local device URIs (file://, ph://, content://, blob:) must NEVER be stored in
 *     the DB. They are valid only in pre-save scan/edit UI flows.
 */

import { supabase } from "@/lib/supabase";

export const INVENTORY_PHOTOS_BUCKET = "inventory-photos";
export const CLAIM_EVIDENCE_BUCKET = "claim-evidence";

/**
 * Expiry in seconds for signed display URLs.
 * 1 hour — short enough to rotate regularly, long enough for a browsing session.
 */
export const SIGNED_URL_EXPIRY_SECS = 3600;

/**
 * Returns true if `value` is a Supabase Storage object path (bare relative path).
 *
 * Excluded (not storage paths):
 *   - https:// / http://     → legacy signed URL or public URL
 *   - file:// / ph://        → iOS local device URI (freshly picked from camera/library)
 *   - content://             → Android content URI
 *   - blob:                  → browser/JS blob URI
 */
export function isStoragePath(value: string | null | undefined): boolean {
  if (!value) return false;
  if (value.startsWith("http://") || value.startsWith("https://")) return false;
  if (
    value.startsWith("file://") ||
    value.startsWith("ph://") ||
    value.startsWith("content://") ||
    value.startsWith("blob:")
  )
    return false;
  return true;
}

/**
 * Returns true if `value` is a URI that can be passed directly to expo-image.
 * Raw Supabase storage paths (e.g. "userId/scan-xxx.jpg") are NOT displayable.
 */
export function isDisplayableUri(value: string | null | undefined): boolean {
  if (!value) return false;
  return (
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("file://") ||
    value.startsWith("ph://") ||
    value.startsWith("content://") ||
    value.startsWith("blob:")
  );
}

/**
 * Resolve a stored value (storage path or legacy signed URL) to a display URL.
 * Logs each case for diagnostics. In DEV, verifies the signed URL actually loads.
 *
 * - Storage path  → generate fresh signed URL via createSignedUrl.
 * - https:// URL  → return as-is (legacy; may expire ≤ 1 year from upload time).
 * - Local URI     → return as-is (valid only in pre-save UI flows; not from DB).
 * - null/empty    → return null.
 */
export async function getSignedDisplayUrl(
  bucket: string,
  pathOrUrl: string | null | undefined,
): Promise<string | null> {
  if (!pathOrUrl) return null;

  // Legacy full URL or local device URI — pass through.
  if (!isStoragePath(pathOrUrl)) {
    if (pathOrUrl.startsWith("http")) {
      if (__DEV__) console.log("[storage] legacy URL (pass-through):", pathOrUrl.slice(0, 70));
    } else {
      if (__DEV__) console.log("[storage] local device URI (pass-through):", pathOrUrl.slice(0, 50));
    }
    return pathOrUrl;
  }

  // Storage path — generate signed URL.
  if (__DEV__) console.log("[storage] creating signed URL for path:", pathOrUrl.slice(0, 70));
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(pathOrUrl, SIGNED_URL_EXPIRY_SECS);

  if (error || !data?.signedUrl) {
    if (__DEV__) console.warn("[storage] createSignedUrl FAILED | path:", pathOrUrl, "| error:", error?.message);
    return null;
  }

  if (__DEV__) console.log("[storage] signed URL OK | path:", pathOrUrl.slice(0, 60));

  // DEV-only: HEAD-fetch the signed URL to verify the object actually exists in storage.
  if (__DEV__) {
    fetch(data.signedUrl, { method: "HEAD" })
      .then((r) => {
        if (r.ok) {
          if (__DEV__) console.log(`[storage] HEAD verify ✓ ${r.status} | path: ${pathOrUrl.slice(0, 50)}`);
        } else {
          if (__DEV__) console.warn(
            `[storage] HEAD verify ✗ ${r.status} — object may not exist | path: ${pathOrUrl.slice(0, 50)}`,
          );
        }
      })
      .catch((e: unknown) => {
        console.warn("[storage] HEAD check error:", e instanceof Error ? e.message : String(e));
      });
  }

  return data.signedUrl;
}

/**
 * Batch-resolve an array of storage paths / legacy URLs to signed display URLs.
 * Delegates to getSignedDisplayUrl for each entry so logging is consistent.
 *
 * Returns a Map<originalValue, resolvedUrl> for successful entries only.
 */
export async function getSignedDisplayUrls(
  bucket: string,
  pathsOrUrls: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const distinct = [
    ...new Set(pathsOrUrls.filter((p): p is string => !!p)),
  ];

  if (distinct.length === 0) return result;

  const settled = await Promise.allSettled(
    distinct.map(async (path) => {
      const url = await getSignedDisplayUrl(bucket, path);
      return url ? { path, url } : null;
    }),
  );

  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value) {
      result.set(outcome.value.path, outcome.value.url);
    }
  }

  return result;
}
