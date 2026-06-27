import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(testDir, "../../app/(tabs)/claim-pack/[fileId].tsx"),
  "utf8",
);

test("claim pack review is collapsed by default in the builder", () => {
  assert.match(source, /const \[isReviewExpanded, setIsReviewExpanded\] = useState\(false\)/);
});

test("room selection appears before the compact review card", () => {
  const roomsHeading = source.indexOf("Rooms in this claim pack");
  const reviewCard = source.indexOf("<ClaimPackReviewCard");

  assert.notEqual(roomsHeading, -1);
  assert.notEqual(reviewCard, -1);
  assert.ok(roomsHeading < reviewCard);
});

test("expanded review keeps issue actions available", () => {
  for (const label of ["Run price search", "Fix item", "Exclude item", "Exclude room", "Approve"]) {
    assert.ok(source.includes(label), `Expected ${label} action to remain available`);
  }
});

test("approval copy stays neutral", () => {
  const deprecatedLabel = ["Approve", " anyway"].join("");
  assert.equal(source.includes(deprecatedLabel), false);
});

test("PDF export is wired to the backend generator", () => {
  assert.ok(source.includes("generateClaimPackPdf(futureGeneratePayload)"));
  assert.ok(source.includes("ClaimPackPdfExportCard"));
  assert.ok(source.includes("Generate claim pack PDF"));
});

test("PDF export blocks empty or unresolved blocking drafts", () => {
  assert.ok(source.includes("Select at least one item to generate a claim pack PDF."));
  assert.ok(source.includes("Resolve or approve required review items before generating the PDF."));
});

test("PDF export shows loading, success, and retry states", () => {
  for (const copy of ["Generating PDF...", "Open PDF", "Retry PDF generation"]) {
    assert.ok(source.includes(copy), `Expected ${copy} state copy`);
  }
});

test("PDF success copy reflects email delivery status", () => {
  assert.ok(source.includes("We've also emailed it to you."));
  assert.ok(source.includes("We couldn't email it, but you can open it here."));
});

test("old coming-next PDF export copy is removed", () => {
  assert.equal(source.includes("Generate PDF"), false);
  assert.equal(source.includes("coming next"), false);
});
