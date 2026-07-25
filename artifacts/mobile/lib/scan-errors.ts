import type { ScanResult } from "@/types/scan";

export type PublicScanFailureCategory =
  | "authentication"
  | "limit"
  | "upload"
  | "timeout"
  | "network"
  | "request"
  | "service"
  | "unexpected";

export function scanFailureCategory(
  result: Pick<ScanResult, "errorCode" | "errorMessage" | "httpStatus">,
): PublicScanFailureCategory {
  const code = result.errorCode?.toUpperCase() ?? "";
  const message = result.errorMessage?.toLowerCase() ?? "";
  if (result.httpStatus === 401 || result.httpStatus === 403) return "authentication";
  if (result.httpStatus === 402) return "limit";
  if (code === "SCAN_UPLOAD_FAILED") return "upload";
  if (code === "SCAN_TIMEOUT" || /timed out|timeout/.test(message)) return "timeout";
  if (code === "SCAN_NETWORK_ERROR" || /network|offline|failed to fetch|connection/.test(message)) return "network";
  if (result.httpStatus != null && result.httpStatus >= 400 && result.httpStatus < 500) return "request";
  if (result.httpStatus != null && result.httpStatus >= 500) return "service";
  if (code) return "service";
  return "unexpected";
}

export function publicScanFailureMessage(
  result: Pick<ScanResult, "errorCode" | "errorMessage" | "httpStatus">,
): string {
  switch (scanFailureCategory(result)) {
    case "authentication":
      return "Your session could not be verified. No items were saved. Sign in again, then retry the scan.";
    case "limit":
      return "Your scan allowance has been reached. No items were saved. Choose an available option to continue.";
    case "upload":
      return "The photo could not be submitted. No items were saved. Check your connection and try again.";
    case "timeout":
      return "The photo may have reached Coverly, but the scan timed out and no items were saved. Retry with the same photo.";
    case "network":
      return "The connection was interrupted, so the photo may not have reached Coverly. No items were saved. Check your connection and retry.";
    case "request":
      return "Coverly could not process this photo. No items were saved. Try another photo or a clearer angle.";
    case "service":
      return "The photo reached Coverly, but processing could not finish. No items were saved. Please try again shortly.";
    default:
      return "Coverly could not complete the scan. No items were saved. Please try again.";
  }
}
