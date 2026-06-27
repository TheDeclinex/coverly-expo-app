import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { Stack, router, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  loadUsageAllowances,
  type UsageAllowance,
} from "@/lib/usage-allowances";
import {
  usageWarningLevel,
} from "@/lib/usage-allowances-model";

const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;

export default function AccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const { profile, isAdmin, isLoading, isError } = useAccountProfile();
  const { subscriptionStatus, subscriptionPeriodEnd, purchaseLoading, restorePurchases, gatesEnabled } = useEntitlements();
  const usageQuery = useQuery({
    queryKey: ["usage-allowances", session?.user.id],
    queryFn: loadUsageAllowances,
    enabled: !!session,
    staleTime: 30_000,
    retry: 1,
  });

  const email = profile?.email ?? session?.user.email ?? "Email unavailable";
  const displayName = profile?.fullName ?? null;
  const planLabel = isLoading ? "Loading…" : profile?.plan ?? "Plan unavailable";
  const planStatusLabel = subscriptionStatus ?? (profile?.plan === "Free" ? "Free" : "Active");
  const planStatusHelper = subscriptionPeriodEnd
    ? `Renews or expires ${new Date(subscriptionPeriodEnd).toLocaleDateString("en-NZ")}`
    : profile?.plan === "Free"
      ? "Free plan"
      : "Managed through your Apple or Google account";
  const planStatusDetail = planStatusLabel === planLabel ? planStatusHelper : `${planStatusLabel} · ${planStatusHelper}`;
  const initialsSource = displayName ?? (email === "Email unavailable" ? "?" : email);
  const initials = initialsSource.slice(0, 1).toUpperCase();
  const version = Constants.expoConfig?.version ?? "Unknown";
  const build = Platform.OS === "ios"
    ? Constants.expoConfig?.ios?.buildNumber
    : Platform.OS === "android"
      ? Constants.expoConfig?.android?.versionCode?.toString()
      : undefined;

  const openLegal = async (url: string | undefined, label: string) => {
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert(`Unable to open ${label}`, "Please try again later.");
    }
  };

  const confirmSignOut = () => {
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

        <ClaimPacksSection onOpen={() => router.push("/(tabs)/claim-packs" as Href)} />

        {isAdmin && (
          <AccountSection title="Administration">
            <AccountRow
              icon="shield"
              title="Admin"
              subtitle="System readiness and administration tools"
              onPress={() => router.push("/admin" as Href)}
              last
            />
          </AccountSection>
        )}

        <AccountSection title="Plan & billing">
          <AccountRow icon="credit-card" title="Your plan" subtitle={planStatusDetail} value={planLabel} />
          <AccountRow icon="arrow-up-circle" title="Upgrade Coverly" subtitle="View Apple or Google subscription options" onPress={() => router.push("/upgrade" as Href)} />
          <AccountRow
            icon="refresh-cw"
            title="Restore purchases"
            subtitle="Use after reinstalling, changing devices, or signing in again."
            value={purchaseLoading ? "Restoring…" : undefined}
            disabled={purchaseLoading}
            onPress={() => void restore()}
            last={!isAdmin}
          />
          {isAdmin ? (
            <AccountRow
              icon="list"
              title="Access level"
              subtitle={profile?.plan === "Free" ? "Free plan limits are visible in the app" : "AI features included · Fair use applies"}
              value={gatesEnabled ? "Standard" : "Preview"}
              last
            />
          ) : null}
        </AccountSection>

        <UsageAllowanceCard
          allowances={usageQuery.data ?? []}
          isLoading={usageQuery.isLoading}
          isError={usageQuery.isError}
          isAdmin={isAdmin}
          onUpgrade={() => router.push("/upgrade" as Href)}
        />

        <AccountSection title="Referrals">
          <AccountRow
            icon="gift"
            title="Invite a friend"
            subtitle="Give a friend bonus AI scan credits and earn 7 days of Coverly Plus after they complete their first room scan."
            value="Coming soon"
          />
          <AccountRow icon="users" title="Referral status" value="Not active" last />
        </AccountSection>

        <AccountSection title="Settings">
          <AccountRow
            icon="user"
            title="Profile & preferences"
            subtitle="Name, country and future notifications"
            onPress={() => router.push("/profile-settings" as Href)}
          />
          <AccountRow icon="lock" title="Privacy policy" value={privacyUrl ? undefined : "Not configured"} disabled={!privacyUrl} onPress={() => void openLegal(privacyUrl, "privacy policy")} />
          <AccountRow icon="file-text" title="Terms" value={termsUrl ? undefined : "Not configured"} disabled={!termsUrl} onPress={() => void openLegal(termsUrl, "terms")} />
          <AccountRow
            icon="trash-2"
            title="Account deletion"
            subtitle="Secure account deletion is being prepared."
            value="Unavailable"
          />
          <AccountRow icon="log-out" title="Sign out" onPress={confirmSignOut} last />
        </AccountSection>
      </ScrollView>
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

function featureLabel(feature: UsageAllowance["feature"]): string {
  return feature === "ai_scan" ? "AI scans" : "Replacement price searches";
}

function featureDescription(allowance: UsageAllowance, isLimited: boolean): string {
  if (!isLimited) return "Included with your plan · Fair use applies";
  const remaining = allowance.remainingUnits ?? Math.max(0, allowance.limitUnits - allowance.usedUnits - allowance.reservedUnits);
  return `${allowance.usedUnits} / ${allowance.limitUnits} used this month · ${remaining} remaining`;
}

function UsageAllowanceCard({
  allowances,
  isLoading,
  isError,
  isAdmin,
  onUpgrade,
}: {
  allowances: UsageAllowance[];
  isLoading: boolean;
  isError: boolean;
  isAdmin: boolean;
  onUpgrade: () => void;
}) {
  const colors = useColors();
  const aiScans = allowances.find((row) => row.feature === "ai_scan") ?? null;
  const replacementPricing = allowances.find((row) => row.feature === "replacement_pricing") ?? null;
  const resetAt = aiScans?.resetAt ?? replacementPricing?.resetAt ?? null;
  const isLimited = !isAdmin && allowances.some((row) => row.isLimited);
  const hasEmptyAllowance = !isAdmin && allowances.some((row) => usageWarningLevel(row) === "empty");
  const hasLowAllowance = !isAdmin && allowances.some((row) => usageWarningLevel(row) === "low");

  let helper = "Loading your monthly usage…";
  if (isError) helper = "Usage allowance could not be loaded. Your account access is unchanged.";
  else if (!isLoading && allowances.length === 0) helper = "Usage allowance is not available yet.";
  else if (!isLimited || isAdmin) helper = "AI scans and replacement pricing are included with your plan. Fair use applies.";
  else if (hasEmptyAllowance) helper = "One of your Free monthly allowances is used up. Upgrade to keep using premium AI features.";
  else if (hasLowAllowance) helper = "You are getting close to one of your Free monthly limits.";
  else helper = `Free allowances reset on ${formatResetDate(resetAt)}.`;

  return (
    <View style={[styles.usageCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={styles.usageHeader}>
        <View style={[styles.usageIcon, { backgroundColor: colors.accent }]}>
          <Feather name="activity" size={17} color={colors.primary} />
        </View>
        <View style={styles.usageHeaderCopy}>
          <Text style={[styles.usageTitle, { color: colors.foreground }]}>Monthly usage</Text>
          <Text style={[styles.usageHelper, { color: isError ? colors.warning : colors.mutedForeground }]}>{helper}</Text>
        </View>
      </View>

      {isLoading ? (
        <Text style={[styles.usagePlaceholder, { color: colors.mutedForeground }]}>Checking allowances…</Text>
      ) : isError || allowances.length === 0 ? null : (
        <View style={styles.usageRows}>
          {[aiScans, replacementPricing].filter((row): row is UsageAllowance => row !== null).map((row) => {
            const rowIsLimited = !isAdmin && row.isLimited;
            const warning = rowIsLimited ? usageWarningLevel(row) : "none";
            const tone = warning === "empty" ? colors.destructive : warning === "low" ? colors.warning : colors.foreground;
            return (
              <View key={row.feature} style={[styles.usageRow, { borderTopColor: colors.border }]}>
                <View style={styles.usageRowCopy}>
                  <Text style={[styles.usageRowTitle, { color: colors.foreground }]}>{featureLabel(row.feature)}</Text>
                  <Text style={[styles.usageRowSubtitle, { color: tone }]}>{featureDescription(row, rowIsLimited)}</Text>
                </View>
                {rowIsLimited ? (
                  <Text style={[styles.usagePill, { color: tone, backgroundColor: warning === "none" ? colors.secondary : colors.accent }]}>
                    {row.remainingUnits ?? 0} left
                  </Text>
                ) : (
                  <Text style={[styles.usagePill, { color: colors.primary, backgroundColor: colors.accent }]}>Included</Text>
                )}
              </View>
            );
          })}
          {isLimited ? (
            <Text style={[styles.usageReset, { color: colors.mutedForeground }]}>Resets {formatResetDate(resetAt)}</Text>
          ) : null}
        </View>
      )}

      {isLimited && hasEmptyAllowance ? (
        <Text onPress={onUpgrade} style={[styles.usageUpgrade, { color: colors.primary }]}>
          Upgrade Coverly
        </Text>
      ) : null}
    </View>
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
  usageCard: { borderWidth: 1, padding: 16, gap: 13 },
  usageHeader: { flexDirection: "row", gap: 11, alignItems: "flex-start" },
  usageIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  usageHeaderCopy: { flex: 1, gap: 3 },
  usageTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  usageHelper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  usagePlaceholder: { fontSize: 12, fontFamily: "Inter_400Regular" },
  usageRows: { gap: 0 },
  usageRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, flexDirection: "row", gap: 10, alignItems: "center" },
  usageRowCopy: { flex: 1, gap: 3 },
  usageRowTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  usageRowSubtitle: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  usagePill: { overflow: "hidden", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontFamily: "Inter_700Bold" },
  usageReset: { marginTop: 2, fontSize: 11, fontFamily: "Inter_400Regular" },
  usageUpgrade: { alignSelf: "flex-start", fontSize: 12, fontFamily: "Inter_700Bold" },
});
