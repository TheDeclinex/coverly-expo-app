import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { adminDateLabel, adminStatusLabel, adminTextLabel } from "@/lib/admin-model";
import { loadAdminClaimPacks, type AdminClaimPackSummary } from "@/lib/admin-service";

export default function AdminClaimPacksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();

  const claimPacksQuery = useQuery({
    queryKey: ["admin-claim-packs", session?.user.id],
    queryFn: () => loadAdminClaimPacks(50),
    enabled: !!session && isAdmin,
    staleTime: 20_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const claimPacks = claimPacksQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "Claim packs" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Orders and history</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Read-only claim pack records. Retry is only enabled when a safe backend retry exists.</Text>
        </View>

        {claimPacksQuery.isLoading ? (
          <StateCard label="Loading claim packs..." loading />
        ) : claimPacksQuery.isError ? (
          <StateCard label="Claim pack history unavailable. Check admin RPC access." />
        ) : claimPacks.length === 0 ? (
          <StateCard label="No claim pack records found." />
        ) : (
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            {claimPacks.map((claimPack, index) => (
              <ClaimPackRow
                key={claimPack.id}
                claimPack={claimPack}
                last={index === claimPacks.length - 1}
                onPress={() => router.push({ pathname: "/(tabs)/admin-claim-pack/[id]", params: { id: claimPack.id } } as Href)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function ClaimPackRow({ claimPack, last, onPress }: { claimPack: AdminClaimPackSummary; last: boolean; onPress: () => void }) {
  const colors = useColors();
  const emailStatus = claimPack.email_sent === null ? "Email not available" : claimPack.email_sent ? "Email sent" : "Email not sent";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
          {adminTextLabel(claimPack.property_name)}
        </Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]} numberOfLines={1}>
          {adminTextLabel(claimPack.user_email)}
        </Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]} numberOfLines={1}>
          {adminStatusLabel(claimPack.status)} / {adminDateLabel(claimPack.created_at)} / {emailStatus}
        </Text>
        {claimPack.generation_error ? (
          <Text style={[styles.errorText, { color: "#B42318" }]} numberOfLines={2}>
            {claimPack.generation_error}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
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
  headerCard: { borderWidth: 1, padding: 15, gap: 5 },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
  listCard: { borderWidth: 1, overflow: "hidden" },
  row: { minHeight: 86, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  rowCopy: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  rowTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
});
