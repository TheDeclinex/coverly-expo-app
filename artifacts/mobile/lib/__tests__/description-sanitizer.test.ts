import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPreferredRetailerIntent,
  sanitizeReplacementSearchText,
  sanitizeSceneDescription,
} from "../description-sanitizer.ts";

test("removes standalone scene-position sentences while retaining product attributes", () => {
  assert.equal(
    sanitizeSceneDescription(
      "A black square-shaped subwoofer with a visible front speaker grille. It is placed on the floor to the right side of the cabinet.",
    ),
    "A black square-shaped subwoofer with a visible front speaker grille.",
  );
  assert.equal(
    sanitizeSceneDescription(
      "A black subwoofer speaker placed on the floor to the right of the media cabinet. It is part of the sound system accompanying the TV.",
    ),
    "A black subwoofer speaker.",
  );
});

test("removes conservative placement suffixes without damaging intrinsic front features", () => {
  assert.equal(
    sanitizeSceneDescription(
      "Black powered subwoofer with a front speaker grille is sitting next to a cabinet.",
    ),
    "Black powered subwoofer with a front speaker grille.",
  );
  assert.equal(
    sanitizeSceneDescription(
      "Front-loading washer with brushed steel controls.",
    ),
    "Front-loading washer with brushed steel controls.",
  );
});

test("removes obvious leading location narration", () => {
  for (const value of [
    "Located next to the television.",
    "To the left of the cabinet.",
    "In front of the sofa.",
    "Behind the table.",
    "Shown on a shelf.",
  ]) {
    assert.equal(sanitizeSceneDescription(value), "");
  }
});

test("removes retailer purchase history without stripping retailer-like brands", () => {
  for (const [input, expected] of [
    ["Sony soundbar purchased from JB Hi-Fi.", "Sony soundbar."],
    ["Television bought at Harvey Norman.", "Television."],
    ["Washer originally purchased from Noel Leeming.", "Washer."],
    ["Kitchen mixer from The Warehouse.", "Kitchen mixer."],
    ["Kindle bought online from Amazon.", "Kindle."],
    ["Amazon Echo Studio smart speaker.", "Amazon Echo Studio smart speaker."],
  ]) {
    assert.equal(sanitizeReplacementSearchText(input), expected);
  }
});

test("extracts only explicit current retailer commands", () => {
  assert.equal(
    extractPreferredRetailerIntent("Only search JB Hi-Fi"),
    "JB Hi-Fi",
  );
  assert.equal(
    extractPreferredRetailerIntent("Find this at Noel Leeming"),
    "Noel Leeming",
  );
  assert.equal(
    extractPreferredRetailerIntent("Show Harvey Norman listings"),
    "Harvey Norman",
  );
  assert.equal(extractPreferredRetailerIntent("purchased from JB Hi-Fi"), null);
});
