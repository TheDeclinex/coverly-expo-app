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
import { adminActivityDateLabel, adminTimelineEventView } from "@/lib/admin-analytics-model";
import {
  adminDateLabel,
  adminNumberLabel,
  adminStatusLabel,
  adminTextLabel,
  adminUserIdDebugSummary,
  normalizeAdminUserIdParam,
} from "@/lib/admin-model";
import {
  loadAdminUserActivity,
  loadAdminUserDetail,
  loadAdminUserPropertyPreview,
  loadAdminUserRecentActivity,
  type AdminUserFile,
} from "@/lib/admin-service";

export default function AdminUserDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const selectedUserId = normalizeAdminUserIdParam(params.id);
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();

  React.useEffect(() => {
    if (!__DEV__) return;
    console.log("[admin] detail route param", { target: adminUserIdDebugSummary(params.id) });
  }, [params.id]);

  const detailQuery = useQuery({
    queryKey: ["admin-user-detail", session?.user.id, selectedUserId],
    queryFn: () => loadAdminUserDetail(selectedUserId!),
    enabled: !!session && isAdmin && !!selectedUserId,
    staleTime: 20_000,
    retry: 1,
  });

  const filesQuery = useQuery({
    queryKey: ["admin-user-files", session?.user.id, selectedUserId],
    queryFn: () => loadAdminUserPropertyPreview(selectedUserId!),
    enabled: !!session && isAdmin && !!selectedUserId && !!detailQuery.data?.profile,
    staleTime: 20_000,
    retry: 1,
  });

  const activityQuery = useQuery({
    queryKey: ["admin-user-activity", session?.user.id, selectedUserId],
    queryFn: () => loadAdminUserActivity(selectedUserId!),
    enabled: !!session && isAdmin && !!selectedUserId,
    staleTime: 20_000,
    retry: 1,
  });

  const recentActivityQuery = useQuery({
    queryKey: ["admin-user-recent-activity", session?.user.id, selectedUserId],
    queryFn: () => loadAdminUserRecentActivity(selectedUserId!),
    enabled: !!session && isAdmin && !!selectedUserId,
    staleTime: 20_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const detail = detailQuery.data;
  const profile = detail?.profile;
  const recentActivityCount = activityQuery.data
    ? activityQuery.data.appOpens30d
      + activityQuery.data.successfulScans30d
      + activityQuery.data.failedScans30d
      + activityQuery.data.replacementSearches30d
      + activityQuery.data.failedReplacementSearches30d
      + activityQuery.data.claimPacksCompleted30d
      + activityQuery.data.claimPacksFailed30d
      + activityQuery.data.paywallViews30d
      + activityQuery.data.purchaseStarts30d
    : null;

  return (
    <>
      <Stack.Screen options={{ title: "User detail" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        {!selectedUserId ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>User unavailable</Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>No valid user ID was provided.</Text>
          </View>
        ) : detailQuery.isLoading ? (
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

            <AccountSection title="Properties setup">
              {filesQuery.isLoading ? (
                <AccountRow icon="loader" title="Loading properties" value="Loading" last />
              ) : filesQuery.isError ? (
                <AccountRow icon="alert-triangle" title="Properties unavailable" subtitle="User profile loaded, but property inspection failed." value="Check RPC" last />
              ) : (filesQuery.data ?? []).length === 0 ? (
                <AccountRow icon="home" title="No properties found" value="Empty" last />
              ) : (
                <>
                  {(filesQuery.data ?? []).map((file, index, files) => (
                    <PropertySetupRow key={file.id} file={file} last={index === files.length - 1 && (detail.counts.propertyCount ?? 0) <= 3} />
                  ))}
                  {(detail.counts.propertyCount ?? 0) > 3 ? (
                    <AccountRow
                      icon="list"
                      title="Open all properties"
                      value={adminNumberLabel(detail.counts.propertyCount)}
                      onPress={() => router.push({ pathname: "/(tabs)/admin-user-files/[id]", params: { id: profile.id } } as Href)}
                      last
                    />
                  ) : null}
                </>
              )}
            </AccountSection>

            <AccountSection title={`Usage ${detail.usage.monthKey ?? ""}`.trim()}>
              <AccountRow icon="camera" title="AI scans" value={adminNumberLabel(detail.usage.aiScans)} />
              <AccountRow icon="search" title="Replacement lookups" value={adminNumberLabel(detail.usage.replacementLookups)} last />
            </AccountSection>

            <AccountSection title="Activity">
              {activityQuery.isLoading ? (
                <AccountRow icon="loader" title="Loading activity" value="Loading" last />
              ) : activityQuery.isError || !activityQuery.data ? (
                <AccountRow
                  icon="alert-triangle"
                  title="Activity unavailable"
                  subtitle="The user profile remains available. Tap to retry reporting."
                  value="Retry"
                  onPress={() => void activityQuery.refetch()}
                  last
                />
              ) : (
                <>
                  <AccountRow icon="calendar" title="Account created" value={adminDateLabel(activityQuery.data.accountCreatedAt)} />
                  <AccountRow icon="log-in" title="Last sign-in" value={adminActivityDateLabel(activityQuery.data.lastSignInAt, "Never signed in")} />
                  <AccountRow icon="activity" title="Last active" value={adminActivityDateLabel(activityQuery.data.lastActiveAt, "No recorded activity")} />
                  <AccountRow
                    icon="play-circle"
                    title="First recorded event"
                    subtitle={activityQuery.data.firstEventName ? adminTimelineEventView({ id: "first", eventName: activityQuery.data.firstEventName, createdAt: activityQuery.data.firstEventAt ?? "", summary: null }).label : undefined}
                    value={adminActivityDateLabel(activityQuery.data.firstEventAt, "No recorded activity")}
                  />
                  <AccountRow
                    icon="clock"
                    title="Latest recorded event"
                    subtitle={activityQuery.data.latestEventName ? adminTimelineEventView({ id: "latest", eventName: activityQuery.data.latestEventName, createdAt: activityQuery.data.latestEventAt ?? "", summary: null }).label : undefined}
                    value={adminActivityDateLabel(activityQuery.data.latestEventAt, "No recorded activity")}
                  />
                  <AccountRow icon="log-in" title="App opens (7d / 30d)" value={`${activityQuery.data.appOpens7d} / ${activityQuery.data.appOpens30d}`} />
                  <AccountRow icon="camera" title="Successful / failed scans (30d)" value={`${activityQuery.data.successfulScans30d} / ${activityQuery.data.failedScans30d}`} />
                  <AccountRow icon="search" title="Successful / failed searches (30d)" value={`${activityQuery.data.replacementSearches30d} / ${activityQuery.data.failedReplacementSearches30d}`} />
                  <AccountRow icon="archive" title="Completed / failed claim packs (30d)" value={`${activityQuery.data.claimPacksCompleted30d} / ${activityQuery.data.claimPacksFailed30d}`} />
                  <AccountRow icon="credit-card" title="Paywall views (30d)" value={adminNumberLabel(activityQuery.data.paywallViews30d)} />
                  <AccountRow icon="shopping-cart" title="Purchase starts (30d)" value={adminNumberLabel(activityQuery.data.purchaseStarts30d)} />
                  <AccountRow
                    icon="info"
                    title="Last 30 days"
                    value={recentActivityCount === 0 ? "No activity in the last 30 days" : `${recentActivityCount} recorded events`}
                    last
                  />
                </>
              )}
            </AccountSection>

            <AccountSection title="Recent activity">
              {recentActivityQuery.isLoading ? (
                <AccountRow icon="loader" title="Loading recent activity" value="Loading" last />
              ) : recentActivityQuery.isError ? (
                <AccountRow
                  icon="alert-triangle"
                  title="Recent activity unavailable"
                  subtitle="Tap to retry. Raw event properties are never shown."
                  value="Retry"
                  onPress={() => void recentActivityQuery.refetch()}
                  last
                />
              ) : (recentActivityQuery.data ?? []).length === 0 ? (
                <AccountRow icon="activity" title="No recorded activity" value="Empty" last />
              ) : (
                (recentActivityQuery.data ?? []).map((event, index, events) => {
                  const view = adminTimelineEventView(event);
                  return (
                    <AccountRow
                      key={event.id}
                      icon="activity"
                      title={view.label}
                      subtitle={[adminDateLabel(event.createdAt), view.summary].filter(Boolean).join(" · ")}
                      last={index === events.length - 1}
                    />
                  );
                })
              )}
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

function PropertySetupRow({ file, last }: { file: AdminUserFile; last: boolean }) {
  return (
    <AccountRow
      icon="home"
      title={adminTextLabel(file.name)}
      subtitle={`${adminStatusLabel(file.property_type)} / Updated ${adminDateLabel(file.updated_at)}`}
      value={`${adminNumberLabel(file.room_count)} rooms / ${adminNumberLabel(file.item_count)} items`}
      last={last}
    />
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
