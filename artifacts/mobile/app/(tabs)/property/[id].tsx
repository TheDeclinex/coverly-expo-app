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
import type { InventoryRoom } from "@/types";

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

function RoomCard({
  item,
  colors,
}: {
  item: InventoryRoom;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const handlePress = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/room/[id]",
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
      {item.cover_photo_url ? (
        <Image
          source={{ uri: item.cover_photo_url }}
          style={[styles.cardImage, { borderRadius: colors.radius }]}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.cardImagePlaceholder,
            {
              backgroundColor: colors.secondary,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Feather
            name={roomIcon(item.room_type) as any}
            size={28}
            color={colors.primary}
          />
        </View>
      )}
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
            size={18}
            color={colors.mutedForeground}
          />
        </View>
        {item.room_type && (
          <Text
            style={[styles.cardType, { color: colors.mutedForeground }]}
          >
            {item.room_type.replace(/_/g, " ")}
          </Text>
        )}
        {item.notes && (
          <Text
            style={[styles.cardNotes, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {item.notes}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export default function RoomsScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    data: rooms,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["rooms", id, session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_rooms")
        .select("*")
        .eq("file_id", id)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      if (queryError) throw queryError;
      return (data ?? []) as InventoryRoom[];
    },
    enabled: !!session && !!id,
  });

  return (
    <>
      <Stack.Screen options={{ title: name ?? "Rooms" }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Failed to load rooms
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
          data={rooms}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <RoomCard item={item} colors={colors} />}
          contentContainerStyle={[
            styles.list,
            {
              paddingBottom: insets.bottom + 24,
              ...(Platform.OS === "web" ? { paddingTop: 16 } : {}),
            },
          ]}
          scrollEnabled={!!(rooms && rooms.length > 0)}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="layers" size={48} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No rooms found
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                Rooms will appear here once added
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
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  cardImage: {
    width: "100%",
    height: 120,
  },
  cardImagePlaceholder: {
    width: "100%",
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: 14,
    gap: 4,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    marginRight: 8,
  },
  cardType: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textTransform: "capitalize",
  },
  cardNotes: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
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
