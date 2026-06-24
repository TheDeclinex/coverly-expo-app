import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, router, type Href, useLocalSearchParams } from "expo-router";
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
  addClaimPackRoom,
  calculateClaimPackSummary,
  clearClaimPackItemsInRoom,
  createRoomsOnlyClaimPackSelection,
  createWholePropertyClaimPackSelection,
  removeClaimPackRoom,
  selectAllClaimPackItemsInRoom,
  toggleClaimPackItem,
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

type BuilderStage = "scope" | "room_picker" | "draft";

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
    summary.missingEvidenceCount > 0 ? formatCount(summary.missingEvidenceCount, "item without evidence", "items without evidence") : null,
  ].filter(Boolean);
  return missing.length === 0 ? "Selected items look claim-pack ready." : missing.join(" · ");
}

function itemCompactWarning(item: InventoryItem, evidenceCount: number) {
  const missing = [
    hasValue(item) ? null : "value",
    hasPhoto(item) ? null : "photo",
    evidenceCount > 0 ? null : "evidence",
  ].filter(Boolean);
  return missing.length === 0 ? null : `Needs ${missing.join(", ")}`;
}

export default function ClaimPackDraftScreen() {
  const { fileId, focusRoomId } = useLocalSearchParams<{
    fileId: string;
    focusRoomId?: string;
  }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<BuilderStage>("scope");
  const [selection, setSelection] = useState<ClaimPackSelection | null>(null);
  const [roomDraftIds, setRoomDraftIds] = useState<Set<string>>(new Set());
  const [didApplyFocusRoom, setDidApplyFocusRoom] = useState(false);

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
    staleTime: 0,
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

  const property = propertyQuery.data ?? null;
  const rooms = roomsQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const evidenceCounts = evidenceCountsQuery.data ?? {};

  useEffect(() => {
    if (!focusRoomId || didApplyFocusRoom || !roomsQuery.isSuccess) return;
    setSelection(createRoomsOnlyClaimPackSelection([focusRoomId]));
    setRoomDraftIds(new Set([focusRoomId]));
    setStage("draft");
    setDidApplyFocusRoom(true);
  }, [didApplyFocusRoom, focusRoomId, roomsQuery.isSuccess]);

  const effectiveSelection = selection ?? createRoomsOnlyClaimPackSelection([]);
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

  const selectedRooms = useMemo(
    () => rooms.filter((room) => effectiveSelection.selectedRoomIds.has(room.id)),
    [effectiveSelection.selectedRoomIds, rooms],
  );
  const selectedUnassignedItems = (itemsByRoomId.get(UNASSIGNED_SECTION_ID) ?? []).filter((item) =>
    effectiveSelection.selectedItemIds.has(item.id),
  );

  const isLoading = propertyQuery.isLoading || roomsQuery.isLoading || itemsQuery.isLoading;
  const error = propertyQuery.error ?? roomsQuery.error ?? itemsQuery.error ?? evidenceCountsQuery.error;
  const refetchAll = () => {
    void propertyQuery.refetch();
    void roomsQuery.refetch();
    void itemsQuery.refetch();
    void evidenceCountsQuery.refetch();
  };

  const startWholeProperty = () => {
    setSelection(createWholePropertyClaimPackSelection(rooms, items));
    setRoomDraftIds(new Set(rooms.map((room) => room.id)));
    setStage("draft");
  };

  const startByRoom = () => {
    setRoomDraftIds(new Set(effectiveSelection.selectedRoomIds));
    setStage("room_picker");
  };

  const continueWithRooms = () => {
    const selectedRoomIds = [...roomDraftIds];
    setSelection((current) => {
      const selectedItemIds = new Set<string>();
      for (const item of items) {
        if (current?.selectedItemIds.has(item.id) && item.room_id && roomDraftIds.has(item.room_id)) {
          selectedItemIds.add(item.id);
        }
      }
      return { selectedRoomIds: new Set(selectedRoomIds), selectedItemIds };
    });
    setStage("draft");
  };

  const toggleRoomDraft = (roomId: string) => {
    setRoomDraftIds((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

  const addRoomToDraft = () => {
    setRoomDraftIds(new Set(effectiveSelection.selectedRoomIds));
    setStage("room_picker");
  };

  const removeRoomFromDraft = (roomId: string) => {
    setSelection((current) => removeClaimPackRoom(current ?? effectiveSelection, roomId, items));
  };

  const selectRoomItems = (roomId: string) => {
    setSelection((current) => selectAllClaimPackItemsInRoom(current ?? effectiveSelection, roomId, items));
  };

  const clearRoomItems = (roomId: string) => {
    setSelection((current) => clearClaimPackItemsInRoom(current ?? effectiveSelection, roomId, items));
  };

  const toggleItem = (item: InventoryItem) => {
    setSelection((current) => toggleClaimPackItem(current ?? effectiveSelection, item, items));
  };

  const addItemManually = (room?: InventoryRoom) => {
    if (!property) return;
    router.push({
      pathname: "/(tabs)/add-item",
      params: {
        fileId,
        fileName: property.name,
        roomId: room?.id,
        roomName: room?.name,
        returnToClaimPack: "1",
      },
    } as Href);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Claim pack builder",
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
          message="Couldn’t load claim-pack builder"
          detail={error instanceof Error ? error.message : "Please try again."}
          onRetry={refetchAll}
        />
      ) : !property ? (
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
          <BuilderHero property={property} stage={stage} colors={colors} />

          {stage === "scope" ? (
            <ScopeChoice
              roomCount={rooms.length}
              itemCount={items.length}
              onWholeProperty={startWholeProperty}
              onChooseRooms={startByRoom}
              colors={colors}
            />
          ) : stage === "room_picker" ? (
            <RoomPicker
              rooms={rooms}
              itemsByRoomId={itemsByRoomId}
              roomDraftIds={roomDraftIds}
              onToggleRoom={toggleRoomDraft}
              onContinue={continueWithRooms}
              onBack={() => setStage(selection ? "draft" : "scope")}
              colors={colors}
            />
          ) : (
            <DraftReview
              property={property}
              rooms={selectedRooms}
              selectedUnassignedItems={selectedUnassignedItems}
              itemsByRoomId={itemsByRoomId}
              selection={effectiveSelection}
              summary={summary}
              evidenceCounts={evidenceCounts}
              onAddRoom={addRoomToDraft}
              onRemoveRoom={removeRoomFromDraft}
              onSelectRoomItems={selectRoomItems}
              onClearRoomItems={clearRoomItems}
              onToggleItem={toggleItem}
              onAddItem={addItemManually}
              colors={colors}
            />
          )}

          <View style={[styles.footerNotice, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
            <Feather name="shield" size={16} color={colors.primary} />
            <Text style={[styles.footerNoticeText, { color: colors.mutedForeground }]}>
              PDF export coming next. This preview does not create a file, upload anything, or change your records.
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

function BuilderHero({
  property,
  stage,
  colors,
}: {
  property: InventoryFile;
  stage: BuilderStage;
  colors: ReturnType<typeof useColors>;
}) {
  const step = stage === "scope" ? "Step 1 of 3" : stage === "room_picker" ? "Step 2 of 3" : "Draft review";
  return (
    <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
        <Feather name="file-text" size={22} color={colors.primary} />
      </View>
      <View style={styles.heroCopy}>
        <Text style={[styles.kicker, { color: colors.mutedForeground }]}>{step.toUpperCase()}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{property.name}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Build a claim-pack draft for selected property contents, photos and supporting evidence.
        </Text>
      </View>
    </View>
  );
}

function ScopeChoice({
  roomCount,
  itemCount,
  onWholeProperty,
  onChooseRooms,
  colors,
}: {
  roomCount: number;
  itemCount: number;
  onWholeProperty: () => void;
  onChooseRooms: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.sections}>
      <Text style={[styles.sectionHeading, { color: colors.foreground }]}>What do you want to prepare?</Text>
      <ChoiceCard
        icon="home"
        title="Whole property"
        subtitle={`Start with all ${formatCount(roomCount, "room")} and ${formatCount(itemCount, "item")} selected. You can remove anything before export.`}
        onPress={onWholeProperty}
        colors={colors}
      />
      <ChoiceCard
        icon="list"
        title="Choose by room"
        subtitle="Pick one or more rooms first, then choose only the items that belong in this claim pack."
        onPress={onChooseRooms}
        colors={colors}
      />
    </View>
  );
}

function ChoiceCard({
  icon,
  title,
  subtitle,
  onPress,
  colors,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceCard,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={[styles.choiceIcon, { backgroundColor: colors.accent }]}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.choiceCopy}>
        <Text style={[styles.choiceTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.choiceSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function RoomPicker({
  rooms,
  itemsByRoomId,
  roomDraftIds,
  onToggleRoom,
  onContinue,
  onBack,
  colors,
}: {
  rooms: InventoryRoom[];
  itemsByRoomId: Map<string, InventoryItem[]>;
  roomDraftIds: Set<string>;
  onToggleRoom: (roomId: string) => void;
  onContinue: () => void;
  onBack: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.sections}>
      <View style={styles.sectionTitleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionHeading, { color: colors.foreground }]}>Choose rooms</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Select the rooms involved in this claim-pack draft.
          </Text>
        </View>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Back</Text>
        </Pressable>
      </View>

      {rooms.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Feather name="home" size={24} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No rooms yet</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Add rooms to this property before choosing by room.</Text>
        </View>
      ) : (
        rooms.map((room) => {
          const roomItems = itemsByRoomId.get(room.id) ?? [];
          const selected = roomDraftIds.has(room.id);
          return (
            <Pressable
              key={room.id}
              onPress={() => onToggleRoom(room.id)}
              style={({ pressed }) => [
                styles.roomChoice,
                { backgroundColor: colors.card, borderColor: selected ? colors.primary : colors.border, borderRadius: colors.radius, opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <SelectionBox selected={selected} colors={colors} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.roomTitle, { color: colors.foreground }]}>{room.name}</Text>
                <Text style={[styles.roomSubtitle, { color: colors.mutedForeground }]}>{formatCount(roomItems.length, "item")} documented</Text>
              </View>
            </Pressable>
          );
        })
      )}

      <Pressable
        disabled={roomDraftIds.size === 0}
        onPress={onContinue}
        style={[
          styles.primaryButton,
          { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: roomDraftIds.size === 0 ? 0.45 : 1 },
        ]}
      >
        <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Continue with selected rooms</Text>
      </Pressable>
    </View>
  );
}

function DraftReview({
  property,
  rooms,
  selectedUnassignedItems,
  itemsByRoomId,
  selection,
  summary,
  evidenceCounts,
  onAddRoom,
  onRemoveRoom,
  onSelectRoomItems,
  onClearRoomItems,
  onToggleItem,
  onAddItem,
  colors,
}: {
  property: InventoryFile;
  rooms: InventoryRoom[];
  selectedUnassignedItems: InventoryItem[];
  itemsByRoomId: Map<string, InventoryItem[]>;
  selection: ClaimPackSelection;
  summary: ReturnType<typeof calculateClaimPackSummary>;
  evidenceCounts: Record<string, number>;
  onAddRoom: () => void;
  onRemoveRoom: (roomId: string) => void;
  onSelectRoomItems: (roomId: string) => void;
  onClearRoomItems: (roomId: string) => void;
  onToggleItem: (item: InventoryItem) => void;
  onAddItem: (room?: InventoryRoom) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.sections}>
      <SummaryCard property={property} summary={summary} colors={colors} />

      <View style={styles.actionRow}>
        <Pressable
          onPress={onAddRoom}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.border, borderRadius: colors.radius, backgroundColor: colors.card, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Feather name="plus" size={15} color={colors.primary} />
          <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Add another room</Text>
        </Pressable>
        <Pressable
          onPress={() => onAddItem(undefined)}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.border, borderRadius: colors.radius, backgroundColor: colors.card, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Feather name="edit-3" size={15} color={colors.primary} />
          <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Add item manually</Text>
        </Pressable>
      </View>

      {rooms.length === 0 && selectedUnassignedItems.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Feather name="list" size={24} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No rooms selected yet</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Add a room to start building this claim-pack draft.</Text>
        </View>
      ) : (
        <>
          {rooms.map((room) => (
            <DraftRoomSection
              key={room.id}
              room={room}
              items={itemsByRoomId.get(room.id) ?? []}
              selectedItemIds={selection.selectedItemIds}
              evidenceCounts={evidenceCounts}
              onRemoveRoom={() => onRemoveRoom(room.id)}
              onSelectAll={() => onSelectRoomItems(room.id)}
              onClear={() => onClearRoomItems(room.id)}
              onToggleItem={onToggleItem}
              onAddItem={() => onAddItem(room)}
              colors={colors}
            />
          ))}
          {selectedUnassignedItems.length > 0 ? (
            <UnassignedItemsSection
              items={selectedUnassignedItems}
              selectedItemIds={selection.selectedItemIds}
              evidenceCounts={evidenceCounts}
              onToggleItem={onToggleItem}
              colors={colors}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function SummaryCard({
  property,
  summary,
  colors,
}: {
  property: InventoryFile;
  summary: ReturnType<typeof calculateClaimPackSummary>;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Text style={[styles.kicker, { color: colors.mutedForeground }]}>DRAFT SUMMARY</Text>
      <Text style={[styles.summaryProperty, { color: colors.foreground }]}>{property.name}</Text>
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
      <Text style={[styles.draftStatus, { color: colors.mutedForeground }]}>Draft only · PDF export coming next</Text>
    </View>
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

function DraftRoomSection({
  room,
  items,
  selectedItemIds,
  evidenceCounts,
  onRemoveRoom,
  onSelectAll,
  onClear,
  onToggleItem,
  onAddItem,
  colors,
}: {
  room: InventoryRoom;
  items: InventoryItem[];
  selectedItemIds: Set<string>;
  evidenceCounts: Record<string, number>;
  onRemoveRoom: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleItem: (item: InventoryItem) => void;
  onAddItem: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const selectedCount = items.filter((item) => selectedItemIds.has(item.id)).length;
  return (
    <View style={[styles.roomCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={styles.roomHeader}>
        <View style={[styles.roomBadge, { backgroundColor: colors.accent }]}>
          <Feather name="home" size={14} color={colors.primary} />
        </View>
        <View style={styles.roomHeaderCopy}>
          <Text style={[styles.roomTitle, { color: colors.foreground }]}>{room.name}</Text>
          <Text style={[styles.roomSubtitle, { color: colors.mutedForeground }]}>
            {formatCount(selectedCount, "item")} selected of {items.length}
          </Text>
        </View>
        <Pressable onPress={onRemoveRoom} hitSlop={8}>
          <Text style={[styles.removeText, { color: colors.destructive }]}>Remove</Text>
        </Pressable>
      </View>
      <View style={[styles.roomTools, { borderTopColor: colors.border }]}>
        <Pressable onPress={onSelectAll} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Select all items</Text>
        </Pressable>
        <Pressable onPress={onClear} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Clear room</Text>
        </Pressable>
        <Pressable onPress={onAddItem} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Add item</Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <Text style={[styles.emptyRoomText, { color: colors.mutedForeground }]}>No documented items in this room yet. Use Add item to create one.</Text>
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
        <View style={[styles.roomBadge, { backgroundColor: colors.secondary }]}>
          <Feather name="box" size={14} color={colors.mutedForeground} />
        </View>
        <View style={styles.roomHeaderCopy}>
          <Text style={[styles.roomTitle, { color: colors.foreground }]}>Unassigned items</Text>
          <Text style={[styles.roomSubtitle, { color: colors.mutedForeground }]}>Selected items not linked to a room</Text>
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
  const warning = selected ? itemCompactWarning(item, evidenceCount) : null;
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
        {warning ? (
          <Text style={[styles.itemWarnings, { color: colors.warning }]} numberOfLines={1}>{warning}</Text>
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
  sections: { gap: 12 },
  sectionHeading: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sectionTitleRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  choiceCard: { borderWidth: 1, minHeight: 88, padding: 14, flexDirection: "row", gap: 12, alignItems: "center" },
  choiceIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  choiceCopy: { flex: 1, gap: 4 },
  choiceTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  choiceSubtitle: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  roomChoice: { borderWidth: 1, minHeight: 58, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", gap: 10, alignItems: "center" },
  summaryCard: { borderWidth: 1, padding: 14, gap: 12 },
  summaryProperty: { fontSize: 16, fontFamily: "Inter_700Bold" },
  summaryGrid: { flexDirection: "row", gap: 8 },
  summaryCell: { flex: 1, gap: 3 },
  summaryValue: { fontSize: 21, fontFamily: "Inter_700Bold" },
  summaryValueCompact: { fontSize: 16, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  readinessRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11, flexDirection: "row", gap: 7, alignItems: "center" },
  readinessText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  draftStatus: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  actionRow: { flexDirection: "row", gap: 9 },
  secondaryButton: { flex: 1, borderWidth: 1, minHeight: 42, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  secondaryButtonText: { fontSize: 12, fontFamily: "Inter_700Bold", textAlign: "center" },
  primaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  primaryButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  emptyCard: { borderWidth: 1, padding: 18, gap: 8, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  roomCard: { borderWidth: 1, overflow: "hidden" },
  roomHeader: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  roomBadge: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  roomHeaderCopy: { flex: 1, gap: 2 },
  roomTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  roomSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  removeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  roomTools: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  roomToolButton: { paddingVertical: 2 },
  linkText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  emptyRoomText: { paddingHorizontal: 14, paddingBottom: 14, fontSize: 12, fontFamily: "Inter_400Regular" },
  itemList: { paddingHorizontal: 14 },
  itemRow: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: 58, paddingVertical: 10, flexDirection: "row", gap: 10, alignItems: "center" },
  itemCopy: { flex: 1, gap: 3 },
  itemTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  itemMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  itemWarnings: { fontSize: 11, fontFamily: "Inter_500Medium" },
  selectionBox: { borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  footerNotice: { padding: 13, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  footerNoticeText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  disabledButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, opacity: 0.82 },
  disabledButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
