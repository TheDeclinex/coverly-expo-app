import { Feather } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import { useQuery } from "@tanstack/react-query";
import { Stack, router, type Href, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountRow, AccountSection } from "@/components/AccountMenu";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  deleteClaimPackDraft,
  listClaimPackDrafts,
  type StoredClaimPackDraft,
} from "@/lib/claim-pack-draft-storage";
import {
  claimPackHistoryValueLabel,
  getClaimPackHistoryStatus,
  safeClaimPackPdfFilename,
} from "@/lib/claim-pack-history";
import { supabase } from "@/lib/supabase";
import type { InventoryFile } from "@/types";

const CLAIM_PACK_SIGNED_URL_EXPIRY_SECONDS = 60 * 10;

type ClaimPackHistoryRow = {
  id: string;
  file_id?: string | null;
  pack_ref?: string | null;
  status?: string | null;
  filename?: string | null;
  generated_at?: string | null;
  storage_path?: string | null;
  generation_error?: string | null;
  total_value?: number | null;
  item_count?: number | null;
  totals?: {
    selectedItemsCount?: number;
    selectedEstimatedValue?: number;
    totalEstimatedValue?: number;
  } | null;
};

export default function ClaimPacksScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [openingPackId, setOpeningPackId] = React.useState<string | null>(null);

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
        .select("id, file_id, pack_ref, status, filename, generated_at, storage_path, generation_error, total_value, item_count, totals")
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
      if (session?.user.id) void historyQuery.refetch();
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
  const confirmDeleteDraft = (draft: StoredClaimPackDraft) => {
    Alert.alert(
      "Delete draft claim pack?",
      "This removes the draft selection and notes only. Your inventory items, rooms, photos, evidence, and generated claim packs will not be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete draft",
          style: "destructive",
          onPress: async () => {
            if (!session?.user.id) return;
            await deleteClaimPackDraft(session.user.id, draft.id);
            await draftsQuery.refetch();
          },
        },
      ],
    );
  };
  const openPreviousPack = async (pack: ClaimPackHistoryRow) => {
    const status = getClaimPackHistoryStatus(pack);
    if (status !== "openable" || !pack.storage_path) return;
    setOpeningPackId(pack.id);
    try {
      const { data, error } = await supabase.storage
        .from("claim-packs")
        .createSignedUrl(pack.storage_path, CLAIM_PACK_SIGNED_URL_EXPIRY_SECONDS);
      if (error || !data?.signedUrl) throw error ?? new Error("Signed URL was not returned.");
      const filename = safeClaimPackPdfFilename(pack.filename, pack.pack_ref ?? pack.id);
      try {
        const file = await File.downloadFileAsync(data.signedUrl, new File(Paths.cache, filename), { idempotent: true });
        await WebBrowser.openBrowserAsync(file.uri);
      } catch (localOpenError) {
        console.warn("[claim-packs] Local claim pack open fallback", {
          packId: pack.id,
          message: localOpenError instanceof Error ? localOpenError.message : "Unknown error",
        });
        await WebBrowser.openBrowserAsync(data.signedUrl);
      }
    } catch (openError) {
      console.warn("[claim-packs] Could not open previous claim pack", {
        packId: pack.id,
        status: pack.status ?? null,
        hasStoragePath: Boolean(pack.storage_path),
        message: openError instanceof Error ? openError.message : "Unknown error",
      });
      Alert.alert("Couldn\u2019t open this Claim Pack. Please try again.");
    } finally {
      setOpeningPackId(null);
    }
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
              <DraftClaimPackRow
                key={draft.id}
                draft={draft}
                subtitle={claimPackDraftSubtitle(draft)}
                onContinue={() => continueDraft(draft)}
                onDelete={() => confirmDeleteDraft(draft)}
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
            historyQuery.data.map((pack, index) => {
              const historyStatus = getClaimPackHistoryStatus(pack);
              const isOpening = openingPackId === pack.id;
              return (
                <AccountRow
                  key={pack.id}
                  icon={historyStatus === "failed" ? "alert-circle" : "file-text"}
                  title={pack.filename ?? "Claim pack"}
                  subtitle={claimPackHistorySubtitle(pack)}
                  value={claimPackHistoryValueLabel(historyStatus, isOpening)}
                  disabled={isOpening}
                  onPress={historyStatus === "openable" && !isOpening ? () => void openPreviousPack(pack) : undefined}
                  last={index === (historyQuery.data?.length ?? 0) - 1}
                />
              );
            })
          ) : (
            <AccountRow
              icon="archive"
              title="No previous packs"
              subtitle="Generated PDFs will appear here after you export a claim pack."
              value="Empty"
              last
            />
          )}
        </AccountSection>
      </ScrollView>
    </>
  );
}

function DraftClaimPackRow({
  draft,
  subtitle,
  onContinue,
  onDelete,
  last,
}: {
  draft: StoredClaimPackDraft;
  subtitle: string;
  onContinue: () => void;
  onDelete: () => void;
  last: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.draftRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Continue ${draft.propertyName}`}
        onPress={onContinue}
        style={({ pressed }) => [styles.draftMain, { opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={[styles.draftIcon, { backgroundColor: colors.secondary }]}>
          <Feather name="edit-3" size={17} color={colors.primary} />
        </View>
        <View style={styles.draftCopy}>
          <Text style={[styles.draftTitle, { color: colors.foreground }]}>{draft.propertyName}</Text>
          <Text style={[styles.draftSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
        </View>
        <Text style={[styles.draftValue, { color: colors.mutedForeground }]}>Continue</Text>
        <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete draft for ${draft.propertyName}`}
        onPress={onDelete}
        hitSlop={8}
        style={({ pressed }) => [styles.deleteButton, { backgroundColor: colors.secondary, opacity: pressed ? 0.72 : 1 }]}
      >
        <Feather name="trash-2" size={17} color="#DC2626" />
      </Pressable>
    </View>
  );
}

function claimPackHistorySubtitle(pack: ClaimPackHistoryRow): string {
  const status = getClaimPackHistoryStatus(pack);
  const generatedDate = pack.generated_at ? new Date(pack.generated_at) : null;
  const dateLabel = generatedDate && !Number.isNaN(generatedDate.getTime())
    ? generatedDate.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })
    : "Draft metadata";
  if (status === "failed") return [safeGenerationError(pack.generation_error), dateLabel].filter(Boolean).join(" · ");
  if (status === "legacy") return ["PDF not available in mobile", dateLabel].join(" · ");
  const itemCount = pack.totals?.selectedItemsCount ?? pack.item_count ?? null;
  const items = itemCount ? `${itemCount} items` : null;
  const totalValue = pack.totals?.selectedEstimatedValue ?? pack.totals?.totalEstimatedValue ?? pack.total_value;
  const value = totalValue ? formatCurrency(totalValue) : null;
  return [items, value, dateLabel].filter(Boolean).join(" · ");
}

function safeGenerationError(value: string | null | undefined): string {
  const message = value?.replace(/\s+/g, " ").trim();
  if (!message) return "Generation failed";
  return message.length > 90 ? `${message.slice(0, 87)}...` : message;
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
  draftRow: { minHeight: 64, paddingLeft: 14, paddingRight: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  draftMain: { flex: 1, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  draftIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  draftCopy: { flex: 1, gap: 2 },
  draftTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  draftSubtitle: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  draftValue: { maxWidth: 80, textAlign: "right", fontSize: 12, fontFamily: "Inter_500Medium" },
  deleteButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
});
