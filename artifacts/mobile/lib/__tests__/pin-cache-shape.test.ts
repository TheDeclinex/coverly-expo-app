import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const roomSource = readFileSync(fileURLToPath(new URL("../../app/(tabs)/room/[id].tsx", import.meta.url).href), "utf8");
const itemSource = readFileSync(fileURLToPath(new URL("../../app/(tabs)/item/[id].tsx", import.meta.url).href), "utf8");

test("pin saves update only array-shaped all-items caches", () => {
  for (const source of [roomSource, itemSource]) {
    assert.equal(
      source.includes('setQueriesData<InventoryItem[]>(\n      { queryKey: ["all-items"] }'),
      false,
    );
    assert.equal(
      source.includes('["all-items", "home-valuation", session?.user.id]'),
      true,
    );
  }
});

test("pin saves keep property item collections in sync", () => {
  assert.equal(roomSource.includes('["property-items", target.file_id, session?.user.id]'), true);
  assert.equal(itemSource.includes('["property-items", item.file_id, session?.user.id]'), true);
});
