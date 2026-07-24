/**
 * React Query hooks for resolving Supabase Storage paths to signed display URLs.
 *
 * These hooks cache signed URLs and re-fetch automatically 5 minutes before expiry,
 * so images keep loading without a visible reload.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import {
  resolvedPrivateImageSource,
  signedImageQueryKey,
  type CoverlyImageSource,
} from "@/lib/image-cache-model";
import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedDisplayUrl,
  isStoragePath,
} from "@/lib/storage-helpers";

/** Re-fetch 5 min before the 1-hour signed URL expires. */
const STALE_TIME_MS = 55 * 60 * 1000;
const GC_TIME_MS    = 60 * 60 * 1000;

function signedUrlsStableKey(pathsOrUrls: (string | null | undefined)[]): string {
  const unique = [...new Set(pathsOrUrls.filter((p): p is string => !!p))];
  return JSON.stringify(unique.sort());
}

async function resolveSignedImageSource(
  accountId: string,
  bucket: string,
  pathOrUrl: string,
): Promise<CoverlyImageSource | null> {
  const uri = await getSignedDisplayUrl(bucket, pathOrUrl);
  if (!uri) return null;
  return isStoragePath(pathOrUrl)
    ? resolvedPrivateImageSource({ accountId, bucket, pathOrUrl, uri })
    : { uri };
}

function signedImageQueryOptions(
  accountId: string,
  bucket: string,
  pathOrUrl: string,
) {
  return {
    queryKey: signedImageQueryKey(accountId, bucket, pathOrUrl),
    queryFn: () => resolveSignedImageSource(accountId, bucket, pathOrUrl),
    enabled: Boolean(accountId && pathOrUrl),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  };
}

export async function fetchSignedImageSource(
  queryClient: QueryClient,
  accountId: string,
  bucket: string,
  pathOrUrl: string,
): Promise<CoverlyImageSource | null> {
  return queryClient.fetchQuery(
    signedImageQueryOptions(accountId, bucket, pathOrUrl),
  );
}

export function useSignedImageSource(
  pathOrUrl: string | null | undefined,
  bucket = INVENTORY_PHOTOS_BUCKET,
): CoverlyImageSource | null | undefined {
  const { session } = useAuth();
  const accountId = session?.user.id ?? "";
  const { data } = useQuery(
    signedImageQueryOptions(accountId, bucket, pathOrUrl ?? ""),
  );
  return pathOrUrl ? (data ?? undefined) : null;
}

export function useSignedImageSources(
  pathsOrUrls: (string | null | undefined)[],
  bucket = INVENTORY_PHOTOS_BUCKET,
): Map<string, CoverlyImageSource> {
  const { session } = useAuth();
  const accountId = session?.user.id ?? "";
  const stableKey = useMemo(
    () => signedUrlsStableKey(pathsOrUrls),
    [pathsOrUrls],
  );
  const distinctPaths = useMemo(
    () => JSON.parse(stableKey) as string[],
    [stableKey],
  );
  const queries = useQueries({
    queries: distinctPaths.map((pathOrUrl) =>
      signedImageQueryOptions(accountId, bucket, pathOrUrl),
    ),
  });

  return useMemo(() => {
    const resolved = new Map<string, CoverlyImageSource>();
    distinctPaths.forEach((path, index) => {
      const source = queries[index]?.data;
      if (source) resolved.set(path, source);
    });
    return resolved;
  }, [distinctPaths, queries]);
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
  const source = useSignedImageSource(pathOrUrl);
  return pathOrUrl ? source?.uri : null;
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
  const sources = useSignedImageSources(pathsOrUrls);
  return useMemo(
    () =>
      new Map(
        [...sources.entries()].map(([path, source]) => [path, source.uri]),
      ),
    [sources],
  );
}

export function useSignedImageRecovery(
  pathsOrUrls: (string | null | undefined)[],
  bucket = INVENTORY_PHOTOS_BUCKET,
): (pathOrUrl: string | null | undefined) => void {
  const { session } = useAuth();
  const accountId = session?.user.id ?? "";
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

      void queryClient
        .invalidateQueries({
          queryKey: signedImageQueryKey(accountId, bucket, storagePath),
        })
        .catch((error: unknown) => {
        if (__DEV__) {
          console.warn(
            "[imageRecovery] signed URL refresh failed",
            error instanceof Error ? error.message : String(error),
          );
        }
        });
    },
    [accountId, bucket, queryClient, stableKey],
  );
}
