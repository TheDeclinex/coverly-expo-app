import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { adminDateLabel, adminStatusLabel, adminTextLabel } from "@/lib/admin-model";
import { loadAdminRecentEvents, type AdminEvent } from "@/lib/admin-service";

export default function AdminErrorsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();

  const eventsQuery = useQuery({
    queryKey: ["admin-recent-events", session?.user.id],
    queryFn: () => loadAdminRecentEvents(50),
    enabled: !!session && isAdmin,
    staleTime: 15_000,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const events = eventsQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "Recent errors" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Recent admin events</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Shows records from admin_events. New app errors need to be written to this table by backend or safe client logging later.</Text>
        </View>

        {eventsQuery.isLoading ? (
          <StateCard label="Loading events..." loading />
        ) : eventsQuery.isError ? (
          <StateCard label="Recent errors unavailable. Check admin RPC access." />
        ) : events.length === 0 ? (
          <StateCard label="No recent error events found." />
        ) : (
          events.map((event) => <EventCard key={event.id} event={event} />)
        )}
      </ScrollView>
    </>
  );
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
      {event.metadata ? (
        <Text style={[styles.metadata, { color: colors.mutedForeground }]} numberOfLines={4}>
          {JSON.stringify(event.metadata)}
        </Text>
      ) : null}
    </View>
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
  eventCard: { borderWidth: 1, padding: 15, gap: 8 },
  eventHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  eventIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  eventTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  message: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  metadata: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
});
