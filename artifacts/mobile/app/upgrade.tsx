import { Feather } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { loadStoreProducts, type PurchasesPackage, type PurchasesStoreProduct } from "@/lib/billing";

type PlanGroup = "plus" | "family";
type BillingPeriod = "monthly" | "annual" | "other";

type DisplayPackage = {
  pkg: PurchasesPackage;
  plan: PlanGroup;
  period: BillingPeriod;
  product: PurchasesStoreProduct;
  price: string;
  priceSource: "store_product_refresh" | "offering_package";
};

type RevenueCatProductDiagnostics = PurchasesPackage["product"] & {
  price?: unknown;
  currencyCode?: unknown;
  subscriptionPeriod?: unknown;
};

const planLabels: Record<PlanGroup, string> = {
  plus: "Coverly Plus",
  family: "Coverly Family",
};

const showTemporaryBillingDiagnostics = true;

function packageSearchText(pkg: PurchasesPackage) {
  return [
    pkg.identifier,
    pkg.packageType,
    pkg.product.identifier,
    pkg.product.title,
    pkg.product.description,
  ].filter(Boolean).join(" ").toLowerCase();
}

function packagePlan(pkg: PurchasesPackage): PlanGroup {
  return packageSearchText(pkg).includes("family") ? "family" : "plus";
}

function packagePeriod(pkg: PurchasesPackage): BillingPeriod {
  if (pkg.packageType === "MONTHLY") return "monthly";
  if (pkg.packageType === "ANNUAL") return "annual";

  const value = packageSearchText(pkg);
  if (value.includes("annual") || value.includes("yearly") || value.includes("year")) return "annual";
  if (value.includes("monthly") || value.includes("month")) return "monthly";
  return "other";
}

function periodLabel(period: BillingPeriod) {
  if (period === "monthly") return "Monthly";
  if (period === "annual") return "Annual";
  return "Plan";
}

function chooseLabel(period: BillingPeriod) {
  if (period === "monthly") return "Choose monthly";
  if (period === "annual") return "Choose annual";
  return "Choose plan";
}

function packageDisplayPrice(product: PurchasesStoreProduct) {
  return product.priceString?.trim() || "Price unavailable";
}

function sortPackage(a: DisplayPackage, b: DisplayPackage) {
  const planOrder = { plus: 0, family: 1 };
  const periodOrder = { monthly: 0, annual: 1, other: 2 };
  return planOrder[a.plan] - planOrder[b.plan]
    || periodOrder[a.period] - periodOrder[b.period]
    || a.pkg.identifier.localeCompare(b.pkg.identifier);
}

function buildDisplayPackages(packages: PurchasesPackage[], storeProductsById: Record<string, PurchasesStoreProduct>) {
  const displayPackages = packages.map((pkg) => ({
    pkg,
    plan: packagePlan(pkg),
    period: packagePeriod(pkg),
    product: storeProductsById[pkg.product.identifier] ?? pkg.product,
    price: packageDisplayPrice(storeProductsById[pkg.product.identifier] ?? pkg.product),
    priceSource: storeProductsById[pkg.product.identifier] ? "store_product_refresh" as const : "offering_package" as const,
  })).sort(sortPackage);

  return {
    plus: displayPackages.filter((pkg) => pkg.plan === "plus"),
    family: displayPackages.filter((pkg) => pkg.plan === "family"),
  };
}

function logDisplayedPackages(displayPackages: DisplayPackage[]) {
  if (!__DEV__) return;

  for (const displayPackage of displayPackages) {
    const { pkg, plan, period, price, priceSource } = displayPackage;
    const product = pkg.product as RevenueCatProductDiagnostics;
    const displayProduct = displayPackage.product as RevenueCatProductDiagnostics;
    console.info("[billing] upgrade package displayed", {
      renderedPlanLabel: planLabels[plan],
      renderedPeriodLabel: periodLabel(period),
      renderedVisiblePrice: price,
      priceSource,
      platform: Platform.OS,
      packageIdentifier: pkg.identifier,
      packageType: pkg.packageType,
      productIdentifier: pkg.product.identifier,
      productTitle: pkg.product.title ?? null,
      productDescription: pkg.product.description ?? null,
      packageProductPriceString: pkg.product.priceString ?? null,
      refreshedProductPriceString: displayPackage.product.priceString ?? null,
      rawPrice: typeof product.price === "number" ? product.price : null,
      currencyCode: typeof product.currencyCode === "string" ? product.currencyCode : null,
      refreshedRawPrice: typeof displayProduct.price === "number" ? displayProduct.price : null,
      refreshedCurrencyCode: typeof displayProduct.currencyCode === "string" ? displayProduct.currencyCode : null,
      billingPeriod: typeof displayProduct.subscriptionPeriod === "string" ? displayProduct.subscriptionPeriod : pkg.packageType,
    });
  }
}

function billingDiagnosticText(displayPackage: DisplayPackage) {
  const { pkg, plan, period, product, price, priceSource } = displayPackage;
  const diagnosticProduct = product as RevenueCatProductDiagnostics;
  const rawPrice = typeof diagnosticProduct.price === "number" ? diagnosticProduct.price : "n/a";
  const currencyCode = typeof diagnosticProduct.currencyCode === "string" ? diagnosticProduct.currencyCode : "n/a";
  const billingPeriod = typeof diagnosticProduct.subscriptionPeriod === "string" ? diagnosticProduct.subscriptionPeriod : pkg.packageType;
  return [
    `Diag ${planLabels[plan]} ${periodLabel(period)} ${price}`,
    `pkg=${pkg.identifier} type=${pkg.packageType}`,
    `product=${product.identifier}`,
    `title=${product.title}`,
    `desc=${product.description}`,
    `priceString=${product.priceString} raw=${rawPrice} currency=${currencyCode}`,
    `period=${billingPeriod} platform=${Platform.OS} source=${priceSource}`,
  ].join("\n");
}

export default function UpgradeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { effectivePlan, offering, error, purchaseLoading, isRefreshing, purchasePackage, restorePurchases, gatesEnabled } = useEntitlements();
  const packages = offering?.availablePackages ?? [];
  const [storeProductsById, setStoreProductsById] = useState<Record<string, PurchasesStoreProduct>>({});
  const productIdentifiersKey = useMemo(() => [...new Set(packages.map((pkg) => pkg.product.identifier))].sort().join("|"), [packages]);
  const groupedPackages = useMemo(() => buildDisplayPackages(packages, storeProductsById), [packages, storeProductsById]);
  const displayedPackages = useMemo(() => [...groupedPackages.plus, ...groupedPackages.family], [groupedPackages]);

  useEffect(() => {
    let cancelled = false;
    const productIdentifiers = productIdentifiersKey ? productIdentifiersKey.split("|") : [];
    setStoreProductsById({});
    if (productIdentifiers.length === 0) return () => { cancelled = true; };

    void (async () => {
      const result = await loadStoreProducts(productIdentifiers);
      if (cancelled || !result.ok) return;
      setStoreProductsById(Object.fromEntries(result.value.map((product) => [product.identifier, product])));
    })();

    return () => { cancelled = true; };
  }, [productIdentifiersKey]);

  useEffect(() => {
    logDisplayedPackages(displayedPackages);
  }, [displayedPackages]);

  const buy = async (pkg: PurchasesPackage) => {
    const result = await purchasePackage(pkg);
    if (result.cancelled) return;
    Alert.alert(result.ok ? "You're covered" : "Purchase unavailable", result.message, result.ok ? [{ text: "Done", onPress: () => router.back() }] : undefined);
  };
  const restore = async () => { const result = await restorePurchases(); Alert.alert(result.ok ? "Purchases restored" : "Restore complete", result.message); };

  return <>
    <Stack.Screen options={{ headerShown: true, title: "Plan options", presentation: "modal" }} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24, backgroundColor: colors.background }]}>
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="shield" size={28} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>Know what you own, with more room to grow.</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>AI scans, replacement pricing and claim-ready exports are included on paid plans.</Text>
        <Text style={[styles.current, { color: colors.primary }]}>Current plan: {effectivePlan === "free" ? "Free" : effectivePlan === "coverly_family" ? "Coverly Family" : "Coverly Plus"}</Text>
      </View>

      {!gatesEnabled && <View style={[styles.notice, { backgroundColor: colors.accent }]}><Text style={{ color: colors.accentForeground }}>Tester mode: limits may be visible without blocking access.</Text></View>}
      {packages.length === 0 ? <View style={[styles.empty, { borderColor: colors.border }]}>
        <Text style={[styles.optionTitle, { color: colors.foreground }]}>Plan options are not available in this build</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{error ?? "Store products are still being prepared for tester builds. You can continue using available Free features."}</Text>
      </View> : (["plus", "family"] as const).map((plan) => {
        const planPackages = groupedPackages[plan];
        if (planPackages.length === 0) return null;

        return <View key={plan} style={styles.planSection}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{planLabels[plan]}</Text>
          {planPackages.map((displayPackage) => <View key={displayPackage.pkg.identifier} style={[styles.option, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.optionHeader}>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: colors.foreground }]}>{periodLabel(displayPackage.period)}</Text>
                <Text style={[styles.body, { color: colors.mutedForeground }]}>{displayPackage.product.description || "AI features included. Fair use applies."}</Text>
              </View>
              <Text style={[styles.price, { color: colors.foreground }]}>{displayPackage.price}</Text>
            </View>
            {showTemporaryBillingDiagnostics ? <Text style={[styles.diagnostic, { color: colors.mutedForeground }]}>{billingDiagnosticText(displayPackage)}</Text> : null}
            <Pressable disabled={purchaseLoading} onPress={() => void buy(displayPackage.pkg)} style={[styles.button, { backgroundColor: colors.primary, opacity: purchaseLoading ? .6 : 1 }]}>
              <Text style={styles.buttonText}>{chooseLabel(displayPackage.period)}</Text>
            </Pressable>
          </View>)}
        </View>;
      })}

      {(purchaseLoading || isRefreshing) && <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.body, { color: colors.mutedForeground }]}>{isRefreshing ? "Purchase received, refreshing access..." : "Contacting the store..."}</Text></View>}
      <Pressable disabled={purchaseLoading} onPress={() => void restore()} style={styles.restore}><Text style={[styles.restoreText, { color: colors.primary }]}>Restore purchases</Text></Pressable>
      <Text style={[styles.legal, { color: colors.mutedForeground }]}>When store purchases are available, payment is charged to your Apple or Google account and managed through your store subscription settings.</Text>
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 18, gap: 14 },
  hero: { padding: 20, gap: 10, borderWidth: 1, borderRadius: 16 },
  title: { fontSize: 24, lineHeight: 31, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  current: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  notice: { padding: 12, borderRadius: 10 },
  empty: { padding: 18, gap: 6, borderWidth: 1, borderRadius: 14 },
  planSection: { gap: 10 },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  option: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 14 },
  optionHeader: { gap: 10 },
  optionCopy: { gap: 4 },
  optionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  price: { fontSize: 19, fontFamily: "Inter_700Bold" },
  diagnostic: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_400Regular" },
  button: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "white", fontFamily: "Inter_600SemiBold" },
  loading: { alignItems: "center", gap: 8 },
  restore: { minHeight: 46, justifyContent: "center", alignItems: "center" },
  restoreText: { fontFamily: "Inter_600SemiBold" },
  legal: { fontSize: 11, lineHeight: 16, textAlign: "center" },
});
