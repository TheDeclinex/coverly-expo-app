import assert from "node:assert/strict";
import test from "node:test";

import {
  isExpoPushToken,
  newUserNotificationBody,
  parseWebhookPayload,
} from "./model.ts";

test("accepts the intended admin notification webhook event", () => {
  const parsed = parseWebhookPayload({
    type: "INSERT",
    table: "admin_notifications",
    schema: "public",
    record: {
      id: "5ceea882-eaa4-41c7-ad16-780d332a2148",
      type: "new_user",
      user_id: "b53f8ad4-5bf0-4aea-8cbb-ea5636569f10",
      email: "jay@example.com",
      status: "pending",
      attempts: 0,
    },
  });
  assert.ok(parsed);
});

test("rejects unrelated and replayed events", () => {
  const base = {
    type: "INSERT",
    table: "admin_notifications",
    schema: "public",
    record: {
      id: "5ceea882-eaa4-41c7-ad16-780d332a2148",
      type: "new_user",
      user_id: null,
      email: null,
      status: "sent",
      attempts: 1,
    },
  };
  assert.equal(parseWebhookPayload(base), null);
  assert.equal(parseWebhookPayload({ ...base, table: "user_profiles" }), null);
});

test("validates Expo tokens and creates the requested body", () => {
  assert.equal(isExpoPushToken("ExpoPushToken[abc_123-XYZ]"), true);
  assert.equal(isExpoPushToken("ExponentPushToken[abc_123-XYZ]"), true);
  assert.equal(isExpoPushToken("secret"), false);
  assert.equal(
    newUserNotificationBody("john@example.com"),
    "john@example.com just created an account",
  );
});

test("rejects malformed tokens without normalizing them", () => {
  for (const value of [
    null,
    undefined,
    123,
    "",
    "ExpoPushToken[]",
    "ExpoPushTokenabc",
    "expoPushToken[abc]",
    "ExpoPushToken[a b]",
    "ExpoPushToken[a/b]",
    "ExpoPushToken[abc]suffix",
    " ExpoPushToken[abc]",
    "ExpoPushToken[abc]\n",
    "ExpoPushToken[abc]\r\n",
    String.raw`ExpoPushToken\[abc\]`,
  ]) {
    assert.equal(isExpoPushToken(value), false, JSON.stringify(value));
  }
});
