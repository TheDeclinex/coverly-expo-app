export const NORMALIZED_SCAN_LIBRARY_MIME_TYPE = "image/jpeg" as const;
export const SCAN_LIBRARY_IMAGE_CONVERSION_ERROR =
  "We couldn't convert the selected photo to JPEG. Try another photo or take a new one.";

export type ScanLibrarySourceFormat =
  | "heic"
  | "heif"
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "unknown";

export interface ScanLibrarySourceAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ScanLibraryJpegConversion {
  uri: string;
  width: number | null;
  height: number | null;
  fileSize: number | null;
}

export interface NormalizedScanLibraryImage extends ScanLibraryJpegConversion {
  fileName: string;
  mimeType: typeof NORMALIZED_SCAN_LIBRARY_MIME_TYPE;
}

type ScanLibraryJpegConverter = (
  asset: ScanLibrarySourceAsset,
  index: number,
) => Promise<ScanLibraryJpegConversion>;

function extensionFrom(value?: string | null): string | null {
  if (!value) return null;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const match = withoutQuery.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? null;
}

export function scanLibrarySourceFormat(asset: ScanLibrarySourceAsset): ScanLibrarySourceFormat {
  const mimeType = asset.mimeType?.trim().toLowerCase() ?? null;
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpeg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";

  const extension = extensionFrom(asset.fileName) ?? extensionFrom(asset.uri);
  if (extension === "heic") return "heic";
  if (extension === "heif") return "heif";
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  if (extension === "png") return "png";
  if (extension === "gif") return "gif";
  if (extension === "webp") return "webp";
  return "unknown";
}

export function normalizedScanLibraryFileName(
  asset: ScanLibrarySourceAsset,
  index: number,
): string {
  const rawName = asset.fileName?.trim() ?? "";
  const sourceStem = rawName.replace(/\.[a-zA-Z0-9]+$/, "");
  const safeStem = sourceStem
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${safeStem || `scan-library-${index + 1}`}.jpg`;
}

/**
 * Sequentially converts every selected still image to a fresh JPEG file.
 * Sequential processing avoids decoding several full-resolution iPhone photos
 * in memory at the same time during a multi-photo selection.
 */
export async function normalizeScanLibrarySelection(
  assets: ScanLibrarySourceAsset[],
  convertToJpeg: ScanLibraryJpegConverter,
): Promise<NormalizedScanLibraryImage[]> {
  const normalized: NormalizedScanLibraryImage[] = [];

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (!asset.uri) continue;
    const converted = await convertToJpeg(asset, index);
    if (!converted.uri) throw new Error(SCAN_LIBRARY_IMAGE_CONVERSION_ERROR);
    normalized.push({
      ...converted,
      fileName: normalizedScanLibraryFileName(asset, index),
      mimeType: NORMALIZED_SCAN_LIBRARY_MIME_TYPE,
    });
  }

  return normalized;
}
