import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router, type Href, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { adminDateLabel, adminNumberLabel, adminStatusLabel, adminTextLabel } from "@/lib/admin-model";
import { loadAdminUserDetail } from "@/lib/admin-service";

export default function AdminUserDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();

  const detailQuery = useQuery({
    queryKey: ["admin-user-detail", session?.user.id, id],
    queryFn: () => loadAdminUserDetail(id),
    enabled: !!session && isAdmin && !!id,
    staleTime: 20_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const detail = detailQuery.data;
  const profile = detail?.profile;

  return (
    <>
      <Stack.Screen options={{ title: "User detail" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        {detailQuery.isLoading ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>Loading user...</Text>
          </View>
        ) : detailQuery.isError || !detail || !profile ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>User unavailable</Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>Check admin access and try again.</Text>
          </View>
        ) : (
          <>
            <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>{adminTextLabel(profile.email)}</Text>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>{adminTextLabel(profile.fullName)}</Text>
              <Text style={[styles.mono, { color: colors.mutedForeground }]}>{profile.id}</Text>
            </View>

            <AccountSection title="Profile">
              <AccountRow icon="shield" title="App role" value={adminStatusLabel(profile.appRole)} />
              <AccountRow icon="credit-card" title="Effective plan" value={adminStatusLabel(profile.effectivePlan)} />
              <AccountRow icon="user-check" title="Tester status" value={adminStatusLabel(profile.testerStatus)} />
              <AccountRow icon="calendar" title="Created" value={adminDateLabel(profile.createdAt)} last />
            </AccountSection>

            <AccountSection title="Inventory">
              <AccountRow icon="home" title="Properties/files" value={adminNumberLabel(detail.counts.propertyCount)} onPress={() => router.push({ pathname: "/(tabs)/admin-user-files/[id]", params: { id: profile.id } } as Href)} />
              <AccountRow icon="grid" title="Rooms" value={adminNumberLabel(detail.counts.roomCount)} />
              <AccountRow icon="package" title="Items" value={adminNumberLabel(detail.counts.itemCount)} />
              <AccountRow icon="archive" title="Claim packs" value={adminNumberLabel(detail.counts.claimPackCount)} last />
            </AccountSection>

            <AccountSection title={`Usage ${detail.usage.monthKey ?? ""}`.trim()}>
              <AccountRow icon="camera" title="AI scans" value={adminNumberLabel(detail.usage.aiScans)} />
              <AccountRow icon="search" title="Replacement lookups" value={adminNumberLabel(detail.usage.replacementLookups)} last />
            </AccountSection>

            <AccountSection title="Access">
              <AccountRow icon="settings" title="Manage access grants" subtitle="Tester and temporary Plus access" onPress={() => router.push({ pathname: "/(tabs)/admin-access", params: { userId: profile.id } } as Href)} />
              <AccountRow icon="activity" title="Entitlement debug" subtitle="Supabase, usage and RevenueCat state" onPress={() => router.push({ pathname: "/(tabs)/admin-entitlements", params: { userId: profile.id } } as Href)} last />
            </AccountSection>

            <AccountSection title="Entitlement fields">
              <AccountRow icon="toggle-left" title="Override status" value={adminStatusLabel(profile.overrideStatus)} />
              <AccountRow icon="tag" title="Override plan" value={adminStatusLabel(profile.overridePlan)} />
              <AccountRow icon="clock" title="Override expiry" value={adminDateLabel(profile.overrideExpiresAt)} />
              <AccountRow icon="smartphone" title="RevenueCat status" value={adminStatusLabel(profile.revenueCatStatus)} last />
            </AccountSection>

            <AccountSection title="Recent support">
              {detail.recentSupport.length === 0 ? (
                <AccountRow icon="message-square" title="No recent support submissions" value="Empty" last />
              ) : (
                detail.recentSupport.map((ticket, index) => (
                  <AccountRow
                    key={ticket.id}
                    icon="message-square"
                    title={adminTextLabel(ticket.title)}
                    subtitle={adminDateLabel(ticket.createdAt)}
                    value={adminStatusLabel(ticket.status)}
                    last={index === detail.recentSupport.length - 1}
                  />
                ))
              )}
            </AccountSection>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  headerCard: { borderWidth: 1, padding: 15, gap: 5 },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  mono: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
});
