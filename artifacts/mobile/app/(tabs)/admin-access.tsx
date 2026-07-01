import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, type Href, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  adminDateLabel,
  adminStatusLabel,
  adminTextLabel,
  adminUserIdDebugSummary,
  normalizeAdminUserIdParam,
} from "@/lib/admin-model";
import {
  loadAdminUserDetail,
  searchAdminUsers,
  updateAdminUserAccess,
  type AdminAccessAction,
  type AdminUserSearchResult,
} from "@/lib/admin-service";

export default function AdminAccessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams();
  const routeUserId = normalizeAdminUserIdParam(params.userId);
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();
  const [queryText, setQueryText] = React.useState("");
  const [submittedQuery, setSubmittedQuery] = React.useState("");
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(routeUserId);
  const [expiryDate, setExpiryDate] = React.useState("");
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (!__DEV__) return;
    console.log("[admin] access route param", { target: adminUserIdDebugSummary(params.userId) });
  }, [params.userId]);

  React.useEffect(() => {
    if (routeUserId) setSelectedUserId(routeUserId);
  }, [routeUserId]);

  const usersQuery = useQuery({
    queryKey: ["admin-access-users", session?.user.id, submittedQuery],
    queryFn: () => searchAdminUsers(submittedQuery, 10),
    enabled: !!session && isAdmin && submittedQuery.length > 0,
    staleTime: 20_000,
    retry: 1,
  });

  const detailQuery = useQuery({
    queryKey: ["admin-user-detail", session?.user.id, selectedUserId],
    queryFn: () => loadAdminUserDetail(selectedUserId!),
    enabled: !!session && isAdmin && !!selectedUserId,
    staleTime: 10_000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: (action: AdminAccessAction) =>
      updateAdminUserAccess({
        userId: selectedUserId!,
        action,
        expiresAt: expiryDate.trim() || null,
        reason: reason.trim() || null,
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(["admin-user-detail", session?.user.id, selectedUserId], detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-user-detail", session?.user.id, selectedUserId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-entitlement-debug", session?.user.id, selectedUserId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users", session?.user.id] }),
        queryClient.invalidateQueries({ queryKey: ["admin-access-users", session?.user.id] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview", session?.user.id] }),
      ]);
      Alert.alert("Access updated", "The user's access state was updated.");
    },
    onError: (error) => {
      Alert.alert("Could not update access", error instanceof Error ? error.message : "Please try again.");
    },
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const detail = detailQuery.data;
  const profile = detail?.profile;

  const runAction = (action: AdminAccessAction, title: string) => {
    if (!selectedUserId || mutation.isPending) return;
    Alert.alert(title, "Apply this access change?", [
      { text: "Cancel", style: "cancel" },
      { text: "Apply", onPress: () => mutation.mutate(action) },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: "Access grants" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Select user</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Search by email, user ID, or full name.</Text>
          <View style={[styles.searchRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Feather name="search" size={17} color={colors.mutedForeground} />
            <TextInput
              value={queryText}
              onChangeText={setQueryText}
              onSubmitEditing={() => setSubmittedQuery(queryText.trim())}
              placeholder="Find user"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              style={[styles.input, { color: colors.foreground }]}
            />
            <Pressable onPress={() => setSubmittedQuery(queryText.trim())} style={[styles.smallButton, { backgroundColor: colors.primary }]}>
              <Text style={[styles.smallButtonText, { color: colors.primaryForeground }]}>Search</Text>
            </Pressable>
          </View>
        </View>

        {usersQuery.isLoading ? <StateCard label="Searching users..." loading /> : null}
        {usersQuery.data?.length ? (
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            {usersQuery.data.map((user, index) => (
              <UserPickRow
                key={user.id}
                user={user}
                selected={user.id === selectedUserId}
                last={index === (usersQuery.data?.length ?? 0) - 1}
                onPress={() => {
                  if (__DEV__) {
                    console.log("[admin] selected access user row", {
                      target: adminUserIdDebugSummary(user.id),
                      emailPresent: !!user.email,
                    });
                  }
                  setSelectedUserId(user.id);
                }}
              />
            ))}
          </View>
        ) : null}

        {selectedUserId ? (
          detailQuery.isLoading ? (
            <StateCard label="Loading selected user..." loading />
          ) : detailQuery.isError || !profile ? (
            <StateCard label="Selected user unavailable." />
          ) : (
            <>
              <AccountSection title="Selected user">
                <AccountRow icon="user" title={adminTextLabel(profile.email)} subtitle={profile.id} />
                <AccountRow icon="credit-card" title="Effective plan" value={adminStatusLabel(profile.effectivePlan)} />
                <AccountRow icon="user-check" title="Tester status" value={adminStatusLabel(profile.testerStatus)} />
                <AccountRow icon="clock" title="Override expiry" value={adminDateLabel(profile.overrideExpiresAt)} last />
              </AccountSection>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                <Text style={[styles.title, { color: colors.foreground }]}>Access change details</Text>
                <TextInput
                  value={expiryDate}
                  onChangeText={setExpiryDate}
                  placeholder="Expiry ISO date/time, optional"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  style={[styles.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Reason, optional"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>

              <AccountSection title="Actions">
                <ActionRow title="Grant tester access" icon="user-check" pending={mutation.isPending} onPress={() => runAction("grant_tester", "Grant tester access")} />
                <ActionRow title="Remove tester access" icon="user-x" pending={mutation.isPending} onPress={() => runAction("remove_tester", "Remove tester access")} />
                <ActionRow title="Grant temporary Plus" icon="credit-card" pending={mutation.isPending} onPress={() => runAction("grant_plus", "Grant temporary Plus")} />
                <ActionRow title="Grant temporary Family" icon="users" pending={mutation.isPending} onPress={() => runAction("grant_family", "Grant temporary Family")} />
                <ActionRow title="Clear access override" icon="x-circle" pending={mutation.isPending} onPress={() => runAction("clear_access", "Clear access override")} />
                <AccountRow icon="plus-circle" title="Add bonus scan/search allowance" value="Not available" disabled last />
              </AccountSection>
            </>
          )
        ) : (
          <StateCard label="Select a user to manage access." />
        )}
      </ScrollView>
    </>
  );
}

function UserPickRow({
  user,
  selected,
  last,
  onPress,
}: {
  user: AdminUserSearchResult;
  selected: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pickRow,
        !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.pickTitle, { color: colors.foreground }]} numberOfLines={1}>{adminTextLabel(user.email)}</Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]} numberOfLines={1}>{adminStatusLabel(user.effective_plan)}</Text>
      </View>
      {selected ? <Feather name="check" size={17} color={colors.primary} /> : null}
    </Pressable>
  );
}

function ActionRow({ title, icon, pending, onPress }: { title: string; icon: React.ComponentProps<typeof Feather>["name"]; pending: boolean; onPress: () => void }) {
  return <AccountRow icon={icon} title={title} value={pending ? "Saving" : undefined} onPress={pending ? undefined : onPress} />;
}

function StateCard({ label, loading = false }: { label: string; loading?: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, padding: 15, gap: 10 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  searchRow: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 9 },
  smallButton: { minHeight: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  smallButtonText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  textInput: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  listCard: { borderWidth: 1, overflow: "hidden" },
  pickRow: { minHeight: 58, paddingHorizontal: 15, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  pickTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
});
