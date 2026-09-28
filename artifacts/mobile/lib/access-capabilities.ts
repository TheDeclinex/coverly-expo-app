// Versioned server contract. RevenueCat and profile labels are never inputs.
export type AccessPlan =
  | "free"
  | "coverly_owned"
  | "coverly_plus"
  | "coverly_family"
  | "admin";
export type AccessClass =
  | "free"
  | "owner"
  | "legacy_plus"
  | "legacy_family"
  | "tester"
  | "admin"
  | "override";
export interface AccessCapabilities {
  effectivePlan: AccessPlan;
  accessClass: AccessClass;
  ownsCoverly: boolean;
  ownershipStatus: "none" | "owned" | "revoked";
  ownershipVerification: "verified" | "revoked" | "unverified" | "not_owned";
  propertyLimit: number | null;
  propertyCount: number;
  canCreateProperty: boolean;
  canExportClaimPack: boolean;
  canManageInventory: boolean;
  canAccessEvidence: boolean;
  aiRequiresMetering: boolean;
  aiPolicyClass: string;
  overrideType: string;
}
export function parseAccessCapabilities(value: unknown): AccessCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_ACCESS_RESPONSE");
  const a = value as Record<string, unknown>;
  const integer = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (
    a.contract_version !== 1 ||
    ![
      "free",
      "coverly_owned",
      "coverly_plus",
      "coverly_family",
      "admin",
    ].includes(a.effective_plan as string) ||
    ![
      "free",
      "owner",
      "legacy_plus",
      "legacy_family",
      "tester",
      "admin",
      "override",
    ].includes(a.access_class as string) ||
    !["verified", "revoked", "unverified", "not_owned"].includes(
      a.ownership_verification as string,
    ) ||
    !["none", "owned", "revoked"].includes(a.ownership_status as string) ||
    ![
      "free",
      "owned",
      "legacy_plus",
      "legacy_family",
      "tester",
      "admin",
      "override",
    ].includes(a.ai_policy_class as string) ||
    !["none", "support", "tester", "admin"].includes(
      a.override_type as string,
    ) ||
    typeof a.owns_coverly !== "boolean" ||
    typeof a.can_export_claim_pack !== "boolean" ||
    typeof a.can_manage_inventory !== "boolean" ||
    typeof a.can_access_evidence !== "boolean" ||
    typeof a.ai_requires_metering !== "boolean" ||
    typeof a.can_create_property !== "boolean" ||
    !integer(a.property_count) ||
    !(a.property_limit === null || integer(a.property_limit)) ||
    (a.owns_coverly && a.ownership_verification !== "verified") ||
    (a.owns_coverly && a.ownership_status !== "owned") ||
    (a.effective_plan === "free" && a.can_export_claim_pack) ||
    (a.access_class === "owner" &&
      (!a.owns_coverly || a.effective_plan !== "coverly_owned")) ||
    (a.effective_plan === "coverly_owned" && a.access_class !== "owner")
  )
    throw new Error("INVALID_ACCESS_RESPONSE");
  return {
    effectivePlan: a.effective_plan as AccessPlan,
    accessClass: a.access_class as AccessClass,
    ownsCoverly: a.owns_coverly,
    ownershipVerification:
      a.ownership_verification as AccessCapabilities["ownershipVerification"],
    ownershipStatus:
      a.ownership_status as AccessCapabilities["ownershipStatus"],
    propertyLimit: a.property_limit as number | null,
    propertyCount: a.property_count as number,
    canCreateProperty: a.can_create_property,
    canExportClaimPack: a.can_export_claim_pack,
    canManageInventory: a.can_manage_inventory,
    canAccessEvidence: a.can_access_evidence,
    aiRequiresMetering: a.ai_requires_metering,
    aiPolicyClass: a.ai_policy_class as string,
    overrideType: a.override_type as string,
  };
}

export function accessPlanLabel(
  plan: AccessPlan,
  accessClass?: AccessClass,
): string {
  if (accessClass === "tester") return "Tester";
  if (accessClass === "override") return "Support access";
  return {
    free: "Free",
    coverly_owned: "Owner",
    coverly_plus: "Plus",
    coverly_family: "Family",
    admin: "Admin",
  }[plan];
}
