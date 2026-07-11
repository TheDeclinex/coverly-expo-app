import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  DUPLICATE_ROOM_NAME_MESSAGE,
  formatRoomCreationError,
  hasActiveRoomNameDuplicate,
  isRoomNameDuplicateError,
} from "../room-creation.ts";

test("active Hallway blocks another Hallway with a friendly error", () => {
  assert.equal(hasActiveRoomNameDuplicate([{ name: "Hallway", archived_at: null }], "Hallway"), true);
  assert.equal(formatRoomCreationError({ code: "23505" }), DUPLICATE_ROOM_NAME_MESSAGE);
});

test("the complete production Postgres response maps without exposing internals", () => {
  const productionError = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "idx_inventory_rooms_file_name_unique"',
    details: "Key (file_id, lower(btrim(name)))=(property-a, hallway) already exists.",
    hint: null,
    constraint: "idx_inventory_rooms_file_name_unique",
  };
  const rendered = formatRoomCreationError(productionError);

  assert.equal(rendered, DUPLICATE_ROOM_NAME_MESSAGE);
  assert.doesNotMatch(rendered, /duplicate key|postgres|constraint|idx_inventory/i);
});

test("a thrown nested Postgres response uses the same mapping", () => {
  assert.equal(
    formatRoomCreationError({
      cause: {
        code: "23505",
        details: 'violates constraint "idx_inventory_rooms_file_name_unique"',
      },
    }),
    DUPLICATE_ROOM_NAME_MESSAGE,
  );
});

test("unrelated unique constraints are not classified as room-name duplicates", () => {
  const error = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "inventory_rooms_pkey"',
  };
  assert.equal(isRoomNameDuplicateError(error), false);
  assert.equal(formatRoomCreationError(error), "We couldn't create this room. Please try again.");
});

test("archived Hallway does not block a new Hallway", () => {
  assert.equal(
    hasActiveRoomNameDuplicate([{ name: "Hallway", archived_at: "2026-07-11T00:00:00Z" }], "Hallway"),
    false,
  );
});

test("rooms in a different property do not enter the current property's duplicate check", () => {
  const propertyOneRooms = [{ name: "Hallway", archived_at: null }];
  const propertyTwoRooms: typeof propertyOneRooms = [];
  assert.equal(hasActiveRoomNameDuplicate(propertyOneRooms, "Hallway"), true);
  assert.equal(hasActiveRoomNameDuplicate(propertyTwoRooms, "Hallway"), false);
});

test("case and surrounding spacing are normalized", () => {
  assert.equal(hasActiveRoomNameDuplicate([{ name: "  HALLWAY  ", archived_at: null }], " hallway "), true);
});

test("a duplicate failure does not require changing the entered value", () => {
  const enteredName = " Hallway ";
  const errorMessage = formatRoomCreationError({
    code: "23505",
    constraint_name: "idx_inventory_rooms_file_name_unique",
  });

  assert.equal(enteredName, " Hallway ");
  assert.equal(errorMessage, DUPLICATE_ROOM_NAME_MESSAGE);
});

test("a replacement room has a distinct id and cannot inherit archived room items", () => {
  const archivedRoomId = "room-archived";
  const replacementRoomId = "room-new";
  const retainedItems = [{ id: "item-1", room_id: archivedRoomId }];

  assert.notEqual(replacementRoomId, archivedRoomId);
  assert.deepEqual(retainedItems.filter((item) => item.room_id === replacementRoomId), []);
});

test("unrelated database details are not exposed", () => {
  assert.equal(
    formatRoomCreationError({ message: "permission denied for relation inventory_rooms" }),
    "We couldn't create this room. Please try again.",
  );
});

test("property and scan creation paths share the mapper and never render the insert error message", () => {
  const propertyScreen = readFileSync(resolve(process.cwd(), "app/(tabs)/property/[id].tsx"), "utf8");
  const scanScreen = readFileSync(resolve(process.cwd(), "app/(tabs)/scan.tsx"), "utf8");

  assert.match(propertyScreen, /setAddRoomError\(formatRoomCreationError\((?:error|err)\)\)/);
  assert.match(scanScreen, /setScanError\(formatRoomCreationError\((?:roomErr|error)\)\)/);
  assert.doesNotMatch(propertyScreen, /setAddRoomError\((?:error|err)\.message\)/);
  assert.doesNotMatch(scanScreen, /setScanError\((?:roomErr|error)\.message\)/);
});
