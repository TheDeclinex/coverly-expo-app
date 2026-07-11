import assert from "node:assert/strict";
import test from "node:test";

import { clearRoomViewSession, getRoomViewSession, resolveRoomRestoreIndex, updateRoomViewSession } from "../room-view-session.ts";

test("stores independent list and grid sessions per room", () => {
  updateRoomViewSession("room-a", { offset: 640, viewMode: "detailed", searchText: "lamp" });
  updateRoomViewSession("room-b", { offset: 220, viewMode: "compact", categoryFilter: "Electronics" });
  assert.equal(getRoomViewSession("room-a")?.offset, 640);
  assert.equal(getRoomViewSession("room-a")?.searchText, "lamp");
  assert.equal(getRoomViewSession("room-b")?.viewMode, "compact");
  assert.equal(getRoomViewSession("room-b")?.offset, 220);
});

test("restores near a surviving anchor and safely ignores a deleted item", () => {
  const session = updateRoomViewSession("room-c", { anchorItemId: "item-3", offset: 900 });
  assert.equal(resolveRoomRestoreIndex(session, ["item-1", "item-3", "item-4"]), 1);
  assert.equal(resolveRoomRestoreIndex(session, ["item-1", "item-4"]), null);
});

test("clamps invalid negative offsets", () => {
  assert.equal(updateRoomViewSession("room-d", { offset: -50 }).offset, 0);
});

test("clears a room session without affecting another room", () => {
  updateRoomViewSession("room-e", { offset: 100 });
  updateRoomViewSession("room-f", { offset: 200 });
  clearRoomViewSession("room-e");
  assert.equal(getRoomViewSession("room-e"), null);
  assert.equal(getRoomViewSession("room-f")?.offset, 200);
});
