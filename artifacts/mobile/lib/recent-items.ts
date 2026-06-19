const RECENT_ITEM_TTL_MS = 5500;
const recentItemExpiries = new Map<string, number>();

export function markRecentItem(itemId: string): void {
  recentItemExpiries.set(itemId, Date.now() + RECENT_ITEM_TTL_MS);
}

export function markRecentItems(itemIds: string[]): void {
  for (const itemId of itemIds) markRecentItem(itemId);
}

export function isRecentItem(itemId: string): boolean {
  const expiry = recentItemExpiries.get(itemId);
  if (!expiry) return false;
  if (expiry <= Date.now()) {
    recentItemExpiries.delete(itemId);
    return false;
  }
  return true;
}
