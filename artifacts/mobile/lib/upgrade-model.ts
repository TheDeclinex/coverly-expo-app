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
  paid: string;
};

export type PaidPlanComparisonRow = {
  label: string;
  plus: string;
  family: string;
};

export type AllPlanComparisonRow = {
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

export function isCurrentPackage(productIdentifier: string, activeSubscriptions: readonly string[] | null | undefined) {
  return activeSubscriptions?.includes(productIdentifier) === true;
}

export function isCurrentPlan(plan: UpgradePlanGroup, effectivePlan: CoverlyBillingPlan) {
  return (plan === "plus" && effectivePlan === "coverly_plus")
    || (plan === "family" && effectivePlan === "coverly_family");
}

export function upgradeHeader(effectivePlan: CoverlyBillingPlan) {
  if (effectivePlan === "free") {
    return {
      title: "Choose the cover that fits",
      planLabel: "Coverly Free",
      supportingText: "Add AI inventory tools, replacement pricing and claim-pack exports.",
      paid: false,
    };
  }
  return {
    title: "Your subscription",
    planLabel: effectivePlan === "coverly_family" ? "Coverly Family" : "Coverly Plus",
    supportingText: "Manage your subscription below.",
    paid: true,
  };
}

export function selectedPlanPackage<T extends UpgradePackageLike>(
  packages: UpgradeDisplayPackage<T>[],
  selectedPeriod: UpgradeBillingPeriod,
) {
  return packages.find((entry) => entry.period === selectedPeriod)
    ?? packages.find((entry) => entry.period === "annual")
    ?? packages.find((entry) => entry.period === "monthly")
    ?? packages[0]
    ?? null;
}

export function exactPeriodPackage<T extends UpgradePackageLike>(
  packages: UpgradeDisplayPackage<T>[],
  period: UpgradeBillingPeriod,
) {
  return packages.find((entry) => entry.period === period) ?? null;
}

export function activePlanPeriod<T extends UpgradePackageLike>(
  packages: UpgradeDisplayPackage<T>[],
  activeSubscriptions: readonly string[] | null | undefined,
): UpgradeBillingPeriod | null {
  return packages.find((entry) => isCurrentPackage(entry.pkg.product.identifier, activeSubscriptions))?.period ?? null;
}

export function planActionLabel({
  selectedPlan,
  selectedPeriod,
  effectivePlan,
  exactCurrentPackage,
}: {
  selectedPlan: UpgradePlanGroup;
  selectedPeriod: UpgradeBillingPeriod;
  effectivePlan: CoverlyBillingPlan;
  exactCurrentPackage: boolean;
}) {
  if (exactCurrentPackage) return "Current plan";
  if (isCurrentPlan(selectedPlan, effectivePlan)) {
    return `Change to ${selectedPeriod === "annual" ? "annual billing" : selectedPeriod === "monthly" ? "monthly billing" : "this billing cycle"}`;
  }
  if (effectivePlan === "coverly_plus" && selectedPlan === "family") return "Upgrade to Family";
  if (effectivePlan === "coverly_family" && selectedPlan === "plus") return "Switch to Plus";
  return `Upgrade to ${selectedPlan === "family" ? "Family" : "Plus"}`;
}

export function currentPlanCarouselIndex(effectivePlan: CoverlyBillingPlan) {
  if (effectivePlan === "coverly_plus") return 1;
  if (effectivePlan === "coverly_family") return 2;
  return 0;
}

export function buildAllPlanComparison(allowances: UsageAllowance[]): AllPlanComparisonRow[] {
  const free = buildPlanComparison(allowances);
  const freeValue = (label: string) => free.find((row) => row.label === label)?.free ?? "—";
  return [
    { label: "Properties", free: freeValue("Properties"), plus: "Additional", family: "Additional" },
    { label: "AI inventory scans", free: freeValue("AI inventory scans"), plus: "Fair use", family: "Fair use" },
    { label: "Price searches", free: freeValue("Price searches"), plus: "Fair use", family: "Fair use" },
    { label: "Claim-pack exports", free: "—", plus: "Included", family: "Included" },
    { label: "Family access", free: "—", plus: "—", family: "Coming soon" },
  ];
}

export function buildPaidPlanComparison(): PaidPlanComparisonRow[] {
  return [
    { label: "AI inventory tools", plus: "Included (fair use)", family: "Included (fair use)" },
    { label: "Price searches", plus: "Included (fair use)", family: "Included (fair use)" },
    { label: "Claim-pack exports", plus: "Included", family: "Included" },
    { label: "Properties", plus: "Additional properties", family: "Additional properties" },
    { label: "Family access", plus: "Individual account", family: "Planned" },
  ];
}

function configuredLimit(allowances: UsageAllowance[], feature: UsageAllowance["feature"]) {
  const value = allowances.find((allowance) => allowance.feature === feature)?.limitUnits;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function buildPlanComparison(allowances: UsageAllowance[]): PlanComparisonRow[] {
  const scans = configuredLimit(allowances, "ai_scan");
  const pricing = configuredLimit(allowances, "replacement_pricing");
  return [
    { label: "Properties", free: "1", paid: "Additional properties" },
    { label: "AI inventory scans", free: scans == null ? "Monthly allowance" : `${scans} / month`, paid: "Included (fair use)" },
    { label: "Price searches", free: pricing == null ? "Monthly allowance" : `${pricing} / month`, paid: "Included (fair use)" },
    { label: "Claim-pack exports", free: "Not included", paid: "Included" },
  ];
}
