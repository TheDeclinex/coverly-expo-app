import { Feather } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import React, { useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { type PurchasesPackage, type PurchasesStoreProduct } from "@/lib/billing";

type PlanGroup = "plus" | "family";
type BillingPeriod = "monthly" | "annual" | "other";

type DisplayPackage = {
  pkg: PurchasesPackage;
  plan: PlanGroup;
  period: BillingPeriod;
  product: PurchasesStoreProduct;
  price: string;
};

const planLabels: Record<PlanGroup, string> = {
  plus: "Coverly Plus",
  family: "Coverly Family",
};

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
  // RevenueCat/StoreKit sandbox and TestFlight regional metadata can be
  // inaccurate. Production UI still uses the offering package's localized
  // price string and lets Apple's purchase sheet confirm the transaction.
  return product.priceString?.trim() || "Price unavailable";
}

function sortPackage(a: DisplayPackage, b: DisplayPackage) {
  const planOrder = { plus: 0, family: 1 };
  const periodOrder = { monthly: 0, annual: 1, other: 2 };
  return planOrder[a.plan] - planOrder[b.plan]
    || periodOrder[a.period] - periodOrder[b.period]
    || a.pkg.identifier.localeCompare(b.pkg.identifier);
}

function buildDisplayPackages(packages: PurchasesPackage[]) {
  const displayPackages = packages.map((pkg) => ({
    pkg,
    plan: packagePlan(pkg),
    period: packagePeriod(pkg),
    product: pkg.product,
    price: packageDisplayPrice(pkg.product),
  })).sort(sortPackage);

  return {
    plus: displayPackages.filter((pkg) => pkg.plan === "plus"),
    family: displayPackages.filter((pkg) => pkg.plan === "family"),
  };
}

export default function UpgradeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { effectivePlan, offering, error, purchaseLoading, isRefreshing, purchasePackage, restorePurchases, gatesEnabled } = useEntitlements();
  const packages = offering?.availablePackages ?? [];
  const groupedPackages = useMemo(() => buildDisplayPackages(packages), [packages]);

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
          <View style={styles.sectionHeading}>
            <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
              <Feather name={plan === "family" ? "users" : "shield"} size={18} color={colors.primary} />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{planLabels[plan]}</Text>
          </View>
          {planPackages.map((displayPackage) => <View key={displayPackage.pkg.identifier} style={[styles.option, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.optionHeader}>
              <View style={[styles.optionIcon, { backgroundColor: colors.secondary }]}>
                <Feather name={displayPackage.period === "annual" ? "award" : "calendar"} size={16} color={colors.primary} />
              </View>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: colors.foreground }]}>{periodLabel(displayPackage.period)}</Text>
                <Text style={[styles.body, { color: colors.mutedForeground }]}>{displayPackage.product.description || "AI features included. Fair use applies."}</Text>
              </View>
              <Text style={[styles.price, { color: colors.foreground }]}>{displayPackage.price}</Text>
            </View>
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
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  option: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 14 },
  optionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  optionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  optionCopy: { flex: 1, gap: 4, minWidth: 0 },
  optionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  price: { fontSize: 19, fontFamily: "Inter_700Bold" },
  button: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "white", fontFamily: "Inter_600SemiBold" },
  loading: { alignItems: "center", gap: 8 },
  restore: { minHeight: 46, justifyContent: "center", alignItems: "center" },
  restoreText: { fontFamily: "Inter_600SemiBold" },
  legal: { fontSize: 11, lineHeight: 16, textAlign: "center" },
});
