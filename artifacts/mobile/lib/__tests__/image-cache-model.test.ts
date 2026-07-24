import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  imageCacheBoundaryAction,
  isDurableStoragePath,
  isSignedImageQueryKey,
  privateImageCacheKey,
  resolvedPrivateImageSource,
  signedImageQueryKey,
} from "../image-cache-model.ts";

const testDir = dirname(fileURLToPath(import.meta.url));

test("rotating signed URLs retain one stable cache identity", () => {
  const common = {
    accountId: "user-a",
    bucket: "inventory-photos",
    pathOrUrl: "user-a/file-1/item-123.jpg",
  };
  const first = resolvedPrivateImageSource({
    ...common,
    uri: "https://example.supabase.co/object/sign/item.jpg?token=first",
  });
  const refreshed = resolvedPrivateImageSource({
    ...common,
    uri: "https://example.supabase.co/object/sign/item.jpg?token=second",
  });

  assert.notEqual(first.uri, refreshed.uri);
  assert.equal(first.cacheKey, refreshed.cacheKey);
});

test("account, bucket, and replacement path each invalidate cache identity", () => {
  const base = {
    accountId: "user-a",
    bucket: "inventory-photos",
    pathOrUrl: "user-a/file-1/item-old.jpg",
  };
  const original = privateImageCacheKey(base);

  assert.notEqual(
    original,
    privateImageCacheKey({ ...base, accountId: "user-b" }),
  );
  assert.notEqual(
    original,
    privateImageCacheKey({ ...base, bucket: "claim-evidence" }),
  );
  assert.notEqual(
    original,
    privateImageCacheKey({
      ...base,
      pathOrUrl: "user-a/file-1/item-new.jpg",
    }),
  );
});

test("signed image queries reuse object-level account/bucket/path identity", () => {
  const first = signedImageQueryKey(
    "user-a",
    "inventory-photos",
    "user-a/file-1/item.jpg",
  );
  const second = signedImageQueryKey(
    "user-a",
    "inventory-photos",
    "user-a/file-1/item.jpg",
  );

  assert.deepEqual(first, second);
  assert.equal(isSignedImageQueryKey(first), true);
  assert.equal(isSignedImageQueryKey(["items", "room-1"]), false);
});

test("account boundary policy clears on first migration, logout, and switching", () => {
  assert.equal(imageCacheBoundaryAction(null, "user-a"), "clear-and-set");
  assert.equal(imageCacheBoundaryAction("user-a", "user-a"), "keep");
  assert.equal(imageCacheBoundaryAction("user-a", null), "clear-and-remove");
  assert.equal(imageCacheBoundaryAction("user-a", "user-b"), "clear-and-set");
  assert.equal(imageCacheBoundaryAction(null, null), "keep");
});

test("storage-path classification excludes signed and local display URIs", () => {
  assert.equal(isDurableStoragePath("user-a/file-1/item.jpg"), true);
  assert.equal(isDurableStoragePath("https://example.com/item.jpg"), false);
  assert.equal(isDurableStoragePath("file:///item.jpg"), false);
  assert.equal(isDurableStoragePath("content://item.jpg"), false);
  assert.equal(isDurableStoragePath(null), false);
});

test("shared components and auth root retain the Phase 1 cache contract", () => {
  const reliableImage = readFileSync(
    resolve(testDir, "../../components/ReliableImage.tsx"),
    "utf8",
  );
  const signedHooks = readFileSync(
    resolve(testDir, "../../hooks/useSignedUrls.ts"),
    "utf8",
  );
  const rootLayout = readFileSync(
    resolve(testDir, "../../app/_layout.tsx"),
    "utf8",
  );

  assert.match(reliableImage, /source=\{\{ uri, cacheKey \}\}/);
  assert.match(reliableImage, /cachePolicy=.*memory-disk/);
  assert.match(signedHooks, /useQueries/);
  assert.match(signedHooks, /signedImageQueryKey/);
  assert.match(rootLayout, /synchroniseImageCacheAccount\(accountId\)/);
  assert.match(rootLayout, /isSignedImageQueryKey/);
});
