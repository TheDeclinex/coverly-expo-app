import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { ExpandableImage } from "@/components/ExpandableImage";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatCurrency } from "@/lib/inventory-mappers";
import { uploadCoverPhoto } from "@/lib/photo-upload";
import { supabase } from "@/lib/supabase";
import type { InventoryItem, InventoryRoom } from "@/types";

const COVER_H = 200;
const TEAL = "#1D9E75";

/** Maps category key → Feather icon name */
const CATEGORY_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  electronics: "monitor",
  furniture: "home",
  appliances: "tool",
  decor: "sun",
  jewellery: "star",
  jewelry: "star",
  clothing: "scissors",
  kitchen: "coffee",
  outdoor: "compass",
  garden: "sun",
  lighting: "zap",
  art: "star",
  sport: "activity",
  tools: "tool",
  automotive: "truck",
};

/** Maps category key → colored dot */
const CATEGORY_COLORS: Record<string, string> = {
  electronics: "#1D9E75",
  furniture: "#8B5CF6",
  appliances: "#3B82F6",
  decor: "#14B8A6",
  jewellery: "#EC4899",
  jewelry: "#EC4899",
  clothing: "#F59E0B",
  kitchen: "#F97316",
  outdoor: "#22C55E",
  garden: "#16A34A",
  lighting: "#EAB308",
  art: "#F472B6",
  sport: "#06B6D4",
  tools: "#64748B",
  automotive: "#78716C",
};

function categoryIcon(cat: string | null): keyof typeof Feather.glyphMap {
  if (!cat) return "package";
  const key = cat.toLowerCase().split(/[\s&]/)[0];
  return CATEGORY_ICONS[key] ?? "package";
}

function categoryDotColor(cat: string | null): string {
  if (!cat) return "#94a3b8";
  const key = cat.toLowerCase().split(/[\s&]/)[0];
  return CATEGORY_COLORS[key] ?? "#94a3b8";
}

function valuationLabel(item: InventoryItem): string | null {
  const src = ((item.price_source_type ?? item.valuation_basis ?? "") as string).toLowerCase();
  if (src.includes("user") || src.includes("manual")) return "User added";
  if (src.includes("listing") || src.includes("link")) return "Listing linked";
  if (src.includes("ai") || src.includes("scan")) return "AI identified";
  if (item.estimated_price != null || item.unit_estimated_price != null) return "Estimated";
  return null;
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

function roomIconName(roomType: string | null): keyof typeof Feather.glyphMap {
  if (!roomType) return "home";
  const key = roomType.toLowerCase().replace(/\s+/g, "_");
  return (ROOM_ICONS[key] ?? "home") as keyof typeof Feather.glyphMap;
}

function ItemCard({
  item,
  colors,
}: {
  item: InventoryItem;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const imageUri = item.image_url ?? item.photo_url ?? null;

  const rawPin = item.image_pin as Record<string, unknown> | null | undefined;
  const pin =
    rawPin && typeof rawPin.x === "number" && typeof rawPin.y === "number"
      ? { x: rawPin.x, y: rawPin.y }
      : null;

  const totalValue =
    (item.estimated_price ?? item.unit_estimated_price ?? 0) *
    (item.quantity ?? 1);
  const valLabel = valuationLabel(item);
  const dotColor = categoryDotColor(item.category);
  const placeholderIcon = categoryIcon(item.category);

  const goToDetail = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: { id: item.id, name: item.name },
    });
  };

  const goToEdit = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/edit-item/[id]",
      params: { id: item.id },
    });
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
        },
      ]}
    >
      {/* ── Summary row ── */}
      <Pressable
        onPress={goToDetail}
        style={({ pressed }) => [
          styles.cardSummary,
          { opacity: pressed ? 0.88 : 1 },
        ]}
      >
        {/* Thumbnail */}
        <View style={[styles.thumbWrap, { borderColor: TEAL }]}>
          <ExpandableImage
            uri={imageUri}
            style={styles.thumb}
            contentFit="cover"
            placeholderIcon={placeholderIcon}
            placeholderIconSize={26}
            placeholderIconColor={TEAL}
            placeholderBackgroundColor={colors.muted}
            pin={pin}
          />
        </View>

        {/* Text block */}
        <View style={styles.cardBody}>
          {/* Name (left) + Price (right) — same row */}
          <View style={styles.nameRow}>
            <Text
              style={[styles.cardName, { color: colors.foreground }]}
              numberOfLines={2}
            >
              {item.name}
            </Text>
            {totalValue > 0 && (
              <View style={styles.priceBlock}>
                <Text style={[styles.price, { color: colors.foreground }]}>
                  {formatCurrency(totalValue)}
                </Text>
                {valLabel && (
                  <Text
                    style={[styles.valLabel, { color: colors.mutedForeground }]}
                  >
                    {valLabel}
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Category chip */}
          <View style={styles.chipRow}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text
              style={[styles.chipText, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {item.category ?? "General items"}
            </Text>
            {item.quantity != null && item.quantity > 1 && (
              <Text style={[styles.qty, { color: colors.mutedForeground }]}>
                {" "}
                ×{item.quantity}
              </Text>
            )}
          </View>
        </View>

        <Feather
          name="chevron-right"
          size={16}
          color={colors.mutedForeground}
          style={{ marginLeft: 2 }}
        />
      </Pressable>

      {/* ── Divider ── */}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* ── Actions ── */}
      <View style={styles.actions}>
        {/* Primary: Find replacement price */}
        <Pressable
          onPress={goToDetail}
          style={({ pressed }) => [
            styles.findPriceBtn,
            { borderColor: TEAL, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Feather name="search" size={13} color={TEAL} />
          <Text style={[styles.findPriceTxt, { color: TEAL }]}>
            Find replacement price
          </Text>
        </Pressable>

        {/* Secondary: Edit + View details */}
        <View style={styles.secondaryRow}>
          <Pressable
            onPress={goToEdit}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.secondary,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Feather name="edit-2" size={13} color={colors.foreground} />
            <Text style={[styles.secondaryTxt, { color: colors.foreground }]}>
              Edit
            </Text>
          </Pressable>

          <Pressable
            onPress={goToDetail}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.secondary,
                flex: 1,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryTxt, { color: colors.foreground }]}>
              View details
            </Text>
            <Feather
              name="chevron-right"
              size={13}
              color={colors.mutedForeground}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function ItemsScreen() {
  const { id, name, fileId } = useLocalSearchParams<{
    id: string;
    name: string;
    fileId?: string;
  }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [coverUploading, setCoverUploading] = useState(false);

  const {
    data: items,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["items", id, session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("room_id", id)
        .order("sort_order", { ascending: true });
      if (queryError) throw queryError;
      return (data ?? []) as InventoryItem[];
    },
    enabled: !!session && !!id,
  });

  const { data: room } = useQuery({
    queryKey: ["room", id, session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_rooms")
        .select("*")
        .eq("id", id)
        .single();
      if (queryError) throw queryError;
      return data as InventoryRoom;
    },
    enabled: !!session && !!id,
  });

  const handleScanRoom = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/scan",
      params: { roomId: id, roomName: name, fileId: fileId ?? "" },
    });
  };

  const handleAddManually = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/add-item",
      params: { roomId: id, roomName: name, fileId: fileId ?? "" },
    });
  };

  const handlePickRoomCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow access to your photos to set a room cover image."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (result.canceled || !result.assets[0]) return;
    if (!session?.user.id) return;
    setCoverUploading(true);
    try {
      const publicUrl = await uploadCoverPhoto(
        result.assets[0].uri,
        session.user.id
      );
      if (!publicUrl) {
        Alert.alert("Upload failed", "Could not upload cover photo. Please try again.");
        return;
      }
      const { error: updateError } = await supabase
        .from("inventory_rooms")
        .update({ cover_photo_url: publicUrl })
        .eq("id", id);
      if (updateError) {
        Alert.alert("Save failed", updateError.message);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["room", id] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", fileId] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", fileId, session.user.id] }),
      ]);
    } finally {
      setCoverUploading(false);
    }
  };

  const renderRoomCover = () => (
    <View style={[styles.coverContainer, { backgroundColor: colors.secondary }]}>
      {room?.cover_photo_url ? (
        <Image
          source={{ uri: room.cover_photo_url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      ) : (
        <View style={styles.coverPlaceholder}>
          <Feather
            name={roomIconName(room?.room_type ?? null)}
            size={72}
            color={colors.primary}
            style={{ opacity: 0.55 }}
          />
        </View>
      )}
      <Pressable
        onPress={handlePickRoomCover}
        disabled={coverUploading}
        style={[styles.cameraBtn, { backgroundColor: "rgba(0,0,0,0.45)" }]}
        hitSlop={8}
      >
        {coverUploading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Feather name="camera" size={16} color="#fff" />
        )}
      </Pressable>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: name ?? "Items",
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
              <Pressable onPress={handleScanRoom} style={{ padding: 4 }} hitSlop={8}>
                <Feather name="zap" size={20} color={colors.primary} />
              </Pressable>
              <Pressable onPress={handleAddManually} style={{ padding: 4 }} hitSlop={8}>
                <Feather name="plus" size={22} color={colors.primary} />
              </Pressable>
            </View>
          ),
        }}
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState
          message="Failed to load items"
          detail={(error as Error).message}
          onRetry={refetch}
        />
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ItemCard item={item} colors={colors} />}
            ListHeaderComponent={renderRoomCover}
            contentContainerStyle={[
              styles.list,
              {
                paddingBottom: insets.bottom + 88,
                ...(Platform.OS === "web" ? { paddingTop: 0 } : {}),
              },
            ]}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refetch}
                tintColor={colors.primary}
              />
            }
            ListEmptyComponent={
              <EmptyState
                icon="package"
                title="No items in this room"
                subtitle="Tap + to add your first item"
              />
            }
          />
          <View
            style={[
              styles.fabRow,
              { bottom: insets.bottom + 20 },
            ]}
          >
            <Pressable
              onPress={handleScanRoom}
              style={({ pressed }) => [
                styles.fabBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.85 : 1,
                  flex: 1,
                },
              ]}
              hitSlop={4}
            >
              <Feather name="zap" size={20} color={colors.primaryForeground} />
              <Text style={[styles.fabText, { color: colors.primaryForeground }]}>
                Scan room
              </Text>
            </Pressable>
            <Pressable
              onPress={handleAddManually}
              style={({ pressed }) => [
                styles.fabBtn,
                {
                  backgroundColor: colors.secondary,
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                  flex: 1,
                },
              ]}
              hitSlop={4}
            >
              <Feather name="plus" size={20} color={colors.foreground} />
              <Text style={[styles.fabText, { color: colors.foreground }]}>
                Add manually
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  coverContainer: {
    height: COVER_H,
    overflow: "hidden",
  },
  coverPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBtn: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    padding: 12,
    paddingTop: 10,
    gap: 10,
  },
  /* ── Card shell ── */
  card: {
    borderWidth: 1,
    overflow: "hidden",
    // shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  /* ── Summary row ── */
  cardSummary: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  thumbWrap: {
    width: 76,
    height: 76,
    borderRadius: 10,
    borderWidth: 2,
    overflow: "hidden",
  },
  thumb: { width: "100%", height: "100%" },
  cardBody: { flex: 1, gap: 4 },
  nameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cardName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
    flex: 1,
  },
  priceBlock: { alignItems: "flex-end", gap: 1, flexShrink: 0 },
  price: { fontSize: 14, fontFamily: "Inter_700Bold" },
  valLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "nowrap",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontFamily: "Inter_400Regular", flexShrink: 1 },
  qty: { fontSize: 12, fontFamily: "Inter_400Regular" },
  /* ── Divider ── */
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  /* ── Actions ── */
  actions: { padding: 10, gap: 8 },
  findPriceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 9,
  },
  findPriceTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  secondaryRow: { flexDirection: "row", gap: 8 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  secondaryTxt: { fontSize: 12, fontFamily: "Inter_500Medium" },
  fabRow: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    gap: 10,
  },
  fabBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 18,
  },
  fabText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
