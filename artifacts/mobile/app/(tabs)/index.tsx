import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { propertyTypeLabel } from "@/constants/propertyTypes";
import { useColors } from "@/hooks/useColors";
import { useSignedUrl } from "@/hooks/useSignedUrls";
import { calcPortfolioStats } from "@/lib/dashboard-stats";
import {
  calculateCoverageInsight,
  getCoverageColor,
  getCoverageStatusLabel,
} from "@/lib/coverage";
import { formatCurrency, getItemTotalValue } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryItem } from "@/types";

const HOME_ITEMS_PAGE_SIZE = 1000;
const countFormatter = new Intl.NumberFormat("en-NZ");

function formatCount(value: number): string {
  return countFormatter.format(value);
}

const WARNING_GRADIENT_STOPS = [
  { at: 0, rgb: [34, 197, 94] },
  { at: 0.4, rgb: [251, 191, 36] },
  { at: 0.72, rgb: [249, 115, 22] },
  { at: 1, rgb: [239, 68, 68] },
] as const;

function warningGradientColor(position: number): string {
  const clamped = Math.min(Math.max(position, 0), 1);
  const upperIndex = WARNING_GRADIENT_STOPS.findIndex((stop) => stop.at >= clamped);
  if (upperIndex <= 0) return "rgb(34, 197, 94)";
  const lower = WARNING_GRADIENT_STOPS[upperIndex - 1];
  const upper = WARNING_GRADIENT_STOPS[upperIndex];
  const mix = (clamped - lower.at) / (upper.at - lower.at);
  const rgb = lower.rgb.map((channel, index) =>
    Math.round(channel + (upper.rgb[index] - channel) * mix),
  );
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function CoverageBar({
  percent,
  colors,
}: {
  percent: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const clamped = Math.min(percent, 100);
  const fill = getCoverageColor(percent);
  const label = getCoverageStatusLabel(percent);

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

function MiniCoverageRing({
  percent,
  toneColor,
  trackColor,
}: {
  percent: number | null;
  toneColor: string;
  trackColor: string;
}) {
  const size = 72;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const warningArcLength = circumference * 0.25;
  const warningSegmentCount = 48;
  const warningSegmentLength = warningArcLength / warningSegmentCount;
  const [animatedPercent, setAnimatedPercent] = React.useState(0);

  React.useEffect(() => {
    if (percent == null) {
      setAnimatedPercent(0);
      return;
    }
    const animation = new Animated.Value(0);
    const listener = animation.addListener(({ value }) => setAnimatedPercent(value));
    Animated.timing(animation, {
      toValue: percent,
      duration: 750,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => animation.removeListener(listener);
  }, [percent]);

  const filled = (Math.min(Math.max(animatedPercent, 0), 100) / 100) * circumference;
  const greenLength = Math.min(filled, circumference * 0.75);
  const warningLength = Math.max(filled - circumference * 0.75, 0);

  return (
    <View style={styles.miniRing}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        {percent != null && greenLength > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#22C55E"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${greenLength} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
        {percent != null && warningLength > 0
          ? Array.from({ length: warningSegmentCount }, (_, index) => {
              const localStart = index * warningSegmentLength;
              const visibleLength = Math.min(
                Math.max(warningLength - localStart, 0),
                warningSegmentLength + 0.35,
              );
              if (visibleLength <= 0) return null;
              return (
                <Circle
                  key={index}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={warningGradientColor(index / (warningSegmentCount - 1))}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeDasharray={`${visibleLength} ${circumference}`}
                  strokeDashoffset={-(circumference * 0.75 + localStart)}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })
          : null}
      </Svg>
      <Text style={[styles.miniRingValue, { color: percent == null ? trackColor : toneColor }]}>
        {percent == null ? "—" : `${Math.round(Math.min(percent, 999))}%`}
      </Text>
      <Text style={[styles.miniRingLabel, { color: toneColor }]}>
        {percent == null ? "not set" : "of cover"}
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
  const { width: windowWidth } = useWindowDimensions();
  const stackCoverage = windowWidth < 430;
  const propertyItems = items.filter((i) => i.file_id === item.id);
  const totalValue = propertyItems.reduce(
    (s, i) => s + getItemTotalValue(i),
    0
  );
  const coverage = calculateCoverageInsight(
    totalValue,
    item.contents_sum_insured,
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
        <View style={[styles.cardInsightLayout, stackCoverage && styles.cardInsightLayoutStacked]}>
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
                {formatCount(propertyItems.length)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Items</Text>
            </View>
            <View style={styles.cardStat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {coverage.hasCover ? formatCurrency(item.contents_sum_insured) : "Not set"}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Contents cover</Text>
            </View>
          </View>
          <View
            style={[
              styles.miniCoverageSummary,
              stackCoverage && styles.miniCoverageSummaryStacked,
              { borderColor: colors.border },
            ]}
          >
            <MiniCoverageRing
              percent={coverage.percent}
              toneColor={coverage.color ?? colors.mutedForeground}
              trackColor={colors.border}
            />
            <View style={[styles.miniCoverageCopy, stackCoverage && styles.miniCoverageCopyStacked]}>
              <Text
                style={[
                  styles.miniCoverageAmount,
                  {
                    color: coverage.overAmount > 0
                      ? coverage.color ?? colors.destructive
                      : colors.foreground,
                  },
                ]}
              >
                {!coverage.hasCover
                  ? "Cover not set"
                  : coverage.overAmount > 0
                    ? `${formatCurrency(coverage.overAmount)} over`
                    : `${formatCurrency(coverage.remainingAmount)} left`}
              </Text>
              <Text style={[styles.miniCoverageHint, { color: colors.mutedForeground }]}>
                Contents value vs cover
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { session } = useAuth();
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

  const {
    data: allItems,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems,
    isRefetching: itemsRefetching,
  } = useQuery({
    queryKey: ["all-items", "home-valuation", session?.user.id],
    queryFn: async () => {
      const rows: InventoryItem[] = [];
      let from = 0;

      // Home needs each item's unit value and quantity to calculate portfolio
      // value. Fetch only those lightweight fields, in stable pages, so the
      // dashboard is not silently truncated by PostgREST's 1,000-row limit.
      while (true) {
        const { data, error } = await supabase
          .from("inventory_items")
          .select("id, file_id, room_id, estimated_price, unit_estimated_price, quantity")
          .order("id", { ascending: true })
          .range(from, from + HOME_ITEMS_PAGE_SIZE - 1);
        if (error) throw error;

        const page = (data ?? []) as InventoryItem[];
        rows.push(...page);
        if (page.length < HOME_ITEMS_PAGE_SIZE) break;
        from += HOME_ITEMS_PAGE_SIZE;
      }

      return rows;
    },
    enabled: !!session,
  });

  const {
    data: exactItemCount,
    isLoading: itemCountLoading,
    error: itemCountError,
    refetch: refetchItemCount,
    isRefetching: itemCountRefetching,
  } = useQuery({
    queryKey: ["all-items", "exact-count", session?.user.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      if (count === null) throw new Error("Supabase did not return an exact item count.");
      return count;
    },
    enabled: !!session,
  });

  const {
    data: allRooms,
    refetch: refetchRooms,
    isRefetching: roomsRefetching,
  } = useQuery({
    queryKey: ["all-rooms-count", session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_rooms")
        .select("id")
        .is("archived_at", null);
      if (error) throw error;
      return (data ?? []) as { id: string }[];
    },
    enabled: !!session,
  });

  const portfolio = useMemo(() => {
    if (!properties || !allItems || exactItemCount === undefined) return null;
    return {
      ...calcPortfolioStats(properties, allItems),
      totalItems: exactItemCount,
    };
  }, [properties, allItems, exactItemCount]);

  const isLoading = propsLoading || itemsLoading || itemCountLoading;
  const homeError = propsError ?? itemsError ?? itemCountError;
  const homeRefetching =
    isRefetching || itemsRefetching || itemCountRefetching || roomsRefetching;

  const refetchHome = async () => {
    await Promise.all([
      refetchProps(),
      refetchItems(),
      refetchItemCount(),
      refetchRooms(),
    ]);
  };

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
          <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#1E293B" }}>
            Welcome back
          </Text>
          <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#64748B", marginTop: 2 }}>
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
                {formatCount(portfolio.totalItems)}
              </Text>
              <Text style={[styles.bigLabel, { color: colors.mutedForeground }]}>
                Total items
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statCell}>
              <Text style={[styles.bigValue, { color: colors.foreground }]}>
                {formatCount(portfolio.propertyCount)}
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

        {(allRooms ?? []).length === 0 && (allItems ?? []).length === 0 && (
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
                flex: 1.3,
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
            <Text numberOfLines={1} style={[styles.quickActionText, { color: colors.foreground }]}>Add manually</Text>
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
          headerBackVisible: false,
          headerLeft: () => null,
          headerTitle: () => (
            <View style={styles.brandTitle}>
              <Text style={[styles.brandName, { color: colors.foreground }]}>Coverly</Text>
              <Text style={[styles.brandTagline, { color: colors.mutedForeground }]}>Know what you own</Text>
            </View>
          ),
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => router.push("/(tabs)/add-property")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add property"
                style={({ pressed }) => [
                  styles.addPropertyAction,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name="plus" size={16} color={colors.primary} />
                <Text style={[styles.addPropertyText, { color: colors.primary }]}>Property</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/account" as Href)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Open account"
                style={({ pressed }) => [
                  styles.accountAction,
                  {
                    backgroundColor: colors.secondary,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name="user" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ),
        }}
      />
      {isLoading ? (
        <LoadingState />
      ) : homeError ? (
        <ErrorState
          message="Failed to load your home inventory"
          detail={(homeError as Error).message}
          onRetry={() => void refetchHome()}
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
              refreshing={homeRefetching}
              onRefresh={() => void refetchHome()}
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
  brandTitle: { gap: 0 },
  brandName: { fontSize: 17, fontFamily: "Inter_700Bold", lineHeight: 20 },
  brandTagline: { fontSize: 10, fontFamily: "Inter_400Regular", lineHeight: 13 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  addPropertyAction: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  addPropertyText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  accountAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
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
    gap: 6,
    paddingHorizontal: 10,
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
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 13,
  },
  cardStat: {
    flexShrink: 1,
    gap: 1,
  },
  cardInsightLayout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  cardInsightLayoutStacked: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  miniCoverageSummary: {
    width: 118,
    minHeight: 104,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  miniCoverageSummaryStacked: {
    width: "100%",
    minHeight: 80,
    borderLeftWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    paddingLeft: 0,
    paddingTop: 10,
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: 12,
  },
  miniRing: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  miniRingValue: { fontSize: 13, fontFamily: "Inter_700Bold", lineHeight: 16 },
  miniRingLabel: { fontSize: 8, fontFamily: "Inter_400Regular", lineHeight: 10 },
  miniCoverageCopy: {
    width: 108,
    alignItems: "center",
    gap: 1,
  },
  miniCoverageCopyStacked: { width: "auto", flex: 1, alignItems: "flex-start" },
  miniCoverageAmount: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  miniCoverageHint: { fontSize: 9, fontFamily: "Inter_400Regular", textAlign: "center" },
  statValue: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
