export interface RefinementFunctionFailure {
  code?: string | number;
  errorCode?: string;
  message?: string;
  error?: string;
  requestId?: string;
}

export function replacementRefinementFailureMessage(status?: number, code?: string | number): string {
  const normalizedCode = typeof code === "string" ? code.toUpperCase() : undefined;
  if (["INVALID_AUTH_TOKEN", "AUTHENTICATED_USER_NOT_FOUND", "UNAUTHORIZED", "INVALID_JWT"].includes(normalizedCode ?? "")) {
    return "Your session has expired. Sign in again, then try improving the search.";
  }
  if (normalizedCode === "MISSING_SESSION" || normalizedCode === "MISSING_AUTH_TOKEN") {
    return "Sign in to use AI search improvement.";
  }
  if (normalizedCode === "SESSION_UNAVAILABLE") {
    return "We couldn’t verify your session. Please try again.";
  }
  if (normalizedCode === "ITEM_NOT_FOUND") {
    return "This item could not be accessed. Return to the item and try again.";
  }
  if (normalizedCode === "FUNCTION_CONFIGURATION_ERROR" || normalizedCode === "MISSING_API_KEY") {
    return "AI search improvement is not configured right now.";
  }
  if (status === 429 || normalizedCode === "AI_RATE_LIMITED") {
    return "AI search improvement is busy right now. Please try again shortly.";
  }
  if (normalizedCode === "SEARCH_TERM_REQUIRED") return "Add a Search Term before using AI.";
  return "AI search improvement is temporarily unavailable. Please try again.";
}

export function refinementFailureCode(
  status: number | undefined,
  failure: RefinementFunctionFailure | null | undefined,
): string | undefined {
  const rawCode = failure?.errorCode ?? failure?.code;
  if (typeof rawCode === "string" && rawCode.trim()) return rawCode.trim().toUpperCase();
  const message = `${failure?.message ?? ""} ${failure?.error ?? ""}`;
  if (status === 401 && /(?:invalid|expired|missing).*?(?:jwt|token)|unauthori[sz]ed/i.test(message)) {
    return "INVALID_JWT";
  }
  return undefined;
}

export async function readRefinementFunctionFailure(error: unknown): Promise<{
  status?: number;
  failure: RefinementFunctionFailure | null;
}> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof context !== "object"
    || typeof (context as { clone?: unknown }).clone !== "function"
    || typeof (context as { status?: unknown }).status !== "number") {
    return { failure: null };
  }
  const functionResponse = context as Response;
  let failure: RefinementFunctionFailure | null = null;
  try {
    failure = await functionResponse.clone().json() as RefinementFunctionFailure;
  } catch {
    // Non-JSON gateway responses are intentionally not shown to the user.
  }
  return { status: functionResponse.status, failure };
}
