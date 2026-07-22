import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { usePropertyAllowance } from "@/hooks/usePropertyAllowance";
import { type PurchasesPackage } from "@/lib/billing";
import {
  buildUpgradePackages,
  defaultBillingPeriod,
  isCurrentPackage,
  isCurrentPlan,
  selectedUpgradePackage,
  upgradePackageHasPrice,
  upgradePurchaseDisabled,
  type UpgradeBillingPeriod,
  type UpgradeDisplayPackage,
  type UpgradePlanGroup,
} from "@/lib/upgrade-model";

const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;

const planContent: Record<UpgradePlanGroup, {
  name: string;
  subtitle: string;
  features: readonly string[];
}> = {
  plus: {
    name: "Coverly Plus",
    subtitle: "Everything you need for one home",
    features: [
      "AI-powered inventory tools",
      "Replacement-price research",
      "Claim-ready exports",
      "One property",
    ],
  },
  family: {
    name: "Coverly Family",
    subtitle: "Protect every property in one place",
    features: [
      "Everything in Plus",
      "Multiple properties",
      "One organised household inventory",
      "Ideal for families, landlords, or holiday homes",
    ],
  },
};

const billingPeriods: readonly Exclude<UpgradeBillingPeriod, "other">[] = ["monthly", "annual"];
const emptyPackages: PurchasesPackage[] = [];

type AppColors = ReturnType<typeof useColors>;

function periodLabel(period: UpgradeBillingPeriod) {
  return period === "annual" ? "Annual" : "Monthly";
}

function PlanVisual({ plan, accent, tint }: { plan: UpgradePlanGroup; accent: string; tint: string }) {
  const isFamily = plan === "family";
  return <View style={[styles.visual, { backgroundColor: tint }]}>
    <View style={[styles.visualOrb, styles.visualOrbOne, { backgroundColor: accent }]} />
    <View style={[styles.visualOrb, styles.visualOrbTwo, { backgroundColor: accent }]} />
    <View style={styles.homeGroup}>
      {isFamily ? <View style={[styles.homeTile, styles.homeTileBack, { borderColor: accent }]}>
        <Feather name="home" size={24} color={accent} />
      </View> : null}
      <View style={[styles.homeTile, { borderColor: accent }]}>
        <Feather name="home" size={isFamily ? 26 : 30} color={accent} />
      </View>
      <View style={[styles.shieldTile, { backgroundColor: accent }]}>
        <Feather name="shield" size={15} color="#FFFFFF" />
      </View>
    </View>
    <Text style={[styles.visualLabel, { color: accent }]}>{isFamily ? "EVERY PROPERTY" : "ONE PROTECTED HOME"}</Text>
  </View>;
}

function BillingOption({
  period,
  displayPackage,
  selected,
  accent,
  tint,
  border,
  colors,
  onSelect,
}: {
  period: Exclude<UpgradeBillingPeriod, "other">;
  displayPackage: UpgradeDisplayPackage<PurchasesPackage> | null;
  selected: boolean;
  accent: string;
  tint: string;
  border: string;
  colors: AppColors;
  onSelect: () => void;
}) {
  const available = Boolean(displayPackage);
  const savings = displayPackage?.savingsPercent;
  const price = displayPackage?.price ?? "Price unavailable";

  return <Pressable
    accessibilityRole="radio"
    accessibilityLabel={`${periodLabel(period)}, ${price}${period === "annual" ? ", best value" : ""}`}
    accessibilityState={{ checked: selected, disabled: !available }}
    disabled={!available}
    onPress={onSelect}
    style={({ pressed }) => [
      styles.billingOption,
      {
        backgroundColor: selected ? tint : colors.card,
        borderColor: selected ? border : colors.border,
        opacity: !available ? 0.58 : pressed ? 0.82 : 1,
      },
    ]}
  >
    <View style={[styles.radio, { borderColor: selected ? accent : colors.border }]}>
      {selected ? <View style={[styles.radioDot, { backgroundColor: accent }]} /> : null}
    </View>
    <View style={styles.billingCopy}>
      <View style={styles.billingTitleRow}>
        <Text style={[styles.billingTitle, { color: colors.foreground }]}>{periodLabel(period)}</Text>
        {period === "annual" ? <View style={[styles.valueBadge, { backgroundColor: accent }]}>
          <Text style={styles.valueBadgeText}>Best value</Text>
        </View> : null}
        {savings != null ? <View style={[styles.savingsBadge, { borderColor: border }]}>
          <Text style={[styles.savingsText, { color: accent }]}>Save {savings}%</Text>
        </View> : null}
      </View>
      <Text style={[styles.billingDetail, { color: colors.mutedForeground }]}>
        {period === "annual" ? "Billed once a year" : "Billed monthly"}
      </Text>
    </View>
    <Text
      accessibilityLabel={`${periodLabel(period)} price ${price}`}
      style={[styles.price, { color: available ? colors.foreground : colors.mutedForeground }]}
    >{price}</Text>
  </Pressable>;
}

function PlanCard({
  plan,
  packages,
  selectedPeriod,
  colors,
  effectivePlan,
  activeSubscriptions,
  purchaseLoading,
  isRefreshing,
  onSelectPeriod,
  onChoose,
}: {
  plan: UpgradePlanGroup;
  packages: readonly UpgradeDisplayPackage<PurchasesPackage>[];
  selectedPeriod: UpgradeBillingPeriod | null;
  colors: AppColors;
  effectivePlan: "free" | "coverly_plus" | "coverly_family";
  activeSubscriptions: readonly string[] | null | undefined;
  purchaseLoading: boolean;
  isRefreshing: boolean;
  onSelectPeriod: (period: UpgradeBillingPeriod) => void;
  onChoose: (pkg: PurchasesPackage) => void;
}) {
  const content = planContent[plan];
  const family = plan === "family";
  const accent = family ? "#6254B5" : colors.primary;
  const tint = family ? "#F3F1FC" : colors.accent;
  const border = family ? "#D7D2F2" : "#B9E4DA";
  const selectedPackage = selectedUpgradePackage(packages, selectedPeriod);
  const currentPlan = isCurrentPlan(plan, effectivePlan);
  const currentPackage = selectedPackage
    ? isCurrentPackage(selectedPackage.pkg.product.identifier, activeSubscriptions)
    : false;
  const priceAvailable = upgradePackageHasPrice(selectedPackage);
  const disabled = upgradePurchaseDisabled(selectedPackage, { purchaseLoading, isRefreshing, currentPackage });
  const buttonLabel = currentPackage ? "Current subscription" : `Choose ${content.name}`;

  return <View style={[styles.planCard, {
    backgroundColor: colors.card,
    borderColor: currentPlan ? border : colors.border,
    borderRadius: colors.radius + 6,
  }]}>
    <PlanVisual plan={plan} accent={accent} tint={tint} />

    <View style={styles.planCardBody}>
      <View style={styles.planTitleRow}>
        <View style={styles.planTitleCopy}>
          <Text accessibilityRole="header" style={[styles.planTitle, { color: colors.foreground }]}>{content.name}</Text>
          <Text style={[styles.planSubtitle, { color: colors.mutedForeground }]}>{content.subtitle}</Text>
        </View>
        {currentPlan ? <View style={[styles.currentBadge, { backgroundColor: tint }]}>
          <Text style={[styles.currentBadgeText, { color: accent }]}>Current plan</Text>
        </View> : null}
      </View>

      <View style={styles.featureList}>
        {content.features.map((feature) => <View key={feature} style={styles.featureRow}>
          <View style={[styles.featureIcon, { backgroundColor: tint }]}>
            <Feather name="check" size={13} color={accent} />
          </View>
          <Text style={[styles.featureText, { color: colors.foreground }]}>{feature}</Text>
        </View>)}
      </View>

      <View accessibilityRole="radiogroup" style={styles.billingGroup}>
        {billingPeriods.map((period) => <BillingOption
          key={period}
          period={period}
          displayPackage={selectedUpgradePackage(packages, period)}
          selected={selectedPeriod === period}
          accent={accent}
          tint={tint}
          border={border}
          colors={colors}
          onSelect={() => onSelectPeriod(period)}
        />)}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${buttonLabel}${selectedPackage ? `, ${periodLabel(selectedPackage.period)}, ${selectedPackage.price}` : ""}`}
        accessibilityState={{ disabled, busy: purchaseLoading || isRefreshing }}
        disabled={disabled}
        onPress={() => {
          if (selectedPackage && priceAvailable) onChoose(selectedPackage.pkg);
        }}
        style={({ pressed }) => [styles.button, {
          backgroundColor: currentPackage ? tint : accent,
          opacity: disabled && !currentPackage ? 0.5 : pressed ? 0.84 : 1,
        }]}
      >
        {purchaseLoading && !currentPackage ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
        <Text style={[styles.buttonText, { color: currentPackage ? accent : "#FFFFFF" }]}>{buttonLabel}</Text>
      </Pressable>
    </View>
  </View>;
}

export default function UpgradeScreen() {
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    effectivePlan, offering, customerInfo, error, purchaseLoading, isRefreshing,
    purchasePackage, restorePurchases, gatesEnabled,
  } = useEntitlements();
  const { allowance: propertyAllowance } = usePropertyAllowance();
  const packages = offering?.availablePackages ?? emptyPackages;
  const groupedPackages = useMemo(() => buildUpgradePackages(packages), [packages]);
  const [selectedPeriods, setSelectedPeriods] = useState<Record<UpgradePlanGroup, UpgradeBillingPeriod | null>>({
    plus: "annual",
    family: "annual",
  });
  const purchaseActionLockRef = React.useRef(false);

  useEffect(() => {
    setSelectedPeriods((current) => ({
      plus: selectedUpgradePackage(groupedPackages.plus, current.plus)
        ? current.plus
        : defaultBillingPeriod(groupedPackages.plus),
      family: selectedUpgradePackage(groupedPackages.family, current.family)
        ? current.family
        : defaultBillingPeriod(groupedPackages.family),
    }));
  }, [groupedPackages]);

  const buy = async (pkg: PurchasesPackage) => {
    if (purchaseLoading || isRefreshing || purchaseActionLockRef.current) return;
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
    if (purchaseLoading || isRefreshing || purchaseActionLockRef.current) return;
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

  const currentPlanLabel = effectivePlan === "free"
    ? "Free"
    : effectivePlan === "coverly_family" ? "Coverly Family" : "Coverly Plus";

  return <>
    <Stack.Screen options={{ headerShown: true, title: "Choose your plan", presentation: "modal" }} />
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28, backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: colors.accent }]}>
          <Feather name="shield" size={22} color={colors.primary} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Choose your plan</Text>
        <Text style={[styles.supportingText, { color: colors.mutedForeground }]}>Protect what matters. Upgrade or cancel anytime.</Text>
        <View style={[styles.currentSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.currentDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.currentSummaryText, { color: colors.foreground }]}>Current plan: {currentPlanLabel}</Text>
        </View>
      </View>

      {!gatesEnabled && propertyAllowance.accessClass === "full_access" ? <View style={[styles.notice, { backgroundColor: colors.accent }]}>
        <Text style={[styles.noticeText, { color: colors.accentForeground }]}>Tester mode: limits may be visible without blocking access.</Text>
      </View> : null}

      {feature === "property" ? <View style={[styles.propertyPrompt, { backgroundColor: "#F3F1FC", borderColor: "#D7D2F2" }]}>
        <Feather name="home" size={17} color="#6254B5" />
        <Text style={[styles.propertyPromptText, { color: colors.foreground }]}>Need another property? Family keeps every home in one organised inventory.</Text>
      </View> : null}

      <View style={styles.sectionIntro}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.foreground }]}>Compare plans</Text>
        <Text style={[styles.sectionCopy, { color: colors.mutedForeground }]}>Annual billing is recommended for the best value.</Text>
      </View>

      {packages.length === 0 ? <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 2 }]}>
        <Feather name="shopping-bag" size={22} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Plan options are not available in this build</Text>
        <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>{error ?? "Store products are still being prepared for tester builds. You can continue using available Free features."}</Text>
      </View> : <View style={styles.planList}>
        {(["plus", "family"] as const).map((plan) => <PlanCard
          key={plan}
          plan={plan}
          packages={groupedPackages[plan]}
          selectedPeriod={selectedPeriods[plan]}
          colors={colors}
          effectivePlan={effectivePlan}
          activeSubscriptions={customerInfo?.activeSubscriptions}
          purchaseLoading={purchaseLoading}
          isRefreshing={isRefreshing}
          onSelectPeriod={(period) => setSelectedPeriods((current) => ({ ...current, [plan]: period }))}
          onChoose={(pkg) => void buy(pkg)}
        />)}
      </View>}

      {(purchaseLoading || isRefreshing) ? <View accessibilityLiveRegion="polite" style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>{isRefreshing ? "Purchase received, refreshing access..." : "Contacting the store..."}</Text>
      </View> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Restore purchases"
        accessibilityState={{ disabled: purchaseLoading || isRefreshing }}
        disabled={purchaseLoading || isRefreshing}
        onPress={() => void restore()}
        style={({ pressed }) => [styles.restore, { opacity: purchaseLoading || isRefreshing ? 0.5 : pressed ? 0.72 : 1 }]}
      >
        <Feather name="refresh-cw" size={15} color={colors.primary} />
        <Text style={[styles.restoreText, { color: colors.primary }]}>Restore purchases</Text>
      </Pressable>

      <View style={styles.footer}>
        <Text style={[styles.legalHeading, { color: colors.foreground }]}>Subscription terms</Text>
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
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 18, gap: 18 },
  header: { alignItems: "center", paddingHorizontal: 10, gap: 7 },
  headerIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  title: { fontSize: 28, lineHeight: 35, textAlign: "center", fontFamily: "Inter_700Bold" },
  supportingText: { maxWidth: 330, fontSize: 14, lineHeight: 20, textAlign: "center", fontFamily: "Inter_400Regular" },
  currentSummary: { minHeight: 34, marginTop: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  currentDot: { width: 7, height: 7, borderRadius: 4 },
  currentSummaryText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  notice: { padding: 12, borderRadius: 10 },
  noticeText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  propertyPrompt: { minHeight: 50, padding: 12, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  propertyPromptText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  sectionIntro: { gap: 3 },
  sectionTitle: { fontSize: 19, lineHeight: 25, fontFamily: "Inter_700Bold" },
  sectionCopy: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  planList: { gap: 18 },
  planCard: {
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  visual: { height: 116, overflow: "hidden", paddingHorizontal: 18, paddingVertical: 15, justifyContent: "space-between" },
  visualOrb: { position: "absolute", borderRadius: 999, opacity: 0.08 },
  visualOrbOne: { width: 100, height: 100, right: -24, top: -34 },
  visualOrbTwo: { width: 62, height: 62, right: 58, bottom: -34 },
  homeGroup: { height: 60, flexDirection: "row", alignItems: "flex-end" },
  homeTile: { width: 58, height: 54, borderRadius: 14, borderWidth: 1, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", zIndex: 2 },
  homeTileBack: { width: 50, height: 47, marginRight: -11, marginBottom: 7, opacity: 0.78, zIndex: 1 },
  shieldTile: { width: 30, height: 30, borderRadius: 15, marginLeft: -11, marginBottom: -2, alignItems: "center", justifyContent: "center", zIndex: 3, borderWidth: 2, borderColor: "#FFFFFF" },
  visualLabel: { position: "absolute", right: 18, bottom: 17, fontSize: 9, letterSpacing: 0.8, fontFamily: "Inter_700Bold" },
  planCardBody: { padding: 17, gap: 16 },
  planTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  planTitleCopy: { flex: 1, minWidth: 0, gap: 3 },
  planTitle: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_700Bold" },
  planSubtitle: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  currentBadge: { flexShrink: 0, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  currentBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold" },
  featureList: { gap: 9 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  featureIcon: { width: 21, height: 21, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  featureText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium" },
  billingGroup: { gap: 8 },
  billingOption: { minHeight: 66, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  billingCopy: { flex: 1, minWidth: 0, gap: 2 },
  billingTitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 },
  billingTitle: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_700Bold" },
  billingDetail: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_400Regular" },
  valueBadge: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3 },
  valueBadgeText: { color: "#FFFFFF", fontSize: 8, lineHeight: 11, fontFamily: "Inter_700Bold" },
  savingsBadge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  savingsText: { fontSize: 8, lineHeight: 11, fontFamily: "Inter_700Bold" },
  price: { maxWidth: "34%", fontSize: 16, lineHeight: 21, textAlign: "right", fontFamily: "Inter_700Bold", flexShrink: 1 },
  button: { minHeight: 50, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14 },
  buttonText: { fontSize: 14, textAlign: "center", fontFamily: "Inter_700Bold" },
  empty: { padding: 20, gap: 8, borderWidth: 1, alignItems: "center" },
  emptyTitle: { fontSize: 15, lineHeight: 20, textAlign: "center", fontFamily: "Inter_700Bold" },
  emptyCopy: { maxWidth: 340, fontSize: 12, lineHeight: 18, textAlign: "center", fontFamily: "Inter_400Regular" },
  loading: { alignItems: "center", gap: 8 },
  loadingText: { fontSize: 12, lineHeight: 17, textAlign: "center", fontFamily: "Inter_400Regular" },
  restore: { minHeight: 44, justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 7 },
  restoreText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  footer: { alignItems: "center", gap: 8, paddingTop: 2 },
  legalHeading: { fontSize: 11, fontFamily: "Inter_700Bold" },
  legal: { maxWidth: 360, fontSize: 10, lineHeight: 15, textAlign: "center", fontFamily: "Inter_400Regular" },
  legalLinks: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  legalLink: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  legalDot: { fontSize: 11 },
});
