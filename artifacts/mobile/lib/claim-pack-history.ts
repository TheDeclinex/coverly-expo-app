export type ClaimPackHistoryStatus = "openable" | "failed" | "legacy" | "pending";

export interface ClaimPackHistoryStateInput {
  status?: string | null;
  storage_path?: string | null;
  generation_error?: string | null;
}

const READY_STATUSES = new Set(["ready", "generated", "complete", "completed", "success"]);
const FAILED_STATUSES = new Set(["failed", "error"]);
const PENDING_STATUSES = new Set(["draft", "pending", "processing", "queued"]);

export function getClaimPackHistoryStatus(pack: ClaimPackHistoryStateInput): ClaimPackHistoryStatus {
  const status = pack.status?.trim().toLowerCase() ?? "";
  if (pack.generation_error || FAILED_STATUSES.has(status)) return "failed";
  if (pack.storage_path?.trim() && (!status || READY_STATUSES.has(status) || PENDING_STATUSES.has(status))) return "openable";
  if (PENDING_STATUSES.has(status)) return "pending";
  return "legacy";
}

export function claimPackHistoryValueLabel(status: ClaimPackHistoryStatus, isOpening = false): string {
  if (isOpening) return "Opening...";
  if (status === "openable") return "Open PDF";
  if (status === "failed") return "Failed";
  if (status === "pending") return "Processing";
  return "Legacy pack";
}

export function safeClaimPackPdfFilename(
  filename: string | null | undefined,
  fallbackName: string | null | undefined,
): string {
  const source = filename?.trim() || `Coverly-Claim-Pack-${fallbackName?.trim() || "Export"}`;
  const withoutExtension = source.replace(/\.pdf$/i, "");
  const safe = withoutExtension
    .replace(/[\\/]/g, "-")
    .replace(/[<>:"|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${safe || "Coverly-Claim-Pack"}.pdf`;
}
