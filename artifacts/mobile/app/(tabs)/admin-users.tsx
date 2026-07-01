import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { adminDateLabel, adminStatusLabel, adminTextLabel } from "@/lib/admin-model";
import { searchAdminUsers, type AdminUserSearchResult } from "@/lib/admin-service";

export default function AdminUsersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();
  const [queryText, setQueryText] = React.useState("");
  const [submittedQuery, setSubmittedQuery] = React.useState("");

  const usersQuery = useQuery({
    queryKey: ["admin-users", session?.user.id, submittedQuery],
    queryFn: () => searchAdminUsers(submittedQuery, 25),
    enabled: !!session && isAdmin,
    staleTime: 20_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  return (
    <>
      <Stack.Screen options={{ title: "User lookup" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.searchCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Find a user</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Search by email, user ID, or full name.</Text>
          <View style={[styles.searchRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Feather name="search" size={17} color={colors.mutedForeground} />
            <TextInput
              value={queryText}
              onChangeText={setQueryText}
              onSubmitEditing={() => setSubmittedQuery(queryText.trim())}
              placeholder="Email, user ID, or name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              style={[styles.input, { color: colors.foreground }]}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setSubmittedQuery(queryText.trim())}
              style={[styles.searchButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.searchButtonText, { color: colors.primaryForeground }]}>Search</Text>
            </Pressable>
          </View>
        </View>

        <UserList
          users={usersQuery.data ?? []}
          isLoading={usersQuery.isLoading}
          isError={usersQuery.isError}
          onOpen={(user) => router.push({ pathname: "/(tabs)/admin-user/[id]", params: { id: user.id } } as Href)}
        />
      </ScrollView>
    </>
  );
}

function UserList({
  users,
  isLoading,
  isError,
  onOpen,
}: {
  users: AdminUserSearchResult[];
  isLoading: boolean;
  isError: boolean;
  onOpen: (user: AdminUserSearchResult) => void;
}) {
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>Loading users...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>User lookup unavailable</Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>Check admin RPC access and try again.</Text>
      </View>
    );
  }

  if (users.length === 0) {
    return (
      <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>No users found</Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>Try a different email, name, or user ID.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      {users.map((user, index) => (
        <Pressable
          key={user.id}
          accessibilityRole="button"
          onPress={() => onOpen(user)}
          style={({ pressed }) => [
            styles.userRow,
            index < users.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
            { opacity: pressed ? 0.72 : 1 },
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
          </View>
          <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  searchCard: { borderWidth: 1, padding: 15, gap: 10 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  searchRow: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 9 },
  searchButton: { minHeight: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  searchButtonText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
  listCard: { borderWidth: 1, overflow: "hidden" },
  userRow: { minHeight: 76, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  userCopy: { flex: 1, gap: 3 },
  userTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  userMeta: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
});
