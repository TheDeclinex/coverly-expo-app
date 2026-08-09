export const AUTOMATIC_REVIEW_SCAN_THRESHOLD = 3;
export const AUTOMATIC_REVIEW_TRIGGER = "third_successful_ai_scan" as const;
export const REVIEW_PROMPT_STORAGE_PREFIX = "coverly:review-prompt:v1";

export const COVERLY_STORE_URLS = {
  ios: "https://apps.apple.com/nz/app/coverly/id6784164282",
  android: "https://play.google.com/store/apps/details?id=nz.coverly.app",
} as const;

export type ReviewPlatform = keyof typeof COVERLY_STORE_URLS;
export type ReviewAnalyticsEvent =
  | "review_prompt_eligible"
  | "review_prompt_requested"
  | "review_store_link_opened";

export interface ReviewPromptState {
  version: 1;
  successfulAiScanCount: number;
  eligibleAt: string | null;
  eligibleReason: typeof AUTOMATIC_REVIEW_TRIGGER | null;
  automaticRequestAttemptedAt: string | null;
  automaticRequestReason: typeof AUTOMATIC_REVIEW_TRIGGER | null;
  lastSuccessfulScanAt: string | null;
  lastSuccessfulScanId: string | null;
}

export interface ReviewPromptStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface ReviewPromptDependencies {
  storage: ReviewPromptStorage;
  isNativeReviewAvailable(): Promise<boolean>;
  requestNativeReview(): Promise<void>;
  openUrl(url: string): Promise<unknown>;
  trackEvent(
    eventName: ReviewAnalyticsEvent,
    properties: Record<string, boolean | number | string>,
  ): Promise<void> | void;
  now?: () => string;
}

export interface SuccessfulScanInput {
  userId: string;
  scanId: string;
  scanCompletedWithoutError: boolean;
  savedItemCount: number;
}

export interface SuccessfulScanResult {
  state: ReviewPromptState;
  incremented: boolean;
  eligible: boolean;
  becameEligible: boolean;
}

export type AutomaticReviewAttemptResult =
  | "requested"
  | "request_failed"
  | "already_attempted"
  | "not_eligible"
  | "not_available"
  | "deferred";

export function reviewPromptStorageKey(userId: string): string {
  return `${REVIEW_PROMPT_STORAGE_PREFIX}:${userId}`;
}

export function defaultReviewPromptState(): ReviewPromptState {
  return {
    version: 1,
    successfulAiScanCount: 0,
    eligibleAt: null,
    eligibleReason: null,
    automaticRequestAttemptedAt: null,
    automaticRequestReason: null,
    lastSuccessfulScanAt: null,
    lastSuccessfulScanId: null,
  };
}

export function parseReviewPromptState(raw: string | null): ReviewPromptState {
  if (!raw) return defaultReviewPromptState();
  try {
    const parsed = JSON.parse(raw) as Partial<ReviewPromptState>;
    const count = Number(parsed.successfulAiScanCount);
    return {
      version: 1,
      successfulAiScanCount: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0,
      eligibleAt: typeof parsed.eligibleAt === "string" ? parsed.eligibleAt : null,
      eligibleReason: parsed.eligibleReason === AUTOMATIC_REVIEW_TRIGGER
        ? AUTOMATIC_REVIEW_TRIGGER
        : null,
      automaticRequestAttemptedAt: typeof parsed.automaticRequestAttemptedAt === "string"
        ? parsed.automaticRequestAttemptedAt
        : null,
      automaticRequestReason: parsed.automaticRequestReason === AUTOMATIC_REVIEW_TRIGGER
        ? AUTOMATIC_REVIEW_TRIGGER
        : null,
      lastSuccessfulScanAt: typeof parsed.lastSuccessfulScanAt === "string"
        ? parsed.lastSuccessfulScanAt
        : null,
      lastSuccessfulScanId: typeof parsed.lastSuccessfulScanId === "string"
        ? parsed.lastSuccessfulScanId
        : null,
    };
  } catch {
    return defaultReviewPromptState();
  }
}

export function successfulScanTransition(
  current: ReviewPromptState,
  input: Omit<SuccessfulScanInput, "userId">,
  now: string,
): SuccessfulScanResult {
  if (
    !input.scanCompletedWithoutError
    || input.savedItemCount < 1
    || !input.scanId
  ) {
    return {
      state: current,
      incremented: false,
      eligible: false,
      becameEligible: false,
    };
  }

  if (current.lastSuccessfulScanId === input.scanId) {
    return {
      state: current,
      incremented: false,
      eligible: current.successfulAiScanCount >= AUTOMATIC_REVIEW_SCAN_THRESHOLD
        && current.automaticRequestAttemptedAt === null,
      becameEligible: false,
    };
  }

  const successfulAiScanCount = current.successfulAiScanCount + 1;
  const eligible = successfulAiScanCount >= AUTOMATIC_REVIEW_SCAN_THRESHOLD
    && current.automaticRequestAttemptedAt === null;
  const becameEligible = eligible && current.eligibleAt === null;
  const state: ReviewPromptState = {
    ...current,
    successfulAiScanCount,
    eligibleAt: becameEligible ? now : current.eligibleAt,
    eligibleReason: becameEligible ? AUTOMATIC_REVIEW_TRIGGER : current.eligibleReason,
    lastSuccessfulScanAt: now,
    lastSuccessfulScanId: input.scanId,
  };

  return { state, incremented: true, eligible, becameEligible };
}

export function coverlyStoreUrl(platform: string): string | null {
  if (platform === "ios" || platform === "android") return COVERLY_STORE_URLS[platform];
  return null;
}

export function createReviewPromptManager(dependencies: ReviewPromptDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const operationQueues = new Map<string, Promise<void>>();

  const serialized = async <Result>(userId: string, operation: () => Promise<Result>): Promise<Result> => {
    const previous = operationQueues.get(userId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    operationQueues.set(userId, result.then(() => undefined, () => undefined));
    return result;
  };

  const readState = async (userId: string): Promise<ReviewPromptState> =>
    parseReviewPromptState(await dependencies.storage.getItem(reviewPromptStorageKey(userId)));

  const writeState = async (userId: string, state: ReviewPromptState): Promise<void> => {
    await dependencies.storage.setItem(reviewPromptStorageKey(userId), JSON.stringify(state));
  };

  const recordSuccessfulScan = async (input: SuccessfulScanInput): Promise<SuccessfulScanResult> =>
    serialized(input.userId, async () => {
      const current = await readState(input.userId);
      const result = successfulScanTransition(current, input, now());
      if (result.incremented) await writeState(input.userId, result.state);
      if (result.becameEligible) {
        void dependencies.trackEvent("review_prompt_eligible", {
          trigger: AUTOMATIC_REVIEW_TRIGGER,
          successful_scan_count: result.state.successfulAiScanCount,
        });
      }
      return result;
    });

  const attemptAutomaticReview = async (input: {
    userId: string;
    positiveCompletionState: boolean;
  }): Promise<AutomaticReviewAttemptResult> => {
    if (!input.positiveCompletionState) return "deferred";

    return serialized(input.userId, async () => {
      const current = await readState(input.userId);
      if (current.automaticRequestAttemptedAt) return "already_attempted";
      if (current.successfulAiScanCount < AUTOMATIC_REVIEW_SCAN_THRESHOLD) return "not_eligible";

      let available = false;
      try {
        available = await dependencies.isNativeReviewAvailable();
      } catch {
        return "not_available";
      }
      if (!available) return "not_available";

      const attempted: ReviewPromptState = {
        ...current,
        automaticRequestAttemptedAt: now(),
        automaticRequestReason: AUTOMATIC_REVIEW_TRIGGER,
      };
      // Persist before invoking the OS so re-renders or app lifecycle changes cannot double-request.
      await writeState(input.userId, attempted);
      void dependencies.trackEvent("review_prompt_requested", {
        trigger: AUTOMATIC_REVIEW_TRIGGER,
        successful_scan_count: attempted.successfulAiScanCount,
      });

      try {
        await dependencies.requestNativeReview();
        return "requested";
      } catch {
        // The OS request was still attempted. Do not retry on later scans.
        return "request_failed";
      }
    });
  };

  const openStoreLink = async (platform: string): Promise<boolean> => {
    const url = coverlyStoreUrl(platform);
    if (!url) return false;
    try {
      await dependencies.openUrl(url);
      void dependencies.trackEvent("review_store_link_opened", {
        source_screen: "account",
        store_platform: platform,
      });
      return true;
    } catch {
      return false;
    }
  };

  return { readState, recordSuccessfulScan, attemptAutomaticReview, openStoreLink };
}
