import { Feather } from "@expo/vector-icons";
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

const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;

export default function AccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const { profile, isAdmin, isLoading, isError } = useAccountProfile();
  const { subscriptionStatus, subscriptionPeriodEnd, purchaseLoading, restorePurchases, gatesEnabled } = useEntitlements();

  const email = profile?.email ?? session?.user.email ?? "Email unavailable";
  const displayName = profile?.fullName ?? null;
  const planLabel = isLoading ? "Loading…" : profile?.plan ?? "Plan unavailable";
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
          <AccountRow icon="credit-card" title="Current plan" value={planLabel} />
          <AccountRow icon="arrow-up-circle" title="Upgrade Coverly" subtitle="View Apple or Google subscription options" onPress={() => router.push("/upgrade" as Href)} />
          <AccountRow icon="settings" title="Subscription status" subtitle={subscriptionPeriodEnd ? `Renews or expires ${new Date(subscriptionPeriodEnd).toLocaleDateString("en-NZ")}` : "Manage subscriptions in your Apple or Google account"} value={subscriptionStatus ?? (profile?.plan === "Free" ? "Free" : "Active")} />
          <AccountRow icon="refresh-cw" title="Restore purchases" value={purchaseLoading ? "Restoring…" : undefined} disabled={purchaseLoading} onPress={() => void restore()} />
          <AccountRow icon="list" title="Plan access" subtitle={profile?.plan === "Free" ? "One property; premium actions show an upgrade prompt" : "AI features included · Fair use applies"} value={gatesEnabled ? "Enforced" : "Test mode"} last />
        </AccountSection>

        <AccountSection title="Claim packs">
          <AccountRow
            icon="package"
            title="Insurance-ready claim packs"
            subtitle="Create PDF exports from your rooms, items, photos and supporting evidence."
            value="Coming soon"
          />
          <AccountRow icon="archive" title="Claim pack history" value="Not available yet" last />
        </AccountSection>

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
});
