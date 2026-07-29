import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Redirect, Stack, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  cursorFromPage,
  mergeAdminPages,
  type AdminCursor,
  type AdminEventSeverityFilter,
  type AdminTimeframe,
} from "@/lib/admin-list-model";
import { adminDateLabel, adminStatusLabel, adminTextLabel } from "@/lib/admin-model";
import { loadAdminEvents, type AdminEvent } from "@/lib/admin-service";

export default function AdminErrorsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();
  const [timeframe, setTimeframe] = React.useState<AdminTimeframe>("7d");
  const [severity, setSeverity] = React.useState<AdminEventSeverityFilter>("all");
  const [source, setSource] = React.useState("");

  const eventsQuery = useInfiniteQuery({
    queryKey: ["admin-events-page", session?.user.id, timeframe, severity, source],
    queryFn: ({ pageParam }) => loadAdminEvents({ timeframe, severity, source, cursor: pageParam, limit: 20 }),
    initialPageParam: null as AdminCursor | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? cursorFromPage(lastPage) : null,
    enabled: !!session && isAdmin,
    staleTime: 15_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const events = mergeAdminPages(eventsQuery.data?.pages);
  const loadMore = () => {
    if (!eventsQuery.hasNextPage || eventsQuery.isFetchingNextPage) return;
    void eventsQuery.fetchNextPage();
  };

  return (
    <>
      <Stack.Screen options={{ title: "Operational events" }} />
      <FlatList
        data={events}
        keyExtractor={(event) => event.id}
        renderItem={({ item }) => <EventCard event={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        ListHeaderComponent={(
          <>
            <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>Admin events</Text>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                This list only reflects producers that write to admin_events. It is not a complete app health check.
              </Text>
            </View>
            <FilterChips
              values={["7d", "30d", "90d", "all"]}
              selected={timeframe}
              onSelect={setTimeframe}
              label={timeframeLabel}
            />
            <FilterChips
              values={["all", "warning", "error", "critical"]}
              selected={severity}
              onSelect={setSeverity}
              label={(value) => adminStatusLabel(value)}
            />
            <FilterChips
              values={["", "revenuecat-webhook"]}
              selected={source}
              onSelect={setSource}
              label={(value) => value ? "RevenueCat" : "All sources"}
            />
          </>
        )}
        ListEmptyComponent={(
          eventsQuery.isLoading
            ? <StateCard label="Loading events..." loading />
            : eventsQuery.isError
              ? <StateCard label="Operational events unavailable. Check admin RPC access." onRetry={() => void eventsQuery.refetch()} />
              : <StateCard label="No matching records. A zero count may also mean no configured producer wrote events in this window." />
        )}
        ListFooterComponent={eventsQuery.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null}
        refreshing={eventsQuery.isRefetching && !eventsQuery.isFetchingNextPage}
        onRefresh={() => void eventsQuery.refetch()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        showsVerticalScrollIndicator={false}
      />
    </>
  );
}

function FilterChips<T extends string>({
  values,
  selected,
  onSelect,
  label,
}: {
  values: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  label: (value: T) => string;
}) {
  const colors = useColors();
  return (
    <View style={styles.filterRow}>
      {values.map((value) => {
        const active = value === selected;
        return (
          <Pressable
            key={value || "all"}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(value)}
            style={({ pressed }) => [
              styles.filterChip,
              {
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.accent : colors.card,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Text style={[styles.filterText, { color: active ? colors.primary : colors.foreground }]}>{label(value)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function timeframeLabel(value: AdminTimeframe): string {
  if (value === "7d") return "7 days";
  if (value === "30d") return "30 days";
  if (value === "90d") return "90 days";
  return "All time";
}

function EventCard({ event }: { event: AdminEvent }) {
  const colors = useColors();
  const isSerious = event.severity === "critical" || event.severity === "error";
  return (
    <View style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={styles.eventHeader}>
        <View style={[styles.eventIcon, { backgroundColor: isSerious ? "#FEF2F2" : colors.secondary }]}>
          <Feather name={isSerious ? "alert-triangle" : "activity"} size={16} color={isSerious ? "#B42318" : colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eventTitle, { color: colors.foreground }]}>{adminStatusLabel(event.severity)}</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>{adminDateLabel(event.created_at)}</Text>
        </View>
      </View>
      <Text style={[styles.message, { color: colors.foreground }]}>{adminTextLabel(event.message)}</Text>
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>
        {adminTextLabel(event.source)} / {adminTextLabel(event.screen)} / user {adminTextLabel(event.user_id)}
      </Text>
    </View>
  );
}

function StateCard({ label, loading = false, onRetry }: { label: string; loading?: boolean; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>{label}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.retryButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.filterText, { color: colors.primaryForeground }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, flexGrow: 1 },
  separator: { height: 12 },
  headerCard: { borderWidth: 1, padding: 15, gap: 5, marginBottom: 12 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  filterChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
  eventCard: { borderWidth: 1, padding: 15, gap: 8 },
  eventHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  eventIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  eventTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  message: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  footer: { paddingVertical: 18 },
  retryButton: { minHeight: 34, borderRadius: 8, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
});
