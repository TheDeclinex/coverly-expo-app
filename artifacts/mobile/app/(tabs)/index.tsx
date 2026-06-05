import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
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
import type { InventoryFile } from "@/types";

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function StatusBadge({
  status,
  colors,
}: {
  status: string | null;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  if (!status) return null;
  return (
    <View
      style={{
        backgroundColor: colors.accent,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_500Medium",
          color: colors.accentForeground,
          textTransform: "capitalize",
        }}
      >
        {status}
      </Text>
    </View>
  );
}

function PropertyCard({
  item,
  colors,
}: {
  item: InventoryFile;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const handlePress = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/property/[id]",
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
      {item.property_cover_image_url ? (
        <Image
          source={{ uri: item.property_cover_image_url }}
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
          <Feather name="home" size={32} color={colors.primary} />
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text
            style={[
              styles.cardName,
              { color: colors.foreground },
            ]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </View>
        <View style={styles.cardMeta}>
          {item.property_type && (
            <Text
              style={[styles.cardType, { color: colors.mutedForeground }]}
            >
              {item.property_type}
            </Text>
          )}
          <StatusBadge status={item.status} colors={colors} />
        </View>
        {item.contents_sum_insured != null && (
          <View style={styles.cardFooter}>
            <Text
              style={[styles.cardLabel, { color: colors.mutedForeground }]}
            >
              Contents insured
            </Text>
            <Text style={[styles.cardValue, { color: colors.foreground }]}>
              {formatCurrency(item.contents_sum_insured)}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default function PropertiesScreen() {
  const { session, signOut } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    data: properties,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["properties", session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_files")
        .select("*")
        .order("last_modified", { ascending: false });
      if (queryError) throw queryError;
      return (data ?? []) as InventoryFile[];
    },
    enabled: !!session,
  });

  const handleSignOut = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await signOut();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "My Properties",
          headerRight: () => (
            <Pressable
              onPress={handleSignOut}
              style={{ padding: 4 }}
              hitSlop={8}
            >
              <Feather
                name="log-out"
                size={20}
                color={colors.mutedForeground}
              />
            </Pressable>
          ),
        }}
      />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Failed to load properties
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
            <Text
              style={[
                styles.retryText,
                { color: colors.primaryForeground },
              ]}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={properties}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PropertyCard item={item} colors={colors} />
          )}
          contentContainerStyle={[
            styles.list,
            {
              paddingBottom: insets.bottom + 24,
              ...(Platform.OS === "web" ? { paddingTop: 16 } : {}),
            },
          ]}
          scrollEnabled={!!(properties && properties.length > 0)}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="home" size={48} color={colors.border} />
              <Text
                style={[styles.emptyTitle, { color: colors.foreground }]}
              >
                No properties yet
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                Your properties will appear here
              </Text>
            </View>
          }
        />
      )}
    </>
  );
}

import { Platform } from "react-native";

const styles = StyleSheet.create({
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  cardImage: {
    width: "100%",
    height: 160,
  },
  cardImagePlaceholder: {
    width: "100%",
    height: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: 16,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardName: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    marginRight: 8,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardType: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textTransform: "capitalize",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  cardLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  cardValue: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
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
