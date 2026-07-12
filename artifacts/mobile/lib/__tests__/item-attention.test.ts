import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  filterItemsNeedingAttention,
  itemMatchesAttention,
  type ItemAttentionFilter,
} from "../item-attention.ts";
import type { InventoryItem } from "../../types/index.ts";

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url).href), "utf8");
const roomSource = source("../../app/(tabs)/room/[id].tsx");
const attentionSource = source("../../app/(tabs)/items-needing-attention.tsx");

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "item-1", file_id: "file-1", room_id: "room-1", room: "Lounge", name: "Television",
    category: "Electronics", confidence: 0.95, estimated_price: 500, unit_estimated_price: 500,
    quantity: 1, quantity_estimate: null, valuation_basis: "manual", price_source_type: "user_entered",
    description: null, image_url: "user/file/photo.jpg", photo_url: null, notes: null, brand_maker: null,
    model_series: null, condition_label: null, purchase_source: null, original_purchase_price: null,
    purchase_year_approx: null, image_pin: null, attachments: null, ...overrides,
  };
}

test("missing-photo and missing-value filters return every matching item", () => {
  const items = [
    item({ id: "complete" }),
    item({ id: "photo-1", image_url: null }),
    item({ id: "photo-2", image_url: null, photo_url: null }),
    item({ id: "value-1", estimated_price: null, unit_estimated_price: null }),
    item({ id: "value-2", estimated_price: null, unit_estimated_price: null }),
  ];
  assert.deepEqual(filterItemsNeedingAttention(items, "missing_photo").map(({ id }) => id), ["photo-1", "photo-2"]);
  assert.deepEqual(filterItemsNeedingAttention(items, "missing_value").map(({ id }) => id), ["value-1", "value-2"]);
});

test("all attention filters use one shared predicate", () => {
  const filters: ItemAttentionFilter[] = ["missing_photo", "missing_value", "needs_details", "missing_evidence", "ai_value"];
  const target = item({ unit_estimated_price: null, estimated_price: null });
  for (const filter of filters) {
    assert.equal(
      filterItemsNeedingAttention([target], filter, { [target.id]: 0 }).length > 0,
      itemMatchesAttention(target, filter, 0),
    );
  }
});

test("Room recommendations route to the intermediate list and never pick the first item", () => {
  assert.ok(roomSource.includes('pathname: "/(tabs)/items-needing-attention"'));
  assert.equal(roomSource.includes("openItem(reviewItems[0])"), false);
  assert.equal(roomSource.includes("openItem(highValueWithoutEvidence[0]"), false);
  assert.equal(roomSource.includes("openItem(aiEstimateItems[0])"), false);
});

test("attention list is virtualized and item navigation is explicit", () => {
  assert.ok(attentionSource.includes("<FlatList"));
  assert.ok(attentionSource.includes("Item details"));
  assert.ok(attentionSource.includes('pathname: "/(tabs)/item/[id]"'));
  assert.ok(attentionSource.includes("useFocusEffect"));
});

test("stale results show a completion state instead of opening another item", () => {
  assert.ok(attentionSource.includes("All caught up"));
  assert.ok(attentionSource.includes("These items no longer need this update"));
  assert.equal(attentionSource.includes("affectedItems[0]"), false);
});
