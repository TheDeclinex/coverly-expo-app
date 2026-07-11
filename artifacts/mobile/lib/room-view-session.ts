export type RoomViewModeState = "detailed" | "compact";

export interface RoomViewSession {
  offset: number;
  anchorItemId: string | null;
  viewMode: RoomViewModeState;
  searchText: string;
  categoryFilter: string;
  readinessFilter: string;
  sortOption: string;
}

const sessions = new Map<string, RoomViewSession>();

export function getRoomViewSession(roomId: string): RoomViewSession | null {
  const session = sessions.get(roomId);
  return session ? { ...session } : null;
}

export function clearRoomViewSession(roomId: string): void {
  sessions.delete(roomId);
}

export function updateRoomViewSession(roomId: string, patch: Partial<RoomViewSession>): RoomViewSession {
  const current = sessions.get(roomId) ?? {
    offset: 0,
    anchorItemId: null,
    viewMode: "detailed" as const,
    searchText: "",
    categoryFilter: "all",
    readinessFilter: "all",
    sortOption: "recent",
  };
  const next = { ...current, ...patch, offset: Math.max(0, patch.offset ?? current.offset) };
  sessions.set(roomId, next);
  return { ...next };
}

export function resolveRoomRestoreIndex(session: RoomViewSession | null, visibleItemIds: string[]): number | null {
  if (!session?.anchorItemId) return null;
  const index = visibleItemIds.indexOf(session.anchorItemId);
  return index >= 0 ? index : null;
}
