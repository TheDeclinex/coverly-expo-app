import Constants from "expo-constants";
import { File } from "expo-file-system";
import { Platform } from "react-native";

import {
  buildFeedbackReportInsertPayload,
  createFeedbackId,
  createFeedbackScreenshotPath,
  serializeError,
  summarizeFeedbackInsertPayload,
  validateFeedbackScreenshotFile,
  validateFeedbackForm,
  type FeedbackAdminStatus,
  type FeedbackFormState,
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
  severity: string | null;
  status: string | null;
  title: string | null;
  description: string | null;
  expected_result: string | null;
  screenshot_url: string | null;
  user_name: string | null;
  app_version: string | null;
  route: string | null;
  screen_name: string | null;
  environment: string | null;
  device_info: string | null;
  os_info: string | null;
  browser_info: string | null;
  metadata_json: { category?: string; priority?: string; buildNumber?: string; [key: string]: unknown } | null;
  created_at: string | null;
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

function appBuildNumber(): string | null {
  if (Platform.OS === "ios") return Constants.expoConfig?.ios?.buildNumber ?? null;
  if (Platform.OS === "android") return Constants.expoConfig?.android?.versionCode?.toString() ?? null;
  return null;
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
  const payload = buildFeedbackReportInsertPayload({
    id: feedbackId,
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    form: input.form,
    currentRoute: input.currentRoute ?? null,
    now,
    environment: appEnvironment(),
    appVersion: Constants.expoConfig?.version ?? null,
    buildNumber: appBuildNumber(),
    appOwnership: Constants.appOwnership ?? null,
    executionEnvironment: Constants.executionEnvironment ?? null,
    deviceInfo: Platform.OS,
    osInfo: `${Platform.OS} ${Platform.Version}`,
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

  try {
    const contentType = screenshotMimeType(input.screenshot);
    logFeedbackStep("screenshot upload starting", {
      feedbackId,
      bucket: FEEDBACK_SCREENSHOTS_BUCKET,
      uploadPath,
      contentType,
      fileSize: input.screenshot.fileSize ?? null,
    });

    let body: Blob | ArrayBuffer;
    try {
      body = await readScreenshotBody(input.screenshot);
    } catch (readError) {
      logFeedbackWarning("screenshot file read failed", {
        feedbackId,
        uploadPath,
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
        uploadPath,
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
        uploadPath,
        userIdPresent: Boolean(input.userId),
      }, updateError);
      throw updateError;
    }

    logFeedbackStep("screenshot attached", {
      feedbackId,
      bucket: FEEDBACK_SCREENSHOTS_BUCKET,
      uploadPath,
    });

    return { id: feedbackId, screenshotAttached: true };
  } catch (error) {
    logFeedbackWarning("feedback submitted without screenshot fallback", {
      feedbackId,
      bucket: FEEDBACK_SCREENSHOTS_BUCKET,
      uploadPath,
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
    .select("id, user_id, user_email, user_name, feedback_type, severity, status, title, description, expected_result, screenshot_url, app_version, route, screen_name, environment, device_info, os_info, browser_info, metadata_json, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as FeedbackReportRow[];
}

export async function createFeedbackScreenshotSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(FEEDBACK_SCREENSHOTS_BUCKET)
    .createSignedUrl(storagePath, 60 * 5);
  if (error || !data?.signedUrl) {
    logFeedbackWarning("admin screenshot signed url failed", {
      bucket: FEEDBACK_SCREENSHOTS_BUCKET,
      pathPresent: Boolean(storagePath),
    }, error ?? new Error("Signed URL not returned"));
    throw error ?? new Error("Signed URL not returned");
  }
  return data.signedUrl;
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
