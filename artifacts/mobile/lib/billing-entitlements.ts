export type CoverlyBillingPlan = "free" | "coverly_plus" | "coverly_family";

export type RevenueCatEntitlementLike = {
  identifier?: string | null;
  expirationDate?: string | null;
  periodType?: string | null;
};

export type RevenueCatCustomerInfoLike = {
  entitlements?: {
    active?: Record<string, RevenueCatEntitlementLike | undefined> | null;
  } | null;
};

export type RevenueCatEntitlementConfig = {
  plusEntitlementId: string | null;
  familyEntitlementId: string | null;
};

export type RevenueCatPlanState = {
  plan: Exclude<CoverlyBillingPlan, "free"> | null;
  entitlementId: string | null;
  subscriptionStatus: "active" | "trialing" | null;
  subscriptionPeriodEnd: string | null;
};

function cleanId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function activeEntitlement(info: RevenueCatCustomerInfoLike | null, id: string | null) {
  if (!id) return null;
  return info?.entitlements?.active?.[id] ?? null;
}

function statusFor(entitlement: RevenueCatEntitlementLike | null): "active" | "trialing" | null {
  if (!entitlement) return null;
  return entitlement.periodType?.toLowerCase() === "trial" ? "trialing" : "active";
}

export function resolveRevenueCatPlan(
  customerInfo: RevenueCatCustomerInfoLike | null,
  config: RevenueCatEntitlementConfig,
): RevenueCatPlanState {
  const familyEntitlementId = cleanId(config.familyEntitlementId);
  const plusEntitlementId = cleanId(config.plusEntitlementId);
  const activeFamily = activeEntitlement(customerInfo, familyEntitlementId);
  if (activeFamily) {
    return {
      plan: "coverly_family",
      entitlementId: familyEntitlementId,
      subscriptionStatus: statusFor(activeFamily),
      subscriptionPeriodEnd: activeFamily.expirationDate ?? null,
    };
  }

  const activePlus = activeEntitlement(customerInfo, plusEntitlementId);
  if (activePlus) {
    return {
      plan: "coverly_plus",
      entitlementId: plusEntitlementId,
      subscriptionStatus: statusFor(activePlus),
      subscriptionPeriodEnd: activePlus.expirationDate ?? null,
    };
  }

  return { plan: null, entitlementId: null, subscriptionStatus: null, subscriptionPeriodEnd: null };
}

export function hasActiveRevenueCatEntitlement(
  customerInfo: RevenueCatCustomerInfoLike | null,
  config: RevenueCatEntitlementConfig,
) {
  return resolveRevenueCatPlan(customerInfo, config).plan !== null;
}
