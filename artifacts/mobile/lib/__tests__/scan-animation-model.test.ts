import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceEvidenceDeck,
  createEvidenceDeck,
  evidenceFrameLabel,
  isSingleImageScan,
} from "../scan-animation-model.ts";

test("single scans remain one honest image with non-numeric context", () => {
  assert.equal(isSingleImageScan("single_photo_room", 1), true);
  assert.equal(isSingleImageScan("single_item", 1), true);
  assert.deepEqual(createEvidenceDeck(1), [0]);
  assert.equal(evidenceFrameLabel("single_photo_room", 0, 1), "Analysing image…");
  assert.equal(evidenceFrameLabel("single_item", 0, 1), "Analysing image…");
});

test("multi-photo scans expose four physical layers and five progress frames", () => {
  let deck = createEvidenceDeck(5);
  assert.deepEqual(deck, [0, 1, 2, 3]);

  const visited: number[] = [];
  for (let step = 0; step < 5; step += 1) {
    const next = advanceEvidenceDeck(deck, 5);
    visited.push(next.currentFrameIndex);
    deck = next.deck;
  }

  assert.deepEqual(visited, [1, 2, 3, 4, 0]);
  assert.deepEqual(deck, [0, 1, 2, 3]);
  assert.equal(evidenceFrameLabel("multi_photo_room", 2, 5), "Checking image 3 of 5");
});

test("video scans retain four physical layers while looping all ten frames", () => {
  let deck = createEvidenceDeck(10);
  assert.equal(deck.length, 4);

  const visited: number[] = [];
  for (let step = 0; step < 10; step += 1) {
    const next = advanceEvidenceDeck(deck, 10);
    visited.push(next.currentFrameIndex);
    deck = next.deck;
  }

  assert.deepEqual(visited, [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  assert.equal(deck.length, 4);
  assert.equal(evidenceFrameLabel("video_room", 2, 10), "Checking frame 3 of 10");
});
