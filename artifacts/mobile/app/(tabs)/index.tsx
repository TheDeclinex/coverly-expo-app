import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
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
import { propertyTypeLabel } from "@/constants/propertyTypes";
import { useColors } from "@/hooks/useColors";
import { useSignedUrl } from "@/hooks/useSignedUrls";
import { calcPortfolioStats } from "@/lib/dashboard-stats";
import { formatCurrency, getItemTotalValue } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryItem } from "@/types";

function coverageColor(percent: number): string {
  if (percent >= 100) return "#EF4444";
  if (percent >= 75) return "#F97316";
  return "#22C55E";
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
        {/* Gradient spans full track so locations map to real bar width */}
        <LinearGradient
          colors={["#22C55E", "#22C55E", "#FBBF24", "#F97316", "#EF4444"]}
          locations={[0, 0.75, 0.85, 0.93, 1.0]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Overlay hides the unfilled right portion with the track colour */}
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${clamped}%` as any,
            right: 0,
            backgroundColor: colors.border,
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

function PropertyCard({
  item,
  items,
  colors,
}: {
  item: InventoryFile;
  items: InventoryItem[];
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const propertyItems = items.filter((i) => i.file_id === item.id);
  const totalValue = propertyItems.reduce(
    (s, i) => s + getItemTotalValue(i),
    0
  );

  const handlePress = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/property/[id]",
      params: { id: item.id, name: item.name },
    });
  };

  // Resolve the storage path (or legacy signed URL) to a fresh display URL.
  const signedCoverUrl = useSignedUrl(item.property_cover_image_url);

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
      {signedCoverUrl ? (
        <Image
          source={{ uri: signedCoverUrl }}
          style={[styles.cardImage, { borderRadius: colors.radius }]}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.cardImagePlaceholder,
            { backgroundColor: colors.secondary, borderRadius: colors.radius },
          ]}
        >
          <Feather name="home" size={32} color={colors.primary} />
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
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
        {item.property_type && (
          <Text style={[styles.cardType, { color: colors.mutedForeground }]}>
            {propertyTypeLabel(item.property_type)}
          </Text>
        )}
        <View style={styles.cardStats}>
          <View style={styles.cardStat}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {formatCurrency(totalValue || null)}
            </Text>
            <Text
              style={[styles.statLabel, { color: colors.mutedForeground }]}
            >
              Inventory value
            </Text>
          </View>
          <View style={styles.cardStat}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {propertyItems.length}
            </Text>
            <Text
              style={[styles.statLabel, { color: colors.mutedForeground }]}
            >
              Items
            </Text>
          </View>
          {item.contents_sum_insured != null && (
            <View style={styles.cardStat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatCurrency(item.contents_sum_insured)}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Recorded cover
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { session, signOut } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    data: properties,
    isLoading: propsLoading,
    error: propsError,
    refetch: refetchProps,
    isRefetching,
  } = useQuery({
    queryKey: ["properties", session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("*")
        .order("last_modified", { ascending: false });
      if (error) throw error;
      return (data ?? []) as InventoryFile[];
    },
    enabled: !!session,
  });

  const { data: allItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["all-items", session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, file_id, room_id, name, estimated_price, unit_estimated_price, quantity, image_url, photo_url");
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
    enabled: !!session,
  });

  const portfolio = useMemo(() => {
    if (!properties || !allItems) return null;
    return calcPortfolioStats(properties, allItems);
  }, [properties, allItems]);

  const handleSignOut = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await signOut();
  };

  const isLoading = propsLoading || itemsLoading;

  const navigateWithProperty = (
    dest: "/(tabs)/add-item" | "/(tabs)/scan"
  ) => {
    // Auto-select the only property; if multiple let the screen's inline picker handle it
    const single = properties?.length === 1 ? properties[0] : null;
    router.push({
      pathname: dest,
      params: single
        ? { fileId: single.id, fileName: single.name }
        : {},
    });
  };

  const handleScanItems = () => navigateWithProperty("/(tabs)/scan");
  const handleAddManually = () => navigateWithProperty("/(tabs)/add-item");

  const renderHeader = () => {
    if (!portfolio || !properties || properties.length === 0) return null;
    return (
      <View style={{ gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        {/* Welcome header */}
        <View style={{ paddingBottom: 2 }}>
          <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#172A27" }}>
            Welcome back
          </Text>
          <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#64736F", marginTop: 2 }}>
            Continue building your home inventory
          </Text>
        </View>

        <View
          style={[
            styles.statsCard,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            YOUR HOME INVENTORY
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={[styles.bigValue, { color: colors.foreground }]}>
                {formatCurrency(portfolio.totalInventoryValue || null)}
              </Text>
              <Text style={[styles.bigLabel, { color: colors.mutedForeground }]}>
                Total inventory value
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statCell}>
              <Text style={[styles.bigValue, { color: colors.foreground }]}>
                {portfolio.totalItems}
              </Text>
              <Text style={[styles.bigLabel, { color: colors.mutedForeground }]}>
                Total items
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statCell}>
              <Text style={[styles.bigValue, { color: colors.foreground }]}>
                {portfolio.propertyCount}
              </Text>
              <Text style={[styles.bigLabel, { color: colors.mutedForeground }]}>
                Properties
              </Text>
            </View>
          </View>
          {portfolio.totalRecordedCover > 0 && portfolio.totalInventoryValue > 0 && (
            <View style={{ marginTop: 12 }}>
              <CoverageBar
                percent={(portfolio.totalInventoryValue / portfolio.totalRecordedCover) * 100}
                colors={colors}
              />
            </View>
          )}
        </View>

        {(allItems ?? []).length === 0 && (
          <View
            style={{
              backgroundColor: colors.secondary,
              borderRadius: colors.radius,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 16,
              gap: 12,
            }}
          >
            <View style={{ gap: 4 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                  letterSpacing: 0.8,
                  color: colors.primary,
                }}
              >
                NEXT STEP
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: "Inter_400Regular",
                  color: colors.foreground,
                  lineHeight: 21,
                }}
              >
                Open your property, add your first room, then scan items to build your inventory record.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                const first = properties[0];
                router.push({
                  pathname: "/(tabs)/property/[id]",
                  params: { id: first.id, name: first.name },
                });
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                paddingVertical: 12,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: "Inter_600SemiBold",
                  color: colors.primaryForeground,
                }}
              >
                Continue setup
              </Text>
              <Feather name="arrow-right" size={14} color={colors.primaryForeground} />
            </Pressable>
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={handleScanItems}
            style={({ pressed }) => [
              styles.quickAction,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
                flex: 2,
              },
            ]}
          >
            <Feather name="zap" size={18} color={colors.primaryForeground} />
            <Text style={[styles.quickActionText, { color: colors.primaryForeground }]}>
              Scan items
            </Text>
          </Pressable>
          <Pressable
            onPress={handleAddManually}
            style={({ pressed }) => [
              styles.quickAction,
              {
                backgroundColor: colors.secondary,
                borderRadius: colors.radius,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
                flex: 1,
              },
            ]}
          >
            <Feather name="plus-circle" size={18} color={colors.foreground} />
            <Text style={[styles.quickActionText, { color: colors.foreground }]}>
              Add manually
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionHeading, { color: colors.foreground }]}>
          My Properties
        </Text>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Coverly",
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Pressable
                onPress={() => router.push("/(tabs)/add-property")}
                style={{ padding: 4 }}
                hitSlop={8}
              >
                <Feather name="plus" size={22} color={colors.primary} />
              </Pressable>
              <Pressable onPress={handleSignOut} style={{ padding: 4 }} hitSlop={8}>
                <Feather name="log-out" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ),
        }}
      />
      {isLoading ? (
        <LoadingState />
      ) : propsError ? (
        <ErrorState
          message="Failed to load properties"
          detail={(propsError as Error).message}
          onRetry={refetchProps}
        />
      ) : (
        <FlatList
          data={properties}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
              <PropertyCard
                item={item}
                items={allItems ?? []}
                colors={colors}
              />
            </View>
          )}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 24,
            ...(Platform.OS === "web" ? { paddingTop: 16 } : {}),
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetchProps}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={{ paddingHorizontal: 16, paddingTop: 32 }}>
              <EmptyState
                icon="home"
                title="No properties yet"
                subtitle="Your properties will appear here once added"
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
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  quickActionText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
  cardImage: {
    width: "100%",
    height: 140,
  },
  cardImagePlaceholder: {
    width: "100%",
    height: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: 14,
    gap: 6,
  },
  cardHeader: {
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
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  cardStats: {
    flexDirection: "row",
    gap: 16,
    marginTop: 6,
  },
  cardStat: {
    gap: 1,
  },
  statValue: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
