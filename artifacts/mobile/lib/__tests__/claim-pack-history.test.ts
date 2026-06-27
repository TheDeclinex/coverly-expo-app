import assert from "node:assert/strict";
import test from "node:test";

import {
  claimPackHistoryValueLabel,
  getClaimPackHistoryStatus,
  safeClaimPackPdfFilename,
} from "../claim-pack-history.ts";

test("ready claim pack with storage path is openable", () => {
  assert.equal(getClaimPackHistoryStatus({ status: "ready", storage_path: "user/property/export.pdf" }), "openable");
  assert.equal(claimPackHistoryValueLabel("openable"), "Open PDF");
});

test("generated claim pack with storage path is treated as ready equivalent", () => {
  assert.equal(getClaimPackHistoryStatus({ status: "generated", storage_path: "user/property/export.pdf" }), "openable");
});

test("failed claim pack is not openable even with storage path", () => {
  assert.equal(getClaimPackHistoryStatus({ status: "failed", storage_path: "user/property/export.pdf" }), "failed");
  assert.equal(getClaimPackHistoryStatus({ status: "ready", storage_path: "user/property/export.pdf", generation_error: "boom" }), "failed");
});

test("legacy claim pack without storage path is visible but not openable", () => {
  assert.equal(getClaimPackHistoryStatus({ status: "ready", storage_path: null }), "legacy");
  assert.equal(claimPackHistoryValueLabel("legacy"), "Legacy pack");
});

test("pending claim pack is not openable", () => {
  assert.equal(getClaimPackHistoryStatus({ status: "processing", storage_path: null }), "pending");
  assert.equal(claimPackHistoryValueLabel("pending"), "Processing");
});

test("claim pack with completed storage path is not classified as pending draft", () => {
  assert.equal(getClaimPackHistoryStatus({ status: "draft", storage_path: "user/property/export.pdf" }), "openable");
});

test("claim pack PDF filename is safe and keeps pdf suffix", () => {
  assert.equal(safeClaimPackPdfFilename("Kitchen / Smoke: Claim?.pdf", "ignored"), "Kitchen-Smoke-Claim.pdf");
  assert.equal(safeClaimPackPdfFilename(null, "Main home"), "Coverly-Claim-Pack-Main-home.pdf");
  assert.equal(safeClaimPackPdfFilename("claim-pack", null), "claim-pack.pdf");
});
