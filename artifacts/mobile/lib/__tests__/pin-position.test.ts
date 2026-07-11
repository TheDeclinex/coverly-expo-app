import assert from "node:assert/strict";
import test from "node:test";

import { clampNormalizedPin, focalCoverRect, normalizedPinFromPoint, pinMarkerPosition, pinMarkerPositionInRect, renderedImageRect } from "../pin-position.ts";

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

test("accounts for contain letterboxing in both directions", () => {
  const rect = renderedImageRect({
    container: { w: 300, h: 300 },
    image: { w: 400, h: 200 },
    fit: "contain",
  });
  assert.deepEqual(rect, { x: 0, y: 75, w: 300, h: 150 });
  assert.deepEqual(
    normalizedPinFromPoint({
      point: { x: 225, y: 112.5 },
      container: { w: 300, h: 300 },
      image: { w: 400, h: 200 },
      fit: "contain",
    }),
    { x: 0.75, y: 0.25 },
  );
});

test("clamps points dragged outside the rendered image", () => {
  assert.deepEqual(
    normalizedPinFromPoint({
      point: { x: -50, y: 500 },
      container: { w: 300, h: 300 },
      image: { w: 400, h: 200 },
      fit: "contain",
    }),
    { x: 0, y: 1 },
  );
});

test("shifts a portrait cover crop toward pins near the top and bottom", () => {
  const input = { container: { w: 300, h: 160 }, image: { w: 200, h: 400 } };
  assert.equal(focalCoverRect({ ...input, focalPoint: { x: 0.5, y: 0.1 } })?.y, 0);
  assert.equal(focalCoverRect({ ...input, focalPoint: { x: 0.5, y: 0.9 } })?.y, -440);
  assert.equal(focalCoverRect({ ...input, focalPoint: { x: 0.5, y: 0.5 } })?.y, -220);
});

test("shifts a landscape cover crop toward pins near the left and right", () => {
  const input = { container: { w: 300, h: 160 }, image: { w: 600, h: 200 } };
  assert.equal(focalCoverRect({ ...input, focalPoint: { x: 0.1, y: 0.5 } })?.x, 0);
  assert.equal(focalCoverRect({ ...input, focalPoint: { x: 0.9, y: 0.5 } })?.x, -180);
  assert.equal(focalCoverRect({ ...input, focalPoint: { x: 0.5, y: 0.5 } })?.x, -90);
});

test("uses a centred cover crop when there is no valid focal pin", () => {
  assert.deepEqual(
    focalCoverRect({ container: { w: 300, h: 160 }, image: { w: 600, h: 200 }, focalPoint: null }),
    { x: -90, y: 0, w: 480, h: 160, scale: 0.8 },
  );
});

test("uses the focal crop transform for marker placement and clamps edge pins", () => {
  const container = { w: 300, h: 160 };
  const pin = { x: 0.5, y: 0.9 };
  const rect = focalCoverRect({ container, image: { w: 200, h: 400 }, focalPoint: pin });
  assert.ok(rect);
  assert.deepEqual(
    pinMarkerPositionInRect({ pin, rect, container, marker: { w: 20, h: 30 } }),
    { left: 140, top: 70 },
  );
  assert.equal(focalCoverRect({ container, image: { w: 200, h: 400 }, focalPoint: { x: 1, y: 1 } })?.y, -440);
});
