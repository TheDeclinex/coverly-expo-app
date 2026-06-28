import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFeedbackReportInsertPayload,
  createFeedbackScreenshotPath,
  feedbackCategoryLabel,
  feedbackPriorityLabel,
  feedbackStatusLabel,
  feedbackTypeLabel,
  isFeedbackAdminStatus,
  serializeError,
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
  assert.equal(feedbackStatusLabel("under_investigation"), "Under investigation");
  assert.equal(isFeedbackAdminStatus("development"), true);
  assert.equal(isFeedbackAdminStatus("admin_only"), false);
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
  assert.equal(textOnlyPayload.severity, "moderate");
  assert.equal(textOnlyPayload.user_id, baseInput.userId);
  assert.equal(textOnlyPayload.screenshot_url, null);
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
