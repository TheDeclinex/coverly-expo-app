import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const edge = readFileSync(resolve(process.cwd(), "../../supabase/functions/scan-room-photo/index.ts"), "utf8");
const scan = readFileSync(resolve(process.cwd(), "app/(tabs)/scan.tsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "lib/scan-service.ts"), "utf8");

test("edge pin source IDs are preferred, range checked, and diagnosed without item names", () => {
  assert.match(edge, /if \(i\.sourceImageId !== undefined\)[\s\S]*else if \(typeof i\.sourcePhotoIndex/);
  assert.match(edge, /resolved >= 0 && resolved < imageCount/);
  assert.match(edge, /scanLog\('pin_diagnostics'/);
  assert.match(edge, /rawPin:[\s\S]*normalizedPin:[\s\S]*resolvedSourcePhotoIndex:/);
});

test("mobile suppresses multi-photo pins whose source index is missing or invalid", () => {
  assert.match(service, /sourcePhotoIndexCandidate >= 0/);
  assert.match(service, /sourcePhotoIndexCandidate < input\.images\.length/);
  assert.match(service, /hasTrustworthyPinSource = input\.images\.length === 1 \|\| sourcePhotoIndex !== null/);
});

test("scan review renders against decoded dimensions and records internal diagnostics", () => {
  assert.match(scan, /onNaturalSize=\{\(size\) =>/);
  assert.match(scan, /activeDecodedDimensions[\s\S]*activeSourceImage\?\.width/);
  assert.match(scan, /\[scanPin\] Source image dimensions/);
});
