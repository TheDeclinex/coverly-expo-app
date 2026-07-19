import type { InventoryRoom } from "@/types";

export type RoomCoverAction = "camera" | "library" | "remove" | "cancel";
export type RoomCoverPickerAction = Extract<RoomCoverAction, "camera" | "library">;

export interface DeferredRoomCoverPickerController {
  queue(action: RoomCoverPickerAction): boolean;
  cancelPending(): void;
  hasPending(): boolean;
  isLaunchInFlight(): boolean;
  executePending(
    launch: (action: RoomCoverPickerAction) => Promise<void>,
  ): Promise<boolean>;
}

/**
 * Keeps a requested native picker action alive while the React Native modal
 * dismisses. The single-flight guard is always released, including picker
 * cancellation and thrown errors.
 */
export function createDeferredRoomCoverPickerController(): DeferredRoomCoverPickerController {
  let pendingAction: RoomCoverPickerAction | null = null;
  let launchInFlight = false;

  return {
    queue(action) {
      if (pendingAction || launchInFlight) return false;
      pendingAction = action;
      return true;
    },
    cancelPending() {
      pendingAction = null;
    },
    hasPending() {
      return pendingAction !== null;
    },
    isLaunchInFlight() {
      return launchInFlight;
    },
    async executePending(launch) {
      if (!pendingAction || launchInFlight) return false;
      const action = pendingAction;
      pendingAction = null;
      launchInFlight = true;
      try {
        await launch(action);
      } finally {
        launchInFlight = false;
      }
      return true;
    },
  };
}

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
