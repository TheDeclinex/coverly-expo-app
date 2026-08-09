import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATIC_REVIEW_TRIGGER,
  COVERLY_STORE_URLS,
  createReviewPromptManager,
  defaultReviewPromptState,
  reviewPromptStorageKey,
  type ReviewAnalyticsEvent,
  type ReviewPromptDependencies,
  type ReviewPromptStorage,
} from "../review-prompt-core.ts";

function memoryStorage(initial: Record<string, string> = {}): ReviewPromptStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
  };
}

function reviewHarness(options: {
  initial?: Record<string, string>;
  available?: boolean;
  requestFails?: boolean;
  openFails?: boolean;
} = {}) {
  const storage = memoryStorage(options.initial);
  const analytics: Array<{ name: ReviewAnalyticsEvent; properties: Record<string, boolean | number | string> }> = [];
  const openedUrls: string[] = [];
  let nativeRequests = 0;
  let time = 0;
  const dependencies: ReviewPromptDependencies = {
    storage,
    isNativeReviewAvailable: async () => options.available ?? true,
    requestNativeReview: async () => {
      nativeRequests += 1;
      if (options.requestFails) throw new Error("OS review request failed");
    },
    openUrl: async (url) => {
      if (options.openFails) throw new Error("No store handler");
      openedUrls.push(url);
    },
    trackEvent: async (name, properties) => {
      analytics.push({ name, properties });
    },
    now: () => `2026-08-09T00:00:${String(++time).padStart(2, "0")}.000Z`,
  };
  return {
    manager: createReviewPromptManager(dependencies),
    storage,
    analytics,
    openedUrls,
    get nativeRequests() {
      return nativeRequests;
    },
  };
}

const userId = "00000000-0000-4000-8000-000000000001";

test("scan 1 and scan 2 stay ineligible; scan 3 with a saved item becomes eligible", async () => {
  const harness = reviewHarness();

  const first = await harness.manager.recordSuccessfulScan({
    userId,
    scanId: "scan-1",
    scanCompletedWithoutError: true,
    savedItemCount: 2,
  });
  const second = await harness.manager.recordSuccessfulScan({
    userId,
    scanId: "scan-2",
    scanCompletedWithoutError: true,
    savedItemCount: 1,
  });
  const third = await harness.manager.recordSuccessfulScan({
    userId,
    scanId: "scan-3",
    scanCompletedWithoutError: true,
    savedItemCount: 1,
  });

  assert.equal(first.state.successfulAiScanCount, 1);
  assert.equal(first.eligible, false);
  assert.equal(second.state.successfulAiScanCount, 2);
  assert.equal(second.eligible, false);
  assert.equal(third.state.successfulAiScanCount, 3);
  assert.equal(third.eligible, true);
  assert.equal(third.becameEligible, true);
  assert.deepEqual(harness.analytics.map((event) => event.name), ["review_prompt_eligible"]);
});

test("failed scans and scans that save zero items do not increment", async () => {
  const harness = reviewHarness();
  const failed = await harness.manager.recordSuccessfulScan({
    userId,
    scanId: "failed-scan",
    scanCompletedWithoutError: false,
    savedItemCount: 3,
  });
  const empty = await harness.manager.recordSuccessfulScan({
    userId,
    scanId: "empty-scan",
    scanCompletedWithoutError: true,
    savedItemCount: 0,
  });

  assert.equal(failed.state.successfulAiScanCount, 0);
  assert.equal(failed.eligible, false);
  assert.equal(empty.state.successfulAiScanCount, 0);
  assert.equal(empty.eligible, false);
  assert.equal(harness.storage.values.has(reviewPromptStorageKey(userId)), false);
});

test("the same successful AI scan is counted once across save retries", async () => {
  const harness = reviewHarness();
  await harness.manager.recordSuccessfulScan({
    userId,
    scanId: "same-scan",
    scanCompletedWithoutError: true,
    savedItemCount: 1,
  });
  const retry = await harness.manager.recordSuccessfulScan({
    userId,
    scanId: "same-scan",
    scanCompletedWithoutError: true,
    savedItemCount: 2,
  });
  assert.equal(retry.incremented, false);
  assert.equal(retry.state.successfulAiScanCount, 1);
});

test("the native review request is attempted only once, including concurrent calls and OS failure", async () => {
  const state = {
    ...defaultReviewPromptState(),
    successfulAiScanCount: 3,
    eligibleAt: "2026-08-09T00:00:00.000Z",
    eligibleReason: AUTOMATIC_REVIEW_TRIGGER,
  };
  const harness = reviewHarness({
    initial: { [reviewPromptStorageKey(userId)]: JSON.stringify(state) },
    requestFails: true,
  });

  const results = await Promise.all([
    harness.manager.attemptAutomaticReview({ userId, positiveCompletionState: true }),
    harness.manager.attemptAutomaticReview({ userId, positiveCompletionState: true }),
  ]);
  const later = await harness.manager.attemptAutomaticReview({ userId, positiveCompletionState: true });

  assert.equal(harness.nativeRequests, 1);
  assert.deepEqual(results, ["request_failed", "already_attempted"]);
  assert.equal(later, "already_attempted");
  assert.deepEqual(harness.analytics.map((event) => event.name), ["review_prompt_requested"]);
});

test("an existing above-threshold user is not prompted on launch and becomes eligible at the next positive completion", async () => {
  const state = { ...defaultReviewPromptState(), successfulAiScanCount: 5 };
  const harness = reviewHarness({
    initial: { [reviewPromptStorageKey(userId)]: JSON.stringify(state) },
  });

  const launch = await harness.manager.attemptAutomaticReview({
    userId,
    positiveCompletionState: false,
  });
  assert.equal(launch, "deferred");
  assert.equal(harness.nativeRequests, 0);

  const completion = await harness.manager.recordSuccessfulScan({
    userId,
    scanId: "next-positive-scan",
    scanCompletedWithoutError: true,
    savedItemCount: 1,
  });
  assert.equal(completion.state.successfulAiScanCount, 6);
  assert.equal(completion.eligible, true);

  await harness.manager.attemptAutomaticReview({ userId, positiveCompletionState: true });
  assert.equal(harness.nativeRequests, 1);
});

test("Rate Coverly opens the exact platform store URLs and logs successful opens", async () => {
  const harness = reviewHarness();
  assert.equal(await harness.manager.openStoreLink("ios"), true);
  assert.equal(await harness.manager.openStoreLink("android"), true);
  assert.deepEqual(harness.openedUrls, [COVERLY_STORE_URLS.ios, COVERLY_STORE_URLS.android]);
  assert.deepEqual(
    harness.analytics.filter((event) => event.name === "review_store_link_opened").map((event) => event.properties.store_platform),
    ["ios", "android"],
  );
});

test("store URL failure is handled without throwing or emitting an opened event", async () => {
  const harness = reviewHarness({ openFails: true });
  await assert.doesNotReject(async () => {
    assert.equal(await harness.manager.openStoreLink("ios"), false);
  });
  assert.equal(harness.analytics.length, 0);
});
