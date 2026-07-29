import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Redirect, Stack, router, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  cursorFromPage,
  mergeAdminPages,
  normalizeAdminSearchQuery,
  type AdminClaimPackStatusFilter,
  type AdminCursor,
  type AdminTimeframe,
} from "@/lib/admin-list-model";
import { adminDateLabel, adminStatusLabel, adminTextLabel } from "@/lib/admin-model";
import { loadAdminClaimPacks, type AdminClaimPackSummary } from "@/lib/admin-service";

export default function AdminClaimPacksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();
  const [status, setStatus] = React.useState<AdminClaimPackStatusFilter>("all");
  const [timeframe, setTimeframe] = React.useState<AdminTimeframe>("30d");
  const [queryText, setQueryText] = React.useState("");
  const [query, setQuery] = React.useState("");

  const claimPacksQuery = useInfiniteQuery({
    queryKey: ["admin-claim-packs-page", session?.user.id, status, timeframe, query],
    queryFn: ({ pageParam }) => loadAdminClaimPacks({ status, timeframe, query, cursor: pageParam, limit: 20 }),
    initialPageParam: null as AdminCursor | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? cursorFromPage(lastPage) : null,
    enabled: !!session && isAdmin,
    staleTime: 20_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const claimPacks = mergeAdminPages(claimPacksQuery.data?.pages);
  const loadMore = () => {
    if (!claimPacksQuery.hasNextPage || claimPacksQuery.isFetchingNextPage) return;
    void claimPacksQuery.fetchNextPage();
  };
  const submitSearch = () => setQuery(normalizeAdminSearchQuery(queryText));

  return (
    <>
      <Stack.Screen options={{ title: "Claim packs" }} />
      <FlatList
        data={claimPacks}
        keyExtractor={(claimPack) => claimPack.id}
        renderItem={({ item }) => (
          <ClaimPackRow
            claimPack={item}
            onPress={() => router.push({ pathname: "/(tabs)/admin-claim-pack/[id]", params: { id: item.id } } as Href)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        ListHeaderComponent={(
          <>
            <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>Orders and history</Text>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>Read-only, paginated claim-pack records. Generation retry is not included in this phase.</Text>
            </View>
            <View style={[styles.searchRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Feather name="search" size={17} color={colors.mutedForeground} />
              <TextInput
                value={queryText}
                onChangeText={setQueryText}
                onSubmitEditing={submitSearch}
                placeholder="Email, property, or pack reference"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                style={[styles.input, { color: colors.foreground }]}
              />
              <Pressable accessibilityRole="button" onPress={submitSearch} style={[styles.searchButton, { backgroundColor: colors.primary }]}>
                <Text style={[styles.filterText, { color: colors.primaryForeground }]}>Search</Text>
              </Pressable>
            </View>
            <FilterChips
              values={["all", "processing", "generated", "failed"]}
              selected={status}
              onSelect={setStatus}
              label={(value) => adminStatusLabel(value)}
            />
            <FilterChips
              values={["7d", "30d", "90d", "all"]}
              selected={timeframe}
              onSelect={setTimeframe}
              label={timeframeLabel}
            />
          </>
        )}
        ListEmptyComponent={(
          claimPacksQuery.isLoading
            ? <StateCard label="Loading claim packs..." loading />
            : claimPacksQuery.isError
              ? <StateCard label="Claim pack history unavailable. Check admin RPC access." onRetry={() => void claimPacksQuery.refetch()} />
              : <StateCard label="No claim pack records match these filters." />
        )}
        ListFooterComponent={claimPacksQuery.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null}
        refreshing={claimPacksQuery.isRefetching && !claimPacksQuery.isFetchingNextPage}
        onRefresh={() => void claimPacksQuery.refetch()}
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
        const active = selected === value;
        return (
          <Pressable
            key={value}
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

function ClaimPackRow({ claimPack, onPress }: { claimPack: AdminClaimPackSummary; onPress: () => void }) {
  const colors = useColors();
  const emailStatus = claimPack.email_sent === null ? "Email not available" : claimPack.email_sent ? "Email sent" : "Email not sent";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
          {adminTextLabel(claimPack.property_name)}
        </Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]} numberOfLines={1}>
          {adminTextLabel(claimPack.user_email)} / {adminTextLabel(claimPack.pack_ref)}
        </Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]} numberOfLines={1}>
          {adminStatusLabel(claimPack.status)} / {adminDateLabel(claimPack.created_at)} / {emailStatus}
        </Text>
        {claimPack.has_generation_error ? (
          <Text style={[styles.errorText, { color: "#B42318" }]}>Generation failed; open the detail for the stored error.</Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </Pressable>
  );
}

function StateCard({ label, loading = false, onRetry }: { label: string; loading?: boolean; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>{label}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.searchButton, { backgroundColor: colors.primary }]}>
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
  searchRow: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 9 },
  searchButton: { minHeight: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  filterChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
  row: { minHeight: 86, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  rowCopy: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  rowTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
  footer: { paddingVertical: 18 },
});
