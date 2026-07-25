import Constants from "expo-constants";
import { File } from "expo-file-system";
import { Platform } from "react-native";

import { getInstalledAppContext } from "@/lib/app-build-context";
import {
  buildFeedbackReportInsertPayload,
  createFeedbackId,
  createFeedbackScreenshotPath,
  isFeedbackScreenshotWriteValueAllowed,
  parseFeedbackScreenshotValue,
  serializeError,
  summarizeFeedbackInsertPayload,
  validateFeedbackScreenshotFile,
  validateFeedbackForm,
  type FeedbackAdminStatus,
  type FeedbackFormState,
  type FeedbackPriority,
} from "@/lib/feedback-model";
import { supabase } from "@/lib/supabase";

export const FEEDBACK_SCREENSHOTS_BUCKET = "feedback-screenshots";

export interface FeedbackScreenshotInput {
  uri: string;
  filename?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}

export interface FeedbackSubmitInput {
  userId: string;
  userEmail?: string | null;
  form: FeedbackFormState;
  currentRoute?: string | null;
  screenshot?: FeedbackScreenshotInput | null;
}

export interface FeedbackSubmitResult {
  id: string;
  screenshotAttached: boolean;
  screenshotWarning?: string;
}

export interface FeedbackReportRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  feedback_type: string | null;
  classification: string | null;
  severity: string | null;
  status: string | null;
  title: string | null;
  description: string | null;
  expected_result: string | null;
  screenshot_url: string | null;
  user_name: string | null;
  app_version: string | null;
  app_build_number: string | null;
  route: string | null;
  screen_name: string | null;
  environment: string | null;
  device_info: string | null;
  device_model: string | null;
  os_info: string | null;
  browser_info: string | null;
  metadata_json: { category?: string; priority?: string; buildNumber?: string; [key: string]: unknown } | null;
  created_at: string | null;
  last_activity_at: string | null;
  user_last_read_at: string | null;
  admin_last_read_at: string | null;
  last_user_message_at: string | null;
  last_admin_message_at: string | null;
  latest_message_preview: string | null;
}

export interface FeedbackMessageRow {
  id: string;
  ticket_id: string;
  sender_user_id: string;
  sender_role: "user" | "admin" | "system";
  body: string;
  attachment_path: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface FeedbackUnreadCounts {
  userUnreadCount: number;
  adminUnreadCount: number;
}

function logFeedbackStep(step: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  console.info("[feedback]", step, payload);
}

function logFeedbackWarning(step: string, payload: Record<string, unknown>, error: unknown) {
  if (!__DEV__) return;
  console.warn("[feedback]", step, {
    ...payload,
    error: serializeError(error),
  });
}

function appEnvironment(): string {
  return process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? "development" : "production");
}

async function readScreenshotBody(screenshot: FeedbackScreenshotInput): Promise<Blob | ArrayBuffer> {
  if (Platform.OS === "web") {
    const response = await fetch(screenshot.uri);
    if (!response.ok) throw new Error(`Could not read screenshot (${response.status}).`);
    return response.blob();
  }
  return new File(screenshot.uri).arrayBuffer();
}

function screenshotMimeType(screenshot: FeedbackScreenshotInput): string {
  const validation = validateFeedbackScreenshotFile(screenshot);
  if (!validation.ok || !validation.mimeType) {
    throw new Error(validation.message ?? "Only PNG or JPG screenshots are supported for now.");
  }
  return validation.mimeType;
}

export async function submitFeedbackReport(input: FeedbackSubmitInput): Promise<FeedbackSubmitResult> {
  const validation = validateFeedbackForm(input.form);
  if (!validation.ok) throw new Error(validation.message);

  const feedbackId = createFeedbackId();
  const now = new Date().toISOString();
  const installedApp = getInstalledAppContext();
  const payload = buildFeedbackReportInsertPayload({
    id: feedbackId,
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    form: input.form,
    currentRoute: input.currentRoute ?? null,
    now,
    environment: appEnvironment(),
    appVersion: installedApp.appVersion,
    buildNumber: installedApp.buildNumber,
    appOwnership: Constants.appOwnership ?? null,
    executionEnvironment: Constants.executionEnvironment ?? null,
    deviceInfo: installedApp.deviceModel
      ? `${installedApp.platform} · ${installedApp.deviceModel}`
      : installedApp.platform,
    deviceModel: installedApp.deviceModel,
    osInfo: installedApp.osVersion,
    browserInfo: Platform.OS === "web" ? "Expo web" : null,
  });
  const insertSummary = summarizeFeedbackInsertPayload(payload, {
    hasScreenshotUri: Boolean(input.screenshot?.uri),
    screenshotRequested: Boolean(input.screenshot),
  });

  if (__DEV__) {
    console.info("[feedback] row insert payload summary", JSON.stringify(insertSummary));
  }

  const { error: insertError } = await supabase.from("feedback_reports").insert(payload);
  if (insertError) {
    if (__DEV__) {
      console.warn("[feedback] row insert failed", JSON.stringify(serializeError(insertError)));
    }
    logFeedbackWarning("feedback row insert failed", {
      feedbackId,
      table: "feedback_reports",
      ...insertSummary,
    }, insertError);
    throw insertError;
  }

  logFeedbackStep("feedback row created", {
    feedbackId,
    table: "feedback_reports",
    screenshotRequested: Boolean(input.screenshot),
  });

  if (!input.screenshot) {
    return { id: feedbackId, screenshotAttached: false };
  }

  const uploadPath = createFeedbackScreenshotPath(
    input.userId,
    feedbackId,
    input.screenshot.filename,
    input.screenshot.mimeType,
    input.screenshot.uri,
  );
  if (!isFeedbackScreenshotWriteValueAllowed(uploadPath, input.userId)) {
    throw new Error("Feedback screenshot path is outside the authenticated user namespace.");
  }

  try {
    const contentType = screenshotMimeType(input.screenshot);
    logFeedbackStep("screenshot upload starting", {
      feedbackId,
      bucket: FEEDBACK_SCREENSHOTS_BUCKET,
      storedPath: uploadPath,
      contentType,
      fileSize: input.screenshot.fileSize ?? null,
    });

    let body: Blob | ArrayBuffer;
    try {
      body = await readScreenshotBody(input.screenshot);
    } catch (readError) {
      logFeedbackWarning("screenshot file read failed", {
        feedbackId,
        storedPath: uploadPath,
        contentType,
      }, readError);
      throw readError;
    }

    const { error: uploadError } = await supabase.storage
      .from(FEEDBACK_SCREENSHOTS_BUCKET)
      .upload(uploadPath, body, {
        contentType,
        upsert: false,
      });
    if (uploadError) {
      logFeedbackWarning("screenshot upload failed", {
        feedbackId,
        bucket: FEEDBACK_SCREENSHOTS_BUCKET,
        storedPath: uploadPath,
        contentType,
      }, uploadError);
      throw uploadError;
    }

    const { error: updateError } = await supabase
      .from("feedback_reports")
      .update({ screenshot_url: uploadPath, updated_at: new Date().toISOString() })
      .eq("id", feedbackId)
      .eq("user_id", input.userId);
    if (updateError) {
      logFeedbackWarning("screenshot_url update failed", {
        feedbackId,
        table: "feedback_reports",
        storedPath: uploadPath,
        userIdPresent: Boolean(input.userId),
      }, updateError);
      throw updateError;
    }

    logFeedbackStep("screenshot attached", {
      feedbackId,
      bucket: FEEDBACK_SCREENSHOTS_BUCKET,
      storedPath: uploadPath,
    });

    return { id: feedbackId, screenshotAttached: true };
  } catch (error) {
    logFeedbackWarning("feedback submitted without screenshot fallback", {
      feedbackId,
      bucket: FEEDBACK_SCREENSHOTS_BUCKET,
      storedPath: uploadPath,
    }, error);
    return {
      id: feedbackId,
      screenshotAttached: false,
      screenshotWarning: "Your feedback was sent, but the screenshot could not be attached.",
    };
  }
}

export async function loadRecentFeedbackReports(limit = 20): Promise<FeedbackReportRow[]> {
  const { data, error } = await supabase
    .from("feedback_reports")
    .select("id, user_id, user_email, user_name, feedback_type, classification, severity, status, title, description, expected_result, screenshot_url, app_version, app_build_number, route, screen_name, environment, device_info, device_model, os_info, browser_info, metadata_json, created_at, last_activity_at, user_last_read_at, admin_last_read_at, last_user_message_at, last_admin_message_at, latest_message_preview")
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as FeedbackReportRow[];
}

export async function loadMyFeedbackReports(userId: string, limit = 50): Promise<FeedbackReportRow[]> {
  const { data, error } = await supabase
    .from("feedback_reports")
    .select("id, user_id, user_email, user_name, feedback_type, classification, severity, status, title, description, expected_result, screenshot_url, app_version, app_build_number, route, screen_name, environment, device_info, device_model, os_info, browser_info, metadata_json, created_at, last_activity_at, user_last_read_at, admin_last_read_at, last_user_message_at, last_admin_message_at, latest_message_preview")
    .eq("user_id", userId)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as FeedbackReportRow[];
}

export { parseFeedbackScreenshotValue } from "@/lib/feedback-model";

export async function createFeedbackScreenshotSignedUrl(storedValue: string): Promise<string> {
  const source = parseFeedbackScreenshotValue(
    storedValue,
    process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    FEEDBACK_SCREENSHOTS_BUCKET,
  );
  if (source.kind === "url") {
    logFeedbackStep("legacy screenshot URL accepted", { urlHost: new URL(source.value).host });
    return source.value;
  }

  logFeedbackStep("screenshot signed url requested", {
    bucket: FEEDBACK_SCREENSHOTS_BUCKET,
    storedPath: source.value,
  });
  const { data, error } = await supabase.storage
    .from(FEEDBACK_SCREENSHOTS_BUCKET)
    .createSignedUrl(source.value, 60 * 5);
  if (error || !data?.signedUrl) {
    logFeedbackWarning("admin screenshot signed url failed", {
      bucket: FEEDBACK_SCREENSHOTS_BUCKET,
      storedPath: source.value,
    }, error ?? new Error("Signed URL not returned"));
    throw error ?? new Error("Signed URL not returned");
  }
  return data.signedUrl;
}

export async function loadFeedbackMessages(ticketId: string): Promise<FeedbackMessageRow[]> {
  const { data, error } = await supabase
    .from("feedback_messages")
    .select("id, ticket_id, sender_user_id, sender_role, body, attachment_path, created_at, edited_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FeedbackMessageRow[];
}

export async function sendFeedbackMessage(ticketId: string, body: string): Promise<FeedbackMessageRow> {
  const message = body.trim();
  if (!message || message.length > 4000) {
    throw new Error("Messages must contain between 1 and 4000 characters.");
  }
  const { data, error } = await supabase.rpc("feedback_add_message", {
    p_ticket_id: ticketId,
    p_body: message,
  });
  if (error) throw error;
  return data as FeedbackMessageRow;
}

export async function markFeedbackTicketRead(
  ticketId: string,
  viewerRole: "user" | "admin",
): Promise<void> {
  const { error } = await supabase.rpc("feedback_mark_ticket_read", {
    p_ticket_id: ticketId,
    p_viewer_role: viewerRole,
  });
  if (error) throw error;
}

export async function loadFeedbackUnreadCounts(): Promise<FeedbackUnreadCounts> {
  const { data, error } = await supabase.rpc("get_feedback_unread_counts");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    userUnreadCount: Number(row?.user_unread_count ?? 0),
    adminUnreadCount: Number(row?.admin_unread_count ?? 0),
  };
}

export async function updateFeedbackReportStatus(id: string, status: FeedbackAdminStatus): Promise<void> {
  const { error } = await supabase.rpc("admin_update_feedback_status", {
    p_feedback_id: id,
    p_status: status,
  });
  if (error) {
    logFeedbackWarning("admin feedback status update failed", {
      feedbackId: id,
      status,
    }, error);
    throw error;
  }
}

export async function updateFeedbackReportPriority(id: string, priority: FeedbackPriority): Promise<void> {
  const { error } = await supabase.rpc("admin_update_feedback_priority", {
    p_feedback_id: id,
    p_priority: priority,
  });
  if (error) {
    logFeedbackWarning("admin feedback priority update failed", {
      feedbackId: id,
      priority,
    }, error);
    throw error;
  }
}
