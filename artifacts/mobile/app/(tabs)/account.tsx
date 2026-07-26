import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { Stack, router, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { LegalDocumentModal } from "@/components/LegalDocumentModal";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { useFeedbackUnread } from "@/hooks/useFeedbackUnread";
import {
  loadUsageAllowances,
  type UsageAllowance,
} from "@/lib/usage-allowances";
import {
  COVERLY_LEGAL_DOCUMENTS,
  type CoverlyLegalDocument,
} from "@/lib/legal-links";
import {
  usageWarningLevel,
} from "@/lib/usage-allowances-model";

export default function AccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const { profile, isAdmin, isLoading, isError } = useAccountProfile();
  const feedbackUnread = useFeedbackUnread();
  const [legalDocument, setLegalDocument] = React.useState<CoverlyLegalDocument | null>(null);
  const {
    effectivePlan,
    purchaseLoading,
    restorePurchases,
    error: billingError,
  } = useEntitlements();
  const usageQuery = useQuery({
    queryKey: ["usage-allowances", session?.user.id],
    queryFn: loadUsageAllowances,
    enabled: !!session,
    staleTime: 30_000,
    retry: 1,
  });

  const email = profile?.email ?? session?.user.email ?? "Email unavailable";
  const displayName = profile?.fullName ?? null;
  const entitlementPlanLabel = effectivePlan === "coverly_family" ? "Family" : effectivePlan === "coverly_plus" ? "Plus" : "Free";
  const planLabel = isLoading && effectivePlan === "free"
    ? "Loading…"
    : entitlementPlanLabel;
  const initialsSource = displayName ?? (email === "Email unavailable" ? "?" : email);
  const initials = initialsSource.slice(0, 1).toUpperCase();
  const version = Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "Unknown";
  const build = Constants.nativeBuildVersion ?? (Platform.OS === "ios"
    ? Constants.platform?.ios?.buildNumber ?? Constants.expoConfig?.ios?.buildNumber
    : Platform.OS === "android"
      ? Constants.platform?.android?.versionCode?.toString() ?? Constants.expoConfig?.android?.versionCode?.toString()
      : undefined);

  const openLegal = async (document: CoverlyLegalDocument) => {
    if (Platform.OS !== "web") {
      setLegalDocument(document);
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(document.url);
    } catch {
      Alert.alert(`Unable to open ${document.title.toLowerCase()}`, "Please try again later.");
    }
  };

  const confirmSignOut = () => {
    if (Platform.OS === "web") {
      const confirmed =
        typeof window === "undefined"
          ? true
          : window.confirm("Sign out? You can sign back in at any time.");
      if (!confirmed) return;
      void signOut();
      return;
    }

    Alert.alert("Sign out?", "You can sign back in at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          void signOut();
        },
      },
    ]);
  };

  const restore = async () => {
    const result = await restorePurchases();
    Alert.alert(result.ok ? "Purchases restored" : "Restore complete", result.message);
  };
  return (
    <>
      <Stack.Screen options={{ title: "Account" }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
            <Text style={[styles.initials, { color: colors.accentForeground }]}>{initials}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={[styles.email, { color: colors.foreground }]} numberOfLines={1}>{displayName ?? email}</Text>
            {displayName ? <Text style={[styles.secondaryEmail, { color: colors.mutedForeground }]} numberOfLines={1}>{email}</Text> : null}
            <View style={styles.profileMeta}>
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.badgeText, { color: colors.accentForeground }]}>{planLabel}</Text>
              </View>
              <Text style={[styles.version, { color: colors.mutedForeground }]}>v{version}{build ? ` (${build})` : ""}</Text>
            </View>
            {isError && <Text style={[styles.profileWarning, { color: colors.warning }]}>Profile details could not be loaded.</Text>}
          </View>
        </View>

        <AccountSection title="Profile">
          <AccountRow
            icon="user"
            title="Profile & notifications"
            subtitle="Name, country and future notifications"
            tone="blue"
            onPress={() => router.push("/profile-settings" as Href)}
            last
          />
        </AccountSection>

        <ClaimPacksSection onOpen={() => router.push("/(tabs)/claim-packs" as Href)} />

        <PlanUsageSection
          planLabel={planLabel}
          effectivePlan={effectivePlan}
          allowances={usageQuery.data ?? []}
          isLoading={usageQuery.isLoading}
          isError={usageQuery.isError}
          isAdmin={isAdmin}
          billingUnavailable={!!billingError}
          purchaseLoading={purchaseLoading}
          onManagePlan={() => router.push("/upgrade" as Href)}
          onRestore={() => void restore()}
        />

        <AccountSection title="Support & help">
          <AccountRow
            icon="book-open"
            title="User guide"
            subtitle="How to use Coverly"
            tone="amber"
            onPress={() => router.push("/user-guide" as Href)}
          />
          <AccountRow
            icon="message-square"
            title="Feedback & support"
            subtitle="Report an issue or read support replies"
            tone="teal"
            badgeCount={feedbackUnread.data?.userUnreadCount}
            onPress={() => router.push("/feedback" as Href)}
            last
          />
        </AccountSection>

        {isAdmin && (
          <AccountSection title="Administration">
            <AccountRow
              icon="shield"
              title="Admin"
              subtitle="System readiness and administration tools"
              tone="greyBlue"
              onPress={() => router.push("/admin" as Href)}
              last
            />
          </AccountSection>
        )}

        <AccountSection title="About & legal">
          <AccountRow
            icon="lock"
            title="Privacy policy"
            tone="green"
            onPress={() => void openLegal(COVERLY_LEGAL_DOCUMENTS.privacy)}
          />
          <AccountRow
            icon="file-text"
            title="Terms"
            tone="green"
            onPress={() => void openLegal(COVERLY_LEGAL_DOCUMENTS.terms)}
          />
          <AccountRow
            icon="trash-2"
            title="Request account deletion"
            subtitle="Delete your Coverly account and associated data."
            tone="red"
            onPress={() => router.push("/account-deletion" as Href)}
            last
          />
        </AccountSection>

        <AccountSection title="Sign out">
          <AccountRow icon="log-out" title="Sign out" tone="neutral" onPress={confirmSignOut} last />
        </AccountSection>
      </ScrollView>
      <LegalDocumentModal document={legalDocument} onClose={() => setLegalDocument(null)} />
    </>
  );
}

function ClaimPacksSection({ onOpen }: { onOpen: () => void }) {
  return (
    <AccountSection title="Claim packs">
      <AccountRow
        icon="package"
        title="Claim packs"
        subtitle="Create or continue a claim-pack draft"
        tone="lavender"
        onPress={onOpen}
        last
      />
    </AccountSection>
  );
}

function formatResetDate(value: string | null): string {
  if (!value) return "your next monthly reset";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "your next monthly reset";
  return date.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
}

function PlanUsageSection({
  planLabel,
  effectivePlan,
  allowances,
  isLoading,
  isError,
  isAdmin,
  billingUnavailable,
  purchaseLoading,
  onManagePlan,
  onRestore,
}: {
  planLabel: string;
  effectivePlan: "free" | "coverly_plus" | "coverly_family";
  allowances: UsageAllowance[];
  isLoading: boolean;
  isError: boolean;
  isAdmin: boolean;
  billingUnavailable: boolean;
  purchaseLoading: boolean;
  onManagePlan: () => void;
  onRestore: () => void;
}) {
  const colors = useColors();
  const rows = allowances.filter((row) => row.feature === "ai_scan" || row.feature === "replacement_pricing");
  const resetAt = rows[0]?.resetAt ?? null;
  const included = effectivePlan !== "free" || isAdmin || (rows.length > 0 && rows.every((row) => !row.isLimited));
  const planName = planLabel.startsWith("Loading") ? planLabel : `Coverly ${planLabel}`;

  return (
    <AccountSection title="Plan & usage">
      <View style={[styles.planUsageContent, { backgroundColor: "#F6FCFA" }]}>
        <View style={styles.planSummary}>
          <Text style={[styles.planName, { color: colors.foreground }]}>{planName}</Text>
          <Text style={[styles.planDescription, { color: colors.mutedForeground }]}>
            {included
              ? "AI scans and replacement pricing included. Fair use applies."
              : "Monthly AI scans and price searches are included up to your Free plan limits."}
          </Text>
        </View>

        <Pressable accessibilityRole="button" onPress={onManagePlan} style={({ pressed }) => [styles.manageRow, { borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}>
          <Text style={[styles.manageText, { color: colors.foreground }]}>{effectivePlan === "free" ? "Upgrade plan" : "Manage plan"}</Text>
          <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
        </Pressable>

        <Text style={[styles.usageHeading, { color: colors.mutedForeground }]}>Usage this month</Text>
        {isLoading ? (
          <View style={styles.usageLoading}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.usagePlaceholder, { color: colors.mutedForeground }]}>Checking usage…</Text>
          </View>
        ) : isError || rows.length === 0 ? (
          <Text style={[styles.usagePlaceholder, { color: isError ? colors.warning : colors.mutedForeground }]}>Usage information is currently unavailable.</Text>
        ) : (
          <View style={styles.usageRows}>
            {rows.map((row) => {
              const limited = !included && row.isLimited;
              const warning = limited ? usageWarningLevel(row) : "none";
              const tone = warning === "empty" ? colors.destructive : warning === "low" ? colors.warning : colors.foreground;
              return (
                <View key={row.feature} style={styles.compactUsageRow}>
                  <Text style={[styles.usageRowTitle, { color: colors.foreground }]}>{row.feature === "ai_scan" ? "AI scans" : "Price searches"}</Text>
                  <Text style={[styles.usageValue, { color: limited ? tone : colors.primary }]}>
                    {limited ? `${row.usedUnits} / ${row.limitUnits} used · ${row.remainingUnits ?? 0} left` : "Included"}
                  </Text>
                </View>
              );
            })}
            {!included ? <Text style={[styles.usageReset, { color: colors.mutedForeground }]}>Resets {formatResetDate(resetAt)}</Text> : null}
          </View>
        )}

        {billingUnavailable ? <Text style={[styles.billingUnavailable, { color: colors.warning }]}>Store services are currently unavailable.</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restore purchases"
          accessibilityHint="Restore a previous App Store or Google Play purchase."
          disabled={purchaseLoading}
          onPress={onRestore}
          style={({ pressed }) => [styles.restoreAction, { opacity: purchaseLoading ? 0.55 : pressed ? 0.72 : 1 }]}
        >
          {purchaseLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          <Text style={[styles.restoreText, { color: colors.primary }]}>{purchaseLoading ? "Restoring purchases…" : "Restore purchases"}</Text>
        </Pressable>
        <Text style={[styles.restoreHelper, { color: colors.mutedForeground }]}>Restore a previous App Store or Google Play purchase.</Text>
      </View>
    </AccountSection>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  profileCard: { borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", gap: 13 },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  initials: { fontSize: 20, fontFamily: "Inter_700Bold" },
  profileCopy: { flex: 1, gap: 7 },
  email: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondaryEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  profileMeta: { flexDirection: "row", alignItems: "center", gap: 9 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  version: { fontSize: 11, fontFamily: "Inter_400Regular" },
  profileWarning: { fontSize: 11, fontFamily: "Inter_400Regular" },
  planUsageContent: { paddingHorizontal: 16, paddingBottom: 14, gap: 12 },
  planSummary: { gap: 4 },
  planName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  planDescription: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  manageRow: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  manageText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  usageHeading: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  usageLoading: { flexDirection: "row", alignItems: "center", gap: 8 },
  compactUsageRow: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  usageValue: { flexShrink: 1, textAlign: "right", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  billingUnavailable: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  restoreAction: { alignSelf: "flex-start", minHeight: 28, flexDirection: "row", alignItems: "center", gap: 7 },
  restoreText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  restoreHelper: { marginTop: -9, fontSize: 10, lineHeight: 15, fontFamily: "Inter_400Regular" },
  usagePlaceholder: { fontSize: 12, fontFamily: "Inter_400Regular" },
  usageRows: { gap: 0 },
  usageRowTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  usageReset: { marginTop: 2, fontSize: 11, fontFamily: "Inter_400Regular" },
});
