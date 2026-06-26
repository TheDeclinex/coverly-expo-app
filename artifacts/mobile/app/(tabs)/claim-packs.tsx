import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, router, type Href, useFocusEffect } from "expo-router";
import React, { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  listClaimPackDrafts,
  type StoredClaimPackDraft,
} from "@/lib/claim-pack-draft-storage";
import { supabase } from "@/lib/supabase";
import type { InventoryFile } from "@/types";

type ClaimPackHistoryRow = {
  id: string;
  file_id?: string | null;
  filename?: string | null;
  generated_at?: string | null;
  storage_path?: string | null;
  generation_error?: string | null;
  totals?: {
    selectedItemsCount?: number;
    selectedEstimatedValue?: number;
  } | null;
};

export default function ClaimPacksScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const propertiesQuery = useQuery({
    queryKey: ["claim-pack-properties", session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("id, name, last_modified")
        .order("last_modified", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Pick<InventoryFile, "id" | "name" | "last_modified">[];
    },
    enabled: !!session,
    staleTime: 30_000,
    retry: 1,
  });

  const historyQuery = useQuery({
    queryKey: ["claim-pack-history", session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_packs")
        .select("id, file_id, filename, generated_at, storage_path, generation_error, totals")
        .order("generated_at", { ascending: false, nullsFirst: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as ClaimPackHistoryRow[];
    },
    enabled: !!session,
    staleTime: 30_000,
    retry: 1,
  });

  const draftsQuery = useQuery({
    queryKey: ["claim-pack-drafts", session?.user.id],
    queryFn: () => listClaimPackDrafts(session?.user.id ?? ""),
    enabled: !!session?.user.id,
    staleTime: 5_000,
  });

  useFocusEffect(
    useCallback(() => {
      if (session?.user.id) void draftsQuery.refetch();
    }, [session?.user.id]),
  );

  const properties = propertiesQuery.data ?? [];
  const openDraft = (fileId: string) => {
    router.push({
      pathname: "/(tabs)/claim-pack/[fileId]",
      params: { fileId },
    } as Href);
  };
  const continueDraft = (draft: StoredClaimPackDraft) => {
    router.push({
      pathname: "/(tabs)/claim-pack/[fileId]",
      params: { fileId: draft.fileId, claimDraftId: draft.id },
    } as Href);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Claim packs",
          headerTitleAlign: "center",
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.primary,
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
            <Feather name="package" size={20} color={colors.primary} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Claim packs</Text>
            <Text style={[styles.heroText, { color: colors.mutedForeground }]}>
              Prepare selected property contents and evidence for a future insurance claim PDF.
            </Text>
          </View>
        </View>

        <AccountSection title="Your drafts">
          {draftsQuery.isLoading ? (
            <AccountRow icon="loader" title="Loading drafts" subtitle="Checking saved claim-pack drafts." value="Loading…" last />
          ) : draftsQuery.data?.length ? (
            draftsQuery.data.map((draft, index) => (
              <AccountRow
                key={draft.id}
                icon="edit-3"
                title={draft.propertyName}
                subtitle={claimPackDraftSubtitle(draft)}
                value="Continue"
                onPress={() => continueDraft(draft)}
                last={index === (draftsQuery.data?.length ?? 0) - 1}
              />
            ))
          ) : (
            <AccountRow
              icon="archive"
              title="No saved drafts"
              subtitle="Start a claim pack and your room and item choices will appear here."
              value="Empty"
              last
            />
          )}
        </AccountSection>

        <AccountSection title="Choose a property">
          {propertiesQuery.isLoading ? (
            <AccountRow icon="loader" title="Loading properties" subtitle="Checking your inventory files." value="Loading…" last />
          ) : propertiesQuery.isError ? (
            <AccountRow
              icon="alert-circle"
              title="Couldn’t load properties"
              subtitle="Tap to try again."
              value="Retry"
              onPress={() => void propertiesQuery.refetch()}
              last
            />
          ) : properties.length === 0 ? (
            <AccountRow
              icon="home"
              title="No properties yet"
              subtitle="Add a property and rooms first, then you can create a claim-pack draft."
              value="Not ready"
              last
            />
          ) : (
            properties.map((property, index) => (
              <AccountRow
                key={property.id}
                icon="file-text"
                title={property.name}
                subtitle="Choose rooms and items for this pack."
                value="Start draft"
                onPress={() => openDraft(property.id)}
                last={index === properties.length - 1}
              />
            ))
          )}
        </AccountSection>

        <AccountSection title="Previous packs">
          {historyQuery.isLoading ? (
            <AccountRow icon="loader" title="Loading previous packs" subtitle="Checking generated pack history." value="Loading…" last />
          ) : historyQuery.isError ? (
            <AccountRow
              icon="alert-circle"
              title="Couldn’t load pack history"
              subtitle="Draft creation is still available."
              value="Retry"
              onPress={() => void historyQuery.refetch()}
              last
            />
          ) : historyQuery.data?.length ? (
            historyQuery.data.map((pack, index) => (
              <AccountRow
                key={pack.id}
                icon={pack.generation_error ? "alert-circle" : "file-text"}
                title={pack.filename ?? "Claim pack"}
                subtitle={claimPackHistorySubtitle(pack)}
                value={pack.generation_error ? "Failed" : pack.storage_path ? "PDF ready" : "Draft"}
                last={index === (historyQuery.data?.length ?? 0) - 1}
              />
            ))
          ) : (
            <AccountRow
              icon="archive"
              title="No previous packs"
              subtitle="Generated PDFs will appear here once export is built."
              value="Empty"
              last
            />
          )}
        </AccountSection>
      </ScrollView>
    </>
  );
}

function claimPackHistorySubtitle(pack: ClaimPackHistoryRow): string {
  const generatedDate = pack.generated_at ? new Date(pack.generated_at) : null;
  const dateLabel = generatedDate && !Number.isNaN(generatedDate.getTime())
    ? generatedDate.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })
    : "Draft metadata";
  const items = pack.totals?.selectedItemsCount ? `${pack.totals.selectedItemsCount} items` : null;
  const value = pack.totals?.selectedEstimatedValue ? formatCurrency(pack.totals.selectedEstimatedValue) : null;
  return [items, value, dateLabel].filter(Boolean).join(" · ");
}

function claimPackDraftSubtitle(draft: StoredClaimPackDraft): string {
  const updatedDate = new Date(draft.updatedAt);
  const dateLabel = Number.isNaN(updatedDate.getTime())
    ? "Saved draft"
    : `Updated ${updatedDate.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}`;
  const items = draft.selectedItemIds.length > 0 ? `${draft.selectedItemIds.length} items` : "No items selected yet";
  const claim = draft.claimNumber.trim() ? `Claim ${draft.claimNumber.trim()}` : null;
  return [items, claim, dateLabel].filter(Boolean).join(" · ");
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  }).format(value);
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  heroCard: { borderWidth: 1, padding: 16, flexDirection: "row", gap: 13 },
  heroIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 5 },
  heroTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  heroText: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
});
