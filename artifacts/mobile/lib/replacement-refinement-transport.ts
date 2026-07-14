import type { ReplacementAiSuggestion } from "./replacement-refinement-assist.ts";

export interface SafeFunctionFailure {
  errorCode?: string;
  message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maximum = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, maximum) : undefined;
}

export function safeFunctionFailure(value: unknown): SafeFunctionFailure {
  if (!isRecord(value)) return {};
  return {
    ...(safeText(value.errorCode, 80)
      ? { errorCode: safeText(value.errorCode, 80) }
      : {}),
    ...(safeText(value.error ?? value.message)
      ? { message: safeText(value.error ?? value.message) }
      : {}),
  };
}

export function validateRefinementFunctionEnvelope(
  value: unknown,
): { ok: true; suggestion: ReplacementAiSuggestion } | { ok: false } {
  if (
    !isRecord(value) ||
    value.success !== true ||
    !isRecord(value.suggestion)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    suggestion: value.suggestion as unknown as ReplacementAiSuggestion,
  };
}

export function refinementFailureMessage(input: {
  status?: number;
  errorType?: string;
  errorCode?: string;
}): string {
  if (input.status === 401 || input.errorCode === "UNAUTHORIZED") {
    return "Your session has expired. Sign in again and retry.";
  }
  if (input.status === 404) {
    return "AI refinement is not available in this app environment yet.";
  }
  if (
    input.status === 504 ||
    input.errorCode === "AI_REFINEMENT_TIMEOUT" ||
    input.errorType === "AbortError"
  ) {
    return "AI refinement took too long. You can still edit the search manually.";
  }
  if (
    input.errorCode === "INVALID_AI_RESPONSE" ||
    input.errorType === "SyntaxError"
  ) {
    return "AI refinement returned an invalid response. You can continue manually.";
  }
  return "AI refinement is temporarily unavailable. You can continue manually.";
}
