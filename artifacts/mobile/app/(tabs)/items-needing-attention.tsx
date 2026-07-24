import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ContextBackButton } from "@/components/ContextBackButton";
import { ErrorState } from "@/components/ErrorState";
import { ReliableImage } from "@/components/ReliableImage";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSignedImageRecovery, useSignedImageSource } from "@/hooks/useSignedUrls";
import {
  filterItemsNeedingAttention,
  isItemAttentionFilter,
  ITEM_ATTENTION_COPY,
  type ItemAttentionFilter,
} from "@/lib/item-attention";
import { formatCurrencyFull, getItemPhoto, getItemTotalValue, hasValue } from "@/lib/inventory-mappers";
import { resolveStoredValueCurrency } from "@/lib/replacement-value";
import { supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";

const AttentionItemCard = React.memo(function AttentionItemCard({
  item,
  issue,
  showValue,
  propertyCurrency,
  onOpen,
}: {
  item: InventoryItem;
  issue: string;
  showValue: boolean;
  propertyCurrency?: string | null;
  onOpen: (item: InventoryItem) => void;
}) {
  const colors = useColors();
  const photoPath = getItemPhoto(item);
  const imageSource = useSignedImageSource(photoPath);
  const recoverImageUrl = useSignedImageRecovery([photoPath]);
  const handleOpen = React.useCallback(() => onOpen(item), [item, onOpen]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Item details for ${item.name}. ${issue}`}
      onPress={handleOpen}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.76 : 1 },
      ]}
    >
      <ReliableImage
        uri={imageSource?.uri}
        cacheKey={imageSource?.cacheKey}
        style={styles.thumbnail}
        contentFit="cover"
        onPermanentError={() => recoverImageUrl(photoPath)}
        fallback={
          <View style={[styles.thumbnail, styles.thumbnailFallback, { backgroundColor: colors.secondary }]}>
            <Feather name="package" size={24} color={colors.primary} />
          </View>
        }
      />
      <View style={styles.cardCopy}>
        <Text numberOfLines={2} style={[styles.itemName, { color: colors.foreground }]}>{item.name}</Text>
        {item.category ? <Text style={[styles.category, { color: colors.mutedForeground }]}>{item.category}</Text> : null}
        {showValue ? <Text style={[styles.value, { color: colors.foreground }]}>{hasValue(item) ? formatCurrencyFull(getItemTotalValue(item), resolveStoredValueCurrency(item.estimated_currency, propertyCurrency), propertyCurrency) : "No recorded value"}</Text> : null}
        <View style={styles.cardFooter}>
          <View style={[styles.issueChip, { backgroundColor: colors.accent }]}>
            <Text style={[styles.issueText, { color: colors.accentForeground }]}>{issue}</Text>
          </View>
          <View style={styles.detailsLink}>
            <Text style={[styles.detailsText, { color: colors.primary }]}>Item details</Text>
            <Feather name="chevron-right" size={15} color={colors.primary} />
          </View>
        </View>
      </View>
    </Pressable>
  );
});

export default function ItemsNeedingAttentionScreen() {
  const { roomId, roomName, fileId, fileName, filter: rawFilter } = useLocalSearchParams<{
    roomId: string;
    roomName?: string;
    fileId?: string;
    fileName?: string;
    filter?: string;
  }>();
  const filter: ItemAttentionFilter = isItemAttentionFilter(rawFilter) ? rawFilter : "needs_details";
  const copy = ITEM_ATTENTION_COPY[filter];
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const itemsQuery = useQuery({
    queryKey: ["items", roomId, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("room_id", roomId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
    enabled: Boolean(session && roomId),
  });

  const itemIds = React.useMemo(() => (itemsQuery.data ?? []).map((item) => item.id), [itemsQuery.data]);
  const resolvedFileId = fileId ?? itemsQuery.data?.[0]?.file_id ?? null;
  const propertyQuery = useQuery({
    queryKey: ["property-market", resolvedFileId, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_files").select("currency_code").eq("id", resolvedFileId!).single();
      if (error) throw error;
      return data as { currency_code: string };
    },
    enabled: Boolean(session && resolvedFileId),
  });
  const itemIdsKey = React.useMemo(() => [...itemIds].sort().join(","), [itemIds]);
  const evidenceQuery = useQuery<Record<string, number>>({
    queryKey: ["room-evidence-counts", roomId, session?.user.id, itemIdsKey],
    queryFn: async () => {
      if (itemIds.length === 0) return {};
      const { data, error } = await supabase.from("claim_evidence_items").select("item_id").in("item_id", itemIds);
      if (error) throw error;
      return (data ?? []).reduce<Record<string, number>>((counts, link) => {
        if (link.item_id) counts[link.item_id] = (counts[link.item_id] ?? 0) + 1;
        return counts;
      }, {});
    },
    enabled: Boolean(session && roomId && filter === "missing_evidence" && itemIds.length > 0),
  });

  useFocusEffect(React.useCallback(() => {
    void itemsQuery.refetch();
    if (filter === "missing_evidence") void evidenceQuery.refetch();
  }, [evidenceQuery.refetch, filter, itemsQuery.refetch]));

  const affectedItems = React.useMemo(
    () => filterItemsNeedingAttention(itemsQuery.data ?? [], filter, evidenceQuery.data ?? {}),
    [evidenceQuery.data, filter, itemsQuery.data],
  );

  const openItem = React.useCallback((item: InventoryItem) => {
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: {
        id: item.id,
        name: item.name,
        roomId,
        roomName: roomName ?? item.room ?? "Room",
        fileId: fileId ?? item.file_id,
        fileName: fileName ?? "Property",
        origin: "attention",
      },
    } as Href);
  }, [fileId, fileName, roomId, roomName]);

  const renderItem = React.useCallback(({ item }: { item: InventoryItem }) => (
    <AttentionItemCard
      item={item}
      issue={copy.chip}
      showValue={filter === "missing_value" || filter === "ai_value" || filter === "missing_evidence"}
      propertyCurrency={propertyQuery.data?.currency_code}
      onOpen={openItem}
    />
  ), [copy.chip, filter, openItem, propertyQuery.data?.currency_code]);

  const loadingEvidence = filter === "missing_evidence" && evidenceQuery.isLoading;
  const loading = itemsQuery.isLoading || loadingEvidence || (Boolean(resolvedFileId) && propertyQuery.isLoading);
  const error = itemsQuery.error ?? evidenceQuery.error ?? propertyQuery.error;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: copy.title,
          headerTitleAlign: "center",
          headerBackVisible: false,
          headerLeft: () => <ContextBackButton label={roomName ?? "Room"} onPress={() => router.back()} />,
        }}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <ErrorState message="Couldn't load items" detail={(error as Error).message} onRetry={() => void itemsQuery.refetch()} />
      ) : (
        <FlatList
          data={affectedItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }, affectedItems.length === 0 && styles.emptyList]}
          ListHeaderComponent={affectedItems.length > 0 ? <Text style={[styles.explanation, { color: colors.mutedForeground }]}>{copy.explanation}</Text> : null}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.completeIcon, { backgroundColor: colors.accent }]}>
                <Feather name="check" size={28} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All caught up</Text>
              <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>These items no longer need this update.</Text>
              <Pressable onPress={() => router.back()} style={[styles.backButton, { backgroundColor: colors.primary }]}>
                <Text style={[styles.backButtonText, { color: colors.primaryForeground }]}>Back to room</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 12 },
  emptyList: { flexGrow: 1 },
  explanation: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular", marginBottom: 4 },
  card: { minHeight: 126, borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: "row", gap: 12 },
  thumbnail: { width: 96, height: 104, borderRadius: 10 },
  thumbnailFallback: { alignItems: "center", justifyContent: "center" },
  cardCopy: { flex: 1, minWidth: 0, paddingVertical: 2 },
  itemName: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  category: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  value: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 5 },
  cardFooter: { flex: 1, minHeight: 32, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  issueChip: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4 },
  issueText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  detailsLink: { flexDirection: "row", alignItems: "center" },
  detailsText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 10 },
  completeIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 21, fontFamily: "Inter_700Bold" },
  emptyCopy: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular", textAlign: "center" },
  backButton: { minHeight: 44, borderRadius: 11, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", marginTop: 8 },
  backButtonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
