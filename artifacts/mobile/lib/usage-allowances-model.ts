export type UsageFeature = "ai_scan" | "replacement_pricing";

export interface UsageAllowance {
  feature: UsageFeature;
  monthKey: string;
  monthStartDate: string | null;
  resetAt: string | null;
  effectivePlan: string | null;
  entitlementMode: string | null;
  isLimited: boolean;
  limitUnits: number;
  usedUnits: number;
  reservedUnits: number;
  remainingUnits: number | null;
  wouldBeBlocked: boolean;
}

export type UsageAllowanceRpcRow = {
  feature?: string | null;
  month_key?: string | null;
  month_start_date?: string | null;
  reset_at?: string | null;
  effective_plan?: string | null;
  entitlement_mode?: string | null;
  is_limited?: boolean | null;
  limit_units?: number | null;
  used_units?: number | null;
  reserved_units?: number | null;
  remaining_units?: number | null;
  would_be_blocked?: boolean | null;
};

function normaliseFeature(value: string | null | undefined): UsageFeature | null {
  return value === "ai_scan" || value === "replacement_pricing" ? value : null;
}

export function normaliseUsageAllowance(row: UsageAllowanceRpcRow): UsageAllowance | null {
  const feature = normaliseFeature(row.feature);
  if (!feature) return null;

  return {
    feature,
    monthKey: row.month_key ?? "",
    monthStartDate: row.month_start_date ?? null,
    resetAt: row.reset_at ?? null,
    effectivePlan: row.effective_plan ?? null,
    entitlementMode: row.entitlement_mode ?? null,
    isLimited: row.is_limited === true,
    limitUnits: Math.max(0, Math.round(Number(row.limit_units ?? 0))),
    usedUnits: Math.max(0, Math.round(Number(row.used_units ?? 0))),
    reservedUnits: Math.max(0, Math.round(Number(row.reserved_units ?? 0))),
    remainingUnits:
      typeof row.remaining_units === "number"
        ? Math.max(0, Math.round(row.remaining_units))
        : null,
    wouldBeBlocked: row.would_be_blocked === true,
  };
}

export function usageWarningLevel(
  allowance: UsageAllowance
): "none" | "low" | "empty" {
  if (!allowance.isLimited || allowance.remainingUnits == null) return "none";
  if (allowance.remainingUnits <= 0) return "empty";
  if (allowance.feature === "ai_scan" && allowance.remainingUnits <= 2) return "low";
  if (allowance.feature === "replacement_pricing" && allowance.remainingUnits <= 1) return "low";
  return "none";
}
