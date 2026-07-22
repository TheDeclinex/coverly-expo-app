import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlanComparison,
  buildUpgradePackages,
  calculateAnnualSavings,
  defaultBillingPeriod,
  isCurrentPackage,
  isCurrentPlan,
  packageDisplayPrice,
  selectedUpgradePackage,
  upgradePackageHasPrice,
  upgradePurchaseDisabled,
  type UpgradePackageLike,
} from "../upgrade-model.ts";

function pkg(identifier: string, packageType: string, price: number, priceString: string): UpgradePackageLike {
  return {
    identifier,
    packageType,
    product: {
      identifier: `${identifier}.product`,
      title: identifier.includes("family") ? "Coverly Family" : "Coverly Plus",
      description: "Subscription",
      price,
      priceString,
    },
  };
}

test("keeps RevenueCat's localised price string as the displayed source", () => {
  assert.equal(packageDisplayPrice(pkg("plus-monthly", "MONTHLY", 9.99, "NZ$9.99")), "NZ$9.99");
  assert.equal(packageDisplayPrice(pkg("plus-monthly", "MONTHLY", 9.99, "  €6,99  ")), "€6,99");
  assert.equal(packageDisplayPrice(pkg("plus-monthly", "MONTHLY", 9.99, "")), "Price unavailable");
});

test("maps all four billing options while preserving the exact package used for display", () => {
  const plusMonthly = pkg("plus-monthly", "MONTHLY", 9.99, "NZ$9.99");
  const plusAnnual = pkg("plus-annual", "ANNUAL", 99.99, "NZ$99.99");
  const familyMonthly = pkg("family-monthly", "MONTHLY", 14.99, "NZ$14.99");
  const familyAnnual = pkg("family-annual", "ANNUAL", 159.99, "NZ$159.99");
  const grouped = buildUpgradePackages([familyAnnual, plusAnnual, familyMonthly, plusMonthly]);

  assert.deepEqual(grouped.plus.map(({ period }) => period), ["monthly", "annual"]);
  assert.deepEqual(grouped.family.map(({ period }) => period), ["monthly", "annual"]);
  assert.equal(grouped.plus[0]?.pkg, plusMonthly);
  assert.equal(grouped.plus[1]?.pkg, plusAnnual);
  assert.equal(grouped.family[0]?.pkg, familyMonthly);
  assert.equal(grouped.family[1]?.pkg, familyAnnual);
  assert.equal(grouped.plus[0]?.price, plusMonthly.product.priceString);
  assert.equal(grouped.family[1]?.price, familyAnnual.product.priceString);
});

test("defaults each plan to annual and switches to the exact selected RevenueCat package", () => {
  const plusMonthly = pkg("plus-monthly", "MONTHLY", 9.99, "NZ$9.99");
  const plusAnnual = pkg("plus-annual", "ANNUAL", 99.99, "NZ$99.99");
  const familyMonthly = pkg("family-monthly", "MONTHLY", 14.99, "NZ$14.99");
  const familyAnnual = pkg("family-annual", "ANNUAL", 149.99, "NZ$149.99");
  const grouped = buildUpgradePackages([plusMonthly, familyAnnual, plusAnnual, familyMonthly]);

  assert.equal(defaultBillingPeriod(grouped.plus), "annual");
  assert.equal(defaultBillingPeriod(grouped.family), "annual");
  assert.equal(selectedUpgradePackage(grouped.plus, "monthly")?.pkg, plusMonthly);
  assert.equal(selectedUpgradePackage(grouped.plus, "annual")?.pkg, plusAnnual);
  assert.equal(selectedUpgradePackage(grouped.family, "monthly")?.pkg, familyMonthly);
  assert.equal(selectedUpgradePackage(grouped.family, "annual")?.pkg, familyAnnual);
});

test("falls back to an available period and treats a missing localised price as unavailable", () => {
  const monthlyOnly = buildUpgradePackages([
    pkg("plus-monthly", "MONTHLY", 9.99, "NZ$9.99"),
  ]).plus;
  const missingPrice = buildUpgradePackages([
    pkg("family-annual", "ANNUAL", 149.99, ""),
  ]).family;

  assert.equal(defaultBillingPeriod(monthlyOnly), "monthly");
  assert.equal(selectedUpgradePackage(monthlyOnly, "annual"), null);
  assert.equal(upgradePackageHasPrice(selectedUpgradePackage(monthlyOnly, "monthly")), true);
  assert.equal(upgradePackageHasPrice(selectedUpgradePackage(missingPrice, "annual")), false);
  assert.equal(upgradePackageHasPrice(null), false);
});

test("disables purchase for missing prices, store loading, refresh, and the current package", () => {
  const available = buildUpgradePackages([
    pkg("plus-annual", "ANNUAL", 99.99, "NZ$99.99"),
  ]).plus[0] ?? null;
  const missingPrice = buildUpgradePackages([
    pkg("plus-annual", "ANNUAL", 99.99, ""),
  ]).plus[0] ?? null;
  const ready = { purchaseLoading: false, isRefreshing: false, currentPackage: false };

  assert.equal(upgradePurchaseDisabled(available, ready), false);
  assert.equal(upgradePurchaseDisabled(null, ready), true);
  assert.equal(upgradePurchaseDisabled(missingPrice, ready), true);
  assert.equal(upgradePurchaseDisabled(available, { ...ready, purchaseLoading: true }), true);
  assert.equal(upgradePurchaseDisabled(available, { ...ready, isRefreshing: true }), true);
  assert.equal(upgradePurchaseDisabled(available, { ...ready, currentPackage: true }), true);
});

test("calculates annual savings only from valid numeric matching prices", () => {
  assert.equal(calculateAnnualSavings(10, 84), 30);
  assert.equal(calculateAnnualSavings(10, 120), null);
  assert.equal(calculateAnnualSavings(Number.NaN, 84), null);
  assert.equal(calculateAnnualSavings(0, 84), null);

  const grouped = buildUpgradePackages([
    pkg("plus-monthly", "MONTHLY", 10, "$10.00"),
    pkg("plus-annual", "ANNUAL", 84, "$84.00"),
    pkg("family-annual", "ANNUAL", 120, "$120.00"),
  ]);
  assert.equal(grouped.plus.find((entry) => entry.period === "annual")?.savingsPercent, 30);
  assert.equal(grouped.family[0]?.savingsPercent, null);

  const differentCurrencies = [
    pkg("plus-monthly", "MONTHLY", 10, "$10.00"),
    pkg("plus-annual", "ANNUAL", 84, "€84.00"),
  ];
  differentCurrencies[0].product.currencyCode = "NZD";
  differentCurrencies[1].product.currencyCode = "EUR";
  assert.equal(buildUpgradePackages(differentCurrencies).plus[1]?.savingsPercent, null);
});

test("comparison uses the configured allowance values returned by the existing service", () => {
  const comparison = buildPlanComparison([
    {
      feature: "ai_scan", monthKey: "2026-07", monthStartDate: null, resetAt: null,
      effectivePlan: "free", entitlementMode: "enforced", isLimited: true,
      limitUnits: 13, usedUnits: 0, reservedUnits: 0, remainingUnits: 13, wouldBeBlocked: false,
    },
    {
      feature: "replacement_pricing", monthKey: "2026-07", monthStartDate: null, resetAt: null,
      effectivePlan: "free", entitlementMode: "enforced", isLimited: true,
      limitUnits: 7, usedUnits: 0, reservedUnits: 0, remainingUnits: 7, wouldBeBlocked: false,
    },
  ]);

  assert.equal(comparison.find((row) => row.label === "AI inventory scans")?.free, "13 / month");
  assert.equal(comparison.find((row) => row.label === "Price searches")?.free, "7 / month");
  const properties = comparison.find((row) => row.label === "Properties");
  assert.deepEqual(properties, { label: "Properties", free: "1", plus: "1", family: "Multiple" });
});

test("identifies current plans and only disables the exact active package", () => {
  assert.equal(isCurrentPlan("plus", "coverly_plus"), true);
  assert.equal(isCurrentPlan("family", "coverly_plus"), false);
  assert.equal(isCurrentPackage("plus.monthly", ["plus.monthly"]), true);
  assert.equal(isCurrentPackage("plus.annual", ["plus.monthly"]), false);
});
