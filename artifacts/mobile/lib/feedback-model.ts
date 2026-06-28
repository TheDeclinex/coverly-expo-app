export type FeedbackType = "issue" | "feedback" | "enhancement";
export type FeedbackCategory = "general" | "scan" | "pricing" | "claim_pack" | "billing" | "account";
export type FeedbackPriority = "low" | "normal" | "blocking";
export type FeedbackAdminStatus =
  | "new"
  | "under_investigation"
  | "bug"
  | "development"
  | "testing"
  | "feature"
  | "resolved"
  | "closed";

export interface FeedbackFormState {
  type: FeedbackType;
  category: FeedbackCategory;
  priority: FeedbackPriority;
  message: string;
}

export interface FeedbackValidationResult {
  ok: boolean;
  message?: string;
}

export interface FeedbackInsertPayloadInput {
  id: string;
  userId: string;
  userEmail?: string | null;
  form: FeedbackFormState;
  currentRoute?: string | null;
  now: string;
  environment: string;
  appVersion?: string | null;
  buildNumber?: string | null;
  appOwnership?: string | null;
  executionEnvironment?: string | null;
  deviceInfo: string;
  osInfo: string;
  browserInfo?: string | null;
}

export type FeedbackInsertPayload = ReturnType<typeof buildFeedbackReportInsertPayload>;

export function buildFeedbackReportInsertPayload(input: FeedbackInsertPayloadInput) {
  return {
    id: input.id,
    user_id: input.userId,
    user_email: input.userEmail ?? null,
    source: "mobile_app",
    status: "new",
    feedback_type: feedbackTypeToExistingColumn(input.form.type),
    severity: feedbackPriorityToSeverity(input.form.priority),
    title: feedbackTitle(input.form),
    description: input.form.message.trim(),
    expected_result: null,
    wants_followup: true,
    screenshot_url: null,
    screen_name: "Feedback & Support",
    route: input.currentRoute ?? null,
    environment: input.environment,
    app_version: input.appVersion ?? null,
    device_info: input.deviceInfo,
    os_info: input.osInfo,
    browser_info: input.browserInfo ?? null,
    metadata_json: {
      category: input.form.category,
      priority: input.form.priority,
      buildNumber: input.buildNumber ?? null,
      appOwnership: input.appOwnership ?? null,
      executionEnvironment: input.executionEnvironment ?? null,
    },
    created_at: input.now,
    updated_at: input.now,
  };
}

export function summarizeFeedbackInsertPayload(
  payload: FeedbackInsertPayload,
  options: { hasScreenshotUri: boolean; screenshotRequested: boolean },
) {
  return {
    source: payload.source,
    status: payload.status,
    feedback_type: payload.feedback_type,
    severity: payload.severity,
    userIdPresent: Boolean(payload.user_id),
    userIdLength: payload.user_id.length,
    hasScreenshotUri: options.hasScreenshotUri,
    screenshotRequested: options.screenshotRequested,
    insertedColumns: Object.keys(payload).sort(),
  };
}

export function feedbackTypeToExistingColumn(value: FeedbackType): string {
  if (value === "enhancement") return "enhancement";
  if (value === "feedback") return "feedback";
  return "issue";
}

export function feedbackPriorityToSeverity(value: FeedbackPriority): string {
  if (value === "blocking") return "critical";
  if (value === "low") return "minor";
  return "moderate";
}

export function feedbackTitle(input: Pick<FeedbackFormState, "type" | "category">): string {
  return `${feedbackTypeLabel(input.type)}: ${feedbackCategoryLabel(input.category)}`;
}

const allowedImageExtensions = new Set(["jpg", "jpeg", "png", "webp"]);
const allowedScreenshotMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function validateFeedbackForm(input: FeedbackFormState): FeedbackValidationResult {
  if (!input.message.trim()) {
    return { ok: false, message: "Tell us what happened or what you need help with." };
  }
  if (input.message.trim().length < 8) {
    return { ok: false, message: "Add a little more detail so we can understand the issue." };
  }
  return { ok: true };
}

export function createFeedbackId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const resolved = char === "x" ? value : (value & 0x3) | 0x8;
    return resolved.toString(16);
  });
}

function extensionFromName(value?: string | null): string | null {
  return value
    ?.split("?")[0]
    .split(".")
    .pop()
    ?.toLowerCase() ?? null;
}

export interface FeedbackScreenshotFileLike {
  uri?: string | null;
  filename?: string | null;
  mimeType?: string | null;
}

export interface FeedbackScreenshotValidationResult {
  ok: boolean;
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
  extension?: "jpg" | "png" | "webp";
  message?: string;
}

export function validateFeedbackScreenshotFile(file: FeedbackScreenshotFileLike): FeedbackScreenshotValidationResult {
  const mimeType = file.mimeType?.toLowerCase() ?? null;
  const extension = extensionFromName(file.filename) ?? extensionFromName(file.uri);

  if (mimeType === "image/heic" || mimeType === "image/heif" || extension === "heic" || extension === "heif") {
    return {
      ok: false,
      message: "Only PNG or JPG screenshots are supported for now.",
    };
  }

  if (mimeType && !allowedScreenshotMimeTypes.has(mimeType)) {
    return {
      ok: false,
      message: "Only PNG or JPG screenshots are supported for now.",
    };
  }

  if (mimeType === "image/png") return { ok: true, mimeType: "image/png", extension: "png" };
  if (mimeType === "image/webp") return { ok: true, mimeType: "image/webp", extension: "webp" };
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return { ok: true, mimeType: "image/jpeg", extension: "jpg" };

  if (extension && allowedImageExtensions.has(extension)) {
    if (extension === "png") return { ok: true, mimeType: "image/png", extension: "png" };
    if (extension === "webp") return { ok: true, mimeType: "image/webp", extension: "webp" };
    return { ok: true, mimeType: "image/jpeg", extension: "jpg" };
  }

  return { ok: true, mimeType: "image/jpeg", extension: "jpg" };
}

export function feedbackScreenshotExtension(filename?: string | null, mimeType?: string | null, uri?: string | null): string {
  const validation = validateFeedbackScreenshotFile({ filename, mimeType, uri });
  if (validation.ok && validation.extension) return validation.extension;

  const fromName = extensionFromName(filename);
  if (fromName && allowedImageExtensions.has(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }

  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function createFeedbackScreenshotPath(
  userId: string,
  feedbackId: string,
  filename?: string | null,
  mimeType?: string | null,
  uri?: string | null,
): string {
  const extension = feedbackScreenshotExtension(filename, mimeType, uri);
  const safeUserId = userId.replace(/[^a-zA-Z0-9-]/g, "");
  const safeFeedbackId = feedbackId.replace(/[^a-zA-Z0-9-]/g, "");
  return `${safeUserId}/${safeFeedbackId}/screenshot.${extension}`;
}

export interface SerializedError {
  name?: string;
  message: string;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
  statusCode?: unknown;
  error?: unknown;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const record = error as Error & Record<string, unknown>;
    return {
      name: error.name,
      message: error.message,
      code: record.code,
      details: record.details,
      hint: record.hint,
      status: record.status,
      statusCode: record.statusCode,
      error: record.error,
    };
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : JSON.stringify(record);
    return {
      message,
      code: record.code,
      details: record.details,
      hint: record.hint,
      status: record.status,
      statusCode: record.statusCode,
      error: record.error,
    };
  }

  return { message: String(error) };
}

export function feedbackTypeLabel(value: FeedbackType | string | null | undefined): string {
  if (value === "enhancement") return "Enhancement";
  if (value === "feedback") return "Feedback";
  if (value === "issue") return "Issue";
  if (value === "recognition_issue") return "Recognition issue";
  return "Feedback";
}

export function feedbackCategoryLabel(value: FeedbackCategory | string | null | undefined): string {
  if (value === "scan") return "Scanning";
  if (value === "pricing") return "Replacement pricing";
  if (value === "claim_pack") return "Claim packs";
  if (value === "billing") return "Billing";
  if (value === "account") return "Account";
  return "General";
}

export function feedbackPriorityLabel(value: FeedbackPriority | string | null | undefined): string {
  if (value === "blocking" || value === "critical") return "Blocking";
  if (value === "moderate") return "Normal";
  if (value === "minor") return "Low";
  if (value === "low") return "Low";
  return "Normal";
}

export const feedbackAdminStatusOptions: FeedbackAdminStatus[] = [
  "new",
  "under_investigation",
  "bug",
  "development",
  "testing",
  "feature",
  "resolved",
  "closed",
];

export function feedbackStatusLabel(value: string | null | undefined): string {
  if (value === "under_investigation") return "Under investigation";
  if (value === "bug") return "Bug";
  if (value === "development") return "Development";
  if (value === "testing") return "Testing";
  if (value === "feature") return "Feature";
  if (value === "resolved") return "Resolved";
  if (value === "closed") return "Closed";
  return "New";
}

export function isFeedbackAdminStatus(value: string): value is FeedbackAdminStatus {
  return feedbackAdminStatusOptions.includes(value as FeedbackAdminStatus);
}
