import assert from "node:assert/strict";
import test from "node:test";

import { clampNormalizedPin, pinMarkerPosition } from "../pin-position.ts";

test("clamps invalid and out-of-range normalized pins", () => {
  assert.deepEqual(clampNormalizedPin({ x: -2, y: 3 }), { x: 0, y: 1 });
  assert.deepEqual(clampNormalizedPin({ x: Number.NaN, y: Number.NaN }), { x: 0.5, y: 0.5 });
});

test("maps a landscape image pin through cover cropping", () => {
  const position = pinMarkerPosition({
    pin: { x: 0.5, y: 0.5 },
    container: { w: 160, h: 120 },
    image: { w: 400, h: 200 },
    fit: "cover",
    marker: { w: 22, h: 28 },
  });
  assert.deepEqual(position, { left: 69, top: 32 });
});

test("keeps portrait and edge pins inside the visible image container", () => {
  const position = pinMarkerPosition({
    pin: { x: 1, y: 0 },
    container: { w: 160, h: 120 },
    image: { w: 200, h: 400 },
    fit: "cover",
    marker: { w: 22, h: 28 },
  });
  assert.ok(position);
  assert.equal(position.left, 138);
  assert.equal(position.top, 0);
});
