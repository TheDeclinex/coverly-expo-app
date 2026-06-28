import { Feather } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import type { PurchasesPackage } from "@/lib/billing";

function packagePlan(pkg: PurchasesPackage) {
  const value = `${pkg.identifier} ${pkg.product.identifier}`.toLowerCase();
  return value.includes("family") ? "Coverly Family" : "Coverly Plus";
}

export default function UpgradeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { effectivePlan, offering, error, purchaseLoading, isRefreshing, purchasePackage, restorePurchases, gatesEnabled } = useEntitlements();
  const packages = offering?.availablePackages ?? [];

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
        <Text style={[styles.body, { color: colors.mutedForeground }]}>AI scans, replacement pricing and claim-ready exports are included on paid plans. Tester access may be managed separately while store purchases are being prepared.</Text>
        <Text style={[styles.current, { color: colors.primary }]}>Current plan: {effectivePlan === "free" ? "Free" : effectivePlan === "coverly_family" ? "Coverly Family" : "Coverly Plus"}</Text>
      </View>

      {!gatesEnabled && <View style={[styles.notice, { backgroundColor: colors.accent }]}><Text style={{ color: colors.accentForeground }}>Tester mode: limits may be visible without blocking access.</Text></View>}
      {packages.length === 0 ? <View style={[styles.empty, { borderColor: colors.border }]}>
        <Text style={[styles.optionTitle, { color: colors.foreground }]}>Plan options are not available in this build</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{error ?? "Store products are still being prepared for tester builds. You can continue using available Free features."}</Text>
      </View> : packages.map((pkg) => <View key={pkg.identifier} style={[styles.option, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: colors.foreground }]}>{packagePlan(pkg)}</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{pkg.product.description || "AI features included · Fair use applies"}</Text></View>
        <Text style={[styles.price, { color: colors.foreground }]}>{pkg.product.priceString}</Text>
        <Pressable disabled={purchaseLoading} onPress={() => void buy(pkg)} style={[styles.button, { backgroundColor: colors.primary, opacity: purchaseLoading ? .6 : 1 }]}><Text style={styles.buttonText}>Choose {pkg.packageType === "ANNUAL" ? "yearly" : pkg.packageType === "MONTHLY" ? "monthly" : "plan"}</Text></Pressable>
      </View>)}

      {(purchaseLoading || isRefreshing) && <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.body, { color: colors.mutedForeground }]}>{isRefreshing ? "Purchase received, refreshing access…" : "Contacting the store…"}</Text></View>}
      <Pressable disabled={purchaseLoading} onPress={() => void restore()} style={styles.restore}><Text style={[styles.restoreText, { color: colors.primary }]}>Restore purchases</Text></Pressable>
      <Text style={[styles.legal, { color: colors.mutedForeground }]}>When store purchases are available, payment is charged to your Apple or Google account and managed through your store subscription settings.</Text>
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 18, gap: 14 }, hero: { padding: 20, gap: 10, borderWidth: 1, borderRadius: 16 },
  title: { fontSize: 24, lineHeight: 31, fontFamily: "Inter_700Bold" }, body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" }, current: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  notice: { padding: 12, borderRadius: 10 }, empty: { padding: 18, gap: 6, borderWidth: 1, borderRadius: 14 },
  option: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 14 }, optionCopy: { gap: 4 }, optionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" }, price: { fontSize: 19, fontFamily: "Inter_700Bold" },
  button: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" }, buttonText: { color: "white", fontFamily: "Inter_600SemiBold" },
  loading: { alignItems: "center", gap: 8 }, restore: { minHeight: 46, justifyContent: "center", alignItems: "center" }, restoreText: { fontFamily: "Inter_600SemiBold" }, legal: { fontSize: 11, lineHeight: 16, textAlign: "center" },
});
