import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFeedbackReportInsertPayload,
  createFeedbackScreenshotPath,
  feedbackCategoryLabel,
  feedbackBuildDisplay,
  formatUnreadBadge,
  feedbackMessageSenderLabel,
  feedbackPriorityLabel,
  feedbackPrioritySortRank,
  feedbackStatusLabel,
  feedbackTicketHasUnread,
  feedbackTypeLabel,
  isFeedbackAdminStatus,
  isFeedbackScreenshotWriteValueAllowed,
  serializeError,
  parseFeedbackScreenshotValue,
  summarizeFeedbackInsertPayload,
  validateFeedbackScreenshotFile,
  validateFeedbackForm,
} from "../feedback-model.ts";

test("feedback form requires a useful message", () => {
  assert.equal(validateFeedbackForm({
    type: "issue",
    category: "general",
    priority: "normal",
    message: "  ",
  }).ok, false);

  assert.equal(validateFeedbackForm({
    type: "issue",
    category: "general",
    priority: "normal",
    message: "The pricing screen freezes after search.",
  }).ok, true);
});

test("feedback screenshot path is scoped to user and feedback id", () => {
  assert.equal(
    createFeedbackScreenshotPath("user/123", "feedback:456", "screen.PNG", "image/png"),
    "user123/feedback456/screenshot.png",
  );
});

test("new screenshot writes stay inside the authenticated user namespace", () => {
  const userId = "22222222-2222-4222-8222-222222222222";
  assert.equal(isFeedbackScreenshotWriteValueAllowed(null, userId), true);
  assert.equal(
    isFeedbackScreenshotWriteValueAllowed(`${userId}/ticket/screenshot.png`, userId),
    true,
  );
  assert.equal(
    isFeedbackScreenshotWriteValueAllowed("33333333-3333-4333-8333-333333333333/ticket/screenshot.png", userId),
    false,
  );
  assert.equal(
    isFeedbackScreenshotWriteValueAllowed("https://attacker.example/screenshot.png", userId),
    false,
  );
});

test("feedback screenshot validation accepts supported image types", () => {
  assert.deepEqual(
    validateFeedbackScreenshotFile({ filename: "screen.jpeg", mimeType: "image/jpeg" }),
    { ok: true, mimeType: "image/jpeg", extension: "jpg" },
  );
  assert.deepEqual(
    validateFeedbackScreenshotFile({ filename: "screen.png", mimeType: "image/png" }),
    { ok: true, mimeType: "image/png", extension: "png" },
  );
  assert.deepEqual(
    validateFeedbackScreenshotFile({ filename: "Screenshot", mimeType: "image/png" }),
    { ok: true, mimeType: "image/png", extension: "png" },
  );
});

test("feedback screenshot validation rejects heic/heif", () => {
  assert.equal(validateFeedbackScreenshotFile({ filename: "screen.heic", mimeType: "image/heic" }).ok, false);
  assert.equal(validateFeedbackScreenshotFile({ uri: "file:///tmp/screen.HEIF" }).ok, false);
});

test("serializeError keeps useful Supabase error fields", () => {
  assert.deepEqual(
    serializeError({
      message: "new row violates row-level security policy",
      code: "42501",
      details: "RLS",
      hint: "check policy",
      statusCode: 403,
    }),
    {
      message: "new row violates row-level security policy",
      code: "42501",
      details: "RLS",
      hint: "check policy",
      status: undefined,
      statusCode: 403,
      error: undefined,
    },
  );
});

test("feedback labels are human readable", () => {
  assert.equal(feedbackTypeLabel("issue"), "Issue");
  assert.equal(feedbackCategoryLabel("claim_pack"), "Claim packs");
  assert.equal(feedbackPriorityLabel("critical"), "Blocking");
  assert.equal(feedbackPriorityLabel("high"), "High");
  assert.deepEqual(
    ["blocking", "high", "normal", "low"].map(feedbackPrioritySortRank),
    [4, 3, 2, 1],
  );
  assert.equal(feedbackStatusLabel("under_investigation"), "Under investigation");
  assert.equal(isFeedbackAdminStatus("development"), true);
  assert.equal(isFeedbackAdminStatus("admin_only"), false);
});

test("legacy tickets without a build number render safely", () => {
  assert.equal(feedbackBuildDisplay("1.0.0", null), "1.0.0");
  assert.equal(feedbackBuildDisplay(null, null), "Unknown");
  assert.equal(feedbackBuildDisplay("1.0.0", "12"), "1.0.0 (12)");
});

test("screenshot values recover storage paths from legacy Supabase URLs", () => {
  assert.deepEqual(
    parseFeedbackScreenshotValue("user/ticket/screenshot.png"),
    { kind: "path", value: "user/ticket/screenshot.png" },
  );
  assert.deepEqual(
    parseFeedbackScreenshotValue(
      "https://demo.supabase.co/storage/v1/object/sign/feedback-screenshots/user/ticket/screenshot.png?token=expired",
      "https://demo.supabase.co",
    ),
    { kind: "path", value: "user/ticket/screenshot.png" },
  );
  assert.deepEqual(
    parseFeedbackScreenshotValue("https://legacy.example/screenshots/ticket.png"),
    { kind: "url", value: "https://legacy.example/screenshots/ticket.png" },
  );
});

test("conversation sender labels depend on sender and viewer roles", () => {
  assert.equal(feedbackMessageSenderLabel("admin", "admin"), "You");
  assert.equal(feedbackMessageSenderLabel("user", "admin"), "User");
  assert.equal(feedbackMessageSenderLabel("user", "user"), "You");
  assert.equal(feedbackMessageSenderLabel("admin", "user"), "Coverly support");
  assert.equal(feedbackMessageSenderLabel("system", "user"), "Status update");
});

test("unread state only follows messages from the opposite party", () => {
  assert.equal(feedbackTicketHasUnread("user", {
    userLastReadAt: "2026-07-23T10:00:00.000Z",
    lastAdminMessageAt: "2026-07-23T10:01:00.000Z",
    lastUserMessageAt: "2026-07-23T10:02:00.000Z",
  }), true);
  assert.equal(feedbackTicketHasUnread("user", {
    userLastReadAt: "2026-07-23T10:03:00.000Z",
    lastAdminMessageAt: "2026-07-23T10:01:00.000Z",
  }), false);
  assert.equal(feedbackTicketHasUnread("admin", {
    adminLastReadAt: null,
    lastUserMessageAt: "2026-07-23T10:02:00.000Z",
  }), true);
});

test("viewing an unread user conversation clears its unread state", () => {
  assert.equal(feedbackTicketHasUnread("user", {
    userLastReadAt: "2026-07-23T10:00:00.000Z",
    lastAdminMessageAt: "2026-07-23T10:01:00.000Z",
  }), true);
  assert.equal(feedbackTicketHasUnread("user", {
    userLastReadAt: "2026-07-23T10:02:00.000Z",
    lastAdminMessageAt: "2026-07-23T10:01:00.000Z",
  }), false);
});

test("feedback unread badge handles absent, single-digit, and overflow counts", () => {
  assert.equal(formatUnreadBadge(0), undefined);
  assert.equal(formatUnreadBadge(-1), undefined);
  assert.equal(formatUnreadBadge(1), "1");
  assert.equal(formatUnreadBadge(9), "9");
  assert.equal(formatUnreadBadge(10), "9+");
  assert.equal(formatUnreadBadge(Number.NaN), undefined);
});

test("feedback insert payload is stable when screenshot is selected", () => {
  const baseInput = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    userEmail: "tester@example.com",
    form: {
      type: "issue" as const,
      category: "claim_pack" as const,
      priority: "normal" as const,
      message: "The support inbox status chip looks wrong.",
    },
    currentRoute: "/feedback",
    now: "2026-06-28T00:00:00.000Z",
    environment: "development",
    appVersion: "1.0.0",
    buildNumber: "7",
    appOwnership: "expo",
    executionEnvironment: "storeClient",
    deviceInfo: "ios",
    osInfo: "ios 18",
    browserInfo: null,
  };
  const textOnlyPayload = buildFeedbackReportInsertPayload(baseInput);
  const screenshotSelectedPayload = buildFeedbackReportInsertPayload(baseInput);

  assert.deepEqual(screenshotSelectedPayload, textOnlyPayload);
  assert.equal(textOnlyPayload.source, "mobile_app");
  assert.equal(textOnlyPayload.status, "new");
  assert.equal(textOnlyPayload.feedback_type, "issue");
  assert.equal(textOnlyPayload.classification, "issue");
  assert.equal(textOnlyPayload.severity, "moderate");
  assert.equal(textOnlyPayload.user_id, baseInput.userId);
  assert.equal(textOnlyPayload.screenshot_url, null);
  assert.equal(textOnlyPayload.app_build_number, "7");
  assert.equal(textOnlyPayload.user_last_read_at, baseInput.now);
  assert.equal("last_admin_message_at" in textOnlyPayload, false);
  assert.equal("screenshotRequested" in textOnlyPayload.metadata_json, false);

  assert.deepEqual(
    summarizeFeedbackInsertPayload(screenshotSelectedPayload, {
      hasScreenshotUri: true,
      screenshotRequested: true,
    }),
    {
      source: "mobile_app",
      status: "new",
      feedback_type: "issue",
      severity: "moderate",
      userIdPresent: true,
      userIdLength: baseInput.userId.length,
      hasScreenshotUri: true,
      screenshotRequested: true,
      insertedColumns: Object.keys(screenshotSelectedPayload).sort(),
    },
  );
});

test("high priority is stored without rewriting existing severity values", () => {
  const payload = buildFeedbackReportInsertPayload({
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    form: {
      type: "bug",
      category: "scan",
      priority: "high",
      message: "Barcode saving fails after a successful lookup.",
    },
    now: "2026-07-24T00:00:00.000Z",
    environment: "development",
    deviceInfo: "ios",
    osInfo: "ios 18",
  });
  assert.equal(payload.severity, "high");
  assert.equal(payload.metadata_json.priority, "high");
});
