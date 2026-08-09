export const HIGH_VALUE_EVIDENCE_RECOMMENDATION = "high-value-evidence";

interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function recommendationDismissalKey(
  userId: string,
  propertyId: string,
  recommendationId: string,
): string {
  return [
    "@coverly/recommendation-dismissal/v1",
    encodeURIComponent(userId),
    encodeURIComponent(propertyId),
    encodeURIComponent(recommendationId),
  ].join(":");
}

export async function isRecommendationDismissed(
  storage: KeyValueStorage,
  userId: string,
  propertyId: string,
  recommendationId: string,
): Promise<boolean> {
  return await storage.getItem(recommendationDismissalKey(userId, propertyId, recommendationId)) === "dismissed";
}

export async function dismissRecommendation(
  storage: KeyValueStorage,
  userId: string,
  propertyId: string,
  recommendationId: string,
): Promise<void> {
  await storage.setItem(recommendationDismissalKey(userId, propertyId, recommendationId), "dismissed");
}
