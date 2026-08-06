import assert from "node:assert/strict";
import test from "node:test";

import {
  LAST_ACTIVE_THROTTLE_MS,
  analyticsScanMode,
  categorizeAnalyticsFailure,
  createAnalyticsClient,
  sanitizeEventProperties,
  type AnalyticsClientDependencies,
  type AnalyticsEventInsert,
  type AnalyticsStorage,
} from "../analytics-core.ts";

function memoryStorage(): AnalyticsStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
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

function analyticsHarness(
  overrides: Partial<AnalyticsClientDependencies> = {},
) {
  const storage = memoryStorage();
  const inserts: AnalyticsEventInsert[] = [];
  let touches = 0;
  let uuidSequence = 0;
  let currentTime = 1_000_000;
  const dependencies: AnalyticsClientDependencies = {
    storage,
    getUserId: async () => "00000000-0000-4000-8000-000000000001",
    insertEvent: async (event) => {
      inserts.push(event);
    },
    touchLastActive: async () => {
      touches += 1;
    },
    getAppMetadata: () => ({
      platform: "ios",
      appVersion: "1.2.3",
      buildNumber: "45",
    }),
    createUuid: () =>
      `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, "0")}`,
    now: () => currentTime,
    ...overrides,
  };
  return {
    storage,
    inserts,
    dependencies,
    get touches() {
      return touches;
    },
    advance(ms: number) {
      currentTime += ms;
    },
  };
}

test("installation ID persists across clients while session ID stays stable only within a client", async () => {
  const harness = analyticsHarness();
  const firstClient = createAnalyticsClient(harness.dependencies);
  await firstClient.trackEvent("property_created");
  await firstClient.trackEvent("room_created");

  assert.equal(
    harness.inserts[0]?.installation_id,
    harness.inserts[1]?.installation_id,
  );
  assert.equal(harness.inserts[0]?.session_id, harness.inserts[1]?.session_id);

  const secondClient = createAnalyticsClient(harness.dependencies);
  await secondClient.trackEvent("property_created");
  assert.equal(
    harness.inserts[0]?.installation_id,
    harness.inserts[2]?.installation_id,
  );
  assert.notEqual(
    harness.inserts[0]?.session_id,
    harness.inserts[2]?.session_id,
  );
});

test("event metadata is attached and unsafe properties are removed", async () => {
  const harness = analyticsHarness();
  const client = createAnalyticsClient(harness.dependencies);
  await client.trackEvent("scan_completed", {
    scan_mode: "multi_photo",
    image_count: 3,
    items_detected_count: 8,
    duration_ms: 1200,
    email: "private@example.com",
    image_url: "https://example.com/signed-photo",
    item_name: "Private item",
  } as never);

  assert.deepEqual(harness.inserts[0], {
    user_id: "00000000-0000-4000-8000-000000000001",
    installation_id: "00000000-0000-4000-8000-000000000002",
    session_id: "00000000-0000-4000-8000-000000000001",
    event_name: "scan_completed",
    platform: "ios",
    app_version: "1.2.3",
    build_number: "45",
    properties: {
      scan_mode: "multi_photo",
      image_count: 3,
      items_detected_count: 8,
      duration_ms: 1200,
    },
  });
});

test("prohibited, nested, and uncontrolled property values never pass sanitization", () => {
  assert.deepEqual(
    sanitizeEventProperties("purchase_started", {
      plan: "plus",
      billing_period: "weekly",
      product_identifier: "bad@example.com",
      customer_info: { email: "private@example.com" },
      search_term: "private search",
      token: "secret",
    }),
    { plan: "plus" },
  );
});

test("analytics insert failures never throw into the calling feature", async () => {
  const harness = analyticsHarness({
    insertEvent: async () => {
      throw new Error("database unavailable");
    },
  });
  const client = createAnalyticsClient(harness.dependencies);
  await assert.doesNotReject(client.trackEvent("property_created"));
});

test("last-active writes are single-flight and throttled for fifteen minutes", async () => {
  const harness = analyticsHarness();
  const client = createAnalyticsClient(harness.dependencies);
  await Promise.all([client.updateLastActive(), client.updateLastActive()]);
  await client.updateLastActive();
  assert.equal(harness.touches, 1);

  harness.advance(LAST_ACTIVE_THROTTLE_MS - 1);
  await client.updateLastActive();
  assert.equal(harness.touches, 1);

  harness.advance(1);
  await client.updateLastActive();
  assert.equal(harness.touches, 2);
});

test("app-open tracking is idempotent across repeated lifecycle effects", async () => {
  const harness = analyticsHarness();
  const client = createAnalyticsClient(harness.dependencies);
  await Promise.all([client.recordAppOpened(), client.recordAppOpened()]);
  await client.recordAppOpened();
  assert.equal(
    harness.inserts.filter((event) => event.event_name === "app_opened").length,
    1,
  );
  assert.equal(harness.inserts[0]?.properties.is_first_open, true);
});

test("failure and scan-mode mapping emits controlled categories only", () => {
  assert.equal(categorizeAnalyticsFailure({ status: 402 }), "usage_limit");
  assert.equal(
    categorizeAnalyticsFailure({ code: "SCAN_UPLOAD_FAILED" }),
    "upload",
  );
  assert.equal(
    categorizeAnalyticsFailure({ message: "Network request timed out" }),
    "timeout",
  );
  assert.equal(categorizeAnalyticsFailure({ status: 503 }), "processing");
  assert.equal(
    categorizeAnalyticsFailure({ message: "user supplied detail" }),
    "unknown",
  );
  assert.equal(analyticsScanMode("video_room"), "video");
  assert.equal(analyticsScanMode("single_item"), "single_item");
});
