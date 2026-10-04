export type PropertyAccessClass =
  | "free"
  | "owner"
  | "plus"
  | "family"
  | "full_access"
  | "unknown";
export type PropertyAllowanceState = "loading" | "ready" | "unavailable";

export type PropertyAllowance = {
  state: PropertyAllowanceState;
  accessClass: PropertyAccessClass;
  propertyCount: number;
  propertyLimit: number | null;
  canCreateProperty: boolean;
  requiredPlan: string | null;
  blockReason: "property_limit_reached" | "entitlement_unavailable" | null;
};

export type PropertyAllowanceRpcRow = {
  access_class?: unknown;
  property_count?: unknown;
  property_limit?: unknown;
  can_create_property?: unknown;
  required_plan?: unknown;
  block_reason?: unknown;
};

const accessClasses = new Set<PropertyAccessClass>([
  "free",
  "owner",
  "plus",
  "family",
  "full_access",
]);

export function getPropertyAllowance(
  accessClass: PropertyAccessClass,
  propertyCount: number,
  state: PropertyAllowanceState = "ready",
): PropertyAllowance {
  // Legacy local helper retained for compatibility. RPC parsing below must never
  // use this plan-based fallback; only the server defines production limits.
  const safeCount =
    Number.isFinite(propertyCount) && propertyCount >= 0
      ? Math.floor(propertyCount)
      : 0;

  if (state !== "ready" || accessClass === "unknown") {
    return {
      state,
      accessClass: "unknown",
      propertyCount: safeCount,
      propertyLimit: 1,
      canCreateProperty: false,
      requiredPlan: null,
      blockReason: "entitlement_unavailable",
    };
  }

  const unlimited = accessClass === "family" || accessClass === "full_access";
  const canCreateProperty = unlimited || safeCount < 1;
  return {
    state: "ready",
    accessClass,
    propertyCount: safeCount,
    propertyLimit: unlimited ? null : 1,
    canCreateProperty,
    requiredPlan: canCreateProperty ? null : "coverly_family",
    blockReason: canCreateProperty ? null : "property_limit_reached",
  };
}

export function parsePropertyAllowance(
  row: PropertyAllowanceRpcRow | null | undefined,
): PropertyAllowance {
  const accessClass =
    typeof row?.access_class === "string" &&
    accessClasses.has(row.access_class as PropertyAccessClass)
      ? (row.access_class as PropertyAccessClass)
      : "unknown";
  const count = row?.property_count;
  const limit = row?.property_limit;
  const validCount =
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  const validLimit =
    limit === null ||
    (typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0);
  if (
    accessClass === "unknown" ||
    !validCount ||
    !validLimit ||
    typeof row?.can_create_property !== "boolean"
  ) {
    return unavailablePropertyAllowance("unavailable");
  }
  // Respect explicit server denials and fail closed on contradictory responses.
  const canCreateProperty =
    row.can_create_property && (limit === null || count < limit);
  return {
    state: "ready",
    accessClass,
    propertyCount: count,
    propertyLimit: limit,
    canCreateProperty,
    requiredPlan:
      !canCreateProperty && typeof row.required_plan === "string"
        ? row.required_plan
        : null,
    blockReason: canCreateProperty ? null : "property_limit_reached",
  };
}

export function unavailablePropertyAllowance(
  state: Extract<PropertyAllowanceState, "loading" | "unavailable">,
) {
  return getPropertyAllowance("unknown", 0, state);
}

export type PropertyAllowanceCopy = {
  title: string;
  body: string;
  benefit: string;
  primaryCta: string;
  secondaryCta: string;
  action: "purchase" | "dismiss" | "retry";
};

export function propertyAllowanceCopy(
  allowance: PropertyAllowance,
): PropertyAllowanceCopy {
  if (allowance.blockReason === "entitlement_unavailable") {
    return {
      title:
        allowance.state === "loading"
          ? "Checking your access"
          : "We couldn't check your access",
      body:
        allowance.state === "loading"
          ? "This will only take a moment."
          : "Check your connection and try again. Nothing has changed.",
      benefit: "",
      primaryCta: allowance.state === "loading" ? "Please wait" : "Try again",
      secondaryCta: "Continue with current property",
      action: "retry",
    };
  }

  const free = allowance.accessClass === "free";
  return {
    title: "You've reached your property limit",
    body: free ? "Free includes one property. Own Coverly with one purchase to document up to 5 properties. You can keep managing your existing inventory."
      : `Your current access includes ${allowance.propertyLimit ?? "your existing"} ${allowance.propertyLimit === 1 ? "property" : "properties"}. Keep managing your existing inventory; another purchase is not needed.`,
    benefit: "",
    primaryCta: free ? "Own Coverly" : "Back to my properties",
    secondaryCta: "Continue with current property",
    action: free ? "purchase" : "dismiss",
  };
}
