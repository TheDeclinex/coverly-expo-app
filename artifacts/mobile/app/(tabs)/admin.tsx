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
import {
  ADMIN_ANALYTICS_GROUPS,
  ADMIN_ANALYTICS_HEADLINES,
  ADMIN_ANALYTICS_METRICS,
  adminAnalyticsMetricValue,
  adminFunnelPercent,
  type AdminAnalyticsMetricKey,
  type AdminAnalyticsMetricTone,
} from "@/lib/admin-analytics-model";
import { adminMetricLabel } from "@/lib/admin-model";
import { loadAdminOverview, loadAdminUsageAnalytics } from "@/lib/admin-service";

function environmentLabel(value: string | undefined): string {
  const environment = value?.trim().toLowerCase();
  if (environment === "dev" || environment === "development") return "Development";
  if (environment === "prod" || environment === "production") return "Production";
  if (environment === "local") return "Local";
  if (environment) return value!.trim();
  return __DEV__ ? "Local" : "Production";
}

function supportCountLabel(
  overview: ReturnType<typeof adminSupportCounts> | undefined,
  isLoading: boolean,
  isError: boolean,
): string | undefined {
  if (isLoading) return "Loading";
  if (isError) return "Unavailable";
  if (!overview) return undefined;
  return `${overview.newCount} new / ${overview.openCount} open`;
}

function adminSupportCounts(overview: Awaited<ReturnType<typeof loadAdminOverview>> | undefined) {
  if (!overview) return undefined;
  return {
    newCount: overview.supportNew ?? 0,
    openCount: overview.supportOpen ?? 0,
  };
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

  const usageAnalyticsQuery = useQuery({
    queryKey: ["admin-usage-analytics", session?.user.id],
    queryFn: loadAdminUsageAnalytics,
    enabled: !!session && isAdmin,
    staleTime: 60_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const overview = overviewQuery.data;
  const supportCounts = adminSupportCounts(overview);
  const environment = environmentLabel(process.env.EXPO_PUBLIC_APP_ENV);
  const openMetric = (metric: AdminAnalyticsMetricKey) => {
    router.push({ pathname: "/(tabs)/admin-analytics/[metric]", params: { metric } } as Href);
  };

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
          {overviewQuery.isFetching || usageAnalyticsQuery.isFetching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Usage analytics</Text>
          <Text style={[styles.sectionHelper, { color: colors.mutedForeground }]}>Tap a metric to see the contributing accounts. Household content is never included.</Text>
        </View>
        {usageAnalyticsQuery.isError ? (
          <View style={[styles.analyticsState, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.sectionHelper, { color: colors.mutedForeground }]}>Usage reporting is unavailable. The rest of Admin is still available.</Text>
            <Pressable accessibilityRole="button" onPress={() => void usageAnalyticsQuery.refetch()} style={[styles.retryButton, { backgroundColor: colors.primary }]}>
              <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Retry analytics</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.metricGrid}>
            {ADMIN_ANALYTICS_HEADLINES.map((metric) => {
              const definition = ADMIN_ANALYTICS_METRICS[metric];
              const value = usageAnalyticsQuery.data ? adminAnalyticsMetricValue(usageAnalyticsQuery.data, metric) : undefined;
              return (
                <MetricCard
                  key={metric}
                  label={definition.headlineLabel ?? definition.label}
                  value={adminMetricLabel(value, usageAnalyticsQuery.isLoading, false)}
                  tone={definition.tone}
                  onPress={() => openMetric(metric)}
                />
              );
            })}
          </View>
        )}

        {ADMIN_ANALYTICS_GROUPS.map((group) => (
          <AccountSection key={group.key} title={group.label} tone={group.tone}>
            {group.metrics.map((metric, index) => {
              const definition = ADMIN_ANALYTICS_METRICS[metric];
              const rawValue = usageAnalyticsQuery.data ? adminAnalyticsMetricValue(usageAnalyticsQuery.data, metric) : undefined;
              const value = usageAnalyticsQuery.isError
                ? "Unavailable"
                : adminMetricLabel(rawValue, usageAnalyticsQuery.isLoading, false);
              const isActivationPercent = group.key === "activation" && metric !== "registered";
              return (
                <AccountRow
                  key={metric}
                  icon={definition.icon}
                  title={definition.label}
                  subtitle={isActivationPercent && usageAnalyticsQuery.data
                    ? `Approx. ${adminFunnelPercent(rawValue ?? 0, usageAnalyticsQuery.data.funnel.registered)} of registered accounts`
                    : undefined}
                  value={value}
                  tone={definition.tone}
                  accessibilityLabel={`${definition.label}, ${value}`}
                  onPress={() => openMetric(metric)}
                  last={index === group.metrics.length - 1}
                />
              );
            })}
          </AccountSection>
        ))}

        <AccountSection title="Support">
          <AccountRow
            icon="message-square"
            title="Support inbox"
            subtitle="Review feedback, issues, and enhancement requests"
            value={supportCountLabel(supportCounts, overviewQuery.isLoading, overviewQuery.isError)}
            badgeCount={overview?.supportUnread ?? undefined}
            tone="amber"
            onPress={() => router.push("/admin-support" as Href)}
            last
          />
        </AccountSection>

        <AccountSection title="Users">
          <AccountRow
            icon="search"
            title="User lookup"
            subtitle="Email, user ID, inventory and usage"
            value="Available"
            tone="blue"
            onPress={() => router.push("/admin-users" as Href)}
          />
          <AccountRow
            icon="user-check"
            title="Access grants"
            subtitle="Tester and temporary Plus access"
            value="Available"
            tone="blue"
            onPress={() => router.push("/admin-access" as Href)}
            last
          />
        </AccountSection>

        <AccountSection title="Billing & entitlements">
          <AccountRow
            icon="credit-card"
            title="Entitlement debug"
            subtitle="Supabase plan fields, overrides, usage and RevenueCat state"
            value="Available"
            tone="green"
            onPress={() => router.push("/admin-entitlements" as Href)}
          />
          <AccountRow icon="shuffle" title="Supabase vs RevenueCat" value="Partial" tone="green" last />
        </AccountSection>

        <AccountSection title="Claim packs">
          <AccountRow
            icon="package"
            title="Orders & history"
            value="Available"
            tone="lavender"
            onPress={() => router.push("/admin-claim-packs" as Href)}
          />
          <AccountRow icon="repeat" title="Generation and retries" value="Not available" tone="lavender" last />
        </AccountSection>

        <AccountSection title="Operational logs">
          <AccountRow icon="alert-triangle" title="Recent errors" value="Available" tone="lavender" onPress={() => router.push("/admin-errors" as Href)} />
          <AccountRow icon="camera" title="AI scan logs" value="Not available" tone="lavender" />
          <AccountRow icon="search" title="Replacement pricing searches" value="Not available" tone="lavender" last />
        </AccountSection>

        <AccountSection title="System health">
          <AccountRow icon="server" title="Environment" value={environment} tone="greyBlue" />
          <AccountRow icon="database" title="Supabase session" value={session ? "Connected" : "Unavailable"} tone="greyBlue" />
          <AccountRow icon="activity" title="Edge Functions" value="Not checked" tone="greyBlue" />
          <AccountRow icon="toggle-left" title="Feature flags" value="Not available" tone="greyBlue" last />
        </AccountSection>
      </ScrollView>
    </>
  );
}

const metricTones: Record<AdminAnalyticsMetricTone, { surface: string; border: string }> = {
  blue: { surface: "#F8FBFF", border: "#D8E8F8" },
  teal: { surface: "#F6FCFA", border: "#D3ECE6" },
  lavender: { surface: "#FBF9FF", border: "#E4DCF4" },
  amber: { surface: "#FFFCF5", border: "#F4E4BC" },
  green: { surface: "#F8FCF8", border: "#D7EAD9" },
  greyBlue: { surface: "#F8FAFC", border: "#DCE4EC" },
};

function MetricCard({ label, value, tone, onPress }: { label: string; value: string; tone: AdminAnalyticsMetricTone; onPress: () => void }) {
  const colors = useColors();
  const palette = metricTones[tone];
  const content = (
    <>
      <Text style={[styles.metricValue, { color: value === "Not available" || value === "Unavailable" ? colors.mutedForeground : colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.metric,
        { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: colors.radius, opacity: pressed ? 0.72 : 1 },
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
  sectionHeading: { gap: 3, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sectionHelper: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  analyticsState: { borderWidth: 1, padding: 14, gap: 10, alignItems: "flex-start" },
  retryButton: { minHeight: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  retryText: { fontSize: 12, fontFamily: "Inter_700Bold" },
});
