import type { OwnershipAction } from "./analytics-core.ts";
import type { AccessCapabilities } from "./access-capabilities.ts";
import type {
  VerificationState,
  RecoveryResult,
} from "./entitlement-controller.ts";

export const OWNERSHIP_ENTITLEMENT = "coverly_owned";
export type OwnershipMapping = {
  productId: string | null;
  packageId: string | null;
};
export type OwnershipPackage = {
  identifier: string;
  packageType: string;
  product: {
    identifier: string;
    price: number;
    priceString: string;
    subscriptionPeriod?: string | null;
    productCategory?: string | null;
  };
};
export function selectOwnershipPackage<T extends OwnershipPackage>(
  packages: readonly T[],
  mapping: OwnershipMapping,
): T | null {
  if (!mapping.productId?.trim() || !mapping.packageId?.trim()) return null;
  const matches = packages.filter(
    (pkg) =>
      pkg?.identifier === mapping.packageId &&
      pkg?.product?.identifier === mapping.productId,
  );
  if (matches.length !== 1) return null;
  const pkg = matches[0];
  // Explicit identity AND store shape. Never infer ownership from marketing text.
  if (
    pkg.packageType !== "LIFETIME" ||
    pkg.product.subscriptionPeriod !== null ||
    (pkg.product.productCategory != null &&
      pkg.product.productCategory !== "NON_SUBSCRIPTION") ||
    typeof pkg.product.price !== "number" ||
    !Number.isFinite(pkg.product.price) ||
    pkg.product.price <= 0 ||
    typeof pkg.product.priceString !== "string" ||
    !pkg.product.priceString.trim()
  )
    return null;
  return pkg;
}
export type OwnershipScreenState =
  | "owned"
  | "legacy"
  | "included"
  | "pending"
  | "busy"
  | "checking"
  | "verification_unavailable"
  | "available"
  | "unavailable";
export function ownershipScreenState(input: {
  access: AccessCapabilities | null;
  verification: VerificationState | "pending";
  pending: boolean;
  busy: boolean;
  productAvailable: boolean;
}): OwnershipScreenState {
  if (input.access?.ownsCoverly) return "owned";
  if (input.pending) return "pending";
  if (
    input.access?.accessClass === "legacy_plus" ||
    input.access?.accessClass === "legacy_family"
  )
    return "legacy";
  if (
    input.access &&
    ["admin", "tester", "override"].includes(input.access.accessClass)
  )
    return "included";
  if (input.busy) return "busy";
  if (!input.access)
    return input.verification === "loading" ||
      input.verification === "reconciling"
      ? "checking"
      : "verification_unavailable";
  if (
    input.verification === "unavailable" ||
    input.verification === "auth_required"
  )
    return "verification_unavailable";
  return input.productAvailable ? "available" : "unavailable";
}
export const OWNERSHIP_BENEFITS = [
  "AI-assisted household inventory",
  "Replacement-price research",
  "Photos, receipts and evidence together",
  "Claim-ready PDF export",
  "Up to 5 properties",
] as const;
export const FAIR_USE_COPY =
  "Normal household use is included. AI features have fair-use limits that refresh periodically to keep the one-time purchase sustainable. Your inventory and manual tools remain available.";
export function ownershipOutcome(result: RecoveryResult): OwnershipAction {
  if (result.pending) return "verification_pending";
  if (result.cancelled) return "purchase_cancelled";
  if (result.outcome === "nothing_found") return "restore_nothing_found";
  if (
    result.outcome === "owner_restored" ||
    result.outcome === "legacy_restored"
  )
    return "restore_succeeded";
  if (result.outcome === "confirmed") return "ownership_confirmed";
  return "purchase_failed";
}
export function deletionPurchaseCopy(legacy: boolean) {
  return legacy
    ? {
        title: "Your legacy subscription",
        body: "Deleting your Coverly account does not cancel an Apple App Store or Google Play subscription. Manage or cancel it separately through your store subscription settings.",
      }
    : {
        title: "Your purchase and account data",
        body: "Deletion removes your Coverly account data according to this deletion process. Your App Store or Google Play purchase history remains with your store account. Restore Purchases requires store verification and association with a Coverly account; contact support if you need help. Restoring a purchase does not restore deleted inventory.",
      };
}
