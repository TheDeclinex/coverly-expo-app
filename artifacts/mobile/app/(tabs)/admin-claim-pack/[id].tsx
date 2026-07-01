import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, type Href, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { adminDateLabel, adminStatusLabel, adminTextLabel } from "@/lib/admin-model";
import { loadAdminClaimPackDetail } from "@/lib/admin-service";

export default function AdminClaimPackDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();

  const detailQuery = useQuery({
    queryKey: ["admin-claim-pack-detail", session?.user.id, id],
    queryFn: () => loadAdminClaimPackDetail(id),
    enabled: !!session && isAdmin && !!id,
    staleTime: 20_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const detail = detailQuery.data;
  const claimPack = detail?.claimPack;

  return (
    <>
      <Stack.Screen options={{ title: "Claim pack detail" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        {detailQuery.isLoading ? (
          <StateCard label="Loading claim pack..." loading />
        ) : detailQuery.isError || !detail || !claimPack ? (
          <StateCard label="Claim pack record unavailable. Check admin RPC access." />
        ) : (
          <>
            <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>{adminTextLabel(detail.propertyName)}</Text>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>{adminTextLabel(detail.userEmail)}</Text>
              <Text style={[styles.mono, { color: colors.mutedForeground }]}>{unknownText(claimPack.id)}</Text>
            </View>

            <AccountSection title="Record">
              <AccountRow icon="activity" title="Status" value={adminStatusLabel(unknownText(claimPack.status))} />
              <AccountRow icon="calendar" title="Created" value={adminDateLabel(unknownText(claimPack.created_at))} />
              <AccountRow icon="check-circle" title="Generated" value={adminDateLabel(unknownText(claimPack.generated_at))} />
              <AccountRow icon="mail" title="Email delivery" value={emailStatus(claimPack.email_sent)} last />
            </AccountSection>

            <AccountSection title="References">
              <AccountRow icon="user" title="User ID" value={unknownText(claimPack.user_id)} />
              <AccountRow icon="home" title="Property/file ID" value={unknownText(claimPack.file_id)} />
              <AccountRow icon="hash" title="Pack ref" value={unknownText(claimPack.pack_ref)} />
              <AccountRow icon="box" title="Scope" value={adminStatusLabel(unknownText(claimPack.scope))} last />
            </AccountSection>

            <AccountSection title="Actions">
              <AccountRow
                icon="refresh-cw"
                title="Retry generation"
                value={detail.retryAvailable ? "Available" : "Not available"}
                subtitle={detail.retryAvailable ? undefined : detail.retryUnavailableReason ?? "Not available yet."}
                disabled={!detail.retryAvailable}
                last
              />
            </AccountSection>

            {unknownText(claimPack.generation_error) !== "Not available" ? (
              <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                <Text style={[styles.title, { color: colors.foreground }]}>Error message</Text>
                <Text style={[styles.errorText, { color: "#B42318" }]}>{unknownText(claimPack.generation_error)}</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

function emailStatus(value: unknown): string {
  if (value === true) return "Sent";
  if (value === false) return "Not sent";
  return "Not available";
}

function unknownText(value: unknown): string {
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "string") return value.trim() ? value : "Not available";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "Not available";
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
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  mono: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
});
