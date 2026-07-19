import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { InventoryRoom } from "../../types/index.ts";

import {
  createDeferredRoomCoverPickerController,
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

test("camera and library actions launch only after dismissal execution", async () => {
  for (const action of ["camera", "library"] as const) {
    const controller = createDeferredRoomCoverPickerController();
    const launched: string[] = [];
    assert.equal(controller.queue(action), true);
    assert.deepEqual(launched, []);
    assert.equal(controller.hasPending(), true);

    assert.equal(await controller.executePending(async (pending) => {
      launched.push(pending);
    }), true);
    assert.deepEqual(launched, [action]);
    assert.equal(controller.hasPending(), false);
    assert.equal(controller.isLaunchInFlight(), false);
  }
});

test("cancel clears the pending action and reopening can queue again", async () => {
  const controller = createDeferredRoomCoverPickerController();
  const launched: string[] = [];
  assert.equal(controller.queue("camera"), true);
  controller.cancelPending();
  assert.equal(await controller.executePending(async (action) => {
    launched.push(action);
  }), false);
  assert.deepEqual(launched, []);
  assert.equal(controller.queue("library"), true);
  assert.equal(controller.hasPending(), true);
});

test("single-flight guard clears after picker cancellation and errors", async () => {
  const controller = createDeferredRoomCoverPickerController();
  assert.equal(controller.queue("camera"), true);
  assert.equal(await controller.executePending(async () => {
    // A canceled picker resolves without a selected asset.
  }), true);
  assert.equal(controller.isLaunchInFlight(), false);
  assert.equal(controller.queue("library"), true);

  await assert.rejects(
    controller.executePending(async () => {
      throw new Error("picker failed");
    }),
    /picker failed/,
  );
  assert.equal(controller.hasPending(), false);
  assert.equal(controller.isLaunchInFlight(), false);
  assert.equal(controller.queue("camera"), true);
});

test("single-flight guard prevents an exactly-once launch from being queued twice", async () => {
  const controller = createDeferredRoomCoverPickerController();
  let releaseLaunch!: () => void;
  const launchBlocked = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });
  const launched: string[] = [];

  assert.equal(controller.queue("camera"), true);
  assert.equal(controller.queue("library"), false);
  const execution = controller.executePending(async (action) => {
    launched.push(action);
    await launchBlocked;
  });
  assert.equal(controller.isLaunchInFlight(), true);
  assert.equal(controller.queue("library"), false);
  assert.equal(await controller.executePending(async () => undefined), false);

  releaseLaunch();
  assert.equal(await execution, true);
  assert.deepEqual(launched, ["camera"]);
  assert.equal(controller.isLaunchInFlight(), false);
  assert.equal(controller.queue("library"), true);
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
  assert.match(source, /if \(result\.canceled \|\| !result\.assets\[0\]\) \{/);
  assert.match(source, /setLocalCoverUrl\(previousLocalCoverUrl\)/);
  assert.match(source, /requestMediaLibraryPermissionsAsync\(\)/);
  assert.match(source, /Linking\.openSettings\(\)/);
  assert.match(source, /Remove room cover\?/);
  assert.match(source, /ActionSheetIOS\.showActionSheetWithOptions\(/);
  assert.match(source, /handleRoomCoverAction\(action, true\)/);
  assert.doesNotMatch(source, /onDismiss=\{flushPendingRoomCoverPicker\}/);
  assert.match(source, /native selector callback fired after dismissal/);
  assert.match(source, /roomCoverPickerController\.queue\(action\)/);
});
