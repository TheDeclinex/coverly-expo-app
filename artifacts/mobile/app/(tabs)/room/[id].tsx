import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React from "react";
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
import { formatCurrency } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";

function ItemCard({
  item,
  colors,
}: {
  item: InventoryItem;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const imageUri = item.image_url ?? item.photo_url;

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
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.cardImage} contentFit="cover" />
      ) : (
        <View style={[styles.cardImagePlaceholder, { backgroundColor: colors.muted }]}>
          <Feather name="package" size={22} color={colors.mutedForeground} />
        </View>
      )}
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
            contentContainerStyle={[
              styles.list,
              {
                paddingBottom: insets.bottom + 88,
                ...(Platform.OS === "web" ? { paddingTop: 16 } : {}),
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
  list: {
    padding: 16,
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
  price: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  chevron: { paddingRight: 12 },
  fabRow: {
    position: "absolute",
    left: 20,
    right: 20,
    flexDirection: "row",
    gap: 10,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  },
  fabBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 28,
    overflow: "hidden",
  },
  fabText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
