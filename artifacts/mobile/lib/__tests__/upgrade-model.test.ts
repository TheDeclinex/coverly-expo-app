import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectOwnershipPackage, ownershipScreenState, ownershipOutcome, deletionPurchaseCopy, FAIR_USE_COPY, type OwnershipPackage } from "../upgrade-model.ts";
import type { AccessCapabilities } from "../access-capabilities.ts";
import { propertyAllowanceCopy, parsePropertyAllowance } from "../property-allowance.ts";
import { normalizeLimitError } from "../limit-errors.ts";
import { OWNERSHIP_ACTIONS, sanitizeEventProperties } from "../analytics-core.ts";
// Fictional test fixtures, not live mappings or commercial prices.
const mapping = { productId: "fixture.owned", packageId: "fixture-ownership" };
const pkg: OwnershipPackage = { identifier: mapping.packageId, packageType: "LIFETIME", product: { identifier: mapping.productId, price: 42.35, priceString: "42,35 €", subscriptionPeriod: null, productCategory: "NON_SUBSCRIPTION" } };
const access = (kind: string) => ({ ownsCoverly: kind === "owner", accessClass: kind, effectivePlan: kind === "owner" ? "coverly_owned" : kind === "free" ? "free" : "coverly_plus" }) as AccessCapabilities;
const base = { access: access("free"), verification: "verified" as const, pending: false, busy: false, productAvailable: true };
test("exact one-time package passes localized price through", () => {
  assert.equal(selectOwnershipPackage([pkg], mapping), pkg);
  assert.equal(selectOwnershipPackage([pkg], mapping)?.product.priceString, "42,35 €");
});
for (const kind of ["MONTHLY", "ANNUAL", "WEEKLY", "CUSTOM", "UNKNOWN"]) test(`reject ${kind} even with configured identifiers`, () => assert.equal(selectOwnershipPackage([{ ...pkg, packageType: kind }], mapping), null));
for (const id of ["plus.monthly", "plus.annual", "family", "arbitrary.owned"]) test(`reject unconfigured ${id}`, () => assert.equal(selectOwnershipPackage([{ ...pkg, product: { ...pkg.product, identifier: id } }], mapping), null));
for (const override of [{ priceString: "" }, { price: NaN }, { price: 0 }, { subscriptionPeriod: "P1M" }, { subscriptionPeriod: undefined }, { productCategory: "SUBSCRIPTION" }]) test(`reject malformed ${JSON.stringify(override)}`, () => assert.equal(selectOwnershipPackage([{ ...pkg, product: { ...pkg.product, ...override } }], mapping), null));
test("missing config/product, malformed and ambiguous packages fail safely", () => {
  assert.equal(selectOwnershipPackage([pkg], { productId: null, packageId: null }), null);
  assert.equal(selectOwnershipPackage([], mapping), null);
  assert.equal(selectOwnershipPackage([pkg, pkg], mapping), null);
  assert.equal(selectOwnershipPackage([null] as unknown as OwnershipPackage[], mapping), null);
});
for (const [kind, expected] of [["owner", "owned"], ["legacy_plus", "legacy"], ["legacy_family", "legacy"], ["tester", "included"], ["admin", "included"], ["override", "included"]]) test(`${kind} cannot buy even if offering is unavailable`, () => assert.equal(ownershipScreenState({ ...base, access: access(kind), productAvailable: false }), expected));
test("Free, unavailable, loading and unverified screen states", () => {
  assert.equal(ownershipScreenState(base), "available");
  assert.equal(ownershipScreenState({ ...base, productAvailable: false }), "unavailable");
  assert.equal(ownershipScreenState({ ...base, busy: true }), "busy");
  assert.equal(ownershipScreenState({ ...base, access: null, verification: "loading" }), "checking");
  assert.equal(ownershipScreenState({ ...base, verification: "unavailable" }), "verification_unavailable");
});
test("pending prevents repurchase even with stale legacy access", () => {
  assert.equal(ownershipScreenState({ ...base, pending: true }), "pending");
  assert.equal(ownershipScreenState({ ...base, pending: true, access: access("legacy_plus") }), "pending");
  assert.equal(ownershipScreenState({ ...base, pending: true, access: access("owner") }), "owned");
});
for (const [outcome, event] of [["cancelled", "purchase_cancelled"], ["failed", "purchase_failed"], ["confirmed", "ownership_confirmed"], ["owner_restored", "restore_succeeded"], ["legacy_restored", "restore_succeeded"], ["nothing_found", "restore_nothing_found"]] as const) test(`outcome ${outcome}`, () => assert.equal(ownershipOutcome({ ok: outcome === "confirmed", cancelled: outcome === "cancelled", outcome, message: "fixture" }), event));
test("pending verification is not failed analytics", () => assert.equal(ownershipOutcome({ ok: true, pending: true, outcome: "pending", message: "fixture" }), "verification_pending"));
test("property limit offers Free ownership and owner continuation", () => {
  const free = propertyAllowanceCopy(parsePropertyAllowance({ access_class: "free", property_count: 1, property_limit: 1, can_create_property: false }));
  const owner = propertyAllowanceCopy(parsePropertyAllowance({ access_class: "owner", property_count: 5, property_limit: 5, can_create_property: false }));
  assert.equal(free.action, "purchase"); assert.match(free.body, /5 properties/);
  assert.equal(owner.action, "dismiss"); assert.match(owner.body, /5 properties/); assert.doesNotMatch(owner.primaryCta, /Own|Buy|Upgrade/);
});
test("owner exhaustion gives reset and manual path, Free gives ownership CTA", () => {
  const owner = normalizeLimitError({ errorCode: "OWNER_FAIR_USE_EXHAUSTED", feature: "ai_scan", resetAt: "2026-10-01T00:00:00Z" });
  assert.equal(owner?.primaryAction, "dismiss"); assert.match(owner!.body, /refreshes on/); assert.match(owner!.secondaryCta, /manually/);
  assert.doesNotMatch(owner!.body, /Plus|Family|[Uu]pgrade/);
  assert.equal(normalizeLimitError({ errorCode: "FREE_ALLOWANCE_EXHAUSTED", feature: "ai_scan" })?.primaryCta, "Own Coverly");
  assert.equal(normalizeLimitError({ errorCode: "AI_SCAN_LIMIT_REACHED", ownsCoverly: true })?.primaryAction, "dismiss");
});
test("deletion explains store history for owners and cancellation only for legacy", () => {
  assert.doesNotMatch(deletionPurchaseCopy(false).body, /subscription|cancel/i);
  assert.match(deletionPurchaseCopy(false).body, /history remains/);
  assert.match(deletionPurchaseCopy(false).body, /does not restore deleted inventory/);
  assert.match(deletionPurchaseCopy(true).body, /does not cancel/);
});
test("bounded analytics actions, one-time classification and historical compatibility", () => {
  for (const action of OWNERSHIP_ACTIONS) assert.deepEqual(sanitizeEventProperties("ownership_flow", { ownership_action: action, plan: "owned", billing_period: "one_time", price: "fixture" }), { ownership_action: action, plan: "owned", billing_period: "one_time" });
  assert.deepEqual(sanitizeEventProperties("ownership_flow", { ownership_action: "arbitrary-price" }), {});
  assert.deepEqual(sanitizeEventProperties("purchase_started", { plan: "family", billing_period: "annual" }), { plan: "family", billing_period: "annual" });
});
test("Upgrade uses one purchase path and accessible wrapping scroll layout", () => {
  const screen = readFileSync(resolve(process.cwd(), "app/upgrade.tsx"), "utf8");
  assert.doesNotMatch(screen, /activeSubscriptions|BillingOption|billingPeriods|savingsPercent|Choose plan|Upgrade to Family/);
  assert.match(screen, /purchasePackage\(selected!/); assert.match(screen, /state !== "available"/);
  assert.match(screen, /selected\.product\.priceString/); assert.match(screen, /Retry confirmation/); assert.match(screen, /Restore Purchases/);
  assert.match(screen, /ScrollView/); assert.match(screen, /accessibilityRole="button"/); assert.doesNotMatch(screen, /numberOfLines|allowFontScaling=\{false\}/);
  assert.doesNotMatch(FAIR_USE_COPY, /unlimited|\d+ scans|Plus|Family/i);
});

test("scan and search owner exhaustion dismisses before any purchase navigation", () => {
  for (const path of ["app/(tabs)/scan.tsx", "app/(tabs)/replacement-pricing/[id].tsx"]) {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    const modal = source.slice(source.lastIndexOf("<LimitReachedModal"));
    assert.match(modal, /if \(limitModal\?\.primaryAction === "dismiss"\) return;\s*router\.push/);
    assert.match(source, /normalizeLimitError\(\{\s*feature: "(?:ai_scan|replacement_pricing)", ownsCoverly, resetAt: ownerResetAt/);
  }
});
