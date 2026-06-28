import { supabase } from "@/lib/supabase";
import type { ClaimPackGenerateDraftPayload } from "@/lib/claim-pack-selection-model";

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
  status?: number | null;
  errorCode?: string | null;
  message?: string | null;
  body?: unknown;
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
  return typeof status === "number" ? status : null;
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

function logClaimPackExport(stage: string, details: Record<string, unknown>): void {
  if (!isDevelopment()) return;
  if (__DEV__) console.info("[claim-pack-export]", stage, details);
}

export async function generateClaimPackPdf(
  payload: ClaimPackGenerateDraftPayload,
): Promise<GenerateClaimPackPdfSuccess> {
  logClaimPackExport("invoke_request", {
    propertyIdPresent: Boolean(payload.propertyId),
    selectedRoomCount: payload.selectedRoomIds.length,
    selectedItemCount: payload.selectedItemIds.length,
    scope: payload.scope,
    clientDraftIdPresent: Boolean(payload.clientDraftId),
    claimNotePresent: Boolean(payload.claimNote),
  });

  const { data, error } = await supabase.functions.invoke<GenerateClaimPackPdfResponse>(
    "generate-claim-pack",
    { body: payload },
  );

  if (error) {
    const body = await readFunctionErrorBody(error);
    const diagnostics = {
      status: errorStatus(error),
      errorCode: errorCode(body),
      message: responseMessage(body) ?? error.message ?? null,
      body,
    };
    logClaimPackExport("invoke_error", {
      status: diagnostics.status,
      errorCode: diagnostics.errorCode,
      message: diagnostics.message,
      exceptionName: error.name,
      exceptionMessage: error.message,
    });
    throw new ClaimPackExportError(
      diagnostics.message || "We couldn't generate your claim pack PDF. Please try again.",
      diagnostics,
    );
  }

  if (!isSuccessResponse(data)) {
    const diagnostics = {
      status: null,
      errorCode: errorCode(data),
      message: responseMessage(data),
      body: data,
    };
    logClaimPackExport("unexpected_response", {
      errorCode: diagnostics.errorCode,
      message: diagnostics.message,
      success: data?.success ?? null,
    });
    throw new ClaimPackExportError(
      diagnostics.message ?? "We couldn't generate your claim pack PDF. Please try again.",
      diagnostics,
    );
  }

  logClaimPackExport("invoke_success", {
    claimPackIdPresent: data.claimPackId !== undefined && data.claimPackId !== null,
    signedUrlPresent: Boolean(data.signedUrl),
    filenamePresent: Boolean(data.filename),
    rendererVersion: data.rendererVersion ?? null,
    emailSent: data.emailSent ?? null,
  });

  return data;
}
