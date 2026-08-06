import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Redirect,
  Stack,
  router,
  type Href,
  useLocalSearchParams,
} from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  ADMIN_ANALYTICS_METRICS,
  adminActivityDateLabel,
  adminAnalyticsMetricFromParam,
  adminAnalyticsPeriodLabel,
  cursorFromAdminAnalyticsPage,
  mergeAdminAnalyticsPages,
  sanitizeAdminFailureCategory,
  type AdminAnalyticsDrilldownAccount,
  type AdminAnalyticsDrilldownCursor,
  type AdminAnalyticsMetricDefinition,
  type AdminAnalyticsMetricTone,
} from "@/lib/admin-analytics-model";
import {
  adminDateLabel,
  adminStatusLabel,
  adminTextLabel,
} from "@/lib/admin-model";
import { loadAdminAnalyticsMetricPage } from "@/lib/admin-service";

const tonePalettes: Record<
  AdminAnalyticsMetricTone,
  { surface: string; iconSurface: string; icon: string }
> = {
  blue: { surface: "#F8FBFF", iconSurface: "#EAF3FF", icon: "#2563A8" },
  teal: { surface: "#F6FCFA", iconSurface: "#E7F7F3", icon: "#0F766E" },
  lavender: { surface: "#FBF9FF", iconSurface: "#F1ECFB", icon: "#6D5A9C" },
  amber: { surface: "#FFFCF5", iconSurface: "#FFF3D8", icon: "#A16207" },
  green: { surface: "#F8FCF8", iconSurface: "#EAF7EC", icon: "#397A4A" },
  greyBlue: { surface: "#F8FAFC", iconSurface: "#EAF0F6", icon: "#52677C" },
};

export default function AdminAnalyticsMetricScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams();
  const metric = adminAnalyticsMetricFromParam(params.metric);
  const definition = metric ? ADMIN_ANALYTICS_METRICS[metric] : null;
  const { session } = useAuth();
  const { isAdmin, isLoading: isProfileLoading } = useAccountProfile();

  const queryKey = [
    "admin-analytics-metric",
    session?.user.id,
    metric,
  ] as const;
  const metricQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      loadAdminAnalyticsMetricPage({
        metric: metric!,
        cursor: pageParam,
        limit: 30,
      }),
    initialPageParam: null as AdminAnalyticsDrilldownCursor | null,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? cursorFromAdminAnalyticsPage(lastPage) : null,
    enabled: !!session && isAdmin && !!metric,
    staleTime: 30_000,
    retry: 1,
  });

  if (isProfileLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const pages = metricQuery.data?.pages;
  const accounts = mergeAdminAnalyticsPages(pages);
  const summary = pages?.[0];
  const periodLabel = metric
    ? adminAnalyticsPeriodLabel(metric, summary?.periodStart)
    : "";
  const loadMore = () => {
    if (!metricQuery.hasNextPage || metricQuery.isFetchingNextPage) return;
    void metricQuery.fetchNextPage();
  };
  const refresh = () =>
    void queryClient.resetQueries({ queryKey, exact: true });

  if (!metric || !definition) {
    return (
      <>
        <Stack.Screen options={{ title: "Analytics metric" }} />
        <View style={styles.invalidWrap}>
          <StateCard
            title="Metric unavailable"
            detail="This analytics metric is not supported."
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: definition.drilldownTitle }} />
      <FlatList
        data={accounts}
        keyExtractor={(account) => account.user_id}
        renderItem={({ item }) => (
          <AnalyticsAccountRow account={item} definition={definition} />
        )}
        ItemSeparatorComponent={ListSeparator}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View
              style={[
                styles.summaryCard,
                {
                  backgroundColor: tonePalettes[definition.tone].surface,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <View
                style={[
                  styles.summaryIcon,
                  {
                    backgroundColor: tonePalettes[definition.tone].iconSurface,
                  },
                ]}
              >
                <Feather
                  name={definition.icon}
                  size={19}
                  color={tonePalettes[definition.tone].icon}
                />
              </View>
              <View style={styles.summaryCopy}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {definition.drilldownTitle}
                </Text>
                <Text
                  style={[styles.period, { color: colors.mutedForeground }]}
                >
                  {periodLabel}
                </Text>
              </View>
              {metricQuery.isFetching && !metricQuery.isFetchingNextPage ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : null}
            </View>
            {summary ? (
              <View style={styles.summaryNumbers}>
                {definition.countMode === "events" ? (
                  <SummaryNumber
                    label={summary.totalEvents === 1 ? "event" : "events"}
                    value={summary.totalEvents}
                  />
                ) : null}
                <SummaryNumber
                  label={summary.totalAccounts === 1 ? "account" : "accounts"}
                  value={summary.totalAccounts}
                />
              </View>
            ) : null}
            <Text style={[styles.privacy, { color: colors.mutedForeground }]}>
              Behavioural metadata only. Household, claim, search, media,
              support, and payment content is excluded.
            </Text>
          </View>
        }
        ListEmptyComponent={
          metricQuery.isLoading ? (
            <StateCard
              title="Loading accounts"
              detail="Calculating this metric…"
              loading
            />
          ) : metricQuery.isError ? (
            <StateCard
              title="Analytics unavailable"
              detail="No sensitive diagnostic details were shown."
              onRetry={() => void metricQuery.refetch()}
            />
          ) : (
            <StateCard
              title="No matching accounts"
              detail={`No accounts matched this metric for ${periodLabel}.`}
            />
          )
        }
        ListFooterComponent={
          metricQuery.isFetchingNextPage ? (
            <ActivityIndicator style={styles.footer} color={colors.primary} />
          ) : null
        }
        refreshing={metricQuery.isRefetching && !metricQuery.isFetchingNextPage}
        onRefresh={refresh}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        showsVerticalScrollIndicator={false}
      />
    </>
  );
}

function ListSeparator() {
  return <View style={styles.separator} />;
}

function SummaryNumber({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.summaryNumber,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Text style={[styles.summaryValue, { color: colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

function AnalyticsAccountRow({
  account,
  definition,
}: {
  account: AdminAnalyticsDrilldownAccount;
  definition: AdminAnalyticsMetricDefinition;
}) {
  const colors = useColors();
  const palette = tonePalettes[definition.tone];
  const safeFailure = sanitizeAdminFailureCategory(account.failure_category);
  const suppressSyntheticEventCount = [
    "registered",
    "new_accounts_30d",
    "active_today",
    "active_7d",
    "active_30d",
    "returned_after_first_day",
  ].includes(definition.key);
  const eventMeta = [
    suppressSyntheticEventCount
      ? null
      : `${account.event_count} ${account.event_count === 1 ? "event" : "events"}`,
    definition.key === "completed_first_scan"
      ? `First successful scan ${adminDateLabel(account.first_event_at)}`
      : `Latest ${adminDateLabel(account.last_event_at)}`,
  ].filter(Boolean);
  const appMeta = [
    account.platform ? adminStatusLabel(account.platform) : null,
    account.app_version ? `v${account.app_version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const planMeta = [
    adminStatusLabel(account.effective_plan),
    account.tester_status ? adminStatusLabel(account.tester_status) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const safeEventMeta = [
    safeFailure,
    account.plan ? adminStatusLabel(account.plan) : null,
    account.product_identifier,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${account.email ?? account.display_name ?? "account"} user detail`}
      onPress={() =>
        router.push({
          pathname: "/(tabs)/admin-user/[id]",
          params: { id: account.user_id },
        } as Href)
      }
      style={({ pressed }) => [
        styles.accountRow,
        {
          backgroundColor: palette.surface,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View
        style={[styles.accountIcon, { backgroundColor: palette.iconSurface }]}
      >
        <Feather name="user" size={17} color={palette.icon} />
      </View>
      <View style={styles.accountCopy}>
        <Text
          style={[styles.accountName, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {adminTextLabel(account.display_name ?? account.email)}
        </Text>
        <Text
          style={[styles.accountEmail, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {adminTextLabel(account.email)}
        </Text>
        <Text style={[styles.accountMeta, { color: colors.mutedForeground }]}>
          {eventMeta.join(" · ")}
        </Text>
        <Text style={[styles.accountMeta, { color: colors.mutedForeground }]}>
          Last active{" "}
          {adminActivityDateLabel(
            account.last_active_at,
            "No recorded activity",
          )}{" "}
          · Created {adminDateLabel(account.created_at)}
        </Text>
        <Text style={[styles.accountMeta, { color: colors.mutedForeground }]}>
          {planMeta}
        </Text>
        {appMeta ? (
          <Text style={[styles.accountMeta, { color: colors.mutedForeground }]}>
            {appMeta}
          </Text>
        ) : null}
        {safeEventMeta ? (
          <Text style={[styles.accountMeta, { color: palette.icon }]}>
            {safeEventMeta}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function StateCard({
  title,
  detail,
  loading = false,
  onRetry,
}: {
  title: string;
  detail: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.stateCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      <Text style={[styles.stateDetail, { color: colors.mutedForeground }]}>
        {detail}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.retryButton, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, flexGrow: 1 },
  headerStack: { gap: 10, marginBottom: 14 },
  summaryCard: {
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryCopy: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  period: { fontSize: 12, fontFamily: "Inter_500Medium" },
  summaryNumbers: { flexDirection: "row", gap: 10 },
  summaryNumber: {
    minWidth: 104,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryValue: { fontSize: 19, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  privacy: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  separator: { height: 10 },
  accountRow: {
    minHeight: 112,
    borderWidth: 1,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  accountIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  accountCopy: { flex: 1, gap: 2 },
  accountName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  accountEmail: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
  accountMeta: {
    fontSize: 10.5,
    lineHeight: 15,
    fontFamily: "Inter_400Regular",
  },
  stateCard: { borderWidth: 1, padding: 16, gap: 7, alignItems: "flex-start" },
  stateTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  stateDetail: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  retryButton: {
    minHeight: 40,
    borderRadius: 9,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  retryText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  footer: { paddingVertical: 18 },
  invalidWrap: { padding: 16 },
});
