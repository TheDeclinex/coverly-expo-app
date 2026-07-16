export type PropertyAccessClass = "free" | "plus" | "family" | "full_access" | "unknown";
export type PropertyAllowanceState = "loading" | "ready" | "unavailable";

export type PropertyAllowance = {
  state: PropertyAllowanceState;
  accessClass: PropertyAccessClass;
  propertyCount: number;
  propertyLimit: 1 | null;
  canCreateProperty: boolean;
  requiredPlan: "coverly_family" | null;
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

const accessClasses = new Set<PropertyAccessClass>(["free", "plus", "family", "full_access"]);

export function getPropertyAllowance(
  accessClass: PropertyAccessClass,
  propertyCount: number,
  state: PropertyAllowanceState = "ready",
): PropertyAllowance {
  const safeCount = Number.isFinite(propertyCount) && propertyCount >= 0 ? Math.floor(propertyCount) : 0;

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

export function parsePropertyAllowance(row: PropertyAllowanceRpcRow | null | undefined): PropertyAllowance {
  const accessClass = typeof row?.access_class === "string" && accessClasses.has(row.access_class as PropertyAccessClass)
    ? row.access_class as PropertyAccessClass
    : "unknown";
  const propertyCount = typeof row?.property_count === "number" ? row.property_count : 0;
  return getPropertyAllowance(accessClass, propertyCount, accessClass === "unknown" ? "unavailable" : "ready");
}

export function unavailablePropertyAllowance(state: Extract<PropertyAllowanceState, "loading" | "unavailable">) {
  return getPropertyAllowance("unknown", 0, state);
}

export type PropertyAllowanceCopy = {
  title: string;
  body: string;
  benefit: string;
  primaryCta: string;
  secondaryCta: string;
};

export function propertyAllowanceCopy(allowance: PropertyAllowance): PropertyAllowanceCopy {
  if (allowance.blockReason === "entitlement_unavailable") {
    return {
      title: allowance.state === "loading" ? "Checking your plan" : "We couldn't check your plan",
      body: allowance.state === "loading"
        ? "This will only take a moment."
        : "Check your connection and try again. Nothing has changed.",
      benefit: "",
      primaryCta: allowance.state === "loading" ? "Please wait" : "Try again",
      secondaryCta: "Continue with current property",
    };
  }

  return {
    title: "You've reached your property limit",
    body: "Your current plan includes one property.\n\nUpgrade to Coverly Family to add additional properties while continuing to manage your existing property.",
    benefit: "",
    primaryCta: "Upgrade to Family",
    secondaryCta: "Continue with current property",
  };
}
