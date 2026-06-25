import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, router, type Href, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  buildClaimPackGeneratePayload,
  calculateClaimPackSummary,
  clearClaimPackItemsInRoom,
  createClaimPackClientDraftId,
  createRoomsOnlyClaimPackSelection,
  createWholePropertyClaimPackSelection,
  loadClaimPackDraftSnapshot,
  removeClaimPackRoom,
  saveClaimPackDraftSnapshot,
  selectClaimPackItem,
  selectAllClaimPackItemsInRoom,
  toggleClaimPackItem,
  type ClaimPackScope,
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
  ].filter((chip): chip is string => Boolean(chip));
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
  const { fileId, focusRoomId, newItemId, claimDraftId } = useLocalSearchParams<{
    fileId: string;
    focusRoomId?: string;
    newItemId?: string;
    claimDraftId?: string;
  }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [stage, setStage] = useState<BuilderStage>("scope");
  const [selection, setSelection] = useState<ClaimPackSelection | null>(null);
  const [roomDraftIds, setRoomDraftIds] = useState<Set<string>>(new Set());
  const [didApplyFocusRoom, setDidApplyFocusRoom] = useState(false);
  const [scope, setScope] = useState<ClaimPackScope>("selected_rooms");
  const [claimNote, setClaimNote] = useState("");
  const [clientDraftId] = useState(() => claimDraftId ?? createClaimPackClientDraftId());
  const [managedRoomId, setManagedRoomId] = useState<string | null>(null);
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);

  useEffect(() => {
    if (stage !== "draft" || !managedRoomId) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [managedRoomId, stage]);

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
    if (!focusRoomId || didApplyFocusRoom || !roomsQuery.isSuccess || !itemsQuery.isSuccess) return;
    const snapshot = loadClaimPackDraftSnapshot(clientDraftId);
    const addedItem = newItemId ? items.find((item) => item.id === newItemId) : null;
    const baseSelection = snapshot?.selection ?? createRoomsOnlyClaimPackSelection([focusRoomId]);
    const focusedSelection = addedItem
      ? selectClaimPackItem(baseSelection, addedItem)
      : baseSelection;
    if (snapshot) {
      setScope(snapshot.scope);
      setClaimNote(snapshot.claimNote);
    }
    setSelection(focusedSelection);
    setRoomDraftIds(new Set(focusedSelection.selectedRoomIds));
    setManagedRoomId(focusRoomId);
    setHighlightItemId(newItemId ?? null);
    setStage("draft");
    setDidApplyFocusRoom(true);
  }, [clientDraftId, didApplyFocusRoom, focusRoomId, items, itemsQuery.isSuccess, newItemId, roomsQuery.isSuccess]);

  const effectiveSelection = selection ?? createRoomsOnlyClaimPackSelection([]);
  const summary = calculateClaimPackSummary({
    rooms,
    items,
    evidenceCountsByItemId: evidenceCounts,
    selection: effectiveSelection,
  });
  const futureGeneratePayload = property
    ? buildClaimPackGeneratePayload({
        propertyId: property.id,
        selection: effectiveSelection,
        scope,
        clientDraftId,
        claimNote,
      })
    : null;

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
    setScope("whole_property");
    setSelection(createWholePropertyClaimPackSelection(rooms, items));
    setRoomDraftIds(new Set(rooms.map((room) => room.id)));
    setManagedRoomId(null);
    setStage("draft");
  };

  const startByRoom = () => {
    setScope("selected_rooms");
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
    setScope("selected_rooms");
    setManagedRoomId(null);
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
    setManagedRoomId(null);
    setStage("room_picker");
  };

  const removeRoomFromDraft = (roomId: string) => {
    setSelection((current) => removeClaimPackRoom(current ?? effectiveSelection, roomId, items));
    setManagedRoomId((current) => (current === roomId ? null : current));
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
    saveClaimPackDraftSnapshot(clientDraftId, {
      selection: effectiveSelection,
      scope,
      claimNote,
      managedRoomId: room?.id ?? managedRoomId,
    });
    router.push({
      pathname: "/(tabs)/add-item",
      params: {
        fileId,
        fileName: property.name,
        roomId: room?.id,
        roomName: room?.name,
        returnToClaimPack: "1",
        claimDraftId: clientDraftId,
      },
    } as Href);
  };

  const enterRoomSelectionMode = (roomId: string | null) => {
    setManagedRoomId(roomId);
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
          ref={scrollRef}
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
              claimNote={claimNote}
              onChangeClaimNote={setClaimNote}
              managedRoomId={managedRoomId}
              onManageRoom={enterRoomSelectionMode}
              highlightItemId={highlightItemId}
              onAddRoom={addRoomToDraft}
              onRemoveRoom={removeRoomFromDraft}
              onSelectRoomItems={selectRoomItems}
              onClearRoomItems={clearRoomItems}
              onToggleItem={toggleItem}
              onAddItem={addItemManually}
              colors={colors}
            />
          )}

          {!managedRoomId ? (
            <>
              <View style={[styles.footerNotice, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
                <Feather name="shield" size={16} color={colors.primary} />
                <Text style={[styles.footerNoticeText, { color: colors.mutedForeground }]}>
                  PDF export coming next. This preview does not create a file, upload anything, or change your records.
                </Text>
              </View>

              <Pressable
                disabled
                accessibilityHint={`Draft includes ${futureGeneratePayload?.selectedItemIds.length ?? 0} selected items.`}
                style={[styles.disabledButton, { backgroundColor: colors.border, borderRadius: colors.radius }]}
              >
                <Feather name="download" size={16} color={colors.mutedForeground} />
                <Text style={[styles.disabledButtonText, { color: colors.mutedForeground }]}>Generate PDF — coming next</Text>
              </Pressable>
            </>
          ) : null}
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
  claimNote,
  onChangeClaimNote,
  managedRoomId,
  onManageRoom,
  highlightItemId,
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
  claimNote: string;
  onChangeClaimNote: (value: string) => void;
  managedRoomId: string | null;
  onManageRoom: (roomId: string | null) => void;
  highlightItemId: string | null;
  onAddRoom: () => void;
  onRemoveRoom: (roomId: string) => void;
  onSelectRoomItems: (roomId: string) => void;
  onClearRoomItems: (roomId: string) => void;
  onToggleItem: (item: InventoryItem) => void;
  onAddItem: (room?: InventoryRoom) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const managedRoom = rooms.find((room) => room.id === managedRoomId) ?? null;
  if (managedRoom) {
    return (
      <View style={styles.sections}>
        <ManageRoomPanel
          room={managedRoom}
          items={itemsByRoomId.get(managedRoom.id) ?? []}
          selectedItemIds={selection.selectedItemIds}
          evidenceCounts={evidenceCounts}
          highlightItemId={highlightItemId}
          onBack={() => onManageRoom(null)}
          onSelectAll={() => onSelectRoomItems(managedRoom.id)}
          onClear={() => onClearRoomItems(managedRoom.id)}
          onToggleItem={onToggleItem}
          onAddItem={() => onAddItem(managedRoom)}
          colors={colors}
        />
      </View>
    );
  }

  return (
    <View style={styles.sections}>
      <SummaryCard property={property} summary={summary} colors={colors} />
      <MissingInfoBanner summary={summary} colors={colors} />
      <ClaimNoteCard claimNote={claimNote} onChangeClaimNote={onChangeClaimNote} colors={colors} />

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
          onPress={() => onAddItem(rooms[0])}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.border, borderRadius: colors.radius, backgroundColor: colors.card, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Feather name="edit-3" size={15} color={colors.primary} />
          <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Add missing item</Text>
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
          <View style={styles.sectionTitleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionHeading, { color: colors.foreground }]}>Rooms in this draft</Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                Choose which items from each room should be included.
              </Text>
            </View>
          </View>
          {rooms.map((room) => (
            <DraftRoomCard
              key={room.id}
              room={room}
              items={itemsByRoomId.get(room.id) ?? []}
              selectedItemIds={selection.selectedItemIds}
              evidenceCounts={evidenceCounts}
              onRemoveRoom={() => onRemoveRoom(room.id)}
              onSelectAll={() => onSelectRoomItems(room.id)}
              onClear={() => onClearRoomItems(room.id)}
              onManageItems={() => onManageRoom(room.id)}
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

function MissingInfoBanner({
  summary,
  colors,
}: {
  summary: ReturnType<typeof calculateClaimPackSummary>;
  colors: ReturnType<typeof useColors>;
}) {
  const missingTotal = summary.missingValueCount + summary.missingPhotoCount + summary.missingEvidenceCount;
  if (missingTotal === 0) return null;
  const chips = [
    summary.missingValueCount > 0 ? `${summary.missingValueCount} no value` : null,
    summary.missingPhotoCount > 0 ? `${summary.missingPhotoCount} no photo` : null,
    summary.missingEvidenceCount > 0 ? `${summary.missingEvidenceCount} no evidence` : null,
  ].filter(Boolean);

  return (
    <View style={[styles.warningCard, { backgroundColor: colors.card, borderColor: colors.warning, borderRadius: colors.radius }]}>
      <View style={styles.warningHeader}>
        <Feather name="alert-circle" size={16} color={colors.warning} />
        <Text style={[styles.warningTitle, { color: colors.foreground }]}>Items with missing info</Text>
      </View>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        Your pack is still usable without these — you can review them room by room.
      </Text>
      <View style={styles.warningChips}>
        {chips.map((chip) => (
          <Text key={chip} style={[styles.warningChip, { backgroundColor: colors.accent, color: colors.warning }]}>
            {chip}
          </Text>
        ))}
      </View>
    </View>
  );
}

function ClaimNoteCard({
  claimNote,
  onChangeClaimNote,
  colors,
}: {
  claimNote: string;
  onChangeClaimNote: (value: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.noteCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Text style={[styles.noteTitle, { color: colors.foreground }]}>Claim context</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        Optional note for the future PDF, such as “storm damage in lounge” or “theft from garage”.
      </Text>
      <TextInput
        value={claimNote}
        onChangeText={onChangeClaimNote}
        placeholder="Add a short claim note"
        placeholderTextColor={colors.mutedForeground}
        multiline
        style={[
          styles.noteInput,
          {
            borderColor: colors.border,
            borderRadius: colors.radius,
            color: colors.foreground,
            backgroundColor: colors.background,
          },
        ]}
      />
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

function DraftRoomCard({
  room,
  items,
  selectedItemIds,
  evidenceCounts,
  onRemoveRoom,
  onSelectAll,
  onClear,
  onManageItems,
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
  onManageItems: () => void;
  onAddItem: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const selectedItems = items.filter((item) => selectedItemIds.has(item.id));
  const selectedCount = selectedItems.length;
  const selectedValue = selectedItems.reduce((total, item) => total + getItemTotalValue(item), 0);
  const evidenceCount = selectedItems.reduce((total, item) => total + (evidenceCounts[item.id] ?? 0), 0);
  const missingCount = selectedItems.reduce(
    (total, item) =>
      total +
      (hasValue(item) ? 0 : 1) +
      (hasPhoto(item) ? 0 : 1) +
      ((evidenceCounts[item.id] ?? 0) > 0 ? 0 : 1),
    0,
  );
  return (
    <View style={[styles.roomCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={styles.roomHeader}>
        <View style={[styles.roomBadge, { backgroundColor: colors.accent }]}>
          <Feather name="home" size={14} color={colors.primary} />
        </View>
        <View style={styles.roomHeaderCopy}>
          <Text style={[styles.roomTitle, { color: colors.foreground }]}>{room.name}</Text>
          <Text style={[styles.roomSubtitle, { color: colors.mutedForeground }]}>
            {formatCount(selectedCount, "item")} selected of {items.length} · {formatCurrency(selectedValue)} est.
          </Text>
          <Text style={[styles.roomSubtitle, { color: colors.mutedForeground }]}>
            {formatCount(evidenceCount, "evidence file", "evidence files")}
            {missingCount > 0 ? ` · ${formatCount(missingCount, "missing detail", "missing details")}` : ""}
          </Text>
        </View>
        <Pressable onPress={onRemoveRoom} hitSlop={8}>
          <Text style={[styles.removeText, { color: colors.mutedForeground }]}>Exclude room</Text>
        </Pressable>
      </View>
      <View style={[styles.roomTools, { borderTopColor: colors.border }]}>
        <Pressable onPress={onManageItems} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Select items</Text>
        </Pressable>
        <Pressable onPress={onSelectAll} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Select all items</Text>
        </Pressable>
        <Pressable onPress={onClear} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Clear selection</Text>
        </Pressable>
        <Pressable onPress={onAddItem} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Add missing item</Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <Text style={[styles.emptyRoomText, { color: colors.mutedForeground }]}>No documented items in this room yet. Use Add item to create one.</Text>
      ) : null}
    </View>
  );
}

function ManageRoomPanel({
  room,
  items,
  selectedItemIds,
  evidenceCounts,
  highlightItemId,
  onBack,
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
  highlightItemId: string | null;
  onBack: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleItem: (item: InventoryItem) => void;
  onAddItem: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.manageCard, { backgroundColor: colors.card, borderColor: colors.primary, borderRadius: colors.radius }]}>
      <View style={styles.manageHeader}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.backPill}>
          <Feather name="chevron-left" size={15} color={colors.primary} />
          <Text style={[styles.linkText, { color: colors.primary }]}>Back to draft</Text>
        </Pressable>
        <Text style={[styles.manageTitle, { color: colors.foreground }]}>Select {room.name} items</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Choose only the items from this room that belong in the claim pack.
        </Text>
      </View>
      <View style={[styles.roomTools, { borderTopColor: colors.border }]}>
        <Pressable onPress={onSelectAll} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Select all</Text>
        </Pressable>
        <Pressable onPress={onClear} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Clear selection</Text>
        </Pressable>
        <Pressable onPress={onAddItem} style={styles.roomToolButton}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Add missing item</Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <View style={styles.manageEmpty}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No items in this room yet</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Add an item manually to include it in this draft.</Text>
        </View>
      ) : (
        <View style={styles.itemList}>
          {items.map((item) => (
            <ClaimPackItemRow
              key={item.id}
              item={item}
              selected={selectedItemIds.has(item.id)}
              evidenceCount={evidenceCounts[item.id] ?? 0}
              highlighted={highlightItemId === item.id}
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
  highlighted = false,
  onPress,
  colors,
}: {
  item: InventoryItem;
  selected: boolean;
  evidenceCount: number;
  highlighted?: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const warning = selected ? itemCompactWarning(item, evidenceCount) : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.itemRow,
        {
          borderTopColor: colors.border,
          backgroundColor: highlighted ? colors.accent : "transparent",
          opacity: pressed ? 0.72 : 1,
        },
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
  warningCard: { borderWidth: 1, padding: 13, gap: 9 },
  warningHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  warningTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  warningChips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  warningChip: { overflow: "hidden", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontFamily: "Inter_700Bold" },
  noteCard: { borderWidth: 1, padding: 13, gap: 9 },
  noteTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  noteInput: { borderWidth: 1, minHeight: 74, paddingHorizontal: 11, paddingVertical: 9, textAlignVertical: "top", fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
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
  manageCard: { borderWidth: 1, overflow: "hidden" },
  manageHeader: { paddingHorizontal: 14, paddingVertical: 13, gap: 5 },
  backPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 2, paddingBottom: 3 },
  manageTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  manageEmpty: { padding: 14, gap: 5 },
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
