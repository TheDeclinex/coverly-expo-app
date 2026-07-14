import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_SCAN_MODEL,
  SCAN_MODES,
  resolveScanModel,
  sanitizeScannedItem,
  scanModelForMode,
} from "./scan-model.ts";

test("defaults inventory scans to the exact GPT-5.6 Luna model ID", () => {
  assert.equal(DEFAULT_SCAN_MODEL, "gpt-5.6-luna");
  assert.equal(resolveScanModel(), "gpt-5.6-luna");
  assert.notEqual(DEFAULT_SCAN_MODEL, "gpt-5.6");
});

test("all inventory scan modes use the same server scan model config", () => {
  for (const mode of SCAN_MODES) {
    assert.equal(scanModelForMode(mode), "gpt-5.6-luna");
    assert.equal(
      scanModelForMode(mode, "configured-scan-model"),
      "configured-scan-model",
    );
  }
});

test("blank scan model config falls back safely", () => {
  assert.equal(resolveScanModel("   "), "gpt-5.6-luna");
});

test("scan descriptions remove scene position while preserving product details and pin data", () => {
  const pin = { x: 72, y: 64 };
  const item = sanitizeScannedItem({
    description:
      "A black square-shaped subwoofer with a visible front speaker grille. It is placed on the floor to the right side of the cabinet.",
    pin,
    sourceImageId: "photo_2",
  });

  assert.equal(
    item.description,
    "A black square-shaped subwoofer with a visible front speaker grille.",
  );
  assert.equal(item.pin, pin);
  assert.equal(item.sourceImageId, "photo_2");

  assert.equal(
    sanitizeScannedItem({
      description:
        "A black subwoofer speaker placed on the floor to the right of the media cabinet. It is part of the sound system accompanying the TV.",
    }).description,
    "A black subwoofer speaker.",
  );
});

test("the shared scan prompt excludes position narration for every scan mode", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /Describe only intrinsic and visually identifiable characteristics/,
  );
  assert.match(
    source,
    /Positional information may be used internally to distinguish objects and generate pins/,
  );
  assert.doesNotMatch(source, /Sentence 2:.*placement/);
  for (const mode of SCAN_MODES)
    assert.match(source, new RegExp(`mode === '${mode}'|// ${mode}`));
  assert.match(source, /pin: i\.pin \?/);
});
