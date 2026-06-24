/**
 * Scan service for Coverly AI-assisted inventory detection.
 *
 * ARCHITECTURE RULES (do not violate):
 * - The mobile app MUST NOT call OpenAI directly. All AI processing goes through
 *   the scan-room-photo Supabase Edge Function so API keys never leave the backend.
 * - Images are base64-encoded at pick time (ImagePicker base64:true option).
 *   The encoded data is sent directly in the Edge Function request body.
 *   No storage upload is required for AI scanning.
 * - Scan results are normalised to ScanDetectedItem[] then saved via
 *   buildItemInsertPayload — the same path as Manual Add Item.
 *
 * Deployment checklist (manual steps required):
 *   1. supabase functions deploy scan-room-photo --no-verify-jwt
 *   2. Set OPENAI_API_KEY in Supabase dashboard → Edge Functions → Secrets
 *   3. After deployment, SCAN_EDGE_FUNCTION_NAME below is already set correctly.
 */

import { anonKey, debugSupabaseUrl, supabase } from "@/lib/supabase";
import type { ScanDetectedItem, ScanInput, ScanResult } from "@/types/scan";

/**
 * Name of the Supabase Edge Function that handles AI scan processing.
 * Set to null to show the "not configured" state without throwing.
 */
const SCAN_EDGE_FUNCTION_NAME: string | null = "scan-room-photo";
const EXPECTED_SCAN_PROJECT_REF = "jqijavrugjidqzbbgpag";
const SCAN_INVOKE_TIMEOUT_MS = 90_000;

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

/**
 * Maximum images allowed per multi-photo scan batch.
 */
export const MAX_MULTI_PHOTO_IMAGES = 5;

/**
 * Map mobile ScanMode values to the production scan-room-photo mode strings.
 * single_item has no dedicated production mode — single_photo detects what is visible.
 */
function toProductionMode(
  mode: ScanInput["mode"]
): "single_photo" | "multi_photo" | "video_frames" {
  switch (mode) {
    case "single_photo_room":
    case "single_item":
      return "single_photo";
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

function scanLog(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[Scan] ${message}`, details);
  } else {
    console.info(`[Scan] ${message}`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.error("[Scan] timeout fired", {
        label,
        timeoutMs,
      });
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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

/**
 * Run an AI-assisted inventory scan via the scan-room-photo Edge Function.
 *
 * ScanInput.images must be pre-encoded (base64 from ImagePicker base64:true option).
 * The function maps the mobile payload to the production contract, handles
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
      fileId: input.fileId,
      roomId: input.roomId,
    });

    const productionPayload = {
      mode: toProductionMode(input.mode),
      usageIdempotencyKey: input.usageIdempotencyKey ?? createUsageIdempotencyKey(),
      images: input.images.map((img, i) => ({
        id: `photo_${i + 1}`,
        imageBase64: img.base64,
        mimeType: img.mimeType,
        sourceName: `photo_${i + 1}`,
      })),
      context: {
        fileId: input.fileId,
        roomName: input.roomName ?? undefined,
      },
    };

    const supabaseHost = new URL(debugSupabaseUrl).host;
    const usesExpectedProject = supabaseHost.startsWith(`${EXPECTED_SCAN_PROJECT_REF}.`);
    scanLog("payload construction completed", {
      productionMode: productionPayload.mode,
      hasUsageIdempotencyKey: !!productionPayload.usageIdempotencyKey,
      imageCount: productionPayload.images.length,
      approxBase64Chars: productionPayload.images.reduce((sum, img) => sum + img.imageBase64.length, 0),
      supabaseHost,
      expectedProjectRef: EXPECTED_SCAN_PROJECT_REF,
      usesExpectedProject,
    });

    if (!usesExpectedProject) {
      console.warn("[Scan] Supabase project ref mismatch", {
        expectedProjectRef: EXPECTED_SCAN_PROJECT_REF,
        supabaseHost,
      });
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    scanLog("auth session checked", {
      hasAccessToken: !!accessToken,
      hasSessionError: !!sessionError,
    });
    if (sessionError || !accessToken) {
      console.error("[Scan] function invoke failed", {
        message: sessionError?.message ?? "Missing Supabase session token",
      });
      return {
        status: "error",
        items: [],
        errorMessage: "You must be signed in to scan items.",
      };
    }

    const functionUrl = `${debugSupabaseUrl.replace(/\/$/, "")}/functions/v1/${SCAN_EDGE_FUNCTION_NAME}`;
    const requestBody = JSON.stringify(productionPayload);
    scanLog("function invoke started", {
      functionName: SCAN_EDGE_FUNCTION_NAME,
      functionUrl,
      requestBodyChars: requestBody.length,
      timeoutMs: SCAN_INVOKE_TIMEOUT_MS,
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
      SCAN_INVOKE_TIMEOUT_MS,
      "scan-room-photo invoke"
    );

    scanLog("HTTP status received", {
      status: response.status,
      ok: response.ok,
    });

    const responseText = await response.text();
    scanLog("response body received", {
      status: response.status,
      bodyChars: responseText.length,
      bodyPreview: responseText.slice(0, 240),
    });
    let data: ScanFunctionResponse | null = null;
    try {
      data = responseText ? JSON.parse(responseText) as ScanFunctionResponse : null;
    } catch {
      console.error("[Scan] function invoke failed", {
        status: response.status,
        responsePreview: responseText.slice(0, 500),
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
      console.error("[Scan] function invoke failed", {
        status: response.status,
        errorCode: data?.errorCode,
        message: data?.message,
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

    scanLog("function invoke returned", {
      success: data?.success,
      itemCount: Array.isArray(data?.items) ? data.items.length : 0,
      errorCode: data?.errorCode,
      edgeFunctionVersion: data?.edgeFunctionVersion ?? data?.diagnostics?.edgeFunctionVersion,
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

    return { status: "success", items };
  } catch (err) {
    console.error("[Scan] function invoke failed", err);
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

  if (input.mode === "video_room") {
    if (!input.videoUri) return "Video required for video scan";
    return null;
  }

  if (input.images.length === 0) return "At least one photo required";

  if (
    input.mode === "multi_photo_room" &&
    input.images.length > MAX_MULTI_PHOTO_IMAGES
  ) {
    return `Maximum ${MAX_MULTI_PHOTO_IMAGES} photos per multi-photo scan`;
  }

  return null;
}
