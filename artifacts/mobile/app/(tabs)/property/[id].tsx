import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { calcPropertyStats, type RoomStat } from "@/lib/dashboard-stats";
import { formatCurrency } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryItem, InventoryRoom } from "@/types";

const BRAND_TEAL = "#1D9E75";
const BRAND_AMBER = "#D97706";
const BRAND_DANGER = "#B91C1C";
const BRAND_BORDER = "#DDE7E3";
const BRAND_DARK = "#085041";

function coverageColor(percent: number): string {
  if (percent >= 90) return BRAND_DANGER;
  if (percent >= 70) return BRAND_AMBER;
  return BRAND_TEAL;
}

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

function RadialCoverage({
  percent,
  size = 88,
  strokeWidth = 9,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.min(percent, 100) / 100) * circumference;
  const stroke = coverageColor(percent);

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={BRAND_BORDER}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <Text
        style={{
          fontSize: 14,
          fontFamily: "Inter_700Bold",
          color: stroke,
          textAlign: "center",
        }}
      >
        {Math.round(Math.min(percent, 999))}%
      </Text>
      <Text
        style={{
          fontSize: 8,
          fontFamily: "Inter_400Regular",
          color: "#64736F",
          textAlign: "center",
        }}
      >
        of cover
      </Text>
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
  const fill = coverageColor(percent);
  const label =
    percent >= 100
      ? "Recorded cover value reached — review with your insurer if needed"
      : percent >= 90
        ? "Approaching recorded cover value — review with your insurer if needed"
        : percent >= 70
          ? "Moderate usage of recorded cover value"
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
            fontFamily: "Inter_600SemiBold",
            color: fill,
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
            backgroundColor: fill,
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

function RoomBarsSection({
  roomStats,
  colors,
}: {
  roomStats: RoomStat[];
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  if (roomStats.length === 0) return null;
  const top = roomStats.slice(0, 8);
  const maxValue = Math.max(...top.map((r) => r.totalValue), 1);
  const maxCount = Math.max(...top.map((r) => r.itemCount), 1);

  return (
    <View
      style={[
        styles.statsCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          gap: 0,
        },
      ]}
    >
      <Text
        style={[
          styles.sectionLabel,
          { color: colors.mutedForeground, marginBottom: 10 },
        ]}
      >
        VALUE BY ROOM
      </Text>
      {top.map((rs) => (
        <View key={`${rs.room.id}-val`} style={styles.barRow}>
          <Text
            style={[styles.barLabel, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {rs.room.name}
          </Text>
          <View
            style={[styles.barTrack, { backgroundColor: colors.border }]}
          >
            <View
              style={[
                styles.barFill,
                {
                  width: `${(rs.totalValue / maxValue) * 100}%` as any,
                  backgroundColor: BRAND_TEAL,
                },
              ]}
            />
          </View>
          <Text
            style={[styles.barMeta, { color: colors.mutedForeground }]}
          >
            {formatCurrency(rs.totalValue || null)}
          </Text>
        </View>
      ))}

      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
          marginVertical: 14,
        }}
      />

      <Text
        style={[
          styles.sectionLabel,
          { color: colors.mutedForeground, marginBottom: 10 },
        ]}
      >
        ITEMS BY ROOM
      </Text>
      {top.map((rs) => (
        <View key={`${rs.room.id}-cnt`} style={styles.barRow}>
          <Text
            style={[styles.barLabel, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {rs.room.name}
          </Text>
          <View
            style={[styles.barTrack, { backgroundColor: colors.border }]}
          >
            <View
              style={[
                styles.barFill,
                {
                  width: `${(rs.itemCount / maxCount) * 100}%` as any,
                  backgroundColor: BRAND_DARK,
                },
              ]}
            />
          </View>
          <Text
            style={[styles.barMeta, { color: colors.mutedForeground }]}
          >
            {rs.itemCount} {rs.itemCount === 1 ? "item" : "items"}
          </Text>
        </View>
      ))}
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

  const pct = maxValue > 0 ? Math.min(totalValue / maxValue, 1) : 0;

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
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <View
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: BRAND_BORDER,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 4,
                borderRadius: 2,
                width: `${pct * 100}%` as any,
                backgroundColor: BRAND_TEAL,
              }}
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function CoverAmountModal({
  visible,
  current,
  onClose,
  onSave,
  colors,
}: {
  visible: boolean;
  current: number | null;
  onClose: () => void;
  onSave: (value: number | null) => Promise<void>;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const insets = useSafeAreaInsets();
  const [raw, setRaw] = useState(
    current != null ? String(current) : ""
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : parseFloat(trimmed.replace(/,/g, ""));
    if (trimmed !== "" && (isNaN(parsed!) || parsed! < 0)) {
      Alert.alert("Invalid amount", "Please enter a valid positive number.");
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      onClose();
    } catch {
      Alert.alert("Error", "Failed to save cover amount. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = () => {
    setRaw(current != null ? String(current) : "");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={handleOpen}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
        onPress={onClose}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 24,
            paddingBottom: insets.bottom + 24,
            gap: 16,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontFamily: "Inter_700Bold",
                color: colors.foreground,
              }}
            >
              Contents cover amount
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text
            style={{
              fontSize: 13,
              fontFamily: "Inter_400Regular",
              color: colors.mutedForeground,
              lineHeight: 19,
            }}
          >
            Enter the contents insurance sum insured from your policy document.
            This unlocks the coverage arc and bar on this property.
          </Text>

          <View style={{ gap: 6 }}>
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                color: colors.mutedForeground,
                letterSpacing: 0.3,
              }}
            >
              Cover amount (£)
            </Text>
            <TextInput
              value={raw}
              onChangeText={setRaw}
              placeholder="e.g. 50000"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              autoFocus
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: colors.radius,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                fontFamily: "Inter_400Regular",
                color: colors.foreground,
                backgroundColor: colors.background,
              }}
            />
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: colors.radius,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Inter_600SemiBold",
                  color: colors.foreground,
                }}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: colors.radius,
                backgroundColor: colors.primary,
                alignItems: "center",
                opacity: pressed || saving ? 0.7 : 1,
              })}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text
                  style={{
                    fontSize: 15,
                    fontFamily: "Inter_600SemiBold",
                    color: colors.primaryForeground,
                  }}
                >
                  Save
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function PropertyDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [coverModalVisible, setCoverModalVisible] = useState(false);

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

  const saveCoverAmount = async (value: number | null) => {
    const { error } = await supabase
      .from("inventory_files")
      .update({ contents_sum_insured: value })
      .eq("id", id);
    if (error) throw error;
    await queryClient.invalidateQueries({
      queryKey: ["property", id, session?.user.id],
    });
  };

  const renderHeader = () => {
    if (!stats) return null;
    return (
      <View style={{ gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        {/* SUMMARY CARD */}
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

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
              marginTop: 4,
            }}
          >
            {/* Stats column */}
            <View style={{ flex: 1, gap: 10 }}>
              <View>
                <Text style={[styles.bigValue, { color: colors.foreground }]}>
                  {formatCurrency(stats.totalValue || null)}
                </Text>
                <Text
                  style={[styles.bigLabel, { color: colors.mutedForeground }]}
                >
                  Recorded contents value
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 20 }}>
                <View>
                  <Text
                    style={[styles.midValue, { color: colors.foreground }]}
                  >
                    {stats.itemCount}
                  </Text>
                  <Text
                    style={[styles.bigLabel, { color: colors.mutedForeground }]}
                  >
                    Items
                  </Text>
                </View>
                <View>
                  <Text
                    style={[styles.midValue, { color: colors.foreground }]}
                  >
                    {stats.roomCount}
                  </Text>
                  <Text
                    style={[styles.bigLabel, { color: colors.mutedForeground }]}
                  >
                    Rooms
                  </Text>
                </View>
              </View>
            </View>

            {/* Radial coverage arc or set-cover CTA */}
            {stats.coveragePercent != null ? (
              <Pressable
                onPress={() => setCoverModalVisible(true)}
                style={{ alignItems: "center" }}
                hitSlop={8}
              >
                <RadialCoverage percent={stats.coveragePercent} />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                    marginTop: 4,
                  }}
                >
                  <Feather
                    name="edit-2"
                    size={10}
                    color={colors.mutedForeground}
                  />
                  <Text
                    style={{
                      fontSize: 10,
                      fontFamily: "Inter_400Regular",
                      color: colors.mutedForeground,
                    }}
                  >
                    Edit cover
                  </Text>
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setCoverModalVisible(true)}
                style={({ pressed }) => ({
                  alignItems: "center",
                  justifyContent: "center",
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  borderWidth: 2,
                  borderColor: colors.border,
                  borderStyle: "dashed",
                  gap: 4,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Feather name="shield" size={20} color={colors.mutedForeground} />
                <Text
                  style={{
                    fontSize: 9,
                    fontFamily: "Inter_500Medium",
                    color: colors.mutedForeground,
                    textAlign: "center",
                    lineHeight: 12,
                  }}
                >
                  Set{"\n"}cover
                </Text>
              </Pressable>
            )}
          </View>

          {stats.coveragePercent != null && (
            <View style={{ marginTop: 14 }}>
              <CoverageBar percent={stats.coveragePercent} colors={colors} />
            </View>
          )}

          {stats.coveragePercent == null && (
            <Pressable
              onPress={() => setCoverModalVisible(true)}
              style={({ pressed }) => ({
                marginTop: 10,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: colors.radius,
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Feather name="shield" size={14} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: "Inter_600SemiBold",
                    color: colors.foreground,
                  }}
                >
                  Set your contents cover amount
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: "Inter_400Regular",
                    color: colors.mutedForeground,
                    marginTop: 1,
                  }}
                >
                  Unlocks the coverage arc and bar
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
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
                  {Math.round(stats.photoPercent)}% photos
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
                    style={[
                      styles.claimText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {stats.itemsNeedingReview} need review
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* ROOM DISTRIBUTION BARS */}
        {stats.roomStats.length > 0 && (
          <RoomBarsSection roomStats={stats.roomStats} colors={colors} />
        )}

        {/* ACTION BUTTONS */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(tabs)/scan",
                params: { fileId: id, fileName: name },
              })
            }
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
                flex: 1,
              },
            ]}
          >
            <Feather name="zap" size={16} color={colors.primaryForeground} />
            <Text
              style={[styles.actionBtnText, { color: colors.primaryForeground }]}
            >
              Scan items
            </Text>
          </Pressable>
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
                backgroundColor: colors.card,
                borderRadius: colors.radius,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
                flex: 1,
              },
            ]}
          >
            <Feather name="plus" size={16} color={colors.foreground} />
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>
              Add manually
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
      <CoverAmountModal
        visible={coverModalVisible}
        current={property?.contents_sum_insured ?? null}
        onClose={() => setCoverModalVisible(false)}
        onSave={saveCoverAmount}
        colors={colors}
      />
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
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  midValue: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  bigLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  claimRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BRAND_BORDER,
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
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  barLabel: {
    width: 80,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  barMeta: {
    width: 62,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
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
