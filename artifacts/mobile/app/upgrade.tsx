import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LegalDocumentModal } from "@/components/LegalDocumentModal";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { ownershipPackageMapping } from "@/lib/billing";
import { trackEvent } from "@/lib/analytics";
import {
  analyticsSourceScreen,
  type OwnershipAction,
} from "@/lib/analytics-core";
import {
  COVERLY_LEGAL_DOCUMENTS,
  type CoverlyLegalDocument,
} from "@/lib/legal-links";
import {
  FAIR_USE_COPY,
  OWNERSHIP_BENEFITS,
  ownershipOutcome,
  ownershipScreenState,
  selectOwnershipPackage,
} from "@/lib/upgrade-model";

export default function UpgradeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const {
    capabilities,
    ownsCoverly,
    offering,
    ownershipVerificationState,
    pendingOperation,
    purchaseLoading,
    isRefreshing,
    purchasePackage,
    restorePurchases,
    retryReconciliation,
    refreshEntitlements,
    refreshOffering,
  } = useEntitlements();
  const [legalDocument, setLegalDocument] =
    useState<CoverlyLegalDocument | null>(null);
  const [notice, setNotice] = useState<{
    identity: typeof retryReconciliation;
    message: string;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const purchaseActionLockRef = useRef(false);
  const identity = useRef(retryReconciliation);
  identity.current = retryReconciliation;
  const paywallTrackedRef = useRef<typeof retryReconciliation | null>(null);
  const availabilityTracked = useRef("");
  const selected = useMemo(
    () =>
      selectOwnershipPackage(
        offering?.availablePackages ?? [],
        ownershipPackageMapping,
      ),
    [offering],
  );
  const sourceScreen = analyticsSourceScreen(feature ?? "account");
  const state = ownershipScreenState({
    access: capabilities,
    verification: ownershipVerificationState,
    pending: pendingOperation !== null,
    busy: purchaseLoading,
    productAvailable: selected !== null,
  });
  const busy = working || purchaseLoading || isRefreshing;
  const record = (action: OwnershipAction) => {
    void trackEvent("ownership_flow", {
      ownership_action: action,
      plan: "owned",
      billing_period: "one_time",
      source_screen: sourceScreen,
      product_identifier: selected?.product.identifier,
    });
  };

  useEffect(() => {
    if (paywallTrackedRef.current === retryReconciliation) return;
    paywallTrackedRef.current = retryReconciliation;
    availabilityTracked.current = "";
    void trackEvent("ownership_flow", {
      ownership_action: "paywall_viewed",
      plan: "owned",
      source_screen: sourceScreen,
    });
    void trackEvent("paywall_viewed", { source_screen: sourceScreen });
  }, [retryReconciliation, sourceScreen]);
  useEffect(() => {
    if (state !== "available" && state !== "unavailable") return;
    if (availabilityTracked.current === state) return;
    availabilityTracked.current = state;
    void trackEvent("ownership_flow", {
      ownership_action:
        state === "available" ? "product_available" : "product_unavailable",
      plan: "owned",
      source_screen: sourceScreen,
    });
  }, [state, sourceScreen, retryReconciliation]);

  const act = async (action: "buy" | "restore" | "confirm" | "refresh") => {
    if (busy || purchaseActionLockRef.current) return;
    if (action === "buy" && (state !== "available" || !selected)) return;
    purchaseActionLockRef.current = true;
    setWorking(true);
    const account = retryReconciliation;
    try {
      if (action === "refresh") {
        await Promise.all([refreshOffering(), refreshEntitlements()]);
        return;
      }
      record(
        action === "buy"
          ? "purchase_started"
          : action === "restore"
            ? "restore_started"
            : "confirmation_started",
      );
      if (action === "buy")
        void trackEvent("purchase_started", {
          plan: "owned",
          billing_period: "one_time",
          product_identifier: selected!.product.identifier,
          source_screen: sourceScreen,
        });
      const result =
        action === "buy"
          ? await purchasePackage(selected!)
          : action === "restore"
            ? await restorePurchases()
            : await retryReconciliation();
      if (identity.current !== account) return;
      setNotice({ identity: account, message: result.message });
      // Canonical reconciliation and the RevenueCat webhook supply the
      // authoritative billing record; these events describe client interaction.
      if (action === "buy" && result.ok) {
        record("purchase_completed");
        void trackEvent("purchase_completed", {
          plan: "owned",
          billing_period: "one_time",
          product_identifier: selected!.product.identifier,
          source_screen: sourceScreen,
        });
      }
      record(
        action === "restore" &&
          !result.ok &&
          !result.pending &&
          result.outcome !== "nothing_found"
          ? "restore_failed"
          : ownershipOutcome(result),
      );
      if (action === "restore" && result.ok)
        void trackEvent("purchase_restored", { source_screen: sourceScreen });
    } catch {
      if (identity.current === account)
        setNotice({
          identity: account,
          message: "This is temporarily unavailable. Please try again.",
        });
    } finally {
      purchaseActionLockRef.current = false;
      setWorking(false);
    }
  };
  const openLegal = async (document: CoverlyLegalDocument) => {
    if (Platform.OS !== "web") {
      setLegalDocument(document);
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(document.url);
    } catch {
      setNotice({
        identity: retryReconciliation,
        message: "Unable to open this document. Please try again later.",
      });
    }
  };
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };
  const actionButton = (
    label: string,
    onPress: () => void,
    secondary = false,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: disabled && busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? colors.card : colors.primary,
          borderColor: colors.primary,
          opacity: disabled ? 0.55 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: secondary ? colors.primary : colors.primaryForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  const statusTitle =
    state === "owned"
      ? "Coverly unlocked"
      : state === "pending"
        ? pendingOperation === "purchase"
          ? "Purchase complete — confirming your Coverly access"
          : "Confirming your Coverly access"
        : state === "legacy"
          ? "Your Coverly access continues"
          : state === "included"
            ? "Coverly access included"
            : state === "checking"
              ? "Checking your access"
              : state === "busy"
                ? "Completing your purchase"
                : state === "verification_unavailable"
                  ? "Let's confirm your access"
                  : "Purchase temporarily unavailable";
  const statusBody =
    state === "owned"
      ? ownershipVerificationState === "unavailable"
        ? "Your previously confirmed ownership is available on this device. Reconnect to refresh your access."
        : "Your one-time purchase is confirmed. Your inventory, evidence and claim-ready PDF exports are ready when you need them."
      : state === "pending"
        ? "Your store transaction does not need to be repeated. Retry confirmation or use Restore Purchases to recover access."
        : state === "legacy"
          ? "Your existing legacy access is still recognized. There is no need to purchase Coverly again."
          : state === "included"
            ? "Your account already has approved access. Continue using Coverly with your current capabilities."
            : state === "checking" || state === "busy"
              ? "This may take a moment."
              : state === "verification_unavailable"
                ? "We couldn't verify this account's access. Refresh or restore a previous purchase before starting a new one."
                : "We couldn't load the one-time Coverly purchase. Try again later; your inventory and manual tools remain available.";
  const sales = state === "available" || state === "unavailable";
  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: "Coverly", presentation: "modal" }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.page,
          { paddingBottom: Math.max(insets.bottom, 20) + 16 },
        ]}
      >
        <View style={[styles.hero, { backgroundColor: "#132D3A" }]}>
          <View accessible={false} style={styles.mark}>
            <Feather
              name={ownsCoverly ? "check" : "home"}
              size={30}
              color="#9DE1D8"
            />
          </View>
          <Text style={styles.eyebrow}>KNOW WHAT YOU OWN.</Text>
          <Text accessibilityRole="header" style={styles.heroTitle}>
            {sales ? "Document your home properly." : statusTitle}
          </Text>
          <Text style={styles.heroBody}>
            {sales ? "Own Coverly with one purchase." : statusBody}
          </Text>
        </View>
        {sales ? (
          <>
            <View style={styles.section}>
              <Text
                accessibilityRole="header"
                style={[styles.heading, { color: colors.foreground }]}
              >
                A home inventory you can rely on
              </Text>
              {OWNERSHIP_BENEFITS.map((benefit) => (
                <View style={styles.benefit} key={benefit}>
                  <Feather
                    name="check-circle"
                    size={18}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.body, { flex: 1, color: colors.foreground }]}
                  >
                    {benefit}
                  </Text>
                </View>
              ))}
            </View>
            <View
              style={[
                styles.purchase,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              {state === "available" && selected ? (
                <>
                  <Text
                    style={[styles.label, { color: colors.mutedForeground }]}
                  >
                    ONE-TIME PURCHASE
                  </Text>
                  <Text
                    accessibilityLabel={`One-time price ${selected.product.priceString}`}
                    style={[styles.price, { color: colors.foreground }]}
                  >
                    {selected.product.priceString}
                  </Text>
                  {actionButton(
                    "Unlock Coverly",
                    () => void act("buy"),
                    false,
                    busy,
                  )}
                  <Text
                    style={[styles.small, { color: colors.mutedForeground }]}
                  >
                    One payment through your app store.
                  </Text>
                </>
              ) : (
                <>
                  <Text
                    accessibilityRole="header"
                    style={[styles.heading, { color: colors.foreground }]}
                  >
                    {statusTitle}
                  </Text>
                  <Text
                    style={[styles.body, { color: colors.mutedForeground }]}
                  >
                    {statusBody}
                  </Text>
                  {actionButton(
                    "Try again",
                    () => void act("refresh"),
                    false,
                    busy,
                  )}
                </>
              )}
            </View>
            <View style={[styles.section, { paddingHorizontal: 8 }]}>
              <Text
                accessibilityRole="header"
                style={[styles.heading, { color: colors.foreground }]}
              >
                AI assistance included
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {FAIR_USE_COPY}
              </Text>
              <Text style={[styles.small, { color: colors.mutedForeground }]}>
                Not ready yet? Free lets you create an inventory, try limited AI
                assistance and keep managing items manually.
              </Text>
            </View>
            {actionButton("Continue with Free", back, true)}
          </>
        ) : (
          <View style={styles.section}>
            {state === "checking" || state === "busy" || busy ? (
              <ActivityIndicator
                accessibilityLabel="Working"
                color={colors.primary}
              />
            ) : null}
            {state === "pending" || state === "verification_unavailable"
              ? actionButton(
                  "Retry confirmation",
                  () => void act("confirm"),
                  false,
                  busy,
                )
              : null}
            {actionButton(
              "Back to my inventory",
              back,
              state === "pending" || state === "verification_unavailable",
            )}
          </View>
        )}
        {notice?.identity === retryReconciliation ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.notice, { color: colors.foreground }]}
          >
            {notice.message}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restore Purchases"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void act("restore")}
          style={styles.linkButton}
        >
          <Text style={[styles.link, { color: colors.primary }]}>
            Restore Purchases
          </Text>
        </Pressable>
        <View style={styles.legalLinks}>
          <Pressable
            accessibilityRole="link"
            onPress={() => void openLegal(COVERLY_LEGAL_DOCUMENTS.terms)}
            style={styles.linkButton}
          >
            <Text style={[styles.small, { color: colors.primary }]}>
              Terms & fair use
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => void openLegal(COVERLY_LEGAL_DOCUMENTS.privacy)}
            style={styles.linkButton}
          >
            <Text style={[styles.small, { color: colors.primary }]}>
              Privacy policy
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      <LegalDocumentModal
        document={legalDocument}
        onClose={() => setLegalDocument(null)}
      />
    </>
  );
}
const styles = StyleSheet.create({
  page: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    padding: 20,
    gap: 24,
  },
  hero: { padding: 28, borderRadius: 24, gap: 15 },
  mark: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: "#234653",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  eyebrow: {
    color: "#9DE1D8",
    fontSize: 11,
    letterSpacing: 1.8,
    fontFamily: "Inter_700Bold",
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 38,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  heroBody: {
    fontSize: 16,
    lineHeight: 25,
    color: "#D3E3E8",
    fontFamily: "Inter_400Regular",
  },
  section: { gap: 16 },
  heading: { fontSize: 19, lineHeight: 27, fontFamily: "Inter_600SemiBold" },
  benefit: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  body: { fontSize: 15, lineHeight: 24, fontFamily: "Inter_400Regular" },
  purchase: { borderWidth: 1, borderRadius: 20, padding: 24, gap: 16 },
  label: { fontSize: 11, letterSpacing: 1.2, fontFamily: "Inter_600SemiBold" },
  price: {
    fontSize: 32,
    lineHeight: 43,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
  button: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
    fontFamily: "Inter_700Bold",
  },
  small: { fontSize: 12, lineHeight: 19, fontFamily: "Inter_400Regular" },
  link: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  linkButton: {
    minHeight: 44,
    padding: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  legalLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
  },
  notice: { fontSize: 14, lineHeight: 22, fontFamily: "Inter_400Regular" },
});
