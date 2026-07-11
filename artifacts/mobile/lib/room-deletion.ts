export type RoomLinkedItem = {
  room_id: string | null;
};

export function withoutRoomItems<T extends RoomLinkedItem>(
  items: readonly T[] | undefined,
  roomId: string,
): T[] | undefined {
  return items?.filter((item) => item.room_id !== roomId);
}

export function subtractDeletedItems(
  currentCount: number | undefined,
  deletedCount: number,
): number | undefined {
  return currentCount === undefined
    ? undefined
    : Math.max(0, currentCount - deletedCount);
}
