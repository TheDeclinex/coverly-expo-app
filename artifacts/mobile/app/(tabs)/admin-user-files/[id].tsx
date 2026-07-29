import { useInfiniteQuery } from "@tanstack/react-query";
import { Redirect, Stack, type Href, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { cursorFromPage, mergeAdminPages, type AdminCursor } from "@/lib/admin-list-model";
import {
  adminCurrencyLabel,
  adminDateLabel,
  adminInventoryTotalLabel,
  adminNumberLabel,
  adminStatusLabel,
  adminUserIdDebugSummary,
  normalizeAdminUserIdParam,
} from "@/lib/admin-model";
import { loadAdminUserFilesPage, type AdminUserFile } from "@/lib/admin-service";

export default function AdminUserFilesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const selectedUserId = normalizeAdminUserIdParam(params.id);
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();

  React.useEffect(() => {
    if (!__DEV__) return;
    console.log("[admin] user files route param", { target: adminUserIdDebugSummary(params.id) });
  }, [params.id]);

  const filesQuery = useInfiniteQuery({
    queryKey: ["admin-user-files-page", session?.user.id, selectedUserId],
    queryFn: ({ pageParam }) => loadAdminUserFilesPage(selectedUserId!, pageParam, 20),
    initialPageParam: null as AdminCursor | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? cursorFromPage(lastPage) : null,
    enabled: !!session && isAdmin && !!selectedUserId,
    staleTime: 20_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const files = mergeAdminPages(filesQuery.data?.pages);
  const loadMore = () => {
    if (!filesQuery.hasNextPage || filesQuery.isFetchingNextPage) return;
    void filesQuery.fetchNextPage();
  };

  return (
    <>
      <Stack.Screen options={{ title: "User properties" }} />
      <FlatList
        data={files}
        keyExtractor={(file) => file.id}
        renderItem={({ item }) => <FileCard file={item} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={(
          <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>Read-only property inspection</Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>Admin Phase 1 does not allow editing or deleting user inventory.</Text>
          </View>
        )}
        ListEmptyComponent={(
          !selectedUserId
            ? <StateCard label="No valid user ID was provided." />
            : filesQuery.isLoading
              ? <StateCard label="Loading properties..." loading />
              : filesQuery.isError
                ? <StateCard label="Properties unavailable. Check admin RPC access." onRetry={() => void filesQuery.refetch()} />
                : <StateCard label="No properties found for this user." />
        )}
        ListFooterComponent={filesQuery.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null}
        refreshing={filesQuery.isRefetching && !filesQuery.isFetchingNextPage}
        onRefresh={() => void filesQuery.refetch()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        showsVerticalScrollIndicator={false}
      />
    </>
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
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FileCard({ file }: { file: AdminUserFile }) {
  const colors = useColors();
  return (
    <View style={[styles.fileCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Text style={[styles.fileTitle, { color: colors.foreground }]}>{file.name ?? "Unnamed property"}</Text>
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>
        {adminStatusLabel(file.property_type)} / Updated {adminDateLabel(file.updated_at)}
      </Text>
      <View style={styles.grid}>
        <Metric label="Cover" value={adminCurrencyLabel(file.contents_sum_insured, file.currency_code)} />
        <Metric label="Inventory" value={adminInventoryTotalLabel(file.inventory_value, file.currency_code, file.inventory_totals)} />
        <Metric label="Rooms" value={adminNumberLabel(file.room_count)} />
        <Metric label="Items" value={adminNumberLabel(file.item_count)} />
        <Metric label="Claim packs" value={adminNumberLabel(file.claim_pack_count)} />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={[styles.metric, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, flexGrow: 1 },
  separator: { height: 12 },
  headerCard: { borderWidth: 1, padding: 15, gap: 5, marginBottom: 12 },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
  fileCard: { borderWidth: 1, padding: 15, gap: 10 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  fileTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "48%", flexGrow: 1, padding: 10, gap: 2 },
  metricValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  metricLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  footer: { paddingVertical: 18 },
  retryButton: { minHeight: 34, borderRadius: 8, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  retryText: { fontSize: 12, fontFamily: "Inter_700Bold" },
});
