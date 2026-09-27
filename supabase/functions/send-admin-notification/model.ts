export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export type AdminNotificationRecord = {
  id: string;
  type: "new_user";
  user_id: string | null;
  email: string | null;
  status: "pending" | "processing" | "sent" | "failed";
  attempts: number;
};

export type AdminNotificationWebhookPayload = {
  type: "INSERT";
  table: "admin_notifications";
  schema: "public";
  record: AdminNotificationRecord;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPO_TOKEN_PATTERN = /^(Expo(nent)?PushToken)\[[A-Za-z0-9_-]+\]$/;

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && EXPO_TOKEN_PATTERN.test(value);
}

export function parseWebhookPayload(
  value: unknown,
): AdminNotificationWebhookPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    payload.type !== "INSERT" ||
    payload.table !== "admin_notifications" ||
    payload.schema !== "public"
  ) {
    return null;
  }
  if (!payload.record || typeof payload.record !== "object") return null;
  const record = payload.record as Record<string, unknown>;
  if (!UUID_PATTERN.test(String(record.id ?? "")) || record.type !== "new_user")
    return null;
  if (record.status !== "pending") return null;
  if (!Number.isInteger(record.attempts) || Number(record.attempts) < 0)
    return null;
  if (record.email !== null && typeof record.email !== "string") return null;
  if (
    record.user_id !== null &&
    !UUID_PATTERN.test(String(record.user_id ?? ""))
  )
    return null;
  return value as AdminNotificationWebhookPayload;
}

export function newUserNotificationBody(email: string | null): string {
  const normalized = email?.trim();
  return normalized
    ? `${normalized} just created an account`
    : "A new user just created an account";
}

export function safeErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 500);
  return String(value).slice(0, 500);
}
