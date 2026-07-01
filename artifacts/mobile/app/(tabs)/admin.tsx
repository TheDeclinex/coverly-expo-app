import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { adminMetricLabel } from "@/lib/admin-model";
import { loadAdminOverview } from "@/lib/admin-service";
import {
  loadRecentFeedbackReports,
  type FeedbackReportRow,
} from "@/lib/feedback-service";

const openStatuses = new Set(["new", "under_investigation", "bug", "development", "testing", "feature"]);

function environmentLabel(value: string | undefined): string {
  const environment = value?.trim().toLowerCase();
  if (environment === "dev" || environment === "development") return "Development";
  if (environment === "prod" || environment === "production") return "Production";
  if (environment === "local") return "Local";
  if (environment) return value!.trim();
  return __DEV__ ? "Local" : "Production";
}

function supportCountLabel(reports: FeedbackReportRow[] | undefined, isLoading: boolean, isError: boolean): string | undefined {
  if (isLoading) return "Loading";
  if (isError) return "Unavailable";
  const openCount = (reports ?? []).filter((report) => openStatuses.has(report.status ?? "new")).length;
  return openCount > 0 ? String(openCount) : undefined;
}

export default function AdminScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();

  const overviewQuery = useQuery({
    queryKey: ["admin-overview", session?.user.id],
    queryFn: loadAdminOverview,
    enabled: !!session && isAdmin,
    staleTime: 30_000,
    retry: 1,
  });

  const feedbackQuery = useQuery({
    queryKey: ["admin-feedback-reports", session?.user.id],
    queryFn: () => loadRecentFeedbackReports(50),
    enabled: !!session && isAdmin,
    staleTime: 30_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const overview = overviewQuery.data;
  const environment = environmentLabel(process.env.EXPO_PUBLIC_APP_ENV);

  return (
    <>
      <Stack.Screen options={{ title: "Admin" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.notice, { backgroundColor: colors.accent, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Feather name="shield" size={19} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.noticeTitle, { color: colors.foreground }]}>Admin MVP</Text>
            <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
              Secure operator tools backed by admin-only Supabase RPCs.
            </Text>
          </View>
          {overviewQuery.isFetching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>

        <View style={styles.metricGrid}>
          <MetricCard
            label="Total users"
            value={adminMetricLabel(overview?.totalUsers, overviewQuery.isLoading, overviewQuery.isError)}
          />
          <MetricCard
            label="Active testers"
            value={adminMetricLabel(overview?.activeTesters, overviewQuery.isLoading, overviewQuery.isError)}
          />
          <MetricCard
            label="AI scans this month"
            value={adminMetricLabel(overview?.aiScansThisMonth, overviewQuery.isLoading, overviewQuery.isError)}
          />
          <MetricCard
            label="Replacement lookups this month"
            value={adminMetricLabel(overview?.replacementLookupsThisMonth, overviewQuery.isLoading, overviewQuery.isError)}
          />
          <MetricCard
            label="Claim packs generated"
            value={adminMetricLabel(overview?.claimPacksGenerated, overviewQuery.isLoading, overviewQuery.isError)}
          />
          <MetricCard
            label="Recent errors"
            value={adminMetricLabel(overview?.recentErrors, overviewQuery.isLoading, overviewQuery.isError)}
            onPress={() => router.push("/admin-errors" as Href)}
          />
        </View>

        <AccountSection title="Support">
          <AccountRow
            icon="message-square"
            title="Support inbox"
            subtitle="Review feedback, issues, and enhancement requests"
            value={supportCountLabel(feedbackQuery.data, feedbackQuery.isLoading, feedbackQuery.isError)}
            onPress={() => router.push("/admin-support" as Href)}
            last
          />
        </AccountSection>

        <AccountSection title="Users">
          <AccountRow
            icon="search"
            title="User lookup"
            subtitle="Email, user ID, inventory and usage"
            value="Connected"
            onPress={() => router.push("/admin-users" as Href)}
          />
          <AccountRow
            icon="user-check"
            title="Access grants"
            subtitle="Tester and temporary Plus access"
            value="Connected"
            onPress={() => router.push("/admin-access" as Href)}
            last
          />
        </AccountSection>

        <AccountSection title="Billing & entitlements">
          <AccountRow
            icon="credit-card"
            title="Entitlement debug"
            subtitle="Supabase plan fields, overrides, usage and RevenueCat state"
            value="Connected"
            onPress={() => router.push("/admin-entitlements" as Href)}
          />
          <AccountRow icon="shuffle" title="Supabase vs RevenueCat" value="Partial" last />
        </AccountSection>

        <AccountSection title="Claim packs">
          <AccountRow
            icon="package"
            title="Orders & history"
            value="Connected"
            onPress={() => router.push("/admin-claim-packs" as Href)}
          />
          <AccountRow icon="repeat" title="Generation and retries" value="Not available" last />
        </AccountSection>

        <AccountSection title="Operational logs">
          <AccountRow icon="alert-triangle" title="Recent errors" value="Connected" onPress={() => router.push("/admin-errors" as Href)} />
          <AccountRow icon="camera" title="AI scan logs" value="Not available" />
          <AccountRow icon="search" title="Replacement pricing searches" value="Not available" last />
        </AccountSection>

        <AccountSection title="System health">
          <AccountRow icon="server" title="Environment" value={environment} />
          <AccountRow icon="database" title="Supabase session" value={session ? "Connected" : "Unavailable"} />
          <AccountRow icon="activity" title="Edge Functions" value="Not checked" />
          <AccountRow icon="toggle-left" title="Feature flags" value="Not available" last />
        </AccountSection>
      </ScrollView>
    </>
  );
}

function MetricCard({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const colors = useColors();
  const content = (
    <>
      <Text style={[styles.metricValue, { color: value === "Not available" || value === "Unavailable" ? colors.mutedForeground : colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.metric, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.metric,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  notice: { borderWidth: 1, padding: 14, flexDirection: "row", gap: 11, alignItems: "flex-start" },
  noticeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  noticeText: { fontSize: 11, lineHeight: 17, fontFamily: "Inter_400Regular" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { width: "48%", flexGrow: 1, borderWidth: 1, padding: 14, minHeight: 82, justifyContent: "center" },
  metricValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  metricLabel: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 4 },
});
