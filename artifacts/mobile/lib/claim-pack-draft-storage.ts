import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ClaimPackScope } from "@/lib/claim-pack-selection-model";

export interface StoredClaimPackDraft {
  id: string;
  fileId: string;
  propertyName: string;
  insurerName: string;
  policyNumber: string;
  claimNumber: string;
  claimNote: string;
  selectedRoomIds: string[];
  selectedItemIds: string[];
  scope: ClaimPackScope;
  createdAt: string;
  updatedAt: string;
}

const storageKey = (userId: string) => `coverly:claim-pack-drafts:${userId}`;

function normaliseDraft(value: unknown): StoredClaimPackDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<StoredClaimPackDraft>;
  if (!row.id || !row.fileId) return null;
  return {
    id: row.id,
    fileId: row.fileId,
    propertyName: row.propertyName ?? "Claim pack draft",
    insurerName: row.insurerName ?? "",
    policyNumber: row.policyNumber ?? "",
    claimNumber: row.claimNumber ?? "",
    claimNote: row.claimNote ?? "",
    selectedRoomIds: Array.isArray(row.selectedRoomIds) ? row.selectedRoomIds.filter((id): id is string => typeof id === "string") : [],
    selectedItemIds: Array.isArray(row.selectedItemIds) ? row.selectedItemIds.filter((id): id is string => typeof id === "string") : [],
    scope: row.scope === "whole_property" ? "whole_property" : "selected_rooms",
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? row.createdAt ?? new Date().toISOString(),
  };
}

export async function listClaimPackDrafts(userId: string): Promise<StoredClaimPackDraft[]> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normaliseDraft)
      .filter((draft): draft is StoredClaimPackDraft => draft !== null)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  } catch {
    return [];
  }
}

export async function getClaimPackDraft(userId: string, draftId: string): Promise<StoredClaimPackDraft | null> {
  const drafts = await listClaimPackDrafts(userId);
  return drafts.find((draft) => draft.id === draftId) ?? null;
}

export async function saveClaimPackDraft(userId: string, draft: StoredClaimPackDraft): Promise<void> {
  const drafts = await listClaimPackDrafts(userId);
  const existing = drafts.find((current) => current.id === draft.id);
  const nextDraft = {
    ...draft,
    createdAt: existing?.createdAt ?? draft.createdAt,
  };
  const next = [nextDraft, ...drafts.filter((current) => current.id !== draft.id)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 20);
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
}
