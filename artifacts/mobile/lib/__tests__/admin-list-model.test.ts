import assert from "node:assert/strict";
import test from "node:test";

import {
  adminClaimPackRpcParams,
  adminDateRange,
  adminEventRpcParams,
  adminSupportRpcParams,
  canRunAdminUserSearch,
  clampAdminLimit,
  mergeAdminPages,
  supportNeedsAttention,
} from "../admin-list-model.ts";

test("blank and too-short user searches stay idle", () => {
  assert.equal(canRunAdminUserSearch(""), false);
  assert.equal(canRunAdminUserSearch("   "), false);
  assert.equal(canRunAdminUserSearch("a"), false);
  assert.equal(canRunAdminUserSearch("ab"), true);
  assert.equal(canRunAdminUserSearch("jay@example.com"), true);
  assert.equal(canRunAdminUserSearch("11111111-1111-4111-8111-111111111111"), true);
});

test("admin date ranges are stable and support all time", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  assert.deepEqual(adminDateRange("7d", now), {
    from: "2026-07-22T12:00:00.000Z",
    to: "2026-07-29T12:00:00.000Z",
  });
  assert.deepEqual(adminDateRange("30d", now), {
    from: "2026-06-29T12:00:00.000Z",
    to: "2026-07-29T12:00:00.000Z",
  });
  assert.deepEqual(adminDateRange("all", now), {
    from: null,
    to: "2026-07-29T12:00:00.000Z",
  });
});

test("filters and cursors map to the intended RPC parameters", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const cursor = { createdAt: "2026-07-20T01:02:03.000Z", id: "row-20" };

  assert.deepEqual(adminSupportRpcParams({
    filter: "closed",
    timeframe: "30d",
    cursor,
    limit: 200,
    now,
  }), {
    p_limit: 50,
    p_before_created_at: cursor.createdAt,
    p_before_id: cursor.id,
    p_from: "2026-06-29T12:00:00.000Z",
    p_to: "2026-07-29T12:00:00.000Z",
    p_status: "closed",
  });

  const needsAttention = adminSupportRpcParams({
    filter: "needs_attention",
    timeframe: "7d",
    now,
  });
  assert.equal(needsAttention.p_from, null);
  assert.equal(needsAttention.p_to, null);

  assert.deepEqual(adminClaimPackRpcParams({
    status: "failed",
    timeframe: "7d",
    query: "  CP-123  ",
    cursor,
    now,
  }), {
    p_limit: 20,
    p_before_created_at: cursor.createdAt,
    p_before_id: cursor.id,
    p_from: "2026-07-22T12:00:00.000Z",
    p_to: "2026-07-29T12:00:00.000Z",
    p_status: "failed",
    p_query: "CP-123",
  });

  assert.deepEqual(adminEventRpcParams({
    timeframe: "90d",
    severity: "critical",
    source: " revenuecat-webhook ",
    cursor,
    now,
  }), {
    p_limit: 20,
    p_before_created_at: cursor.createdAt,
    p_before_id: cursor.id,
    p_from: "2026-04-30T12:00:00.000Z",
    p_to: "2026-07-29T12:00:00.000Z",
    p_severity: "critical",
    p_source: "revenuecat-webhook",
  });
});

test("cursor pages merge without duplicate rows", () => {
  const merged = mergeAdminPages([
    { items: [{ id: "3" }, { id: "2" }], hasMore: true },
    { items: [{ id: "2" }, { id: "1" }], hasMore: false },
  ]);
  assert.deepEqual(merged.map((row) => row.id), ["3", "2", "1"]);
});

test("needs-attention includes new, active, or unread tickets regardless of age", () => {
  assert.equal(supportNeedsAttention({ status: "new", hasUnreadUserMessage: false }), true);
  assert.equal(supportNeedsAttention({ status: "development", hasUnreadUserMessage: false }), true);
  assert.equal(supportNeedsAttention({ status: "closed", hasUnreadUserMessage: true }), true);
  assert.equal(supportNeedsAttention({ status: "closed", hasUnreadUserMessage: false }), false);
});

test("admin limits clamp to the backend contract", () => {
  assert.equal(clampAdminLimit(undefined), 20);
  assert.equal(clampAdminLimit(0), 1);
  assert.equal(clampAdminLimit(25), 25);
  assert.equal(clampAdminLimit(500), 50);
});
