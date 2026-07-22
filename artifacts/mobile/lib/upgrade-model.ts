import type { CoverlyBillingPlan } from "@/lib/billing-entitlements";
import type { UsageAllowance } from "@/lib/usage-allowances-model";

export type UpgradePlanGroup = "plus" | "family";
export type UpgradeBillingPeriod = "monthly" | "annual" | "other";

export type UpgradePackageLike = {
  identifier: string;
  packageType?: string | null;
  product: {
    identifier: string;
    title?: string | null;
    description?: string | null;
    price: number;
    priceString?: string | null;
    currencyCode?: string | null;
  };
};

export type UpgradeDisplayPackage<T extends UpgradePackageLike = UpgradePackageLike> = {
  pkg: T;
  plan: UpgradePlanGroup;
  period: UpgradeBillingPeriod;
  price: string;
  savingsPercent: number | null;
};

export type PlanComparisonRow = {
  label: string;
  free: string;
  plus: string;
  family: string;
};

function packageSearchText(pkg: UpgradePackageLike) {
  return [
    pkg.identifier,
    pkg.packageType,
    pkg.product.identifier,
    pkg.product.title,
    pkg.product.description,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function packagePlan(pkg: UpgradePackageLike): UpgradePlanGroup {
  return packageSearchText(pkg).includes("family") ? "family" : "plus";
}

export function packagePeriod(pkg: UpgradePackageLike): UpgradeBillingPeriod {
  if (pkg.packageType === "MONTHLY") return "monthly";
  if (pkg.packageType === "ANNUAL") return "annual";

  const value = packageSearchText(pkg);
  if (value.includes("annual") || value.includes("yearly") || value.includes("year")) return "annual";
  if (value.includes("monthly") || value.includes("month")) return "monthly";
  return "other";
}

export function packageDisplayPrice(pkg: UpgradePackageLike) {
  return pkg.product.priceString?.trim() || "Price unavailable";
}

export function calculateAnnualSavings(monthlyPrice: number, annualPrice: number): number | null {
  if (!Number.isFinite(monthlyPrice) || !Number.isFinite(annualPrice) || monthlyPrice <= 0 || annualPrice <= 0) return null;
  const monthlyForYear = monthlyPrice * 12;
  if (annualPrice >= monthlyForYear) return null;
  const percent = Math.round((1 - annualPrice / monthlyForYear) * 100);
  return percent > 0 && percent < 100 ? percent : null;
}

export function buildUpgradePackages<T extends UpgradePackageLike>(packages: T[]) {
  const base = packages.map((pkg) => ({
    pkg,
    plan: packagePlan(pkg),
    period: packagePeriod(pkg),
    price: packageDisplayPrice(pkg),
    savingsPercent: null as number | null,
  }));

  const withSavings = base.map((entry) => {
    if (entry.period !== "annual") return entry;
    const monthly = base.find((candidate) => candidate.plan === entry.plan && candidate.period === "monthly");
    const currenciesMatch = monthly
      && (!monthly.pkg.product.currencyCode
        || !entry.pkg.product.currencyCode
        || monthly.pkg.product.currencyCode === entry.pkg.product.currencyCode);
    return {
      ...entry,
      savingsPercent: monthly && currenciesMatch
        ? calculateAnnualSavings(monthly.pkg.product.price, entry.pkg.product.price)
        : null,
    };
  });

  const planOrder = { plus: 0, family: 1 };
  const periodOrder = { monthly: 0, annual: 1, other: 2 };
  withSavings.sort((a, b) => planOrder[a.plan] - planOrder[b.plan]
    || periodOrder[a.period] - periodOrder[b.period]
    || a.pkg.identifier.localeCompare(b.pkg.identifier));

  return {
    plus: withSavings.filter((entry) => entry.plan === "plus"),
    family: withSavings.filter((entry) => entry.plan === "family"),
  };
}

export function defaultBillingPeriod(
  packages: readonly UpgradeDisplayPackage[],
): UpgradeBillingPeriod | null {
  if (packages.some((entry) => entry.period === "annual")) return "annual";
  if (packages.some((entry) => entry.period === "monthly")) return "monthly";
  return packages[0]?.period ?? null;
}

export function selectedUpgradePackage<T extends UpgradePackageLike>(
  packages: readonly UpgradeDisplayPackage<T>[],
  period: UpgradeBillingPeriod | null,
): UpgradeDisplayPackage<T> | null {
  if (!period) return null;
  return packages.find((entry) => entry.period === period) ?? null;
}

export function upgradePackageHasPrice(entry: UpgradeDisplayPackage | null) {
  return Boolean(entry?.pkg.product.priceString?.trim());
}

export function upgradePurchaseDisabled(
  entry: UpgradeDisplayPackage | null,
  state: { purchaseLoading: boolean; isRefreshing: boolean; currentPackage: boolean },
) {
  return state.purchaseLoading
    || state.isRefreshing
    || state.currentPackage
    || !entry
    || !upgradePackageHasPrice(entry);
}

export function isCurrentPackage(productIdentifier: string, activeSubscriptions: readonly string[] | null | undefined) {
  return activeSubscriptions?.includes(productIdentifier) === true;
}

export function isCurrentPlan(plan: UpgradePlanGroup, effectivePlan: CoverlyBillingPlan) {
  return (plan === "plus" && effectivePlan === "coverly_plus")
    || (plan === "family" && effectivePlan === "coverly_family");
}

function configuredLimit(allowances: UsageAllowance[], feature: UsageAllowance["feature"]) {
  const value = allowances.find((allowance) => allowance.feature === feature)?.limitUnits;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function buildPlanComparison(allowances: UsageAllowance[]): PlanComparisonRow[] {
  const scans = configuredLimit(allowances, "ai_scan");
  const pricing = configuredLimit(allowances, "replacement_pricing");
  return [
    { label: "Properties", free: "1", plus: "1", family: "Multiple" },
    { label: "AI inventory scans", free: scans == null ? "Monthly allowance" : `${scans} / month`, plus: "Included (fair use)", family: "Included (fair use)" },
    { label: "Price searches", free: pricing == null ? "Monthly allowance" : `${pricing} / month`, plus: "Included (fair use)", family: "Included (fair use)" },
    { label: "Claim-pack exports", free: "Not included", plus: "Included", family: "Included" },
  ];
}
