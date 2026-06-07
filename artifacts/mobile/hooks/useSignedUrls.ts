/**
 * React Query hooks for resolving Supabase Storage paths to signed display URLs.
 *
 * These hooks cache signed URLs and re-fetch automatically 5 minutes before expiry,
 * so images keep loading without a visible reload.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedDisplayUrl,
  getSignedDisplayUrls,
} from "@/lib/storage-helpers";

/** Re-fetch 5 min before the 1-hour signed URL expires. */
const STALE_TIME_MS = 55 * 60 * 1000;
const GC_TIME_MS    = 60 * 60 * 1000;

/**
 * Resolves a single storage path or legacy signed URL to a display URL.
 * Returns undefined while loading, null on failure, or the signed URL string.
 */
export function useSignedUrl(
  pathOrUrl: string | null | undefined,
): string | null | undefined {
  const { data } = useQuery({
    queryKey: ["signed-url", pathOrUrl ?? ""],
    queryFn: () => getSignedDisplayUrl(INVENTORY_PHOTOS_BUCKET, pathOrUrl),
    enabled: !!pathOrUrl,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  });
  return pathOrUrl ? (data ?? undefined) : null;
}

/**
 * Batch-resolves an array of storage paths / legacy URLs to signed display URLs.
 * Uses createSignedUrls() — one round-trip for all paths regardless of array length.
 *
 * Returns a Map<originalPathOrUrl, signedUrl>.
 * Re-fetches 5 min before the 1-hour expiry.
 */
export function useSignedUrls(
  pathsOrUrls: (string | null | undefined)[],
): Map<string, string> {
  // Stable, de-duped, sorted key so the query identity doesn't change on re-order
  const stableKey = useMemo(() => {
    const unique = [...new Set(pathsOrUrls.filter((p): p is string => !!p))];
    return unique.sort().join("\n");
  }, [pathsOrUrls]);

  const hasAny = stableKey.length > 0;

  const { data } = useQuery({
    queryKey: ["signed-urls", stableKey],
    queryFn: () => getSignedDisplayUrls(INVENTORY_PHOTOS_BUCKET, pathsOrUrls),
    enabled: hasAny,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  });

  return data ?? new Map<string, string>();
}
