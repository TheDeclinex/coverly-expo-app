export interface ClaimPackRoomLike {
  id: string;
  name: string;
}

export interface ClaimPackItemLike {
  id: string;
  room_id: string | null;
  estimated_price: number | null;
  unit_estimated_price?: number | null;
  quantity?: number | null;
  image_url?: string | null;
  photo_url?: string | null;
  attachments?: { url?: string | null }[] | null;
}

export interface ClaimPackSelection {
  selectedRoomIds: Set<string>;
  selectedItemIds: Set<string>;
}

export type ClaimPackScope = "whole_property" | "selected_rooms";

export interface ClaimPackSummary {
  selectedRoomsCount: number;
  selectedItemsCount: number;
  includedEvidenceCount: number;
  selectedEstimatedValue: number;
  missingValueCount: number;
  missingPhotoCount: number;
  missingEvidenceCount: number;
}

export interface ClaimPackGenerateDraftPayload {
  propertyId: string;
  selectedRoomIds: string[];
  selectedItemIds: string[];
  scope: ClaimPackScope;
  clientDraftId: string;
  claimNote: string | null;
}

export interface ClaimPackDraftSnapshot {
  selection: ClaimPackSelection;
  scope: ClaimPackScope;
  claimNote: string;
  managedRoomId: string | null;
}

const draftSnapshots = new Map<string, ClaimPackDraftSnapshot>();

function cloneSelection(selection: ClaimPackSelection): ClaimPackSelection {
  return {
    selectedRoomIds: new Set(selection.selectedRoomIds),
    selectedItemIds: new Set(selection.selectedItemIds),
  };
}

export function saveClaimPackDraftSnapshot(
  clientDraftId: string,
  snapshot: ClaimPackDraftSnapshot,
): void {
  draftSnapshots.set(clientDraftId, {
    ...snapshot,
    selection: cloneSelection(snapshot.selection),
  });
}

export function loadClaimPackDraftSnapshot(
  clientDraftId: string | null | undefined,
): ClaimPackDraftSnapshot | null {
  if (!clientDraftId) return null;
  const snapshot = draftSnapshots.get(clientDraftId);
  if (!snapshot) return null;
  return {
    ...snapshot,
    selection: cloneSelection(snapshot.selection),
  };
}

export function createClaimPackClientDraftId(
  now = Date.now(),
  random = Math.random(),
): string {
  const randomPart = Math.floor(random * 1_000_000_000)
    .toString(36)
    .padStart(6, "0");
  return `cpd_${now}_${randomPart}`;
}

export function itemClaimPackValue(item: ClaimPackItemLike): number {
  const unitValue = item.unit_estimated_price ?? item.estimated_price ?? 0;
  const quantity = item.quantity ?? 1;
  return unitValue * quantity;
}

export function itemHasClaimPackValue(item: ClaimPackItemLike): boolean {
  return item.unit_estimated_price != null || item.estimated_price != null;
}

export function itemHasClaimPackPhoto(item: ClaimPackItemLike): boolean {
  if (item.image_url || item.photo_url) return true;
  return Array.isArray(item.attachments)
    ? item.attachments.some((photo) => Boolean(photo?.url))
    : false;
}

export function createInitialClaimPackSelection(
  rooms: ClaimPackRoomLike[],
  items: ClaimPackItemLike[],
): ClaimPackSelection {
  return createWholePropertyClaimPackSelection(rooms, items);
}

export function createWholePropertyClaimPackSelection(
  rooms: ClaimPackRoomLike[],
  items: ClaimPackItemLike[],
): ClaimPackSelection {
  return {
    selectedRoomIds: new Set(rooms.map((room) => room.id)),
    selectedItemIds: new Set(items.map((item) => item.id)),
  };
}

export function createRoomsOnlyClaimPackSelection(roomIds: string[]): ClaimPackSelection {
  return {
    selectedRoomIds: new Set(roomIds),
    selectedItemIds: new Set(),
  };
}

export function addClaimPackRoom(
  selection: ClaimPackSelection,
  roomId: string,
): ClaimPackSelection {
  const selectedRoomIds = new Set(selection.selectedRoomIds);
  selectedRoomIds.add(roomId);
  return { selectedRoomIds, selectedItemIds: new Set(selection.selectedItemIds) };
}

export function removeClaimPackRoom(
  selection: ClaimPackSelection,
  roomId: string,
  items: ClaimPackItemLike[],
): ClaimPackSelection {
  const selectedRoomIds = new Set(selection.selectedRoomIds);
  const selectedItemIds = new Set(selection.selectedItemIds);
  selectedRoomIds.delete(roomId);
  for (const item of items) {
    if (item.room_id === roomId) selectedItemIds.delete(item.id);
  }
  return { selectedRoomIds, selectedItemIds };
}

export function selectAllClaimPackItemsInRoom(
  selection: ClaimPackSelection,
  roomId: string,
  items: ClaimPackItemLike[],
): ClaimPackSelection {
  const selectedRoomIds = new Set(selection.selectedRoomIds);
  const selectedItemIds = new Set(selection.selectedItemIds);
  selectedRoomIds.add(roomId);
  for (const item of items) {
    if (item.room_id === roomId) selectedItemIds.add(item.id);
  }
  return { selectedRoomIds, selectedItemIds };
}

export function clearClaimPackItemsInRoom(
  selection: ClaimPackSelection,
  roomId: string,
  items: ClaimPackItemLike[],
): ClaimPackSelection {
  const selectedRoomIds = new Set(selection.selectedRoomIds);
  const selectedItemIds = new Set(selection.selectedItemIds);
  for (const item of items) {
    if (item.room_id === roomId) selectedItemIds.delete(item.id);
  }
  selectedRoomIds.add(roomId);
  return { selectedRoomIds, selectedItemIds };
}

export function toggleClaimPackRoom(
  selection: ClaimPackSelection,
  roomId: string,
  items: ClaimPackItemLike[],
): ClaimPackSelection {
  const selectedRoomIds = new Set(selection.selectedRoomIds);
  const selectedItemIds = new Set(selection.selectedItemIds);
  const roomItemIds = items.filter((item) => item.room_id === roomId).map((item) => item.id);

  if (selectedRoomIds.has(roomId)) {
    selectedRoomIds.delete(roomId);
    for (const itemId of roomItemIds) selectedItemIds.delete(itemId);
  } else {
    selectedRoomIds.add(roomId);
    for (const itemId of roomItemIds) selectedItemIds.add(itemId);
  }

  return { selectedRoomIds, selectedItemIds };
}

export function toggleClaimPackItem(
  selection: ClaimPackSelection,
  item: ClaimPackItemLike,
  items: ClaimPackItemLike[],
): ClaimPackSelection {
  const selectedRoomIds = new Set(selection.selectedRoomIds);
  const selectedItemIds = new Set(selection.selectedItemIds);

  if (selectedItemIds.has(item.id)) {
    selectedItemIds.delete(item.id);
  } else {
    selectedItemIds.add(item.id);
    if (item.room_id) selectedRoomIds.add(item.room_id);
  }

  if (item.room_id) {
    const anySelectedInRoom = items.some(
      (candidate) => candidate.room_id === item.room_id && selectedItemIds.has(candidate.id),
    );
    if (!anySelectedInRoom) selectedRoomIds.delete(item.room_id);
  }

  return { selectedRoomIds, selectedItemIds };
}

export function selectClaimPackItem(
  selection: ClaimPackSelection,
  item: ClaimPackItemLike,
): ClaimPackSelection {
  const selectedRoomIds = new Set(selection.selectedRoomIds);
  const selectedItemIds = new Set(selection.selectedItemIds);
  selectedItemIds.add(item.id);
  if (item.room_id) selectedRoomIds.add(item.room_id);
  return { selectedRoomIds, selectedItemIds };
}

export function buildClaimPackGeneratePayload({
  propertyId,
  selection,
  scope,
  clientDraftId,
  claimNote,
}: {
  propertyId: string;
  selection: ClaimPackSelection;
  scope: ClaimPackScope;
  clientDraftId: string;
  claimNote?: string | null;
}): ClaimPackGenerateDraftPayload {
  const trimmedNote = claimNote?.trim() ?? "";
  return {
    propertyId,
    selectedRoomIds: [...selection.selectedRoomIds].sort(),
    selectedItemIds: [...selection.selectedItemIds].sort(),
    scope,
    clientDraftId,
    claimNote: trimmedNote.length > 0 ? trimmedNote : null,
  };
}

export function calculateClaimPackSummary({
  rooms,
  items,
  evidenceCountsByItemId,
  selection,
}: {
  rooms: ClaimPackRoomLike[];
  items: ClaimPackItemLike[];
  evidenceCountsByItemId: Record<string, number>;
  selection: ClaimPackSelection;
}): ClaimPackSummary {
  const selectedItems = items.filter((item) => selection.selectedItemIds.has(item.id));
  const selectedRoomIds = new Set(selection.selectedRoomIds);

  for (const item of selectedItems) {
    if (item.room_id) selectedRoomIds.add(item.room_id);
  }

  return selectedItems.reduce<ClaimPackSummary>(
    (summary, item) => {
      const evidenceCount = evidenceCountsByItemId[item.id] ?? 0;
      return {
        ...summary,
        selectedItemsCount: summary.selectedItemsCount + 1,
        includedEvidenceCount: summary.includedEvidenceCount + evidenceCount,
        selectedEstimatedValue: summary.selectedEstimatedValue + itemClaimPackValue(item),
        missingValueCount: summary.missingValueCount + (itemHasClaimPackValue(item) ? 0 : 1),
        missingPhotoCount: summary.missingPhotoCount + (itemHasClaimPackPhoto(item) ? 0 : 1),
        missingEvidenceCount: summary.missingEvidenceCount + (evidenceCount > 0 ? 0 : 1),
      };
    },
    {
      selectedRoomsCount: rooms.filter((room) => selectedRoomIds.has(room.id)).length,
      selectedItemsCount: 0,
      includedEvidenceCount: 0,
      selectedEstimatedValue: 0,
      missingValueCount: 0,
      missingPhotoCount: 0,
      missingEvidenceCount: 0,
    },
  );
}
