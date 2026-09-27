/** Version 1 of get_my_access_capabilities(). Server decisions, not client plan inference.
 * Purchase/profile UI adoption is a later batch. Ownership never implies unlimited AI.
 */
export type AccessCapabilities = {
  contract_version: 1;
  access_class:
    | "free"
    | "owner"
    | "legacy_plus"
    | "legacy_family"
    | "tester"
    | "admin"
    | "override";
  effective_plan:
    | "free"
    | "coverly_owned"
    | "coverly_plus"
    | "coverly_family"
    | "admin";
  owns_coverly: boolean;
  ownership_status: "none" | "owned" | "revoked";
  ownership_verification: "not_owned" | "verified" | "unverified" | "revoked";
  legacy_plan: "coverly_plus" | "coverly_family" | null;
  override_type: "none" | "tester" | "admin" | "support";
  property_limit: number | null;
  property_count: number;
  can_create_property: boolean;
  can_export_claim_pack: boolean;
  can_manage_inventory: boolean;
  can_access_evidence: boolean;
  ai_policy_class:
    | "free"
    | "owned"
    | "legacy_plus"
    | "legacy_family"
    | "tester"
    | "admin"
    | "override";
  ai_requires_metering: boolean;
  legacy_compatibility: boolean;
};
