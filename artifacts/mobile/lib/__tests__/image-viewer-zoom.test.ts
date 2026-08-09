import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const viewer = readFileSync(resolve(process.cwd(), "components/ImageViewerModal.tsx"), "utf8");

test("shared fullscreen viewer supports pinch, pan, and double-tap zoom", () => {
  assert.match(viewer, /Gesture\.Pinch\(\)/);
  assert.match(viewer, /Gesture\.Pan\(\)/);
  assert.match(viewer, /numberOfTaps\(2\)/);
  assert.match(viewer, /MAX_ZOOM_SCALE = 4/);
});

test("zoom resets on visibility, active image, edit-mode, or source changes", () => {
  assert.match(viewer, /\[active, enabled, resetKey, resetZoom, visible\]/);
  assert.match(viewer, /if \(!visible\) setZoomedIndex\(null\)/);
  assert.match(viewer, /setZoomedIndex\(null\);[\s\S]*beginViewerPinEdit/);
});

test("gallery paging is disabled while an image is zoomed", () => {
  assert.match(viewer, /scrollEnabled=\{!editingPin && zoomedIndex === null && imageSources\.length > 1\}/);
});
