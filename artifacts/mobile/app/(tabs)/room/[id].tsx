import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

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
        <Image
          source={{ uri: imageUri }}
          style={styles.cardImage}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.cardImagePlaceholder,
            { backgroundColor: colors.muted },
          ]}
        >
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
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.accent, borderRadius: 6 },
              ]}
            >
              <Text
                style={[styles.badgeText, { color: colors.accentForeground }]}
              >
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
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
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

  return (
    <>
      <Stack.Screen options={{ title: name ?? "Items" }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Failed to load items
          </Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            {(error as Error).message}
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[
              styles.retryButton,
              { backgroundColor: colors.primary, borderRadius: colors.radius },
            ]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ItemCard item={item} colors={colors} />}
          contentContainerStyle={[
            styles.list,
            {
              paddingBottom: insets.bottom + 24,
              ...(Platform.OS === "web" ? { paddingTop: 16 } : {}),
            },
          ]}
          scrollEnabled={!!(items && items.length > 0)}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="package" size={48} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No items in this room
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                Items will appear here once added
              </Text>
            </View>
          }
        />
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
  cardImage: {
    width: 72,
    height: 72,
  },
  cardImagePlaceholder: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  cardName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "capitalize",
  },
  qty: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  price: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginTop: 2,
  },
  chevron: {
    paddingRight: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  errorSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
