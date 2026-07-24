export const PRIVATE_IMAGE_CACHE_VERSION = "v1";
export const SIGNED_IMAGE_QUERY_PREFIX = "signed-image";

export type CoverlyImageRepresentation = "original";

export interface CoverlyImageSource {
  uri: string;
  cacheKey?: string;
}

export type CoverlyImageInput = string | CoverlyImageSource;

export type ImageCacheBoundaryAction =
  | "keep"
  | "clear-and-set"
  | "clear-and-remove";

export function isDurableStoragePath(
  value: string | null | undefined,
): value is string {
  if (!value) return false;
  return !(
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("file://") ||
    value.startsWith("ph://") ||
    value.startsWith("content://") ||
    value.startsWith("blob:")
  );
}

export function privateImageCacheKey(input: {
  accountId: string;
  bucket: string;
  pathOrUrl: string;
  representation?: CoverlyImageRepresentation;
}): string {
  return JSON.stringify([
    "coverly-image",
    PRIVATE_IMAGE_CACHE_VERSION,
    input.accountId,
    input.bucket,
    input.pathOrUrl,
    input.representation ?? "original",
  ]);
}

export function resolvedPrivateImageSource(input: {
  accountId: string;
  bucket: string;
  pathOrUrl: string;
  uri: string;
  representation?: CoverlyImageRepresentation;
}): CoverlyImageSource {
  return {
    uri: input.uri,
    cacheKey: privateImageCacheKey(input),
  };
}

export function normalizeCoverlyImageSource(
  input: CoverlyImageInput,
): CoverlyImageSource {
  return typeof input === "string" ? { uri: input } : input;
}

export function signedImageQueryKey(
  accountId: string,
  bucket: string,
  pathOrUrl: string,
): readonly string[] {
  return [
    SIGNED_IMAGE_QUERY_PREFIX,
    PRIVATE_IMAGE_CACHE_VERSION,
    accountId,
    bucket,
    pathOrUrl,
  ] as const;
}

export function isSignedImageQueryKey(
  queryKey: readonly unknown[],
): boolean {
  return queryKey[0] === SIGNED_IMAGE_QUERY_PREFIX;
}

export function imageCacheBoundaryAction(
  previousAccountId: string | null,
  nextAccountId: string | null,
): ImageCacheBoundaryAction {
  if (previousAccountId === nextAccountId) return "keep";
  return nextAccountId ? "clear-and-set" : "clear-and-remove";
}
