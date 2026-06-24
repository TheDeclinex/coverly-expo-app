import assert from "node:assert/strict";
import test from "node:test";

import {
  addClaimPackRoom,
  calculateClaimPackSummary,
  clearClaimPackItemsInRoom,
  createInitialClaimPackSelection,
  createRoomsOnlyClaimPackSelection,
  createWholePropertyClaimPackSelection,
  removeClaimPackRoom,
  selectAllClaimPackItemsInRoom,
  toggleClaimPackItem,
  toggleClaimPackRoom,
  type ClaimPackItemLike,
  type ClaimPackRoomLike,
} from "../claim-pack-selection-model.ts";

const rooms: ClaimPackRoomLike[] = [
  { id: "room-a", name: "Lounge" },
  { id: "room-b", name: "Kitchen" },
];

const items: ClaimPackItemLike[] = [
  {
    id: "item-tv",
    room_id: "room-a",
    estimated_price: 900,
    unit_estimated_price: null,
    quantity: 1,
    image_url: "user/file/tv.jpg",
    photo_url: null,
  },
  {
    id: "item-chair",
    room_id: "room-a",
    estimated_price: 100,
    unit_estimated_price: null,
    quantity: 2,
    image_url: null,
    photo_url: null,
  },
  {
    id: "item-kettle",
    room_id: "room-b",
    estimated_price: null,
    unit_estimated_price: null,
    quantity: 1,
    image_url: null,
    photo_url: "user/file/kettle.jpg",
  },
];

test("defaults all rooms and items into a draft claim-pack selection", () => {
  const selection = createInitialClaimPackSelection(rooms, items);

  assert.deepEqual([...selection.selectedRoomIds].sort(), ["room-a", "room-b"]);
  assert.deepEqual([...selection.selectedItemIds].sort(), ["item-chair", "item-kettle", "item-tv"]);
});

test("whole property selection includes every room and item", () => {
  const selection = createWholePropertyClaimPackSelection(rooms, items);

  assert.deepEqual([...selection.selectedRoomIds].sort(), ["room-a", "room-b"]);
  assert.deepEqual([...selection.selectedItemIds].sort(), ["item-chair", "item-kettle", "item-tv"]);
});

test("choose-by-room starts with selected rooms and unchecked items", () => {
  const selection = createRoomsOnlyClaimPackSelection(["room-a"]);

  assert.deepEqual([...selection.selectedRoomIds], ["room-a"]);
  assert.deepEqual([...selection.selectedItemIds], []);
});

test("rooms can be added and removed from a draft", () => {
  const initial = createRoomsOnlyClaimPackSelection(["room-a"]);
  const withKitchen = addClaimPackRoom(initial, "room-b");
  const selectedKitchenItems = selectAllClaimPackItemsInRoom(withKitchen, "room-b", items);
  const withoutKitchen = removeClaimPackRoom(selectedKitchenItems, "room-b", items);

  assert.equal(withKitchen.selectedRoomIds.has("room-b"), true);
  assert.equal(selectedKitchenItems.selectedItemIds.has("item-kettle"), true);
  assert.equal(withoutKitchen.selectedRoomIds.has("room-b"), false);
  assert.equal(withoutKitchen.selectedItemIds.has("item-kettle"), false);
});

test("room item select all and clear preserve the selected room", () => {
  const initial = createRoomsOnlyClaimPackSelection(["room-a"]);
  const selected = selectAllClaimPackItemsInRoom(initial, "room-a", items);
  const cleared = clearClaimPackItemsInRoom(selected, "room-a", items);

  assert.equal(selected.selectedItemIds.has("item-tv"), true);
  assert.equal(selected.selectedItemIds.has("item-chair"), true);
  assert.equal(cleared.selectedRoomIds.has("room-a"), true);
  assert.equal(cleared.selectedItemIds.has("item-tv"), false);
  assert.equal(cleared.selectedItemIds.has("item-chair"), false);
});

test("room toggle deselects and reselects all items in that room", () => {
  const initial = createInitialClaimPackSelection(rooms, items);
  const withoutLounge = toggleClaimPackRoom(initial, "room-a", items);

  assert.equal(withoutLounge.selectedRoomIds.has("room-a"), false);
  assert.equal(withoutLounge.selectedItemIds.has("item-tv"), false);
  assert.equal(withoutLounge.selectedItemIds.has("item-chair"), false);
  assert.equal(withoutLounge.selectedItemIds.has("item-kettle"), true);

  const withLounge = toggleClaimPackRoom(withoutLounge, "room-a", items);
  assert.equal(withLounge.selectedRoomIds.has("room-a"), true);
  assert.equal(withLounge.selectedItemIds.has("item-tv"), true);
  assert.equal(withLounge.selectedItemIds.has("item-chair"), true);
});

test("item toggle keeps room selection in sync", () => {
  const initial = createInitialClaimPackSelection([{ id: "room-a", name: "Lounge" }], items.slice(0, 2));
  const withoutTv = toggleClaimPackItem(initial, items[0], items);
  const withoutLoungeItems = toggleClaimPackItem(withoutTv, items[1], items);

  assert.equal(withoutTv.selectedRoomIds.has("room-a"), true);
  assert.equal(withoutLoungeItems.selectedRoomIds.has("room-a"), false);
});

test("summary counts selected value, evidence, and missing readiness data", () => {
  const selection = createInitialClaimPackSelection(rooms, items);
  const summary = calculateClaimPackSummary({
    rooms,
    items,
    evidenceCountsByItemId: {
      "item-tv": 2,
      "item-chair": 0,
      "item-kettle": 1,
    },
    selection,
  });

  assert.equal(summary.selectedRoomsCount, 2);
  assert.equal(summary.selectedItemsCount, 3);
  assert.equal(summary.includedEvidenceCount, 3);
  assert.equal(summary.selectedEstimatedValue, 1100);
  assert.equal(summary.missingValueCount, 1);
  assert.equal(summary.missingPhotoCount, 1);
  assert.equal(summary.missingEvidenceCount, 1);
});
