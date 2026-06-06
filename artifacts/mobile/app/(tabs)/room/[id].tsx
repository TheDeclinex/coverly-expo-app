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
  const imageUri = item.image_url ?? item.photo_url;

  const rawPin = item.image_pin as Record<string, unknown> | null | undefined;
  const pin =
    rawPin && typeof rawPin.x === "number" && typeof rawPin.y === "number"
      ? { x: rawPin.x, y: rawPin.y }
      : null;

  const handlePress = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: { id: item.id, name: item.name },
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
      <ExpandableImage
        uri={imageUri}
        style={styles.cardImage}
        contentFit="cover"
        placeholderIcon="package"
        placeholderIconSize={22}
        placeholderIconColor={colors.mutedForeground}
        placeholderBackgroundColor={colors.muted}
        pin={pin}
      />
      <View style={styles.cardBody}>
        <Text
          style={[styles.cardName, { color: colors.foreground }]}
          numberOfLines={2}
        >
          {item.name}
        </Text>
        <View style={styles.cardMeta}>
          {item.category && (
            <View style={[styles.badge, { backgroundColor: colors.accent, borderRadius: 6 }]}>
              <Text style={[styles.badgeText, { color: colors.accentForeground }]}>
                {item.category}
              </Text>
            </View>
          )}
          {item.quantity != null && item.quantity > 1 && (
            <Text style={[styles.qty, { color: colors.mutedForeground }]}>
              ×{item.quantity}
            </Text>
          )}
        </View>
        {item.estimated_price != null && (
          <Text style={[styles.price, { color: colors.primary }]}>
            {formatCurrency(item.estimated_price)}
          </Text>
        )}
      </View>
      <View style={styles.chevron}>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>
    </Pressable>
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
    padding: 16,
    paddingTop: 12,
  },
  card: {
    flexDirection: "row",
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 10,
    alignItems: "center",
  },
  cardImage: { width: 72, height: 72 },
  cardImagePlaceholder: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, padding: 12, gap: 4 },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  badge: { paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "capitalize",
  },
  qty: { fontSize: 12, fontFamily: "Inter_400Regular" },
  price: { fontSize: 14, fontFamily: "Inter_700Bold" },
  chevron: { paddingRight: 12 },
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
