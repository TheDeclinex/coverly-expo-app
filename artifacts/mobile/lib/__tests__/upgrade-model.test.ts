import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlanComparison,
  buildUpgradePackages,
  calculateAnnualSavings,
  isCurrentPackage,
  isCurrentPlan,
  packageDisplayPrice,
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
});

test("identifies current plans and only disables the exact active package", () => {
  assert.equal(isCurrentPlan("plus", "coverly_plus"), true);
  assert.equal(isCurrentPlan("family", "coverly_plus"), false);
  assert.equal(isCurrentPackage("plus.monthly", ["plus.monthly"]), true);
  assert.equal(isCurrentPackage("plus.annual", ["plus.monthly"]), false);
});
