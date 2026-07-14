import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { type PurchasesPackage } from "@/lib/billing";
import { loadUsageAllowances } from "@/lib/usage-allowances";
import {
  activePlanPeriod,
  buildAllPlanComparison,
  buildUpgradePackages,
  currentPlanCarouselIndex,
  exactPeriodPackage,
  isCurrentPackage,
  isCurrentPlan,
  planActionLabel,
  upgradeHeader,
  type UpgradeBillingPeriod,
  type UpgradeDisplayPackage,
  type UpgradePlanGroup,
} from "@/lib/upgrade-model";

const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;
const planOrder = ["free", "plus", "family"] as const;
type CarouselPlan = typeof planOrder[number];

const planDetails: Record<CarouselPlan, { title: string; description: string; icon: keyof typeof Feather.glyphMap; benefits: string[] }> = {
  free: { title: "Free", description: "Start documenting your home.", icon: "home", benefits: ["1 property", "Monthly AI scan allowance", "Monthly price-search allowance"] },
  plus: { title: "Plus", description: "For a complete, claim-ready inventory.", icon: "shield", benefits: ["Additional properties", "Fair-use AI scans and pricing", "Claim-pack exports"] },
  family: { title: "Family", description: "Everything in Plus, with household sharing planned.", icon: "users", benefits: ["Everything currently included in Plus", "Family sharing features coming soon"] },
};

function periodLabel(period: UpgradeBillingPeriod) {
  return period === "annual" ? "Annual" : "Monthly";
}

function formattedPeriodEnd(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function UpgradeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const {
    effectivePlan, offering, customerInfo, error, purchaseLoading, isRefreshing,
    purchasePackage, restorePurchases, gatesEnabled, subscriptionPeriodEnd,
  } = useEntitlements();
  const allowancesQuery = useQuery({
    queryKey: ["usage-allowances", session?.user.id], queryFn: loadUsageAllowances,
    enabled: !!session, staleTime: 30_000, retry: 1,
  });
  const packages = offering?.availablePackages ?? [];
  const groupedPackages = useMemo(() => buildUpgradePackages(packages), [packages]);
  const comparison = useMemo(() => buildAllPlanComparison(allowancesQuery.data ?? []), [allowancesQuery.data]);
  const header = upgradeHeader(effectivePlan);
  const currentIndex = currentPlanCarouselIndex(effectivePlan);
  const activeCadence = activePlanPeriod(
    effectivePlan === "coverly_family" ? groupedPackages.family : groupedPackages.plus,
    customerInfo?.activeSubscriptions,
  );
  const [chosenPeriod, setChosenPeriod] = useState<UpgradeBillingPeriod | null>(null);
  const selectedPeriod = chosenPeriod ?? activeCadence ?? "monthly";
  const [visibleCard, setVisibleCard] = useState(currentIndex);
  const carouselRef = useRef<FlatList<CarouselPlan>>(null);
  const lastCentredPlanRef = useRef<string | null>(null);
  const purchaseActionLockRef = useRef(false);
  const cardWidth = Math.min(Math.max(width * 0.82, 278), 340);
  const cardGap = 12;

  useEffect(() => {
    if (lastCentredPlanRef.current === effectivePlan) return;
    lastCentredPlanRef.current = effectivePlan;
    setVisibleCard(currentIndex);
    requestAnimationFrame(() => carouselRef.current?.scrollToIndex({ index: currentIndex, animated: false }));
  }, [currentIndex, effectivePlan]);

  const buy = async (pkg: PurchasesPackage) => {
    if (purchaseLoading || purchaseActionLockRef.current) return;
    purchaseActionLockRef.current = true;
    try {
      const result = await purchasePackage(pkg);
      if (result.cancelled) return;
      Alert.alert(result.ok ? "You're covered" : "Purchase unavailable", result.message,
        result.ok ? [{ text: "Done", onPress: () => router.back() }] : undefined);
    } finally { purchaseActionLockRef.current = false; }
  };

  const restore = async () => {
    if (purchaseLoading || purchaseActionLockRef.current) return;
    purchaseActionLockRef.current = true;
    try {
      const result = await restorePurchases();
      Alert.alert(result.ok ? "Purchases restored" : "Restore complete", result.message);
    } finally { purchaseActionLockRef.current = false; }
  };

  const openLegal = async (url: string | undefined, label: string) => {
    if (!url) return;
    try { await WebBrowser.openBrowserAsync(url); }
    catch { Alert.alert(`Unable to open ${label}`, "Please try again later."); }
  };

  const managementUrl = effectivePlan !== "free" && (Platform.OS === "ios" || Platform.OS === "android")
    ? customerInfo?.managementURL ?? null
    : null;
  const managementLabel = Platform.OS === "ios" ? "Manage in App Store" : "Manage in Google Play";
  const manageSubscription = async () => {
    if (!managementUrl) return;
    try {
      if (!await Linking.canOpenURL(managementUrl)) throw new Error("Unsupported URL");
      await Linking.openURL(managementUrl);
    } catch {
      Alert.alert("Unable to open subscription settings", `Please open your subscription directly in ${Platform.OS === "ios" ? "the App Store" : "Google Play"}.`);
    }
  };

  const renderPaidCard = (plan: UpgradePlanGroup, displayPackage: UpgradeDisplayPackage<PurchasesPackage> | null) => {
    const currentTier = isCurrentPlan(plan, effectivePlan);
    const exactCurrent = !!displayPackage && isCurrentPackage(displayPackage.pkg.product.identifier, customerInfo?.activeSubscriptions);
    const label = displayPackage
      ? planActionLabel({ selectedPlan: plan, selectedPeriod, effectivePlan, exactCurrentPackage: exactCurrent })
      : `${periodLabel(selectedPeriod)} unavailable`;
    const disabled = purchaseLoading || exactCurrent || !displayPackage;
    return { currentTier, exactCurrent, label, disabled };
  };

  const renderPlanCard = ({ item: plan }: { item: CarouselPlan }) => {
    const details = planDetails[plan];
    const currentTier = plan === "free" ? effectivePlan === "free" : isCurrentPlan(plan, effectivePlan);
    const displayPackage = plan === "free" ? null : exactPeriodPackage(groupedPackages[plan], selectedPeriod) as UpgradeDisplayPackage<PurchasesPackage> | null;
    const paidState = plan === "free" ? null : renderPaidCard(plan, displayPackage);
    const freeCurrent = plan === "free" && effectivePlan === "free";
    const disabled = plan === "free" ? freeCurrent || !managementUrl || purchaseLoading : paidState!.disabled;
    const actionLabel = plan === "free"
      ? freeCurrent ? "Current plan" : managementUrl ? managementLabel : "Manage through your app store"
      : paidState!.label;

    return <View style={[styles.planCard, { width: cardWidth, backgroundColor: currentTier ? colors.accent : colors.card, borderColor: currentTier ? colors.primary : colors.border }]}>
      {plan === "family" ? <View style={[styles.ribbon, { backgroundColor: colors.primary }]}><Text style={[styles.ribbonText, { color: colors.primaryForeground }]}>Family access planned</Text></View> : null}
      <View style={styles.planHead}>
        <View style={styles.planHeadLeft}>
          <View style={[styles.planIcon, { backgroundColor: currentTier ? colors.card : colors.secondary }]}><Feather name={details.icon} size={18} color={colors.primary} /></View>
          <Text style={[styles.planName, { color: colors.foreground }]}>{details.title}</Text>
        </View>
        {currentTier ? <View style={[styles.planTag, { backgroundColor: colors.card, borderColor: colors.primary }]}><Text style={[styles.planTagText, { color: colors.primary }]}>Current tier</Text></View> : null}
      </View>
      <Text style={[styles.planDescription, { color: colors.mutedForeground }]}>{details.description}</Text>
      {plan === "free" ? <View style={styles.priceRow}><Text style={[styles.price, { color: colors.foreground }]}>Free</Text><Text style={[styles.period, { color: colors.mutedForeground }]}>no subscription</Text></View>
        : displayPackage ? <>
          <View style={styles.priceRow}><Text accessibilityLabel={`${periodLabel(selectedPeriod)} price ${displayPackage.price}`} style={[styles.price, { color: colors.foreground }]}>{displayPackage.price}</Text><Text style={[styles.period, { color: colors.mutedForeground }]}>{selectedPeriod === "annual" ? "per year" : "per month"}</Text></View>
          {selectedPeriod === "annual" && displayPackage.savingsPercent != null ? <View style={[styles.savingsBadge, { backgroundColor: colors.card }]}><Text style={[styles.savingsText, { color: colors.primary }]}>Save {displayPackage.savingsPercent}% annually</Text></View> : null}
        </> : <View style={styles.priceRow}><Text style={[styles.unavailable, { color: colors.mutedForeground }]}>{periodLabel(selectedPeriod)} package temporarily unavailable</Text></View>}
      <View style={styles.benefits}>{details.benefits.map((benefit) => <View key={benefit} style={styles.benefitRow}><Feather name="check" size={14} color={colors.primary} /><Text style={[styles.benefitText, { color: colors.foreground }]}>{benefit}</Text></View>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} accessibilityState={{ disabled }} disabled={disabled}
        onPress={() => plan === "free" ? void manageSubscription() : displayPackage ? void buy(displayPackage.pkg) : undefined}
        style={({ pressed }) => [styles.planButton, { backgroundColor: disabled ? colors.secondary : colors.primary, borderColor: disabled ? colors.border : colors.primary, opacity: pressed ? 0.8 : 1 }]}>
        {purchaseLoading && plan !== "free" && !paidState!.exactCurrent ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
        <Text style={[styles.planButtonText, { color: disabled ? colors.mutedForeground : colors.primaryForeground }]}>{actionLabel}</Text>
      </Pressable>
    </View>;
  };

  const periodEnd = formattedPeriodEnd(subscriptionPeriodEnd);

  return <>
    <Stack.Screen options={{ headerShown: true, title: "Plan options", presentation: "modal" }} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24, backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <View style={[styles.subscriptionCard, { backgroundColor: header.paid ? colors.accent : colors.card, borderColor: header.paid ? colors.primary : colors.border }]}>
        <View style={[styles.subscriptionIcon, { backgroundColor: colors.card }]}><Feather name={header.paid ? "shield" : "home"} size={20} color={colors.primary} /></View>
        <View style={styles.subscriptionCopy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{header.paid ? "Your subscription" : "Current access"}</Text>
          <View style={styles.subscriptionNameRow}><Text accessibilityRole="header" style={[styles.subscriptionName, { color: colors.foreground }]}>{header.planLabel}</Text><View style={[styles.currentBadge, { backgroundColor: colors.primary }]}><Text style={[styles.currentBadgeText, { color: colors.primaryForeground }]}>Current plan</Text></View></View>
          <Text style={[styles.subscriptionDetail, { color: colors.mutedForeground }]}>{header.paid ? [activeCadence ? `Billed ${activeCadence === "annual" ? "annually" : "monthly"}` : null, periodEnd ? `current period ends ${periodEnd}` : null].filter(Boolean).join(" · ") || "Manage your subscription below." : "Upgrade whenever you need more inventory tools."}</Text>
          {managementUrl ? <Pressable accessibilityRole="link" onPress={() => void manageSubscription()} style={styles.manageLink}><Text style={[styles.manageLinkText, { color: colors.primary }]}>{managementLabel}</Text><Feather name="chevron-right" size={14} color={colors.primary} /></Pressable> : null}
        </View>
      </View>

      {!gatesEnabled ? <View style={[styles.notice, { backgroundColor: colors.accent }]}><Text style={[styles.noticeText, { color: colors.accentForeground }]}>Tester mode: limits may be visible without blocking access.</Text></View> : null}

      <View style={styles.section}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Billing cycle</Text><View accessibilityRole="tablist" style={[styles.cycleToggle, { backgroundColor: colors.secondary }]}>{(["monthly", "annual"] as const).map((period) => <Pressable key={period} accessibilityRole="tab" accessibilityState={{ selected: selectedPeriod === period }} onPress={() => setChosenPeriod(period)} style={[styles.cycleOption, selectedPeriod === period && { backgroundColor: colors.card }]}><Text style={[styles.cycleText, { color: selectedPeriod === period ? colors.foreground : colors.mutedForeground }]}>{periodLabel(period)}</Text></Pressable>)}</View></View>

      <View style={styles.section}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Choose your plan</Text>
        <FlatList ref={carouselRef} horizontal data={[...planOrder]} keyExtractor={(item) => item} renderItem={renderPlanCard} showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + cardGap} decelerationRate="fast" initialScrollIndex={currentIndex}
          contentContainerStyle={{ gap: cardGap, paddingHorizontal: (width - cardWidth) / 2 }} getItemLayout={(_, index) => ({ length: cardWidth + cardGap, offset: (cardWidth + cardGap) * index, index })}
          onMomentumScrollEnd={(event) => setVisibleCard(Math.max(0, Math.min(2, Math.round(event.nativeEvent.contentOffset.x / (cardWidth + cardGap)))))} />
        <View style={styles.dots}>{planOrder.map((plan, index) => <View key={plan} style={[styles.dot, { backgroundColor: index === visibleCard ? colors.primary : colors.border }, index === visibleCard && styles.activeDot]} />)}</View>
      </View>

      {packages.length === 0 ? <View style={[styles.packageNotice, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.packageNoticeTitle, { color: colors.foreground }]}>Store plans are temporarily unavailable</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{error ?? "You can keep using your current access and try again later."}</Text></View> : null}

      <View style={styles.section}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Compare all plans</Text><View style={[styles.comparison, { borderColor: colors.border }]}><View style={[styles.compareRow, styles.compareHeader, { borderBottomColor: colors.border }]}><Text style={[styles.featureCell, styles.headerText, { color: colors.mutedForeground }]}>FEATURE</Text>{planOrder.map((plan) => <Text key={plan} style={[styles.valueCell, styles.headerText, { color: plan === "plus" ? colors.primary : colors.mutedForeground }]}>{plan.toUpperCase()}</Text>)}</View>{comparison.map((row, index) => <View key={row.label} style={[styles.compareRow, index < comparison.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}><Text style={[styles.featureCell, { color: colors.foreground }]}>{row.label}</Text><Text style={[styles.valueCell, { color: colors.mutedForeground }]}>{row.free}</Text><Text style={[styles.valueCell, { color: colors.foreground }]}>{row.plus}</Text><Text style={[styles.valueCell, { color: colors.foreground }]}>{row.family}</Text></View>)}</View><Text style={[styles.footnote, { color: colors.mutedForeground }]}>Fair-use limits protect against automated abuse. Normal home-inventory use is included.</Text></View>

      {(purchaseLoading || isRefreshing) ? <View accessibilityLiveRegion="polite" style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.body, { color: colors.mutedForeground }]}>{isRefreshing ? "Purchase received, refreshing access..." : "Contacting the store..."}</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Restore purchases" disabled={purchaseLoading} onPress={() => void restore()} style={({ pressed }) => [styles.restore, { opacity: purchaseLoading ? 0.55 : pressed ? 0.72 : 1 }]}><Text style={[styles.restoreText, { color: colors.primary }]}>Restore purchases</Text></Pressable>
      <View style={styles.footer}><Text style={[styles.legal, { color: colors.mutedForeground }]}>Payment is charged to your Apple or Google account. Subscriptions renew unless cancelled and are managed through your store subscription settings.</Text><View style={styles.legalLinks}>{privacyUrl ? <Pressable accessibilityRole="link" onPress={() => void openLegal(privacyUrl, "privacy policy")}><Text style={[styles.legalLink, { color: colors.primary }]}>Privacy policy</Text></Pressable> : null}{privacyUrl && termsUrl ? <Text style={{ color: colors.mutedForeground }}>•</Text> : null}{termsUrl ? <Pressable accessibilityRole="link" onPress={() => void openLegal(termsUrl, "terms")}><Text style={[styles.legalLink, { color: colors.primary }]}>Terms</Text></Pressable> : null}</View></View>
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingVertical: 14, gap: 20 }, section: { gap: 9 }, body: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  subscriptionCard: { marginHorizontal: 16, borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: "row", gap: 11 }, subscriptionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" }, subscriptionCopy: { flex: 1, gap: 4 }, eyebrow: { fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "Inter_700Bold" }, subscriptionNameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 }, subscriptionName: { fontSize: 18, fontFamily: "Inter_700Bold" }, subscriptionDetail: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" }, currentBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }, currentBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold" }, manageLink: { minHeight: 34, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 2 }, manageLinkText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  notice: { marginHorizontal: 16, padding: 10, borderRadius: 9 }, noticeText: { fontSize: 11, fontFamily: "Inter_500Medium" }, sectionTitle: { marginHorizontal: 16, fontSize: 15, fontFamily: "Inter_700Bold" }, cycleToggle: { marginHorizontal: 16, padding: 4, borderRadius: 999, flexDirection: "row" }, cycleOption: { flex: 1, minHeight: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" }, cycleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  planCard: { borderWidth: 1.5, borderRadius: 20, padding: 17, gap: 12, overflow: "visible" }, ribbon: { position: "absolute", top: -10, alignSelf: "center", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }, ribbonText: { fontSize: 9, fontFamily: "Inter_700Bold" }, planHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, planHeadLeft: { flexDirection: "row", alignItems: "center", gap: 9 }, planIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" }, planName: { fontSize: 17, fontFamily: "Inter_700Bold" }, planTag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }, planTagText: { fontSize: 9, fontFamily: "Inter_700Bold" }, planDescription: { minHeight: 34, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" }, priceRow: { minHeight: 34, flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 5 }, price: { fontSize: 25, fontFamily: "Inter_700Bold" }, period: { fontSize: 11, fontFamily: "Inter_500Medium" }, unavailable: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_600SemiBold" }, savingsBadge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }, savingsText: { fontSize: 9, fontFamily: "Inter_700Bold" }, benefits: { flex: 1, gap: 7 }, benefitRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 }, benefitText: { flex: 1, fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium" }, planButton: { minHeight: 44, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7, paddingHorizontal: 10 }, planButtonText: { fontSize: 12, textAlign: "center", fontFamily: "Inter_700Bold" }, dots: { minHeight: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, dot: { width: 6, height: 6, borderRadius: 3 }, activeDot: { width: 16 },
  packageNotice: { marginHorizontal: 16, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 }, packageNoticeTitle: { fontSize: 13, fontFamily: "Inter_700Bold" }, comparison: { marginHorizontal: 16, borderWidth: 1, borderRadius: 14, overflow: "hidden" }, compareRow: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 9, gap: 4 }, compareHeader: { borderBottomWidth: StyleSheet.hairlineWidth }, featureCell: { flex: 1.35, fontSize: 9, lineHeight: 13, fontFamily: "Inter_600SemiBold" }, valueCell: { flex: 1, fontSize: 8.5, lineHeight: 13, textAlign: "center", fontFamily: "Inter_500Medium" }, headerText: { fontSize: 8, letterSpacing: 0.25, fontFamily: "Inter_700Bold" }, footnote: { marginHorizontal: 16, fontSize: 10, lineHeight: 15, fontFamily: "Inter_400Regular" }, loading: { alignItems: "center", gap: 7 }, restore: { minHeight: 42, alignItems: "center", justifyContent: "center" }, restoreText: { fontSize: 12, fontFamily: "Inter_700Bold" }, footer: { marginHorizontal: 16, alignItems: "center", gap: 8 }, legal: { maxWidth: 360, textAlign: "center", fontSize: 10, lineHeight: 15, fontFamily: "Inter_400Regular" }, legalLinks: { flexDirection: "row", alignItems: "center", gap: 9 }, legalLink: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
});
