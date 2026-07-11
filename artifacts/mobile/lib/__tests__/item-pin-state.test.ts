import assert from "node:assert/strict";
import test from "node:test";

import { itemWithCommittedPin, replaceItemWithCommittedPin } from "../item-pin-state.ts";

const item = { id: "item-1", image_pin: { x: 0.2, y: 0.3, sourcePhotoIndex: 2, type: "ai" } } as never;

test("commits a pin without mutating the previous item and preserves source metadata", () => {
  const updated = itemWithCommittedPin(item, { x: 0.7, y: 0.8 });
  assert.deepEqual(updated.image_pin, { x: 0.7, y: 0.8, sourcePhotoIndex: 2, type: "ai" });
  assert.deepEqual((item as { image_pin: unknown }).image_pin, { x: 0.2, y: 0.3, sourcePhotoIndex: 2, type: "ai" });
});

test("updates only the committed item in a collection", () => {
  const sibling = { id: "item-2", image_pin: null } as never;
  const updated = replaceItemWithCommittedPin([item, sibling], "item-1", { x: 0.4, y: 0.5 });
  assert.equal(updated?.[1], sibling);
  assert.deepEqual(updated?.[0].image_pin, { x: 0.4, y: 0.5, sourcePhotoIndex: 2, type: "ai" });
});
