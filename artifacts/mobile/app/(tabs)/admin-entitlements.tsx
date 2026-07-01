import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, type Href, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  adminDateLabel,
  adminNumberLabel,
  adminStatusLabel,
  adminTextLabel,
  adminUserIdDebugSummary,
  normalizeAdminUserIdParam,
} from "@/lib/admin-model";
import { loadAdminEntitlementDebug, searchAdminUsers, type AdminUserSearchResult } from "@/lib/admin-service";

export default function AdminEntitlementsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const routeUserId = normalizeAdminUserIdParam(params.userId);
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();
  const [queryText, setQueryText] = React.useState("");
  const [submittedQuery, setSubmittedQuery] = React.useState("");
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(routeUserId);

  React.useEffect(() => {
    if (!__DEV__) return;
    console.log("[admin] entitlement route param", { target: adminUserIdDebugSummary(params.userId) });
  }, [params.userId]);

  React.useEffect(() => {
    if (routeUserId) setSelectedUserId(routeUserId);
  }, [routeUserId]);

  const usersQuery = useQuery({
    queryKey: ["admin-entitlement-users", session?.user.id, submittedQuery],
    queryFn: () => searchAdminUsers(submittedQuery, 10),
    enabled: !!session && isAdmin && submittedQuery.length > 0,
    staleTime: 20_000,
    retry: 1,
  });

  const debugQuery = useQuery({
    queryKey: ["admin-entitlement-debug", session?.user.id, selectedUserId],
    queryFn: () => loadAdminEntitlementDebug(selectedUserId!),
    enabled: !!session && isAdmin && !!selectedUserId,
    staleTime: 10_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const debug = debugQuery.data;
  const profile = debug?.profile;

  return (
    <>
      <Stack.Screen options={{ title: "Entitlement debug" }} />
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
                    console.log("[admin] selected entitlement user row", {
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

        {!selectedUserId ? (
          <StateCard label="Select a user to inspect entitlement state." />
        ) : debugQuery.isLoading ? (
          <StateCard label="Loading entitlement state..." loading />
        ) : debugQuery.isError || !debug || !profile ? (
          <StateCard label="Entitlement state unavailable. Check admin RPC access." />
        ) : (
          <>
            <AccountSection title="User">
              <AccountRow icon="user" title={adminTextLabel(profile.email)} subtitle={profile.id} />
              <AccountRow icon="shield" title="App role" value={adminStatusLabel(profile.appRole)} />
              <AccountRow icon="credit-card" title="Effective plan" value={adminStatusLabel(profile.effectivePlan)} last />
            </AccountSection>

            <AccountSection title="Supabase plan fields">
              <AccountRow icon="tag" title="Profile plan" value={adminStatusLabel(profile.plan)} />
              <AccountRow icon="toggle-left" title="Subscription status" value={adminStatusLabel(profile.subscriptionStatus)} />
              <AccountRow icon="credit-card" title="Subscription plan" value={adminStatusLabel(profile.subscriptionPlan)} />
              <AccountRow icon="calendar" title="Subscription period end" value={adminDateLabel(profile.subscriptionPeriodEnd)} last />
            </AccountSection>

            <AccountSection title="Override fields">
              <AccountRow icon="tag" title="Override plan" value={adminStatusLabel(profile.overridePlan)} />
              <AccountRow icon="activity" title="Override status" value={adminStatusLabel(profile.overrideStatus)} />
              <AccountRow icon="edit-3" title="Override reason" value={adminTextLabel(profile.overrideReason)} />
              <AccountRow icon="clock" title="Override expiry" value={adminDateLabel(profile.overrideExpiresAt)} last />
            </AccountSection>

            <AccountSection title={`Usage ${debug.usage.monthKey ?? ""}`.trim()}>
              <AccountRow icon="camera" title="AI scans" value={adminNumberLabel(debug.usage.aiScans)} />
              <AccountRow icon="search" title="Replacement lookups" value={adminNumberLabel(debug.usage.replacementLookups)} last />
            </AccountSection>

            <AccountSection title="RevenueCat">
              <AccountRow icon="smartphone" title="Status" value={debug.revenueCatConnected ? adminStatusLabel(profile.revenueCatStatus) : "Not connected"} />
              <AccountRow icon="hash" title="Customer ID" value={adminTextLabel(profile.revenueCatCustomerId)} />
              <AccountRow icon="box" title="Product ID" value={adminTextLabel(profile.revenueCatProductId)} />
              <AccountRow icon="award" title="Entitlement ID" value={adminTextLabel(profile.revenueCatEntitlementId)} />
              <AccountRow icon="clock" title="Last sync" value={adminDateLabel(profile.revenueCatUpdatedAt)} last />
            </AccountSection>

            {!debug.revenueCatConnected ? <StateCard label={debug.revenueCatExplanation ?? "RevenueCat data is not connected for this user in Supabase."} /> : null}
            {!debug.supportsBonusAllowance ? <StateCard label="Bonus scan/search allowance is not supported by the current entitlement schema." /> : null}
          </>
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
        <Text style={[styles.pickTitle, { color: colors.foreground }]} numberOfLines={1}>
          {adminTextLabel(user.email)}
        </Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]} numberOfLines={1}>
          {adminStatusLabel(user.effective_plan)}
        </Text>
      </View>
      {selected ? <Feather name="check" size={17} color={colors.primary} /> : null}
    </Pressable>
  );
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
  listCard: { borderWidth: 1, overflow: "hidden" },
  pickRow: { minHeight: 58, paddingHorizontal: 15, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  pickTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
});
