import assert from "node:assert/strict";
import test from "node:test";

import {
  NORMALIZED_SCAN_LIBRARY_MIME_TYPE,
  normalizeScanLibrarySelection,
  normalizedScanLibraryFileName,
  scanLibrarySourceFormat,
  type ScanLibrarySourceAsset,
} from "../scan-image-normalization.ts";

const cases: Array<{
  name: string;
  asset: ScanLibrarySourceAsset;
  sourceFormat: ReturnType<typeof scanLibrarySourceFormat>;
}> = [
  {
    name: "image/heic selected asset",
    asset: { uri: "file:///photos/IMG_1001", fileName: "IMG_1001", mimeType: "image/heic" },
    sourceFormat: "heic",
  },
  {
    name: "image/heif selected asset",
    asset: { uri: "file:///photos/IMG_1002", fileName: "IMG_1002", mimeType: "image/heif" },
    sourceFormat: "heif",
  },
  {
    name: "uppercase HEIC extension",
    asset: { uri: "file:///photos/IMG_1003.HEIC", fileName: "IMG_1003.HEIC" },
    sourceFormat: "heic",
  },
  {
    name: "asset without filename or extension",
    asset: { uri: "ph://A1B2C3D4" },
    sourceFormat: "unknown",
  },
  {
    name: "ordinary JPEG",
    asset: { uri: "file:///photos/lounge.jpeg", fileName: "lounge.jpeg", mimeType: "image/jpeg" },
    sourceFormat: "jpeg",
  },
  {
    name: "ordinary PNG",
    asset: { uri: "file:///photos/lounge.png", fileName: "lounge.png", mimeType: "image/png" },
    sourceFormat: "png",
  },
];

for (const entry of cases) {
  test(`${entry.name} receives normalized JPEG metadata`, async () => {
    assert.equal(scanLibrarySourceFormat(entry.asset), entry.sourceFormat);
    const [normalized] = await normalizeScanLibrarySelection([entry.asset], async (_asset, index) => ({
      uri: `file:///cache/normalized-${index}.jpg`,
      width: 4032,
      height: 3024,
      fileSize: 1_250_000,
    }));

    assert.equal(normalized.mimeType, NORMALIZED_SCAN_LIBRARY_MIME_TYPE);
    assert.match(normalized.fileName, /\.jpg$/);
    assert.match(normalized.uri, /\.jpg$/);
    assert.equal(normalized.width, 4032);
    assert.equal(normalized.height, 3024);
  });
}

test("missing filename receives a deterministic JPEG filename", () => {
  assert.equal(normalizedScanLibraryFileName({ uri: "ph://NO_EXTENSION" }, 3), "scan-library-4.jpg");
});

test("mixed-format multi-photo selection normalizes every image in order", async () => {
  const assets = cases.map((entry) => entry.asset);
  const conversionOrder: number[] = [];
  const normalized = await normalizeScanLibrarySelection(assets, async (asset, index) => {
    conversionOrder.push(index);
    return {
      uri: `file:///cache/mixed-${index}.jpg`,
      width: asset.width ?? 1920,
      height: asset.height ?? 1080,
      fileSize: 500_000 + index,
    };
  });

  assert.deepEqual(conversionOrder, [0, 1, 2, 3, 4, 5]);
  assert.equal(normalized.length, assets.length);
  assert.ok(normalized.every((asset) => asset.mimeType === "image/jpeg"));
  assert.ok(normalized.every((asset) => asset.fileName.endsWith(".jpg")));
  assert.ok(normalized.every((asset) => asset.uri.endsWith(".jpg")));
});
