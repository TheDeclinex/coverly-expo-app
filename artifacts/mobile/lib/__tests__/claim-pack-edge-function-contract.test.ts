import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(testDir, "../../../../supabase/functions/generate-claim-pack/index.ts"),
  "utf8",
);

test("generate-claim-pack inserts the property file id into claim_packs", () => {
  assert.ok(source.includes("file_id: property.id"));
});

test("generate-claim-pack contract matches the mobile payload keys", () => {
  for (const key of ["propertyId", "selectedRoomIds", "selectedItemIds", "scope", "clientDraftId", "claimNote"]) {
    assert.ok(source.includes(key), `Expected ${key} in generate-claim-pack contract`);
  }
});

test("generate-claim-pack uses final insurer-ready sections", () => {
  for (const section of [
    "Claim and Property Details",
    "Executive Summary",
    "Selected Item Schedule",
    "Item Details and Photo References",
    "Evidence Appendix",
    "Evidence Attachments",
    "Declaration and Notes",
  ]) {
    assert.ok(source.includes(section), `Expected ${section} in final PDF renderer`);
  }
});

test("generate-claim-pack avoids placeholder and debug PDF language", () => {
  for (const forbidden of ["placeholder", "debug-style", "test renderer", "Missing info summary", "Valuation basis:", "Renderer: branded-v1"]) {
    assert.equal(source.includes(forbidden), false, `Did not expect ${forbidden}`);
  }
});

test("generate-claim-pack presents valuation basis in user-friendly wording", () => {
  assert.ok(source.includes("friendlyValuationBasis"));
  assert.ok(source.includes("Estimated replacement value"));
  assert.ok(source.includes("Policyholder estimate"));
});

test("generate-claim-pack presents property type enums in user-friendly wording", () => {
  assert.ok(source.includes("friendlyPropertyType"));
  for (const label of ["Main home", "Rental property", "Holiday home", "Storage unit"]) {
    assert.ok(source.includes(label), `Expected property type label ${label}`);
  }
  assert.ok(source.includes("titleCaseWords"));
  assert.equal(source.includes('{ label: "Property type", value: params.property.property_type }'), false);
});

test("generate-claim-pack groups selected items by room", () => {
  assert.ok(source.includes("snapshotsByRoom"));
  assert.ok(source.includes("roomHeading(roomName"));
});

test("generate-claim-pack returns signed URL and email status", () => {
  assert.ok(source.includes("signedUrl: signedData.signedUrl"));
  assert.ok(source.includes('rendererVersion: RENDERER_VERSION'));
  assert.ok(source.includes("emailSent: emailResult.emailSent"));
});

test("email failure does not fail PDF generation", () => {
  assert.ok(source.includes("email failed"));
  assert.ok(source.includes("return { emailSent: false"));
});

test("generate-claim-pack exposes unmistakable deployed renderer diagnostics", () => {
  assert.ok(source.includes('const EDGE_VERSION = "claim-pack-v1-branded-email"'));
  assert.ok(source.includes('const RENDERER_VERSION = "branded-v1"'));
  assert.ok(source.includes('rendererVersion: RENDERER_VERSION'));
});

test("generate-claim-pack logs email provider status safely", () => {
  for (const marker of ["email provider detected", "email attempted", "email sent", "email skipped", "email failed"]) {
    assert.ok(source.includes(marker), `Expected ${marker} log marker`);
  }
});

test("evidence appendix is based only on linked evidence records", () => {
  assert.ok(source.includes(".from(\"claim_evidence_items\")"));
  assert.ok(source.includes(".from(\"claim_evidence\")"));
  assert.ok(source.includes("if (allEvidence.length > 0)"));
  assert.equal(source.includes("Primary item photo included where available"), false);
});

test("pdf evidence is represented and copied into bounded evidence attachments", () => {
  assert.ok(source.includes("PDF_EVIDENCE_PAGE_LIMIT = 5"));
  assert.ok(source.includes("isPdfEvidence"));
  assert.ok(source.includes("loadPdfEvidenceAsset"));
  assert.ok(source.includes("pdfDoc.copyPages"));
  assert.ok(source.includes("First ${pdfAsset.includedPageCount} pages included"));
  assert.ok(source.includes("original PDF evidence file retained"));
  assert.ok(source.includes("PDF evidence file retained in Coverly."));
});

test("primary item photos stay in item cards instead of appendix rows", () => {
  assert.ok(source.includes("item.photo_url ? \"Photo supplied\""));
  assert.ok(source.includes("evidenceCard(item, evidence"));
  assert.equal(source.includes("writer.tableRow([item.name, \"Photo supplied\""), false);
});

test("claim pack reference does not use client draft or random suffixes", () => {
  assert.ok(source.includes("Claim Pack Reference"));
  assert.ok(source.includes("function makePackRef(generatedAt: string)"));
  assert.equal(source.includes("makePackRef(payload.clientDraftId)"), false);
  assert.equal(source.includes("crypto.randomUUID().slice"), false);
});

test("raw valuation enums are not rendered", () => {
  for (const raw of ["ai_estimate", "replacement_listing", "valuation_basis: item.valuation_basis"]) {
    assert.equal(source.includes(raw), false, `Did not expect raw valuation enum ${raw}`);
  }
});
