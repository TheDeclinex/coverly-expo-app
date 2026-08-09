import assert from "node:assert/strict";
import test from "node:test";

import {
  dismissRecommendation,
  HIGH_VALUE_EVIDENCE_RECOMMENDATION,
  isRecommendationDismissed,
  recommendationDismissalKey,
} from "../recommendation-dismissal.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("recommendation dismissals are scoped to account, property, and recommendation", async () => {
  const storage = memoryStorage();
  await dismissRecommendation(storage, "user-a", "property-a", HIGH_VALUE_EVIDENCE_RECOMMENDATION);

  assert.equal(await isRecommendationDismissed(storage, "user-a", "property-a", HIGH_VALUE_EVIDENCE_RECOMMENDATION), true);
  assert.equal(await isRecommendationDismissed(storage, "user-a", "property-b", HIGH_VALUE_EVIDENCE_RECOMMENDATION), false);
  assert.equal(await isRecommendationDismissed(storage, "user-b", "property-a", HIGH_VALUE_EVIDENCE_RECOMMENDATION), false);
});

test("dismissal keys safely encode identifiers", () => {
  assert.equal(
    recommendationDismissalKey("user/a", "property:a", "evidence prompt"),
    "@coverly/recommendation-dismissal/v1:user%2Fa:property%3Aa:evidence%20prompt",
  );
});
