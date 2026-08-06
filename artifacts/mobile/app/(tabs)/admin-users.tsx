import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, router, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  adminUserDirectoryEffectiveQuery,
  cursorFromAdminUserPage,
  mergeAdminPages,
  type AdminUserAnalyticsCursor,
} from "@/lib/admin-list-model";
import {
  ADMIN_USER_FILTER_OPTIONS,
  ADMIN_USER_SORT_OPTIONS,
  adminActivityDateLabel,
  type AdminUserAnalyticsFilter,
  type AdminUserAnalyticsSort,
} from "@/lib/admin-analytics-model";
import { adminDateLabel, adminStatusLabel, adminTextLabel, adminUserIdDebugSummary } from "@/lib/admin-model";
import { loadAdminUsersPage, type AdminUserSearchResult } from "@/lib/admin-service";

export default function AdminUsersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { isAdmin, isLoading: isProfileLoading } = useAccountProfile();
  const [queryText, setQueryText] = React.useState("");
  const [effectiveQuery, setEffectiveQuery] = React.useState<string | null>(null);
  const [queryRevision, setQueryRevision] = React.useState(0);
  const [filter, setFilter] = React.useState<AdminUserAnalyticsFilter>("all");
  const [sort, setSort] = React.useState<AdminUserAnalyticsSort>("last_active");

  const usersQueryKey = ["admin-users-page", session?.user.id, effectiveQuery, filter, sort, queryRevision] as const;
  const usersQuery = useInfiniteQuery({
    queryKey: usersQueryKey,
    queryFn: ({ pageParam }) => loadAdminUsersPage({
      query: effectiveQuery,
      filter,
      sort,
      cursor: pageParam,
      limit: 50,
    }),
    initialPageParam: null as AdminUserAnalyticsCursor | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? cursorFromAdminUserPage(lastPage) : null,
    enabled: !!session && isAdmin,
    staleTime: 20_000,
    retry: 1,
  });

  if (isProfileLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const users = mergeAdminPages(usersQuery.data?.pages);
  const handleQueryTextChange = (value: string) => {
    const nextEffectiveQuery = adminUserDirectoryEffectiveQuery(value);
    setQueryText(value);
    if (nextEffectiveQuery === effectiveQuery) return;
    setEffectiveQuery(nextEffectiveQuery);
    setQueryRevision((current) => current + 1);
  };
  const loadMore = () => {
    if (!usersQuery.hasNextPage || usersQuery.isFetchingNextPage) return;
    void usersQuery.fetchNextPage();
  };
  const refreshFromFirstPage = () => {
    void queryClient.resetQueries({ queryKey: usersQueryKey, exact: true });
  };
  const openUser = (user: AdminUserSearchResult) => {
    if (__DEV__) {
      console.log("[admin] selected user row", {
        target: adminUserIdDebugSummary(user.id),
        emailPresent: !!user.email,
      });
    }
    router.push({ pathname: "/(tabs)/admin-user/[id]", params: { id: user.id } } as Href);
  };

  return (
    <>
      <Stack.Screen options={{ title: "User lookup" }} />
      <FlatList
        data={users}
        keyExtractor={(user) => user.id}
        renderItem={({ item }) => <UserRow user={item} onOpen={openUser} />}
        ItemSeparatorComponent={ListSeparator}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        ListHeaderComponent={(
          <>
            <View style={[styles.searchCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>Find a user</Text>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                Browse newest users or search by email, full name, or complete user UUID.
              </Text>
              <View style={[styles.searchRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Feather name="search" size={17} color={colors.mutedForeground} />
                <TextInput
                  value={queryText}
                  onChangeText={handleQueryTextChange}
                  placeholder="Email, user ID, or name"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  style={[styles.input, { color: colors.foreground }]}
                />
              </View>
              {queryText.trim().length === 1 ? (
                <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                  Enter one more character to search. The full directory remains visible.
                </Text>
              ) : null}
              <Text style={[styles.controlLabel, { color: colors.foreground }]}>Filter</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {ADMIN_USER_FILTER_OPTIONS.map((option) => (
                  <FilterChip
                    key={option.value}
                    label={option.label}
                    selected={filter === option.value}
                    onPress={() => setFilter(option.value)}
                  />
                ))}
              </ScrollView>
              <Text style={[styles.controlLabel, { color: colors.foreground }]}>Sort</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {ADMIN_USER_SORT_OPTIONS.map((option) => (
                  <FilterChip
                    key={option.value}
                    label={option.label}
                    selected={sort === option.value}
                    onPress={() => setSort(option.value)}
                  />
                ))}
              </ScrollView>
            </View>
            <Text style={[styles.resultHeader, { color: colors.foreground }]}>Users</Text>
          </>
        )}
        ListEmptyComponent={(
          usersQuery.isLoading
            ? <StateCard label="Loading users..." loading />
            : usersQuery.isError
              ? <StateCard label="User directory unavailable. Check admin RPC access and try again." onRetry={() => void usersQuery.refetch()} />
              : <StateCard label={effectiveQuery ? "No users match this search." : "No users are available."} />
        )}
        ListFooterComponent={usersQuery.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null}
        refreshing={usersQuery.isRefetching && !usersQuery.isFetchingNextPage}
        onRefresh={refreshFromFirstPage}
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

function UserRow({ user, onOpen }: { user: AdminUserSearchResult; onOpen: (user: AdminUserSearchResult) => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpen(user)}
      style={({ pressed }) => [
        styles.userRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View style={styles.userCopy}>
        <Text style={[styles.userTitle, { color: colors.foreground }]} numberOfLines={1}>
          {adminTextLabel(user.email)}
        </Text>
        <Text style={[styles.userMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {adminTextLabel(user.full_name)} / {adminStatusLabel(user.effective_plan)} / {adminStatusLabel(user.tester_status)}
        </Text>
        <Text style={[styles.userMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          Created {adminDateLabel(user.created_at)}
        </Text>
        <Text style={[styles.userMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          Last sign-in {adminActivityDateLabel(user.last_sign_in_at, "Never signed in")} / Last active {adminActivityDateLabel(user.last_active_at, "No recorded activity")}
        </Text>
        <Text style={[styles.userMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {user.property_count} properties / {user.room_count} rooms / {user.item_count} items
        </Text>
        <Text style={[styles.userMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          Last 30d: {user.successful_scans_30d} scans / {user.replacement_searches_30d} searches / {user.claim_packs_30d} claim packs
        </Text>
        <Text style={[styles.userId, { color: colors.mutedForeground }]} numberOfLines={1}>{user.id}</Text>
      </View>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </Pressable>
  );
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.background,
          borderColor: selected ? colors.primary : colors.border,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
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
        <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.retryButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, flexGrow: 1 },
  searchCard: { borderWidth: 1, padding: 15, gap: 10, marginBottom: 14 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  searchRow: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 9 },
  controlLabel: { fontSize: 12, fontFamily: "Inter_700Bold", marginTop: 2 },
  chipRow: { gap: 7, paddingRight: 8 },
  chip: { minHeight: 34, borderWidth: 1, borderRadius: 17, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  resultHeader: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 10 },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
  retryButton: { minHeight: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  retryText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  separator: { height: 10 },
  userRow: { minHeight: 76, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  userCopy: { flex: 1, gap: 3 },
  userTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  userMeta: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  userId: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_400Regular" },
  footer: { paddingVertical: 18 },
});
