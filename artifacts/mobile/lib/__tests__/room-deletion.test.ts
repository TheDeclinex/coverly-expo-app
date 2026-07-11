import assert from "node:assert/strict";
import test from "node:test";

import { subtractDeletedItems, withoutRoomItems } from "../room-deletion.ts";

const room = {
  id: "room-a",
};

const items = [
  { id: "item-a", file_id: "property-a", room_id: "room-a", name: "Table", estimated_price: 500, quantity: 1 },
  { id: "item-b", file_id: "property-a", room_id: "room-a", name: "Lamp", estimated_price: 100, quantity: 2 },
];

test("deleting a room removes all of its items from cached collections", () => {
  assert.deepEqual(withoutRoomItems(items, room.id), []);
  assert.equal(subtractDeletedItems(items.length, items.length), 0);
});

test("deleting the only room returns property totals and graphs to empty", () => {
  const remainingItems = withoutRoomItems(items, room.id) ?? [];
  const totalValue = remainingItems.reduce(
    (sum, item) => sum + item.estimated_price * item.quantity,
    0,
  );
  const categoryGraphValues = remainingItems.map((item) => item.estimated_price * item.quantity);

  assert.equal(remainingItems.length, 0);
  assert.equal(totalValue, 0);
  assert.deepEqual(categoryGraphValues, []);
});

test("deleted-room values no longer contribute to home portfolio totals", () => {
  const remainingItems = withoutRoomItems(items, room.id) ?? [];
  const totalInventoryValue = remainingItems.reduce(
    (sum, item) => sum + item.estimated_price * item.quantity,
    0,
  );

  assert.equal(remainingItems.length, 0);
  assert.equal(totalInventoryValue, 0);
});

test("items belonging to other rooms are preserved", () => {
  const otherItem = { ...items[0], id: "item-c", room_id: "room-b" };
  assert.deepEqual(withoutRoomItems([...items, otherItem], room.id), [otherItem]);
});
