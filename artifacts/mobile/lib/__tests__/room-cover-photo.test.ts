import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { InventoryRoom } from "../../types/index.ts";

import {
  roomCoverActions,
  withRoomCoverPhoto,
  withRoomListCoverPhoto,
} from "../room-cover-photo.ts";

function room(id: string, coverPhotoUrl: string | null): InventoryRoom {
  return {
    id,
    file_id: "file-a",
    user_id: "user-a",
    name: id === "room-a" ? "Lounge" : "Kitchen",
    room_type: null,
    sort_order: null,
    cover_photo_url: coverPhotoUrl,
    notes: null,
    description: null,
    archived_at: null,
  };
}

test("cover actions include remove only when a cover exists", () => {
  assert.deepEqual(roomCoverActions(false), ["camera", "library", "cancel"]);
  assert.deepEqual(roomCoverActions(true), ["camera", "library", "remove", "cancel"]);
});

test("successful changes refresh the room and matching room card without touching siblings", () => {
  const current = room("room-a", "old.jpg");
  const sibling = room("room-b", "kitchen.jpg");

  assert.equal(withRoomCoverPhoto(current, "new.jpg")?.cover_photo_url, "new.jpg");
  const list = withRoomListCoverPhoto([current, sibling], "room-a", "new.jpg")!;
  assert.equal(list[0].cover_photo_url, "new.jpg");
  assert.equal(list[1], sibling);
});

test("remove clears only the cover field", () => {
  const current = room("room-a", "old.jpg");
  assert.deepEqual(withRoomCoverPhoto(current, null), { ...current, cover_photo_url: null });
});

test("room screen keeps camera and library cancellation and failure recoverable", () => {
  const source = readFileSync(resolve(process.cwd(), "app/(tabs)/room/[id].tsx"), "utf8");
  assert.match(source, /launchCameraAsync\(ROOM_COVER_PICKER_OPTIONS\)/);
  assert.match(source, /launchImageLibraryAsync\(ROOM_COVER_PICKER_OPTIONS\)/);
  assert.match(source, /if \(result\.canceled \|\| !result\.assets\[0\]\) return/);
  assert.match(source, /setLocalCoverUrl\(previousLocalCoverUrl\)/);
  assert.match(source, /requestMediaLibraryPermissionsAsync\(\)/);
  assert.match(source, /Linking\.openSettings\(\)/);
  assert.match(source, /Remove room cover\?/);
});
