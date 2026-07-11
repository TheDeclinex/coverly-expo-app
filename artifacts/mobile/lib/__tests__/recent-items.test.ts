import assert from "node:assert/strict";
import test from "node:test";

import { stageRecentItemBatch, takeRecentItemBatch, withoutRecentItem } from "../recent-items.ts";

test("latest scan batch replaces the previous batch for a room", () => {
  stageRecentItemBatch("room-a", ["old-1", "old-2"]);
  stageRecentItemBatch("room-a", ["new-1", "new-2"]);

  assert.deepEqual([...takeRecentItemBatch("room-a") ?? []], ["new-1", "new-2"]);
});

test("room batches are isolated and consumed only once", () => {
  stageRecentItemBatch("room-a", ["a-1"]);
  stageRecentItemBatch("room-b", ["b-1"]);

  assert.deepEqual([...takeRecentItemBatch("room-a") ?? []], ["a-1"]);
  assert.equal(takeRecentItemBatch("room-a"), null);
  assert.deepEqual([...takeRecentItemBatch("room-b") ?? []], ["b-1"]);
});

test("opening one item clears only that item and preserves its siblings", () => {
  const remaining = withoutRecentItem(new Set(["item-1", "item-2", "item-3"]), "item-2");
  assert.deepEqual([...remaining], ["item-1", "item-3"]);
});
