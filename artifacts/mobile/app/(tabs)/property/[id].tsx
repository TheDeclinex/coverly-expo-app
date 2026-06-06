import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
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
import { calcPropertyStats } from "@/lib/dashboard-stats";
import { formatCurrency } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryItem, InventoryRoom } from "@/types";

const ROOM_ICONS: Record<string, string> = {
  kitchen: "coffee",
  bedroom: "moon",
  bathroom: "droplet",
  living_room: "tv",
  lounge: "tv",
  dining: "scissors",
  office: "monitor",
  garage: "truck",
  garden: "sun",
  utility: "tool",
  hallway: "navigation",
  loft: "archive",
};

function roomIcon(roomType: string | null): string {
  if (!roomType) return "square";
  const key = roomType.toLowerCase().replace(/\s+/g, "_");
  return ROOM_ICONS[key] ?? "square";
}

function MiniBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <View
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: "#E2E8F0",
        overflow: "hidden",
        flex: 1,
      }}
    >
      <View
        style={{
          height: 6,
          borderRadius: 3,
          width: `${pct * 100}%` as any,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function CoverageBar({
  percent,
  colors,
}: {
  percent: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const clamped = Math.min(percent, 100);
  const isHigh = percent >= 90;
  const fillColor = isHigh ? colors.warning : colors.primary;
  const label =
    percent >= 100
      ? "Recorded cover reached — review with your insurer"
      : percent >= 90
        ? "Approaching recorded cover value"
        : `${Math.round(percent)}% of recorded cover value`;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_400Regular",
            color: colors.mutedForeground,
          }}
        >
          Recorded contents value vs cover
        </Text>
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_500Medium",
            color: isHigh ? colors.warning : colors.mutedForeground,
          }}
        >
          {Math.round(percent)}%
        </Text>
      </View>
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: 8,
            borderRadius: 4,
            width: `${clamped}%` as any,
            backgroundColor: fillColor,
          }}
        />
      </View>
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_400Regular",
          color: colors.mutedForeground,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function RoomCard({
  item,
  itemCount,
  totalValue,
  maxValue,
  colors,
}: {
  item: InventoryRoom;
  itemCount: number;
  totalValue: number;
  maxValue: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const handlePress = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/room/[id]",
      params: { id: item.id, name: item.name, fileId: item.file_id },
    });
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.cardLeft}>
        {item.cover_photo_url ? (
          <Image
            source={{ uri: item.cover_photo_url }}
            style={styles.roomThumb}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.roomThumbPlaceholder,
              { backgroundColor: colors.secondary },
            ]}
          >
            <Feather
              name={roomIcon(item.room_type) as any}
              size={20}
              color={colors.primary}
            />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardRow}>
          <Text
            style={[styles.cardName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Feather
            name="chevron-right"
            size={16}
            color={colors.mutedForeground}
          />
        </View>
        <View style={styles.cardMeta}>
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </Text>
          <Text style={[styles.metaValue, { color: colors.primary }]}>
            {formatCurrency(totalValue || null)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <MiniBar value={totalValue} max={maxValue} color={colors.primary} />
        </View>
      </View>
    </Pressable>
  );
}

export default function PropertyDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    data: rooms,
    isLoading: roomsLoading,
    error: roomsError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["rooms", id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_rooms")
        .select("*")
        .eq("file_id", id)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InventoryRoom[];
    },
    enabled: !!session && !!id,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["property-items", id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(
          "id, file_id, room_id, name, estimated_price, unit_estimated_price, quantity, image_url, photo_url"
        )
        .eq("file_id", id);
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
    enabled: !!session && !!id,
  });

  const { data: property } = useQuery({
    queryKey: ["property", id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as InventoryFile;
    },
    enabled: !!session && !!id,
  });

  const stats = useMemo(() => {
    if (!property || !rooms || !items) return null;
    return calcPropertyStats(property, rooms, items);
  }, [property, rooms, items]);

  const maxRoomValue = stats
    ? Math.max(...stats.roomStats.map((r) => r.totalValue), 1)
    : 1;

  const isLoading = roomsLoading || itemsLoading;

  const renderHeader = () => {
    if (!stats) return null;
    return (
      <View style={{ gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <View
          style={[
            styles.statsCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            PROPERTY SUMMARY
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={[styles.bigValue, { color: colors.foreground }]}>
                {formatCurrency(stats.totalValue || null)}
              </Text>
              <Text style={[styles.bigLabel, { color: colors.mutedForeground }]}>
                Inventory value
              </Text>
            </View>
            <View
              style={[styles.statDivider, { backgroundColor: colors.border }]}
            />
            <View style={styles.statCell}>
              <Text style={[styles.bigValue, { color: colors.foreground }]}>
                {stats.itemCount}
              </Text>
              <Text style={[styles.bigLabel, { color: colors.mutedForeground }]}>
                Items
              </Text>
            </View>
            <View
              style={[styles.statDivider, { backgroundColor: colors.border }]}
            />
            <View style={styles.statCell}>
              <Text style={[styles.bigValue, { color: colors.foreground }]}>
                {stats.roomCount}
              </Text>
              <Text style={[styles.bigLabel, { color: colors.mutedForeground }]}>
                Rooms
              </Text>
            </View>
          </View>

          {stats.coveragePercent != null && (
            <View style={{ marginTop: 12 }}>
              <CoverageBar percent={stats.coveragePercent} colors={colors} />
            </View>
          )}

          {stats.itemCount > 0 && (
            <View style={styles.claimRow}>
              <View style={styles.claimStat}>
                <Feather
                  name="camera"
                  size={14}
                  color={
                    stats.photoPercent >= 80
                      ? colors.success
                      : colors.mutedForeground
                  }
                />
                <Text
                  style={[styles.claimText, { color: colors.mutedForeground }]}
                >
                  {Math.round(stats.photoPercent)}% have photos
                </Text>
              </View>
              <View style={styles.claimStat}>
                <Feather
                  name="tag"
                  size={14}
                  color={
                    stats.valuePercent >= 80
                      ? colors.success
                      : colors.mutedForeground
                  }
                />
                <Text
                  style={[styles.claimText, { color: colors.mutedForeground }]}
                >
                  {Math.round(stats.valuePercent)}% valued
                </Text>
              </View>
              {stats.itemsNeedingReview > 0 && (
                <View style={styles.claimStat}>
                  <Feather
                    name="alert-circle"
                    size={14}
                    color={colors.warning}
                  />
                  <Text
                    style={[styles.claimText, { color: colors.mutedForeground }]}
                  >
                    {stats.itemsNeedingReview} need review
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(tabs)/add-item",
                params: { fileId: id, fileName: name },
              })
            }
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="plus" size={16} color={colors.primaryForeground} />
            <Text
              style={[styles.actionBtnText, { color: colors.primaryForeground }]}
            >
              Add item
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionHeading, { color: colors.foreground }]}>
          Rooms
        </Text>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: name ?? "Property" }} />
      {isLoading ? (
        <LoadingState />
      ) : roomsError ? (
        <ErrorState
          message="Failed to load rooms"
          detail={(roomsError as Error).message}
          onRetry={refetch}
        />
      ) : (
        <FlatList
          data={stats ? stats.roomStats.map((rs) => rs) : []}
          keyExtractor={(rs) => rs.room.id}
          renderItem={({ item: rs }) => (
            <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
              <RoomCard
                item={rs.room}
                itemCount={rs.itemCount}
                totalValue={rs.totalValue}
                maxValue={maxRoomValue}
                colors={colors}
              />
            </View>
          )}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 24,
            ...(Platform.OS === "web" ? { paddingTop: 0 } : {}),
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
              <EmptyState
                icon="layers"
                title="No rooms found"
                subtitle="Rooms will appear here once added"
              />
            </View>
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  statsCard: {
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sectionHeading: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
    marginBottom: 2,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statCell: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statDivider: {
    width: 1,
    height: 36,
    marginHorizontal: 4,
  },
  bigValue: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  bigLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  claimRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.08)",
  },
  claimStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  claimText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
  },
  cardLeft: {},
  roomThumb: {
    width: 72,
    height: 72,
  },
  roomThumbPlaceholder: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    padding: 12,
    gap: 2,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    marginRight: 4,
  },
  cardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  metaValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
