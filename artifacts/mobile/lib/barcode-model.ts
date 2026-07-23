export type BarcodeFailureKind = "invalid" | "not-found" | "network" | "service";

export function isSupportedBarcodeValue(value: string): boolean {
  return /^(?:\d{8}|\d{12}|\d{13})$/.test(value.trim());
}

export function classifyBarcodeFailure(errorCode?: string | null, message?: string | null): BarcodeFailureKind {
  const code = errorCode?.trim().toUpperCase() ?? "";
  const detail = message?.toLowerCase() ?? "";
  if (code === "PRODUCT_NOT_FOUND" || code === "NO_MATCH") return "not-found";
  if (code.includes("INVALID") || code.includes("UNREADABLE")) return "invalid";
  if (code.includes("NETWORK") || /network|fetch|offline|timed out|timeout/.test(detail)) return "network";
  return "service";
}
