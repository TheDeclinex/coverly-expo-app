import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  calculateClaimPackSummary,
  createInitialClaimPackSelection,
  toggleClaimPackItem,
  toggleClaimPackRoom,
  type ClaimPackSelection,
} from "@/lib/claim-pack-selection-model";
import {
  formatCurrency,
  getItemTotalValue,
  hasPhoto,
  hasValue,
} from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryItem, InventoryRoom } from "@/types";

const UNASSIGNED_SECTION_ID = "__unassigned__";

type EvidenceLinkRow = {
  item_id: string | null;
  evidence_id: string | null;
};

type EvidenceIncludeRow = {
  id: string;
  include_in_pack: boolean | null;
};

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function readinessCopy(summary: ReturnType<typeof calculateClaimPackSummary>) {
  const missing = [
    summary.missingValueCount > 0 ? formatCount(summary.missingValueCount, "missing value", "missing values") : null,
    summary.missingPhotoCount > 0 ? formatCount(summary.missingPhotoCount, "missing photo", "missing photos") : null,
    summary.missingEvidenceCount > 0 ? formatCount(summary.missingEvidenceCount, "without evidence", "without evidence") : null,
  ].filter(Boolean);
  return missing.length === 0 ? "Selected items look claim-pack ready." : missing.join(" · ");
}

export default function ClaimPackDraftScreen() {
  const { fileId } = useLocalSearchParams<{ fileId: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState<ClaimPackSelection | null>(null);
  const [initialSelectionKey, setInitialSelectionKey] = useState<string | null>(null);

  const propertyQuery = useQuery({
    queryKey: ["claim-pack-property", fileId, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("*")
        .eq("id", fileId)
        .single();
      if (error) throw error;
      return data as InventoryFile;
    },
    enabled: Boolean(session && fileId),
  });

  const roomsQuery = useQuery({
    queryKey: ["claim-pack-rooms", fileId, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_rooms")
        .select("*")
        .eq("file_id", fileId)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InventoryRoom[];
    },
    enabled: Boolean(session && fileId),
  });

  const itemsQuery = useQuery({
    queryKey: ["claim-pack-items", fileId, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("file_id", fileId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
    enabled: Boolean(session && fileId),
  });

  const itemIds = useMemo(() => (itemsQuery.data ?? []).map((item) => item.id), [itemsQuery.data]);
  const itemIdsKey = useMemo(() => [...itemIds].sort().join(","), [itemIds]);

  const evidenceCountsQuery = useQuery<Record<string, number>>({
    queryKey: ["claim-pack-evidence-counts", fileId, session?.user.id, itemIdsKey],
    queryFn: async () => {
      if (itemIds.length === 0) return {};

      const { data: links, error: linkError } = await supabase
        .from("claim_evidence_items")
        .select("item_id, evidence_id")
        .in("item_id", itemIds);
      if (linkError) throw linkError;

      const evidenceIds = [
        ...new Set((links ?? []).map((link: EvidenceLinkRow) => link.evidence_id).filter(Boolean)),
      ] as string[];
      if (evidenceIds.length === 0) return {};

      const { data: evidenceRows, error: evidenceError } = await supabase
        .from("claim_evidence")
        .select("id, include_in_pack")
        .in("id", evidenceIds);
      if (evidenceError) throw evidenceError;

      const includeMap = new Map(
        ((evidenceRows ?? []) as EvidenceIncludeRow[]).map((row) => [row.id, row.include_in_pack === true]),
      );

      return ((links ?? []) as EvidenceLinkRow[]).reduce<Record<string, number>>((counts, link) => {
        if (!link.item_id || !link.evidence_id || !includeMap.get(link.evidence_id)) return counts;
        counts[link.item_id] = (counts[link.item_id] ?? 0) + 1;
        return counts;
      }, {});
    },
    enabled: Boolean(session && fileId && itemIds.length > 0),
  });

  const rooms = roomsQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const evidenceCounts = evidenceCountsQuery.data ?? {};
  const selectionKey = useMemo(
    () => `${rooms.map((room) => room.id).join(",")}|${items.map((item) => item.id).join(",")}`,
    [rooms, items],
  );

  useEffect(() => {
    if (!roomsQuery.isSuccess || !itemsQuery.isSuccess) return;
    if (selection && initialSelectionKey === selectionKey) return;
    setSelection(createInitialClaimPackSelection(rooms, items));
    setInitialSelectionKey(selectionKey);
  }, [initialSelectionKey, items, itemsQuery.isSuccess, rooms, roomsQuery.isSuccess, selection, selectionKey]);

  const effectiveSelection = selection ?? createInitialClaimPackSelection(rooms, items);
  const summary = calculateClaimPackSummary({
    rooms,
    items,
    evidenceCountsByItemId: evidenceCounts,
    selection: effectiveSelection,
  });

  const itemsByRoomId = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const item of items) {
      const key = item.room_id ?? UNASSIGNED_SECTION_ID;
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    }
    return map;
  }, [items]);

  const isLoading = propertyQuery.isLoading || roomsQuery.isLoading || itemsQuery.isLoading;
  const error = propertyQuery.error ?? roomsQuery.error ?? itemsQuery.error ?? evidenceCountsQuery.error;
  const refetchAll = () => {
    void propertyQuery.refetch();
    void roomsQuery.refetch();
    void itemsQuery.refetch();
    void evidenceCountsQuery.refetch();
  };

  const toggleRoom = (roomId: string) => {
    setSelection((current) => toggleClaimPackRoom(current ?? effectiveSelection, roomId, items));
  };

  const toggleItem = (item: InventoryItem) => {
    setSelection((current) => toggleClaimPackItem(current ?? effectiveSelection, item, items));
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Claim pack preview",
          headerTitleAlign: "center",
          headerStyle: { backgroundColor: colors.card },
          headerShadowVisible: true,
          headerTitleStyle: {
            fontFamily: "Inter_600SemiBold",
            fontSize: 17,
            color: colors.foreground,
          },
          headerTintColor: colors.primary,
        }}
      />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState
          message="Couldn’t load claim-pack preview"
          detail={error instanceof Error ? error.message : "Please try again."}
          onRetry={refetchAll}
        />
      ) : !propertyQuery.data ? (
        <EmptyState
          icon="file-text"
          title="Property unavailable"
          subtitle="This property could not be loaded."
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
              <Feather name="file-text" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={[styles.kicker, { color: colors.mutedForeground }]}>DRAFT PREVIEW</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>{propertyQuery.data.name}</Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                Choose the rooms, items, photos and supporting evidence that will go into a future claim-ready PDF.
              </Text>
            </View>
          </View>

          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <View style={styles.summaryGrid}>
              <SummaryCell label="Rooms" value={summary.selectedRoomsCount} colors={colors} />
              <SummaryCell label="Items" value={summary.selectedItemsCount} colors={colors} />
              <SummaryCell label="Evidence" value={summary.includedEvidenceCount} colors={colors} />
              <SummaryCell label="Value" value={formatCurrency(summary.selectedEstimatedValue)} colors={colors} compact />
            </View>
            <View style={[styles.readinessRow, { borderTopColor: colors.border }]}>
              <Feather
                name={summary.missingValueCount + summary.missingPhotoCount + summary.missingEvidenceCount === 0 ? "check-circle" : "alert-circle"}
                size={15}
                color={summary.missingValueCount + summary.missingPhotoCount + summary.missingEvidenceCount === 0 ? colors.success : colors.warning}
              />
              <Text style={[styles.readinessText, { color: colors.mutedForeground }]}>{readinessCopy(summary)}</Text>
            </View>
          </View>

          {items.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Feather name="package" size={24} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No items to include yet</Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                Add or scan items first, then come back to preview what a claim pack could contain.
              </Text>
            </View>
          ) : (
            <View style={styles.sections}>
              {rooms.map((room) => {
                const roomItems = itemsByRoomId.get(room.id) ?? [];
                const selectedItemsInRoom = roomItems.filter((item) => effectiveSelection.selectedItemIds.has(item.id)).length;
                const roomSelected = effectiveSelection.selectedRoomIds.has(room.id);
                return (
                  <RoomSection
                    key={room.id}
                    room={room}
                    items={roomItems}
                    selectedItemsInRoom={selectedItemsInRoom}
                    roomSelected={roomSelected}
                    selectedItemIds={effectiveSelection.selectedItemIds}
                    evidenceCounts={evidenceCounts}
                    onToggleRoom={() => toggleRoom(room.id)}
                    onToggleItem={toggleItem}
                    colors={colors}
                  />
                );
              })}
              {(itemsByRoomId.get(UNASSIGNED_SECTION_ID) ?? []).length > 0 ? (
                <UnassignedItemsSection
                  items={itemsByRoomId.get(UNASSIGNED_SECTION_ID) ?? []}
                  selectedItemIds={effectiveSelection.selectedItemIds}
                  evidenceCounts={evidenceCounts}
                  onToggleItem={toggleItem}
                  colors={colors}
                />
              ) : null}
            </View>
          )}

          <View style={[styles.footerNotice, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
            <Feather name="shield" size={16} color={colors.primary} />
            <Text style={[styles.footerNoticeText, { color: colors.mutedForeground }]}>
              PDF export, claim-pack history and purchases are coming next. This preview does not create a file or change your records.
            </Text>
          </View>

          <Pressable
            disabled
            style={[styles.disabledButton, { backgroundColor: colors.border, borderRadius: colors.radius }]}
          >
            <Feather name="download" size={16} color={colors.mutedForeground} />
            <Text style={[styles.disabledButtonText, { color: colors.mutedForeground }]}>Generate PDF — coming next</Text>
          </Pressable>
        </ScrollView>
      )}
    </>
  );
}

function SummaryCell({
  label,
  value,
  colors,
  compact = false,
}: {
  label: string;
  value: number | string;
  colors: ReturnType<typeof useColors>;
  compact?: boolean;
}) {
  return (
    <View style={styles.summaryCell}>
      <Text
        style={[compact ? styles.summaryValueCompact : styles.summaryValue, { color: colors.foreground }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function RoomSection({
  room,
  items,
  selectedItemsInRoom,
  roomSelected,
  selectedItemIds,
  evidenceCounts,
  onToggleRoom,
  onToggleItem,
  colors,
}: {
  room: InventoryRoom;
  items: InventoryItem[];
  selectedItemsInRoom: number;
  roomSelected: boolean;
  selectedItemIds: Set<string>;
  evidenceCounts: Record<string, number>;
  onToggleRoom: () => void;
  onToggleItem: (item: InventoryItem) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.roomCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Pressable onPress={onToggleRoom} style={styles.roomHeader}>
        <SelectionBox selected={roomSelected} colors={colors} />
        <View style={styles.roomHeaderCopy}>
          <Text style={[styles.roomTitle, { color: colors.foreground }]}>{room.name}</Text>
          <Text style={[styles.roomSubtitle, { color: colors.mutedForeground }]}>
            {formatCount(selectedItemsInRoom, "item")} selected of {items.length}
          </Text>
        </View>
        <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
      </Pressable>
      {items.length === 0 ? (
        <Text style={[styles.emptyRoomText, { color: colors.mutedForeground }]}>No documented items in this room yet.</Text>
      ) : (
        <View style={styles.itemList}>
          {items.map((item) => (
            <ClaimPackItemRow
              key={item.id}
              item={item}
              selected={selectedItemIds.has(item.id)}
              evidenceCount={evidenceCounts[item.id] ?? 0}
              onPress={() => onToggleItem(item)}
              colors={colors}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function UnassignedItemsSection({
  items,
  selectedItemIds,
  evidenceCounts,
  onToggleItem,
  colors,
}: {
  items: InventoryItem[];
  selectedItemIds: Set<string>;
  evidenceCounts: Record<string, number>;
  onToggleItem: (item: InventoryItem) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.roomCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={styles.roomHeader}>
        <View style={[styles.unassignedIcon, { backgroundColor: colors.secondary }]}>
          <Feather name="box" size={14} color={colors.mutedForeground} />
        </View>
        <View style={styles.roomHeaderCopy}>
          <Text style={[styles.roomTitle, { color: colors.foreground }]}>Unassigned items</Text>
          <Text style={[styles.roomSubtitle, { color: colors.mutedForeground }]}>
            Items not linked to a room yet
          </Text>
        </View>
      </View>
      <View style={styles.itemList}>
        {items.map((item) => (
          <ClaimPackItemRow
            key={item.id}
            item={item}
            selected={selectedItemIds.has(item.id)}
            evidenceCount={evidenceCounts[item.id] ?? 0}
            onPress={() => onToggleItem(item)}
            colors={colors}
          />
        ))}
      </View>
    </View>
  );
}

function ClaimPackItemRow({
  item,
  selected,
  evidenceCount,
  onPress,
  colors,
}: {
  item: InventoryItem;
  selected: boolean;
  evidenceCount: number;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const readyBadges = [
    hasValue(item) ? null : "No value",
    hasPhoto(item) ? null : "No photo",
    evidenceCount > 0 ? null : "No evidence",
  ].filter(Boolean);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.itemRow,
        { borderTopColor: colors.border, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <SelectionBox selected={selected} colors={colors} small />
      <View style={styles.itemCopy}>
        <Text style={[styles.itemTitle, { color: colors.foreground }]} numberOfLines={1}>
          {item.name || "Unnamed item"}
        </Text>
        <Text style={[styles.itemMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {formatCurrency(getItemTotalValue(item))} · {formatCount(evidenceCount, "evidence file", "evidence files")}
        </Text>
        {readyBadges.length > 0 ? (
          <Text style={[styles.itemWarnings, { color: colors.warning }]} numberOfLines={1}>
            {readyBadges.join(" · ")}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function SelectionBox({
  selected,
  colors,
  small = false,
}: {
  selected: boolean;
  colors: ReturnType<typeof useColors>;
  small?: boolean;
}) {
  const size = small ? 22 : 26;
  return (
    <View
      style={[
        styles.selectionBox,
        {
          width: size,
          height: size,
          borderRadius: small ? 7 : 8,
          backgroundColor: selected ? colors.primary : colors.background,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      {selected ? <Feather name="check" size={small ? 13 : 15} color={colors.primaryForeground} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  heroCard: { borderWidth: 1, padding: 16, flexDirection: "row", gap: 13 },
  heroIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 5 },
  kicker: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  body: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  summaryCard: { borderWidth: 1, padding: 14, gap: 12 },
  summaryGrid: { flexDirection: "row", gap: 8 },
  summaryCell: { flex: 1, gap: 3 },
  summaryValue: { fontSize: 21, fontFamily: "Inter_700Bold" },
  summaryValueCompact: { fontSize: 16, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  readinessRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11, flexDirection: "row", gap: 7, alignItems: "center" },
  readinessText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  emptyCard: { borderWidth: 1, padding: 18, gap: 8, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sections: { gap: 12 },
  roomCard: { borderWidth: 1, overflow: "hidden" },
  roomHeader: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  roomHeaderCopy: { flex: 1, gap: 2 },
  roomTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  roomSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyRoomText: { paddingHorizontal: 14, paddingBottom: 14, fontSize: 12, fontFamily: "Inter_400Regular" },
  itemList: { paddingHorizontal: 14 },
  itemRow: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: 62, paddingVertical: 11, flexDirection: "row", gap: 10, alignItems: "center" },
  itemCopy: { flex: 1, gap: 3 },
  itemTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  itemMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  itemWarnings: { fontSize: 11, fontFamily: "Inter_500Medium" },
  selectionBox: { borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  unassignedIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  footerNotice: { padding: 13, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  footerNoticeText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  disabledButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, opacity: 0.82 },
  disabledButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
