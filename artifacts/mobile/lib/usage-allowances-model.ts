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
  policyClass?: string | null;
  isBypassed?: boolean;
  blocked?: boolean;
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
  policy_class?: string | null;
  is_bypassed?: boolean | null;
  blocked?: boolean | null;
};

function normaliseFeature(
  value: string | null | undefined,
): UsageFeature | null {
  return value === "ai_scan" || value === "replacement_pricing" ? value : null;
}

export function normaliseUsageAllowance(
  row: UsageAllowanceRpcRow,
): UsageAllowance | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const feature = normaliseFeature(row.feature);
  if (!feature) return null;
  if (
    typeof row.is_limited !== "boolean" ||
    typeof row.limit_units !== "number"
  )
    return null;
  const validUnits = (v: unknown) =>
    v == null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
  if (
    ![
      row.limit_units,
      row.used_units,
      row.reserved_units,
      row.remaining_units,
    ].every(validUnits)
  )
    return null;
  const owner = row.policy_class === "owned";
  if (
    owner &&
    (row.is_limited !== true ||
      row.is_bypassed === true ||
      row.remaining_units == null ||
      row.limit_units == null)
  )
    return null;
  if (row.is_limited === true && row.remaining_units == null) return null;
  if (
    row.remaining_units != null &&
    row.limit_units != null &&
    row.remaining_units > row.limit_units
  )
    return null;
  if (
    row.is_limited &&
    row.remaining_units !==
      Math.max(
        0,
        row.limit_units - (row.used_units ?? 0) - (row.reserved_units ?? 0),
      )
  )
    return null;

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
    policyClass: row.policy_class ?? null,
    isBypassed:
      row.is_bypassed === true ||
      (row.policy_class == null && row.is_limited === false),
    blocked:
      row.blocked === true ||
      (row.blocked == null &&
        row.entitlement_mode === "enforced" &&
        row.would_be_blocked === true),
  };
}

export function usageOperationRecovery(
  code: string,
):
  | "wait"
  | "completed"
  | "new_operation"
  | "invalid"
  | "allowance"
  | "service"
  | null {
  if (code === "OPERATION_IN_PROGRESS") return "wait";
  if (code === "OPERATION_COMPLETED") return "completed";
  if (
    ["OPERATION_REFUNDED", "OPERATION_EXPIRED", "OPERATION_DENIED"].includes(
      code,
    )
  )
    return "new_operation";
  if (["IDEMPOTENCY_CONFLICT", "INVALID_WORKLOAD"].includes(code))
    return "invalid";
  if (["FREE_ALLOWANCE_EXHAUSTED", "OWNER_FAIR_USE_EXHAUSTED"].includes(code))
    return "allowance";
  return code.startsWith("USAGE_") ? "service" : null;
}

export function usageWarningLevel(
  allowance: UsageAllowance,
): "none" | "low" | "empty" {
  if (!allowance.isLimited || allowance.remainingUnits == null) return "none";
  if (allowance.remainingUnits <= 0) return "empty";
  if (allowance.feature === "ai_scan" && allowance.remainingUnits <= 2)
    return "low";
  if (
    allowance.feature === "replacement_pricing" &&
    allowance.remainingUnits <= 1
  )
    return "low";
  return "none";
}
