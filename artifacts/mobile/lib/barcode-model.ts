export type BarcodeFailureKind =
  | "invalid"
  | "not-found"
  | "network"
  | "authentication"
  | "rate-limit"
  | "malformed-response"
  | "parse"
  | "service";

export function isSupportedBarcodeValue(value: string): boolean {
  return /^(?:\d{8}|\d{12}|\d{13})$/.test(value.trim());
}

export function classifyBarcodeFailure(errorCode?: string | null, message?: string | null): BarcodeFailureKind {
  const code = errorCode?.trim().toUpperCase() ?? "";
  const detail = message?.toLowerCase() ?? "";
  if (code === "PRODUCT_NOT_FOUND" || code === "NO_MATCH") return "not-found";
  if (code.includes("INVALID") || code.includes("UNREADABLE")) return "invalid";
  if (code.includes("NETWORK") || /network|fetch|offline|timed out|timeout/.test(detail)) return "network";
  if (code.includes("AUTH") || code === "UNAUTHORIZED" || /auth|unauthorized|expired session/.test(detail)) return "authentication";
  if (code.includes("RATE_LIMIT") || code.includes("TOO_FAST") || code.includes("EXCEED_LIMIT") || /rate.?limit|too many requests/.test(detail)) return "rate-limit";
  if (code.includes("MALFORMED") || /malformed|invalid response/.test(detail)) return "malformed-response";
  if (code.includes("PARSE") || /could not parse|failed to parse/.test(detail)) return "parse";
  return "service";
}
