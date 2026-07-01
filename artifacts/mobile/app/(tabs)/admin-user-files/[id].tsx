import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, type Href, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { adminCurrencyLabel, adminDateLabel, adminNumberLabel, adminStatusLabel } from "@/lib/admin-model";
import { loadAdminUserFiles, type AdminUserFile } from "@/lib/admin-service";

export default function AdminUserFilesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();

  const filesQuery = useQuery({
    queryKey: ["admin-user-files", session?.user.id, id],
    queryFn: () => loadAdminUserFiles(id),
    enabled: !!session && isAdmin && !!id,
    staleTime: 20_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const files = filesQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "User properties" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Read-only property inspection</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Admin V1 does not allow editing or deleting user inventory.</Text>
        </View>

        {filesQuery.isLoading ? (
          <StateCard label="Loading properties..." loading />
        ) : filesQuery.isError ? (
          <StateCard label="Properties unavailable. Check admin RPC access." />
        ) : files.length === 0 ? (
          <StateCard label="No properties found for this user." />
        ) : (
          files.map((file) => <FileCard key={file.id} file={file} />)
        )}
      </ScrollView>
    </>
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

function FileCard({ file }: { file: AdminUserFile }) {
  const colors = useColors();
  return (
    <View style={[styles.fileCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Text style={[styles.fileTitle, { color: colors.foreground }]}>{file.name ?? "Unnamed property"}</Text>
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>
        {adminStatusLabel(file.property_type)} / Updated {adminDateLabel(file.updated_at)}
      </Text>
      <View style={styles.grid}>
        <Metric label="Cover" value={adminCurrencyLabel(file.contents_sum_insured)} />
        <Metric label="Inventory" value={adminCurrencyLabel(file.inventory_value)} />
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
  content: { padding: 16, gap: 12 },
  headerCard: { borderWidth: 1, padding: 15, gap: 5 },
  stateCard: { borderWidth: 1, padding: 16, gap: 8, alignItems: "flex-start" },
  fileCard: { borderWidth: 1, padding: 15, gap: 10 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  fileTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "48%", flexGrow: 1, padding: 10, gap: 2 },
  metricValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  metricLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
});
