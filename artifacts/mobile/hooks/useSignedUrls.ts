/**
 * React Query hooks for resolving Supabase Storage paths to signed display URLs.
 *
 * These hooks cache signed URLs and re-fetch automatically 5 minutes before expiry,
 * so images keep loading without a visible reload.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedDisplayUrl,
  getSignedDisplayUrls,
  isStoragePath,
} from "@/lib/storage-helpers";

/** Re-fetch 5 min before the 1-hour signed URL expires. */
const STALE_TIME_MS = 55 * 60 * 1000;
const GC_TIME_MS    = 60 * 60 * 1000;

function signedUrlsStableKey(pathsOrUrls: (string | null | undefined)[]): string {
  const unique = [...new Set(pathsOrUrls.filter((p): p is string => !!p))];
  return unique.sort().join("\n");
}

/**
 * Resolves a single storage path or legacy signed URL to a display URL.
 * Returns undefined while loading, null on failure, or the signed URL string.
 *
 * Handles all cases:
 *   - null/undefined  → null (no query fired)
 *   - file://, ph://, content://, blob:  → pass-through (local pre-save UI only)
 *   - https://        → pass-through (legacy DB value)
 *   - storage path    → createSignedUrl from inventory-photos bucket
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
 *
 * Returns a Map<originalPathOrUrl, resolvedUrl>.
 * Re-fetches 5 min before the 1-hour expiry.
 *
 * Handles all URI types (null, local device URI, legacy https://, storage path).
 */
export function useSignedUrls(
  pathsOrUrls: (string | null | undefined)[],
): Map<string, string> {
  // Stable, de-duped, sorted key so the query identity doesn't change on re-order.
  const stableKey = useMemo(() => signedUrlsStableKey(pathsOrUrls), [pathsOrUrls]);

  const hasAny = stableKey.length > 0;

  const { data } = useQuery({
    queryKey: ["signed-urls", stableKey],
    queryFn: () => getSignedDisplayUrls(INVENTORY_PHOTOS_BUCKET, pathsOrUrls),
    enabled: hasAny,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  });

  // Log resolution results when the query settles.
  useEffect(() => {
    if (!data || data.size === 0) return;
    const requested = stableKey.split("\n").filter(Boolean);
    const sample = requested[0] ? `| sample: ${requested[0].slice(0, 50)}` : "";
    console.log(
      `[useSignedUrls] resolved ${data.size}/${requested.length} paths ${sample}`,
    );
  }, [data, stableKey]);

  return data ?? new Map<string, string>();
}

export function useSignedImageRecovery(
  pathsOrUrls: (string | null | undefined)[],
): (pathOrUrl: string | null | undefined) => void {
  const queryClient = useQueryClient();
  const stableKey = useMemo(() => signedUrlsStableKey(pathsOrUrls), [pathsOrUrls]);
  const refreshedPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    refreshedPathsRef.current.clear();
  }, [stableKey]);

  return useCallback(
    (pathOrUrl: string | null | undefined) => {
      if (!pathOrUrl) return;
      if (!isStoragePath(pathOrUrl)) return;
      const storagePath = pathOrUrl;
      if (refreshedPathsRef.current.has(storagePath)) return;
      refreshedPathsRef.current.add(storagePath);

      if (__DEV__) console.warn("[imageRecovery] signed URL refresh requested", {
        query: stableKey ? "signed-urls" : "signed-url",
        hasPath: true,
      });

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["signed-url", storagePath] }),
        stableKey
          ? queryClient.invalidateQueries({ queryKey: ["signed-urls", stableKey] })
          : Promise.resolve(),
      ]).catch((error: unknown) => {
        if (__DEV__) {
          console.warn(
            "[imageRecovery] signed URL refresh failed",
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    },
    [queryClient, stableKey],
  );
}
