import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { type PurchasesPackage } from "@/lib/billing";
import { loadUsageAllowances } from "@/lib/usage-allowances";
import {
  buildPlanComparison,
  buildUpgradePackages,
  isCurrentPackage,
  isCurrentPlan,
  type UpgradeBillingPeriod,
  type UpgradePlanGroup,
} from "@/lib/upgrade-model";

const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;

const planLabels: Record<UpgradePlanGroup, string> = {
  plus: "Coverly Plus",
  family: "Coverly Family",
};

const planPositioning: Record<UpgradePlanGroup, string> = {
  plus: "For individuals and households building a complete home inventory.",
  family: "Includes the same currently available mobile access as Plus.",
};

const paidBenefits = [
  "AI inventory scans included (fair use applies)",
  "Replacement-price searches included (fair use applies)",
  "Claim-ready PDF exports included",
  "Add more than one property",
];

function periodLabel(period: UpgradeBillingPeriod) {
  if (period === "monthly") return "Monthly";
  if (period === "annual") return "Annual";
  return "Plan";
}

function billingExplanation(period: UpgradeBillingPeriod) {
  if (period === "monthly") return "Billed monthly through your app store.";
  if (period === "annual") return "Billed once a year through your app store.";
  return "Billing is managed through your app store.";
}

function actionLabel(period: UpgradeBillingPeriod, currentPlan: boolean, hasPaidPlan: boolean) {
  const suffix = period === "monthly" ? "monthly" : period === "annual" ? "annually" : "plan";
  if (currentPlan) return `Change to ${suffix}`;
  if (hasPaidPlan) return `Switch ${suffix}`;
  return `Upgrade ${suffix}`;
}

export default function UpgradeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const {
    effectivePlan, offering, customerInfo, error, purchaseLoading, isRefreshing,
    purchasePackage, restorePurchases, gatesEnabled,
  } = useEntitlements();
  const allowancesQuery = useQuery({
    queryKey: ["usage-allowances", session?.user.id],
    queryFn: loadUsageAllowances,
    enabled: !!session,
    staleTime: 30_000,
    retry: 1,
  });
  const packages = offering?.availablePackages ?? [];
  const groupedPackages = useMemo(() => buildUpgradePackages(packages), [packages]);
  const comparison = useMemo(() => buildPlanComparison(allowancesQuery.data ?? []), [allowancesQuery.data]);
  const hasPaidPlan = effectivePlan !== "free";
  const purchaseActionLockRef = React.useRef(false);

  const buy = async (pkg: PurchasesPackage) => {
    if (purchaseLoading || purchaseActionLockRef.current) return;
    purchaseActionLockRef.current = true;
    try {
      const result = await purchasePackage(pkg);
      if (result.cancelled) return;
      Alert.alert(
        result.ok ? "You're covered" : "Purchase unavailable",
        result.message,
        result.ok ? [{ text: "Done", onPress: () => router.back() }] : undefined,
      );
    } finally {
      purchaseActionLockRef.current = false;
    }
  };

  const restore = async () => {
    if (purchaseLoading || purchaseActionLockRef.current) return;
    purchaseActionLockRef.current = true;
    try {
      const result = await restorePurchases();
      Alert.alert(result.ok ? "Purchases restored" : "Restore complete", result.message);
    } finally {
      purchaseActionLockRef.current = false;
    }
  };

  const openLegal = async (url: string | undefined, label: string) => {
    if (!url) return;
    try { await WebBrowser.openBrowserAsync(url); }
    catch { Alert.alert(`Unable to open ${label}`, "Please try again later."); }
  };

  return <>
    <Stack.Screen options={{ headerShown: true, title: "Plan options", presentation: "modal" }} />
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28, backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 4 }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
          <Feather name="shield" size={25} color={colors.primary} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Protect everything you own.</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>Upgrade to unlock more AI inventory tools, replacement pricing and claim-ready records for your home.</Text>
        <View style={styles.benefits}>
          {paidBenefits.map((benefit) => <View key={benefit} style={styles.benefitRow}>
            <Feather name="check-circle" size={17} color={colors.primary} />
            <Text style={[styles.benefitText, { color: colors.foreground }]}>{benefit}</Text>
          </View>)}
        </View>
        <View style={[styles.currentSummary, { backgroundColor: colors.accent }]}>
          <Text style={[styles.currentSummaryText, { color: colors.accentForeground }]}>Current plan: {effectivePlan === "free" ? "Free" : effectivePlan === "coverly_family" ? "Coverly Family" : "Coverly Plus"}</Text>
        </View>
      </View>

      {!gatesEnabled ? <View style={[styles.notice, { backgroundColor: colors.accent }]}>
        <Text style={[styles.noticeText, { color: colors.accentForeground }]}>Tester mode: limits may be visible without blocking access.</Text>
      </View> : null}

      <View style={styles.sectionIntro}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.foreground }]}>Free versus paid</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>See what changes when you upgrade.</Text>
      </View>
      <View style={[styles.comparisonCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <View style={[styles.comparisonHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.comparisonFeature, { color: colors.mutedForeground }]}>FEATURE</Text>
          <Text style={[styles.comparisonValue, { color: colors.mutedForeground }]}>FREE</Text>
          <Text style={[styles.comparisonValue, { color: colors.primary }]}>PLUS & FAMILY</Text>
        </View>
        {comparison.map((row, index) => <View key={row.label} style={[styles.comparisonRow, index < comparison.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          <Text style={[styles.comparisonFeatureText, { color: colors.foreground }]}>{row.label}</Text>
          <Text style={[styles.comparisonValueText, { color: colors.mutedForeground }]}>{row.free}</Text>
          <Text style={[styles.comparisonValueText, styles.paidValue, { color: colors.foreground }]}>{row.paid}</Text>
        </View>)}
      </View>

      {packages.length === 0 ? <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text style={[styles.optionTitle, { color: colors.foreground }]}>Plan options are not available in this build</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{error ?? "Store products are still being prepared for tester builds. You can continue using available Free features."}</Text>
      </View> : (["plus", "family"] as const).map((plan) => {
        const planPackages = groupedPackages[plan];
        if (planPackages.length === 0) return null;
        const currentPlan = isCurrentPlan(plan, effectivePlan);

        return <View key={plan} style={styles.planSection}>
          <View style={styles.planHeading}>
            <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
              <Feather name={plan === "family" ? "users" : "shield"} size={18} color={colors.primary} />
            </View>
            <View style={styles.planHeadingCopy}>
              <View style={styles.planTitleRow}>
                <Text accessibilityRole="header" style={[styles.planTitle, { color: colors.foreground }]}>{planLabels[plan]}</Text>
                {currentPlan ? <View style={[styles.currentBadge, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.currentBadgeText, { color: colors.accentForeground }]}>Current plan</Text>
                </View> : null}
              </View>
              <Text style={[styles.planPositioning, { color: colors.mutedForeground }]}>{planPositioning[plan]}</Text>
            </View>
          </View>

          {planPackages.map((displayPackage) => {
            const currentPackage = isCurrentPackage(displayPackage.pkg.product.identifier, customerInfo?.activeSubscriptions);
            const disabled = purchaseLoading || currentPackage;
            const label = currentPackage ? "Current subscription" : actionLabel(displayPackage.period, currentPlan, hasPaidPlan);
            return <View key={displayPackage.pkg.identifier} style={[styles.option, { backgroundColor: colors.card, borderColor: currentPackage ? colors.primary : colors.border, borderRadius: colors.radius }]}>
              <View style={styles.optionHeader}>
                <View style={[styles.optionIcon, { backgroundColor: colors.secondary }]}>
                  <Feather name={displayPackage.period === "annual" ? "award" : "calendar"} size={16} color={colors.primary} />
                </View>
                <View style={styles.optionCopy}>
                  <View style={styles.periodRow}>
                    <Text style={[styles.optionTitle, { color: colors.foreground }]}>{periodLabel(displayPackage.period)}</Text>
                    {displayPackage.savingsPercent != null ? <View style={[styles.savingsBadge, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.savingsText, { color: colors.accentForeground }]}>Save {displayPackage.savingsPercent}%</Text>
                    </View> : null}
                  </View>
                  <Text style={[styles.billingCopy, { color: colors.mutedForeground }]}>{billingExplanation(displayPackage.period)}</Text>
                </View>
                <Text accessibilityLabel={`${periodLabel(displayPackage.period)} price ${displayPackage.price}`} style={[styles.price, { color: colors.foreground }]}>{displayPackage.price}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${displayPackage.price}`}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => void buy(displayPackage.pkg)}
                style={({ pressed }) => [styles.button, {
                  backgroundColor: currentPackage ? colors.secondary : colors.primary,
                  opacity: purchaseLoading ? 0.55 : pressed ? 0.82 : 1,
                }]}
              >
                {purchaseLoading && !currentPackage ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
                <Text style={[styles.buttonText, { color: currentPackage ? colors.secondaryForeground : colors.primaryForeground }]}>{label}</Text>
              </Pressable>
            </View>;
          })}
        </View>;
      })}

      {(purchaseLoading || isRefreshing) ? <View accessibilityLiveRegion="polite" style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{isRefreshing ? "Purchase received, refreshing access..." : "Contacting the store..."}</Text>
      </View> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Restore purchases"
        disabled={purchaseLoading}
        onPress={() => void restore()}
        style={({ pressed }) => [styles.restore, { opacity: purchaseLoading ? 0.55 : pressed ? 0.72 : 1 }]}
      >
        <Text style={[styles.restoreText, { color: colors.primary }]}>Restore purchases</Text>
      </Pressable>

      <View style={styles.footer}>
        <Text style={[styles.legal, { color: colors.mutedForeground }]}>Payment is charged to your Apple or Google account. Subscriptions renew unless cancelled and are managed through your store subscription settings.</Text>
        {(privacyUrl || termsUrl) ? <View style={styles.legalLinks}>
          {privacyUrl ? <Pressable accessibilityRole="link" onPress={() => void openLegal(privacyUrl, "privacy policy")}><Text style={[styles.legalLink, { color: colors.primary }]}>Privacy policy</Text></Pressable> : null}
          {privacyUrl && termsUrl ? <Text style={[styles.legalDot, { color: colors.mutedForeground }]}>•</Text> : null}
          {termsUrl ? <Pressable accessibilityRole="link" onPress={() => void openLegal(termsUrl, "terms")}><Text style={[styles.legalLink, { color: colors.primary }]}>Terms</Text></Pressable> : null}
        </View> : null}
      </View>
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, gap: 16 },
  hero: { padding: 20, gap: 11, borderWidth: 1 },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  title: { fontSize: 25, lineHeight: 32, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  benefits: { gap: 9, marginTop: 3 },
  benefitRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  benefitText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  currentSummary: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginTop: 3 },
  currentSummaryText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  notice: { padding: 12, borderRadius: 10 },
  noticeText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  sectionIntro: { gap: 3 },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  comparisonCard: { borderWidth: 1, overflow: "hidden" },
  comparisonHeader: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  comparisonRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 12 },
  comparisonFeature: { flex: 1.05, fontSize: 9, letterSpacing: 0.55, fontFamily: "Inter_700Bold" },
  comparisonValue: { flex: 1, fontSize: 9, letterSpacing: 0.3, textAlign: "right", fontFamily: "Inter_700Bold" },
  comparisonFeatureText: { flex: 1.05, fontSize: 12, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  comparisonValueText: { flex: 1, fontSize: 11, lineHeight: 16, textAlign: "right", fontFamily: "Inter_500Medium" },
  paidValue: { fontFamily: "Inter_600SemiBold" },
  empty: { padding: 18, gap: 6, borderWidth: 1 },
  planSection: { gap: 10 },
  planHeading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  planHeadingCopy: { flex: 1, gap: 3, minWidth: 0 },
  planTitleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  planTitle: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  planPositioning: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  currentBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  currentBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  option: { padding: 15, gap: 13, borderWidth: 1 },
  optionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  optionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  optionCopy: { flex: 1, gap: 4, minWidth: 0 },
  periodRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  optionTitle: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold" },
  billingCopy: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  savingsBadge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  savingsText: { fontSize: 9, fontFamily: "Inter_700Bold" },
  price: { maxWidth: "34%", fontSize: 18, lineHeight: 23, textAlign: "right", fontFamily: "Inter_700Bold", flexShrink: 1 },
  button: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14 },
  buttonText: { fontSize: 14, textAlign: "center", fontFamily: "Inter_700Bold" },
  loading: { alignItems: "center", gap: 8 },
  restore: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  restoreText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  footer: { alignItems: "center", gap: 9 },
  legal: { maxWidth: 360, fontSize: 11, lineHeight: 16, textAlign: "center", fontFamily: "Inter_400Regular" },
  legalLinks: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  legalLink: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  legalDot: { fontSize: 11 },
});
