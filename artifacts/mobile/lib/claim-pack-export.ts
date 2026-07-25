import { friendlyNetworkErrorMessage } from "@/lib/network-errors";
import {
  debugExpectedSupabaseProjectRef,
  debugSupabaseHost,
  debugSupabaseProjectRef,
  debugSupabaseProjectRefMatchesExpected,
  supabase,
} from "@/lib/supabase";
import type { ClaimPackGenerateDraftPayload } from "@/lib/claim-pack-selection-model";

export const CLAIM_PACK_GENERATE_FUNCTION_NAME = "generate-claim-pack";

export interface GenerateClaimPackPdfSuccess {
  success: true;
  claimPackId: string | number;
  signedUrl: string;
  rendererVersion?: string | null;
  filename?: string | null;
  generatedAt?: string | null;
  totals?: Record<string, unknown> | null;
  emailSent?: boolean;
  emailWarning?: string | null;
}

export interface GenerateClaimPackPdfFailure {
  success: false;
  error?: string;
  message?: string;
}

export type GenerateClaimPackPdfResponse = GenerateClaimPackPdfSuccess | GenerateClaimPackPdfFailure;

interface ClaimPackExportDiagnostics {
  reason?: "prepare_failed" | "edge_function_error" | "network_error" | "unexpected_response";
  status?: number | null;
  errorCode?: string | null;
  message?: string | null;
  body?: unknown;
}

export interface ClaimPackPdfDiagnosticsContext {
  fileId?: string | null;
  clientDraftId?: string | null;
  claimPackId?: string | number | null;
  selectedRoomCount?: number | null;
  selectedItemCount?: number | null;
  evidenceCount?: number | null;
  hasEvidence?: boolean | null;
  functionName?: string;
  supabaseProjectRef?: string | null;
  expectedSupabaseProjectRef?: string | null;
  supabaseProjectRefMatchesExpected?: boolean | null;
  supabaseHost?: string | null;
  status?: number | null;
  errorCode?: string | null;
  message?: string | null;
}

export class ClaimPackExportError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: ClaimPackExportDiagnostics = {},
  ) {
    super(message);
    this.name = "ClaimPackExportError";
  }
}

function isDevelopment(): boolean {
  return typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
}

function isSuccessResponse(value: unknown): value is GenerateClaimPackPdfSuccess {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<GenerateClaimPackPdfSuccess>;
  return response.success === true && typeof response.signedUrl === "string" && response.signedUrl.length > 0;
}

function responseMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const message = (value as Partial<GenerateClaimPackPdfFailure>).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as Partial<GenerateClaimPackPdfFailure>).error;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  if (typeof status === "number") return status;
  const context = record.context;
  if (context && typeof context === "object") {
    const contextStatus = (context as Record<string, unknown>).status;
    if (typeof contextStatus === "number") return contextStatus;
  }
  return null;
}

function isLikelyInvokeNetworkError(error: unknown): boolean {
  if (friendlyNetworkErrorMessage(error)) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /network|fetch|offline|timed out|timeout|connection/i.test(message);
}

function safeErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return null;
}

async function readFunctionErrorBody(error: unknown): Promise<unknown> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object" || !("json" in context)) return null;
  try {
    return await (context as Response).json();
  } catch {
    return null;
  }
}

function baseClaimPackDiagnostics(payload?: ClaimPackGenerateDraftPayload | null): ClaimPackPdfDiagnosticsContext {
  return {
    fileId: payload?.propertyId ?? null,
    clientDraftId: payload?.clientDraftId ?? null,
    selectedRoomCount: payload?.selectedRoomIds.length ?? null,
    selectedItemCount: payload?.selectedItemIds.length ?? null,
    functionName: CLAIM_PACK_GENERATE_FUNCTION_NAME,
    supabaseProjectRef: debugSupabaseProjectRef,
    supabaseProjectRefMatchesExpected: debugSupabaseProjectRefMatchesExpected,
    supabaseHost: debugSupabaseHost,
  };
}

function logClaimPackExport(stage: string, details: ClaimPackPdfDiagnosticsContext): void {
  if (!isDevelopment()) return;
  if (__DEV__) console.info("[claim-pack-export]", stage, details);
}

export function logClaimPackPdfDiagnostic(
  stage:
    | "claim_pack_pdf_button_pressed"
    | "claim_pack_generate_prepare_started"
    | "claim_pack_generate_prepare_failed"
    | "claim_pack_generate_invoke_started"
    | "claim_pack_generate_invoke_completed"
    | "claim_pack_generate_invoke_failed",
  details: ClaimPackPdfDiagnosticsContext,
): void {
  logClaimPackExport(stage, {
    functionName: CLAIM_PACK_GENERATE_FUNCTION_NAME,
    supabaseProjectRef: debugSupabaseProjectRef,
    supabaseProjectRefMatchesExpected: debugSupabaseProjectRefMatchesExpected,
    supabaseHost: debugSupabaseHost,
    expectedSupabaseProjectRef: debugExpectedSupabaseProjectRef,
    ...details,
  });
}

export async function generateClaimPackPdf(
  payload: ClaimPackGenerateDraftPayload,
): Promise<GenerateClaimPackPdfSuccess> {
  const baseDiagnostics = baseClaimPackDiagnostics(payload);
  if (!payload.propertyId || !payload.clientDraftId || payload.selectedItemIds.length === 0) {
    const diagnostics = {
      ...baseDiagnostics,
      reason: "prepare_failed" as const,
      errorCode: "INVALID_CLAIM_PACK_PAYLOAD",
      message: "Claim pack PDF could not be prepared before the request was sent.",
    };
    logClaimPackPdfDiagnostic("claim_pack_generate_prepare_failed", diagnostics);
    throw new ClaimPackExportError(diagnostics.message, diagnostics);
  }

  let invokeResult: { data: GenerateClaimPackPdfResponse | null; error: Error | null };
  try {
    invokeResult = await supabase.functions.invoke<GenerateClaimPackPdfResponse>(
      CLAIM_PACK_GENERATE_FUNCTION_NAME,
      { body: payload },
    );
  } catch (error) {
    const friendlyMessage = friendlyNetworkErrorMessage(error);
    if (friendlyMessage || isLikelyInvokeNetworkError(error)) {
      throw new ClaimPackExportError(friendlyMessage ?? "Network error while contacting claim pack generation.", {
        reason: "network_error",
        errorCode: "NETWORK_UNAVAILABLE",
        message: safeErrorMessage(error),
      });
    }
    throw new ClaimPackExportError("Claim pack PDF generation failed before the request could complete.", {
      reason: "prepare_failed",
      errorCode: "INVOKE_THROWN_BEFORE_RESPONSE",
      message: safeErrorMessage(error),
    });
  }

  const { data, error } = invokeResult;

  if (error) {
    const body = await readFunctionErrorBody(error);
    const diagnostics = {
      reason: "edge_function_error" as const,
      status: errorStatus(error),
      errorCode: errorCode(body),
      message: responseMessage(body) ?? error.message ?? null,
      body,
    };
    throw new ClaimPackExportError(
      diagnostics.message || "We couldn't generate your claim pack PDF. Please try again.",
      diagnostics,
    );
  }

  if (!isSuccessResponse(data)) {
    const diagnostics = {
      reason: "unexpected_response" as const,
      status: null,
      errorCode: errorCode(data),
      message: responseMessage(data),
      body: data,
    };
    throw new ClaimPackExportError(
      diagnostics.message ?? "We couldn't generate your claim pack PDF. Please try again.",
      diagnostics,
    );
  }
  return data;
}
