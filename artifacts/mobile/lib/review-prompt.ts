import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import { Linking, Platform } from "react-native";

import { trackEvent } from "@/lib/analytics";
import {
  AUTOMATIC_REVIEW_TRIGGER,
  createReviewPromptManager,
  type SuccessfulScanInput,
} from "@/lib/review-prompt-core";

const reviewPromptManager = createReviewPromptManager({
  storage: AsyncStorage,
  isNativeReviewAvailable: StoreReview.isAvailableAsync,
  requestNativeReview: StoreReview.requestReview,
  openUrl: Linking.openURL,
  trackEvent,
});

export { AUTOMATIC_REVIEW_TRIGGER };

export function recordSuccessfulAiScan(input: SuccessfulScanInput) {
  return reviewPromptManager.recordSuccessfulScan(input);
}

export function attemptAutomaticReviewPrompt(userId: string) {
  return reviewPromptManager.attemptAutomaticReview({
    userId,
    positiveCompletionState: true,
  });
}

export function openCoverlyStoreReview() {
  return reviewPromptManager.openStoreLink(Platform.OS);
}
