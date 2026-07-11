import assert from "node:assert/strict";
import test from "node:test";

import { pinBelongsToPhoto, viewerAllowsPinEditing } from "../image-viewer-config.ts";

test("pin editing is available only for an editable pin on its source photo", () => {
  const base = { pin: { x: 0.4, y: 0.6 }, hasSaveHandler: true, currentIndex: 2, pinPhotoIndex: 2 };
  assert.equal(viewerAllowsPinEditing(base), true);
  assert.equal(viewerAllowsPinEditing({ ...base, hasSaveHandler: false }), false);
  assert.equal(viewerAllowsPinEditing({ ...base, pin: null }), false);
  assert.equal(viewerAllowsPinEditing({ ...base, currentIndex: 1 }), false);
});

test("pins render only on their source photo", () => {
  assert.equal(pinBelongsToPhoto(1, 1), true);
  assert.equal(pinBelongsToPhoto(0, 1), false);
});
