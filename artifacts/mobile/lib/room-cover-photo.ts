import type { InventoryRoom } from "@/types";

export type RoomCoverAction = "camera" | "library" | "remove" | "cancel";

export function roomCoverActions(hasCover: boolean): RoomCoverAction[] {
  return hasCover
    ? ["camera", "library", "remove", "cancel"]
    : ["camera", "library", "cancel"];
}

export function withRoomCoverPhoto(
  room: InventoryRoom | undefined,
  coverPhotoUrl: string | null,
): InventoryRoom | undefined {
  return room ? { ...room, cover_photo_url: coverPhotoUrl } : room;
}

export function withRoomListCoverPhoto(
  rooms: InventoryRoom[] | undefined,
  roomId: string,
  coverPhotoUrl: string | null,
): InventoryRoom[] | undefined {
  return rooms?.map((room) => room.id === roomId
    ? { ...room, cover_photo_url: coverPhotoUrl }
    : room);
}
