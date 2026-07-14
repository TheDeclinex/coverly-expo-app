import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildPlanComparison,
  buildPaidPlanComparison,
  buildAllPlanComparison,
  buildUpgradePackages,
  calculateAnnualSavings,
  isCurrentPackage,
  isCurrentPlan,
  activePlanPeriod,
  currentPlanCarouselIndex,
  exactPeriodPackage,
  planActionLabel,
  selectedPlanPackage,
  upgradeHeader,
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

test("uses subscription management copy for paid users and concise upgrade copy for free users", () => {
  assert.deepEqual(upgradeHeader("coverly_plus"), {
    title: "Your subscription", planLabel: "Coverly Plus",
    supportingText: "Manage your subscription below.", paid: true,
  });
  assert.equal(upgradeHeader("free").paid, false);
  assert.doesNotMatch(upgradeHeader("coverly_plus").supportingText, /upgrade|unlock/i);
});

test("monthly and annual selection changes the displayed package without purchasing", () => {
  const grouped = buildUpgradePackages([
    pkg("plus-monthly", "MONTHLY", 10, "$10.00"),
    pkg("plus-annual", "ANNUAL", 84, "$84.00"),
  ]);
  assert.equal(selectedPlanPackage(grouped.plus, "monthly")?.pkg.identifier, "plus-monthly");
  assert.equal(selectedPlanPackage(grouped.plus, "annual")?.pkg.identifier, "plus-annual");
  assert.equal(activePlanPeriod(grouped.plus, ["plus-monthly.product"]), "monthly");
});

test("uses consistent labels for current cadence, cycle changes and tier changes", () => {
  assert.equal(planActionLabel({ selectedPlan: "plus", selectedPeriod: "monthly", effectivePlan: "coverly_plus", exactCurrentPackage: true }), "Current plan");
  assert.equal(planActionLabel({ selectedPlan: "plus", selectedPeriod: "annual", effectivePlan: "coverly_plus", exactCurrentPackage: false }), "Change to annual billing");
  assert.equal(planActionLabel({ selectedPlan: "family", selectedPeriod: "annual", effectivePlan: "coverly_plus", exactCurrentPackage: false }), "Upgrade to Family");
  assert.equal(planActionLabel({ selectedPlan: "plus", selectedPeriod: "annual", effectivePlan: "coverly_family", exactCurrentPackage: false }), "Switch to Plus");
});

test("carousel starts on the effective current tier", () => {
  assert.equal(currentPlanCarouselIndex("free"), 0);
  assert.equal(currentPlanCarouselIndex("coverly_plus"), 1);
  assert.equal(currentPlanCarouselIndex("coverly_family"), 2);
});

test("global cadence selection does not silently substitute a missing package", () => {
  const grouped = buildUpgradePackages([pkg("plus-monthly", "MONTHLY", 10, "$10.00")]);
  assert.equal(exactPeriodPackage(grouped.plus, "monthly")?.price, "$10.00");
  assert.equal(exactPeriodPackage(grouped.plus, "annual"), null);
});

test("three-tier comparison keeps Family sharing marked as coming soon", () => {
  const rows = buildAllPlanComparison([]);
  assert.equal(rows.find((row) => row.label === "Family access")?.family, "Coming soon");
  assert.equal(rows.find((row) => row.label === "Family access")?.plus, "—");
});

test("paid comparison is honest about currently planned Family access", () => {
  const comparison = buildPaidPlanComparison();
  assert.equal(comparison.find((row) => row.label === "Family access")?.family, "Planned");
  assert.equal(comparison.find((row) => row.label === "AI inventory tools")?.plus, comparison.find((row) => row.label === "AI inventory tools")?.family);
});

test("screen follows the three-card mock-up while preserving billing and store management", () => {
  const source = readFileSync(resolve(process.cwd(), "app/upgrade.tsx"), "utf8");
  assert.match(source, /const planOrder = \["free", "plus", "family"\] as const/);
  assert.match(source, /initialScrollIndex=\{currentIndex\}/);
  assert.match(source, /setChosenPeriod\(period\)/);
  assert.match(source, /exactPeriodPackage\(groupedPackages\[plan\], selectedPeriod\)/);
  assert.match(source, /displayPackage\.price/);
  assert.match(source, /void buy\(displayPackage\.pkg\)/);
  assert.match(source, /customerInfo\?\.managementURL/);
  assert.match(source, /Linking\.openURL\(managementUrl\)/);
  assert.match(source, /Restore purchases/);
  assert.match(source, /temporarily unavailable/);
  assert.match(source, /Everything in Plus, with household sharing planned\./);
  assert.doesNotMatch(source, /Up to 5 members|shared with your household/i);
  assert.doesNotMatch(source, /Downgrade to Free/);
});
