const pendingRoomBatches = new Map<string, Set<string>>();

/** Stage exactly one newly scanned batch for the next Room screen focus. */
export function stageRecentItemBatch(roomId: string, itemIds: string[]): void {
  pendingRoomBatches.set(roomId, new Set(itemIds.filter(Boolean)));
}

/** Consume a staged batch once so refreshes cannot recreate New badges. */
export function takeRecentItemBatch(roomId: string): Set<string> | null {
  const batch = pendingRoomBatches.get(roomId);
  if (!batch) return null;
  pendingRoomBatches.delete(roomId);
  return new Set(batch);
}

export function withoutRecentItem(itemIds: ReadonlySet<string>, itemId: string): Set<string> {
  const next = new Set(itemIds);
  next.delete(itemId);
  return next;
}
