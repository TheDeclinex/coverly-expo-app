/**
 * Scan service for Coverly AI-assisted inventory detection.
 *
 * ARCHITECTURE RULES (do not violate):
 * - The mobile app MUST NOT call OpenAI directly. All AI processing goes through
 *   the scan-room-photo Supabase Edge Function so API keys never leave the backend.
 * - Scan images are uploaded to Supabase Storage before invoke.
 *   The Edge Function receives small storage references instead of large base64
 *   JSON payloads. Legacy base64 payloads are still supported by the function.
 * - Scan results are normalised to ScanDetectedItem[] then saved via
 *   buildItemInsertPayload — the same path as Manual Add Item.
 *
 * Deployment checklist (manual steps required):
 *   1. supabase functions deploy scan-room-photo --no-verify-jwt
 *   2. Set OPENAI_API_KEY in Supabase dashboard → Edge Functions → Secrets
 *   3. After deployment, SCAN_EDGE_FUNCTION_NAME below is already set correctly.
 */

import { friendlyNetworkErrorMessage } from "@/lib/network-errors";
import { uploadScanPhoto } from "@/lib/photo-upload";
import { anonKey, debugSupabaseUrl, supabase } from "@/lib/supabase";
import type { ScanDetectedItem, ScanEncodedImage, ScanInput, ScanResult } from "@/types/scan";

/**
 * Name of the Supabase Edge Function that handles AI scan processing.
 * Set to null to show the "not configured" state without throwing.
 */
const SCAN_EDGE_FUNCTION_NAME: string | null = "scan-room-photo";
const EXPECTED_SCAN_PROJECT_REF = "jqijavrugjidqzbbgpag";
const SCAN_INVOKE_TIMEOUT_MS = 90_000;
const VIDEO_SCAN_INVOKE_TIMEOUT_MS = 120_000;

interface ScanFunctionResponse {
  success?: boolean;
  items?: unknown[];
  errorCode?: string;
  message?: string;
  edgeFunctionVersion?: string;
  diagnostics?: {
    edgeFunctionVersion?: string;
  };
}

interface ScanImagePayload {
  id: string;
  mimeType: string;
  sourceName: string;
  storagePath?: string;
  imageBase64?: string;
}

/**
 * Maximum images allowed per multi-photo scan batch.
 */
export const MAX_MULTI_PHOTO_IMAGES = 5;
export const MAX_VIDEO_SCAN_FRAMES = 20;

/**
 * Map mobile ScanMode values to the production scan-room-photo mode strings.
 */
function toProductionMode(
  mode: ScanInput["mode"]
): "single_photo" | "multi_photo" | "video_frames" | "single_item" {
  switch (mode) {
    case "single_photo_room":
      return "single_photo";
    case "single_item":
      return "single_item";
    case "multi_photo_room":
      return "multi_photo";
    case "video_room":
      return "video_frames";
  }
}

/**
 * Convert a production confidence float (0.0–1.0) to a display string.
 */
function confidenceToLabel(n: number): string {
  if (n >= 0.75) return "high";
  if (n >= 0.45) return "medium";
  return "low";
}

function confidenceScore(confidence: string | null | undefined): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  if (confidence === "low") return 1;
  return 0;
}

function primarySingleItem(items: ScanDetectedItem[]): ScanDetectedItem[] {
  if (items.length <= 1) return items;
  const [primary] = [...items].sort((a, b) => {
    const aDistance = a.pin ? Math.hypot(a.pin.x - 50, a.pin.y - 50) : 999;
    const bDistance = b.pin ? Math.hypot(b.pin.x - 50, b.pin.y - 50) : 999;
    const distanceDelta = aDistance - bDistance;
    if (Math.abs(distanceDelta) > 8) return distanceDelta;
    return confidenceScore(b.confidence) - confidenceScore(a.confidence);
  });
  return primary ? [primary] : [];
}

function scanLog(message: string, details?: Record<string, unknown>) {
  if (details) {
    if (__DEV__) console.info(`[Scan] ${message}`, details);
  } else {
    if (__DEV__) console.info(`[Scan] ${message}`);
  }
}

function scanNetworkFailureMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (error instanceof Error && error.name === "ScanTimeoutError") {
    return "Scan timed out before completion.";
  }

  if (
    normalized.includes("network request timed out") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return "Scan timed out before completion.";
  }

  if (
    normalized.includes("network request failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("internet connection") ||
    normalized.includes("offline") ||
    normalized.includes("not connected")
  ) {
    return "Network request failed while scanning. Check your connection and try again.";
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      error.name = "ScanTimeoutError";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}


function expectedScanNetworkMessage(error: unknown): string | null {
  return scanNetworkFailureMessage(error) ?? friendlyNetworkErrorMessage(error);
}

function scanUploadFailureMessage(error: string): string {
  const normalized = error.toLowerCase();
  if (
    normalized.includes("network request timed out") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return "Photo upload timed out before scanning. Please try again.";
  }
  return "Photo upload failed before scanning. Please try again.";
}

function createUsageIdempotencyKey(): string {
  const randomUuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });

  return `scan:${Date.now()}:${randomUuid}`;
}

async function buildStorageFirstImagePayload(
  images: ScanEncodedImage[],
  userId: string,
  fileId: string,
): Promise<{ ok: true; images: ScanImagePayload[] } | { ok: false; errorMessage: string }> {
  const uploadedImages: ScanImagePayload[] = [];

  scanLog("scan pre-upload batch started", {
    imageCount: images.length,
  });

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const id = `photo_${index + 1}`;
    const sourceName = id;

    if (image.storagePath) {
      scanLog("per-photo upload skipped; existing storage ref present", {
        imageIndex: index,
      });
      uploadedImages.push({
        id,
        storagePath: image.storagePath,
        mimeType: image.mimeType,
        sourceName,
      });
      continue;
    }

    if (image.uri) {
      scanLog("per-photo upload started", {
        imageIndex: index,
        imageCount: images.length,
        maxAttempts: 3,
      });
      const uploaded = await uploadScanPhoto(image.uri, userId, `${index}:${image.uri}`, {
        fileId,
        maxAttempts: 3,
      });
      if (!uploaded.ok) {
        const errorMessage = scanUploadFailureMessage(uploaded.error);
        scanLog("per-photo upload failed", {
          imageIndex: index,
          source: uploaded.source,
          statusCode: uploaded.statusCode ?? null,
          message: uploaded.error,
          uploadedImageRefCount: uploadedImages.filter((uploadedImage) => !!uploadedImage.storagePath).length,
        });
        scanLog("scan invoke skipped because upload incomplete", {
          imageCount: images.length,
          failedImageIndex: index,
          uploadedImageRefCount: uploadedImages.filter((uploadedImage) => !!uploadedImage.storagePath).length,
        });
        return {
          ok: false,
          errorMessage,
        };
      }

      scanLog("per-photo upload completed", {
        imageIndex: index,
        imageCount: images.length,
      });
      uploadedImages.push({
        id,
        storagePath: uploaded.path,
        mimeType: image.mimeType,
        sourceName,
      });
      continue;
    }

    if (image.base64) {
      uploadedImages.push({
        id,
        imageBase64: image.base64,
        mimeType: image.mimeType,
        sourceName,
      });
      continue;
    }

    scanLog("scan invoke skipped because upload incomplete", {
      imageCount: images.length,
      failedImageIndex: index,
      uploadedImageRefCount: uploadedImages.filter((uploadedImage) => !!uploadedImage.storagePath).length,
      reason: "missing image uri or fallback payload",
    });
    return {
      ok: false,
      errorMessage: "Photo upload failed before scanning. Please try again.",
    };
  }

  scanLog("scan pre-upload batch completed", {
    imageCount: images.length,
    uploadedImageRefCount: uploadedImages.filter((image) => !!image.storagePath).length,
    legacyBase64ImageCount: uploadedImages.filter((image) => !!image.imageBase64).length,
  });

  return { ok: true, images: uploadedImages };
}

/**
 * Run an AI-assisted inventory scan via the scan-room-photo Edge Function.
 *
 * ScanInput.images are uploaded to Storage before invoke. The function maps the
 * mobile payload to the production contract, handles
 * success/error envelopes, and normalises returned items to ScanDetectedItem[].
 */
export async function runAiScan(input: ScanInput): Promise<ScanResult> {
  if (!SCAN_EDGE_FUNCTION_NAME) {
    return {
      status: "not_configured",
      items: [],
      errorMessage:
        "AI scan endpoint not configured. Deploy the scan-room-photo Edge Function and update SCAN_EDGE_FUNCTION_NAME.",
    };
  }

  if (input.images.length === 0) {
    return {
      status: "error",
      items: [],
      errorMessage: "No images to scan.",
    };
  }

  try {
    scanLog("payload construction started", {
      mode: input.mode,
      imageCount: input.images.length,
    });

    const supabaseHost = new URL(debugSupabaseUrl).host;
    const usesExpectedProject = supabaseHost.startsWith(`${EXPECTED_SCAN_PROJECT_REF}.`);
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const userId = sessionData.session?.user.id;
    scanLog("auth session checked", {
      hasAccessToken: !!accessToken,
      hasUserId: !!userId,
      hasSessionError: !!sessionError,
    });
    if (sessionError || !accessToken || !userId) {
      if (__DEV__) console.warn("[Scan] function invoke skipped; missing auth session", {
        message: sessionError?.message ?? "Missing Supabase session token",
      });
      return {
        status: "error",
        items: [],
        errorMessage: "You must be signed in to scan items.",
      };
    }

    const imagePayload = await buildStorageFirstImagePayload(input.images, userId, input.fileId);
    if (!imagePayload.ok) {
      return {
        status: "error",
        items: [],
        errorMessage: imagePayload.errorMessage,
      };
    }

    const productionPayload = {
      mode: toProductionMode(input.mode),
      usageIdempotencyKey: input.usageIdempotencyKey ?? createUsageIdempotencyKey(),
      images: imagePayload.images,
      context: {
        fileId: input.fileId,
        roomId: input.roomId,
        roomName: input.roomName ?? undefined,
      },
    };

    scanLog("payload construction completed", {
      productionMode: productionPayload.mode,
      hasUsageIdempotencyKey: !!productionPayload.usageIdempotencyKey,
      imageCount: productionPayload.images.length,
      uploadedImageRefCount: productionPayload.images.filter((image) => !!image.storagePath).length,
      legacyBase64ImageCount: productionPayload.images.filter((image) => !!image.imageBase64).length,
      approxBase64Chars: productionPayload.images.reduce((sum, img) => sum + (img.imageBase64?.length ?? 0), 0),
      supabaseHost,
      expectedProjectRef: EXPECTED_SCAN_PROJECT_REF,
      usesExpectedProject,
    });

    if (!usesExpectedProject) {
      if (__DEV__) console.warn("[Scan] Supabase project ref mismatch", {
        expectedProjectRef: EXPECTED_SCAN_PROJECT_REF,
        supabaseHost,
      });
    }

    const functionUrl = `${debugSupabaseUrl.replace(/\/$/, "")}/functions/v1/${SCAN_EDGE_FUNCTION_NAME}`;
    const requestBody = JSON.stringify(productionPayload);
    const timeoutMs = input.mode === "video_room" ? VIDEO_SCAN_INVOKE_TIMEOUT_MS : SCAN_INVOKE_TIMEOUT_MS;
    const invokeStartedAt = Date.now();
    scanLog("function invoke started", {
      functionName: SCAN_EDGE_FUNCTION_NAME,
      requestBodyChars: requestBody.length,
      timeoutMs,
    });

    const response = await withTimeout(
      fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: requestBody,
      }),
      timeoutMs,
      "scan-room-photo invoke"
    );

    scanLog("HTTP status received", {
      status: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - invokeStartedAt,
    });

    const responseText = await response.text();
    scanLog("response body received", {
      status: response.status,
      bodyChars: responseText.length,
    });
    let data: ScanFunctionResponse | null = null;
    try {
      data = responseText ? JSON.parse(responseText) as ScanFunctionResponse : null;
    } catch {
      if (__DEV__) console.warn("[Scan] function returned invalid JSON", {
        status: response.status,
        bodyChars: responseText.length,
        elapsedMs: Date.now() - invokeStartedAt,
      });
      return {
        status: "error",
        items: [],
        errorMessage: `Scan failed with an invalid response (${response.status}).`,
        httpStatus: response.status,
        responseBody: responseText,
      };
    }

    if (!response.ok) {
      if (__DEV__) console.warn("[Scan] function returned error response", {
        status: response.status,
        errorCode: data?.errorCode,
        message: data?.message,
        elapsedMs: Date.now() - invokeStartedAt,
      });
      return {
        status: "error",
        items: [],
        errorMessage: data?.message ?? data?.errorCode ?? `Scan failed (${response.status}).`,
        errorCode: data?.errorCode,
        httpStatus: response.status,
        responseBody: data,
      };
    }

    scanLog("function invoke completed", {
      success: data?.success,
      itemCount: Array.isArray(data?.items) ? data.items.length : 0,
      errorCode: data?.errorCode,
      edgeFunctionVersion: data?.edgeFunctionVersion ?? data?.diagnostics?.edgeFunctionVersion,
      elapsedMs: Date.now() - invokeStartedAt,
    });

    // Production function returns { success: bool, items?, errorCode?, message? }
    if (data?.success === false) {
      return {
        status: "error",
        items: [],
        errorMessage: data.message ?? data.errorCode ?? "Scan failed",
        errorCode: data.errorCode,
        responseBody: data,
      };
    }

    const rawItems: unknown[] = Array.isArray(data?.items) ? data.items : [];

    const items: ScanDetectedItem[] = rawItems
      .filter(
        (r): r is Record<string, unknown> =>
          typeof r === "object" && r !== null && typeof (r as Record<string, unknown>).name === "string"
      )
      .map((raw) => {
        // Validate pin: must be object with finite x/y numbers in 0–100 range
        const rawPin = raw.pin as { x?: unknown; y?: unknown } | undefined;
        const pin =
          rawPin &&
          typeof rawPin.x === "number" &&
          typeof rawPin.y === "number" &&
          isFinite(rawPin.x) &&
          isFinite(rawPin.y)
            ? { x: Math.min(100, Math.max(0, rawPin.x)), y: Math.min(100, Math.max(0, rawPin.y)) }
            : null;

        // sourcePhotoIndex: 0-based integer returned by Edge Function
        const sourcePhotoIndex =
          typeof raw.sourcePhotoIndex === "number" && isFinite(raw.sourcePhotoIndex)
            ? Math.max(0, Math.round(raw.sourcePhotoIndex))
            : null;

        return {
          name: (raw.name as string).trim(),
          description:
            typeof raw.description === "string" ? raw.description.trim() || null : null,
          category:
            typeof raw.category === "string" ? raw.category : null,
          quantity:
            typeof raw.quantity === "number" && raw.quantity >= 1
              ? Math.round(raw.quantity)
              : 1,
          estimatedPrice:
            typeof raw.estimatedPrice === "number" ? raw.estimatedPrice : null,
          unitEstimatedPrice:
            typeof raw.unitEstimatedPrice === "number" ? raw.unitEstimatedPrice : null,
          brandMaker:
            typeof raw.brand_guess === "string" ? raw.brand_guess : null,
          modelSeries: null,
          conditionLabel: null,
          confidence:
            typeof raw.confidence === "number"
              ? confidenceToLabel(raw.confidence)
              : null,
          valuationBasis: "ai_estimate",
          priceSourceType: "ai_scan",
          imageUrl: null,
          photoUrl: null,
          sourceImageUri: null,
          pin,
          sourcePhotoIndex,
        };
      });

    return { status: "success", items: input.mode === "single_item" ? primarySingleItem(items) : items };
  } catch (err) {
    const expectedMessage = expectedScanNetworkMessage(err);
    if (expectedMessage) {
      scanLog("function invoke ended with expected network failure", {
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        status: "error",
        items: [],
        errorMessage: expectedMessage,
      };
    }

    if (__DEV__) console.error("[Scan] function invoke failed", err);
    return {
      status: "error",
      items: [],
      errorMessage: err instanceof Error ? err.message : "Unknown scan error",
    };
  }
}

/**
 * Validate a scan input before submitting.
 */
export function validateScanInput(input: ScanInput): string | null {
  if (!input.fileId) return "Property required";
  if (!input.roomId) return "Room required";

  if (input.images.length === 0) return "At least one photo required";

  if (
    input.mode === "multi_photo_room" &&
    input.images.length > MAX_MULTI_PHOTO_IMAGES
  ) {
    return `Maximum ${MAX_MULTI_PHOTO_IMAGES} photos per multi-photo scan`;
  }

  if (
    input.mode === "video_room" &&
    input.images.length > MAX_VIDEO_SCAN_FRAMES
  ) {
    return `Maximum ${MAX_VIDEO_SCAN_FRAMES} frames per video scan`;
  }

  return null;
}
