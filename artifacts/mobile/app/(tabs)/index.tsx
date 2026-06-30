import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { RecommendedActionCard } from "@/components/RecommendedActionCard";
import { ReliableImage } from "@/components/ReliableImage";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { ENABLE_RECOMMENDED_ACTIONS } from "@/constants/recommendedActions";
import { propertyTypeLabel } from "@/constants/propertyTypes";
import { useColors } from "@/hooks/useColors";
import { useSignedUrl, useSignedUrls } from "@/hooks/useSignedUrls";
import { calcPortfolioStats } from "@/lib/dashboard-stats";
import {
  calculateCoverageInsight,
  getCoverageColor,
} from "@/lib/coverage";
import { formatCurrency, getItemTotalValue } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryItem, InventoryRoom } from "@/types";

const HOME_ITEMS_PAGE_SIZE = 1000;
const HOME_SUMMARY_BACKGROUND = "#F6FBFA";
const HOME_SUMMARY_BORDER = "#D7E7E4";
const countFormatter = new Intl.NumberFormat("en-NZ");
type GlobalReadinessFilter = "all" | "needs_review" | "missing_photo" | "missing_value";

function formatCount(value: number): string {
  return countFormatter.format(value);
}

function itemHasPhoto(item: InventoryItem): boolean {
  return Boolean(item.image_url || item.photo_url);
}

function itemHasValue(item: InventoryItem): boolean {
  return getItemTotalValue(item) > 0;
}

function globalItemNeedsReview(item: InventoryItem): boolean {
  const lowConfidence = item.confidence != null && item.confidence < 0.7;
  const unclearName = item.name.trim().length < 3;
  return !itemHasValue(item) || !item.quantity || lowConfidence || unclearName;
}

function globalReadinessLabel(item: InventoryItem): string | null {
  if (!itemHasPhoto(item)) return "No photo";
  if (!itemHasValue(item)) return "No value";
  if (globalItemNeedsReview(item)) return "Needs review";
  return null;
}

function matchesGlobalReadiness(item: InventoryItem, filter: GlobalReadinessFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_review") return globalItemNeedsReview(item);
  if (filter === "missing_photo") return !itemHasPhoto(item);
  if (filter === "missing_value") return !itemHasValue(item);
  return true;
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
  inventoryValue,
  coverValue,
  colors,
}: {
  percent: number;
  inventoryValue: number;
  coverValue: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const clamped = Math.min(percent, 100);
  const fill = getCoverageColor(percent);

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
          Inventory value vs cover
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
        {formatCurrency(inventoryValue || null)} recorded of {formatCurrency(coverValue)} cover
      </Text>
    </View>
  );
}

function getPropertyCoverCopy(
  coverage: ReturnType<typeof calculateCoverageInsight>
) {
  if (!coverage.hasCover) {
    return {
      primary: "Add contents cover",
      secondary: "Compare this property's inventory value",
    };
  }
  if (coverage.overAmount > 0) {
    return {
      primary: `${formatCurrency(coverage.overAmount)} over cover`,
      secondary: "Review this property's contents cover",
    };
  }
  return {
    primary: `${formatCurrency(coverage.remainingAmount)} remaining cover`,
    secondary: "Based on this property's inventory value",
  };
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
  const coverCopy = getPropertyCoverCopy(coverage);

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
        <ReliableImage
          uri={signedCoverUrl}
          style={[styles.cardImage, { borderRadius: colors.radius }]}
          contentFit="cover"
          fallback={
            <View
              style={[
                styles.cardImagePlaceholder,
                { backgroundColor: colors.secondary, borderRadius: colors.radius },
              ]}
            >
              <Feather name="home" size={32} color={colors.primary} />
            </View>
          }
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
                {coverCopy.primary}
              </Text>
              <Text style={[styles.miniCoverageHint, { color: colors.mutedForeground }]}>
                {coverCopy.secondary}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.cardActionRow}>
          <Text style={[styles.cardActionText, { color: colors.primary }]}>Continue inventory</Text>
          <Feather name="arrow-right" size={13} color={colors.primary} />
        </View>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { session } = useAuth();
  const { canCreateProperty, enforce } = useEntitlements();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [globalSearchVisible, setGlobalSearchVisible] = React.useState(false);
  const [globalSearchText, setGlobalSearchText] = React.useState("");
  const [globalReadinessFilter, setGlobalReadinessFilter] = React.useState<GlobalReadinessFilter>("all");

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
          .select("id, sort_order, file_id, room_id, room, name, category, confidence, estimated_price, unit_estimated_price, quantity, valuation_basis, price_source_type, description, image_url, photo_url, brand_maker")
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
        .select("id, file_id, user_id, name, room_type, sort_order, cover_photo_url, notes, description, archived_at")
        .is("archived_at", null);
      if (error) throw error;
      return (data ?? []) as InventoryRoom[];
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
  const propertyById = useMemo(() => {
    const map = new Map<string, InventoryFile>();
    (properties ?? []).forEach((property) => map.set(property.id, property));
    return map;
  }, [properties]);
  const roomById = useMemo(() => {
    const map = new Map<string, InventoryRoom>();
    (allRooms ?? []).forEach((room) => map.set(room.id, room));
    return map;
  }, [allRooms]);
  const globalSearchImagePaths = useMemo(
    () => (allItems ?? []).map((item) => item.image_url ?? item.photo_url ?? null),
    [allItems],
  );
  const globalSearchSignedUrls = useSignedUrls(globalSearchImagePaths);
  const normalizedGlobalSearch = globalSearchText.trim().toLowerCase();
  const globalSearchActive = normalizedGlobalSearch.length > 0 || globalReadinessFilter !== "all";
  const globalSearchResults = useMemo(() => {
    const results = (allItems ?? []).filter((item) => {
      const room = item.room_id ? roomById.get(item.room_id) : null;
      const property = propertyById.get(item.file_id);
      const valueText = String(Math.round(getItemTotalValue(item)));
      const haystack = [
        item.name,
        item.category,
        item.brand_maker,
        item.description,
        item.room,
        room?.name,
        property?.name,
        valueText,
        globalReadinessLabel(item),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        (!normalizedGlobalSearch || haystack.includes(normalizedGlobalSearch)) &&
        matchesGlobalReadiness(item, globalReadinessFilter)
      );
    });
    return results
      .sort((a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0))
      .slice(0, 60);
  }, [allItems, globalReadinessFilter, normalizedGlobalSearch, propertyById, roomById]);

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
  const propertyCount = properties?.length ?? 0;
  const canAddProperty = canCreateProperty(propertyCount);

  const handleAddProperty = () => {
    if (!enforce("property", propertyCount)) return;
    router.push("/(tabs)/add-property");
  };

  const clearGlobalSearch = React.useCallback(() => {
    setGlobalSearchText("");
    setGlobalReadinessFilter("all");
  }, []);

  const openGlobalSearchResult = React.useCallback((item: InventoryItem) => {
    const room = item.room_id ? roomById.get(item.room_id) : null;
    const property = propertyById.get(item.file_id);
    setGlobalSearchVisible(false);
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: {
        id: item.id,
        name: item.name,
        roomId: item.room_id ?? "",
        roomName: room?.name ?? item.room ?? "",
        fileId: item.file_id,
        fileName: property?.name ?? "Property",
      },
    });
  }, [propertyById, roomById]);

  const homeRecommendedAction = useMemo(() => {
    if (!ENABLE_RECOMMENDED_ACTIONS) return null;

    if (!properties || properties.length === 0) {
      return {
        body: "Add your first property",
        detail: "Set up the home, rental, or other place you want to inventory.",
        primaryLabel: "Add property",
        onPrimaryPress: handleAddProperty,
      };
    }

    const firstProperty = properties[0];
    if ((allRooms ?? []).length === 0) {
      return {
        body: "Add your first room",
        detail: "Open your property, add a room, then start recording visible items.",
        primaryLabel: "Open property",
        onPrimaryPress: () =>
          router.push({
            pathname: "/(tabs)/property/[id]",
            params: { id: firstProperty.id, name: firstProperty.name },
          }),
      };
    }

    return null;
  }, [allRooms, handleAddProperty, properties]);

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
            { backgroundColor: HOME_SUMMARY_BACKGROUND, borderColor: HOME_SUMMARY_BORDER, borderRadius: colors.radius },
          ]}
        >
          <View style={styles.summaryTitleRow}>
            <View style={[styles.summaryTitleIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="home" size={12} color={colors.primary} />
            </View>
            <Text style={[styles.sectionLabel, styles.summarySectionLabel, { color: colors.mutedForeground }]}>
              YOUR HOME INVENTORY
            </Text>
          </View>
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
                inventoryValue={portfolio.totalInventoryValue}
                coverValue={portfolio.totalRecordedCover}
                colors={colors}
              />
            </View>
          )}
          {portfolio.totalRecordedCover <= 0 && (
            <Text style={[styles.coverFallbackText, { color: colors.mutedForeground }]}>
              Add contents cover to compare your inventory value
            </Text>
          )}
        </View>

        {homeRecommendedAction ? <RecommendedActionCard {...homeRecommendedAction} /> : null}

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
          {properties.length === 1 ? "Your Property" : "My Properties"}
        </Text>
      </View>
    );
  };

  const renderGlobalSearchChip = (
    label: string,
    value: GlobalReadinessFilter,
  ) => {
    const selected = globalReadinessFilter === value;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => setGlobalReadinessFilter(value)}
        style={({ pressed }) => [
          styles.globalFilterChip,
          {
            backgroundColor: selected ? colors.primary : colors.card,
            borderColor: selected ? colors.primary : colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Text style={[styles.globalFilterChipText, { color: selected ? colors.primaryForeground : colors.foreground }]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const renderGlobalSearchModal = () => (
    <Modal
      visible={globalSearchVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setGlobalSearchVisible(false)}
    >
      <Pressable style={styles.globalSearchBackdrop} onPress={() => setGlobalSearchVisible(false)}>
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={[
            styles.globalSearchSheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius + 6,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.globalSearchHeader}>
            <Text style={[styles.globalSearchTitle, { color: colors.foreground }]}>Search inventory</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close inventory search"
              onPress={() => setGlobalSearchVisible(false)}
              style={styles.globalSearchClose}
              hitSlop={8}
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <View style={[styles.globalSearchBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={globalSearchText}
              onChangeText={setGlobalSearchText}
              placeholder="Search item, room, property, category"
              placeholderTextColor={colors.mutedForeground}
              returnKeyType="search"
              style={[styles.globalSearchInput, { color: colors.foreground }]}
            />
            {globalSearchActive ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={clearGlobalSearch} hitSlop={6}>
                <Feather name="x-circle" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.globalFilterRow}>
            {renderGlobalSearchChip("All", "all")}
            {renderGlobalSearchChip("Needs review", "needs_review")}
            {renderGlobalSearchChip("Missing photo", "missing_photo")}
            {renderGlobalSearchChip("Missing value", "missing_value")}
          </View>
          <FlatList
            data={globalSearchResults}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.globalResultsList}
            contentContainerStyle={styles.globalResultsContent}
            ListEmptyComponent={
              <View style={styles.globalEmpty}>
                <Feather name="search" size={22} color={colors.mutedForeground} />
                <Text style={[styles.globalEmptyTitle, { color: colors.foreground }]}>No matching items found</Text>
                <Text style={[styles.globalEmptyBody, { color: colors.mutedForeground }]}>
                  Try another item name, category, room, property, value, or status.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const room = item.room_id ? roomById.get(item.room_id) : null;
              const property = propertyById.get(item.file_id);
              const imageRef = item.image_url ?? item.photo_url ?? "";
              const imageUri = globalSearchSignedUrls.get(imageRef) ?? null;
              const readiness = globalReadinessLabel(item);
              const value = getItemTotalValue(item);

              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openGlobalSearchResult(item)}
                  style={({ pressed }) => [
                    styles.globalResultRow,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}
                >
                  {imageUri ? (
                    <ReliableImage
                      uri={imageUri}
                      style={styles.globalResultThumb}
                      contentFit="cover"
                      fallback={
                        <View style={[styles.globalResultThumb, styles.globalResultPlaceholder, { backgroundColor: colors.secondary }]}>
                          <Feather name="package" size={18} color={colors.primary} />
                        </View>
                      }
                    />
                  ) : (
                    <View style={[styles.globalResultThumb, styles.globalResultPlaceholder, { backgroundColor: colors.secondary }]}>
                      <Feather name="package" size={18} color={colors.primary} />
                    </View>
                  )}
                  <View style={styles.globalResultCopy}>
                    <Text style={[styles.globalResultName, { color: colors.foreground }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.globalResultContext, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {room?.name ?? item.room ?? "No room"} · {property?.name ?? "Property"}
                    </Text>
                    <View style={styles.globalResultMetaRow}>
                      <Text style={[styles.globalResultValue, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {value > 0 ? formatCurrency(value) : "No value"}
                      </Text>
                      {readiness ? (
                        <View style={[styles.globalReadinessChip, { borderColor: colors.warning, backgroundColor: colors.warning + "10" }]}>
                          <Text style={[styles.globalReadinessText, { color: colors.warning }]} numberOfLines={1}>
                            {readiness}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );

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
                onPress={() => setGlobalSearchVisible(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Search inventory"
                style={({ pressed }) => [
                  styles.accountAction,
                  {
                    backgroundColor: colors.secondary,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name="search" size={18} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={handleAddProperty}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={canAddProperty ? "Add property" : "Upgrade to add another property"}
                style={({ pressed }) => [
                  styles.addPropertyAction,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : canAddProperty ? 1 : 0.78,
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
            <FirstUseEmptyState onAddProperty={handleAddProperty} />
          }
        />
      )}
      {renderGlobalSearchModal()}
    </>
  );
}

function FirstUseEmptyState({ onAddProperty }: { onAddProperty: () => void }) {
  const colors = useColors();
  const steps: Array<{ icon: keyof typeof Feather.glyphMap; title: string; body: string }> = [
    { icon: "home", title: "Add your property", body: "Create the place you want to inventory." },
    { icon: "zap", title: "Scan a room", body: "Capture visible items from photos." },
    { icon: "paperclip", title: "Add evidence", body: "Attach receipts, photos, and notes." },
    { icon: "package", title: "Create a claim pack", body: "Export selected items when needed." },
  ];

  return (
    <View style={styles.firstUseWrap}>
      <LinearGradient
        colors={["#F6FBFA", "#FFFFFF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.firstUseCard, { borderColor: HOME_SUMMARY_BORDER, borderRadius: colors.radius }]}
      >
        <View style={[styles.firstUseIcon, { backgroundColor: colors.accent }]}>
          <Feather name="shield" size={24} color={colors.primary} />
        </View>
        <Text style={[styles.firstUseTitle, { color: colors.foreground }]}>Welcome to Coverly</Text>
        <Text style={[styles.firstUseBody, { color: colors.mutedForeground }]}>
          Start by adding your first property, then scan a room or add items manually.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add property"
          onPress={onAddProperty}
          style={({ pressed }) => [
            styles.firstUsePrimary,
            { backgroundColor: colors.primary, opacity: pressed ? 0.84 : 1 },
          ]}
        >
          <Feather name="plus-circle" size={17} color={colors.primaryForeground} />
          <Text style={[styles.firstUsePrimaryText, { color: colors.primaryForeground }]}>Add property</Text>
        </Pressable>
      </LinearGradient>

      <View style={styles.firstUseSteps}>
        {steps.map((step) => (
          <View key={step.title} style={[styles.firstUseStep, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <View style={[styles.firstUseStepIcon, { backgroundColor: colors.secondary }]}>
              <Feather name={step.icon} size={16} color={colors.primary} />
            </View>
            <View style={styles.firstUseStepCopy}>
              <Text style={[styles.firstUseStepTitle, { color: colors.foreground }]}>{step.title}</Text>
              <Text style={[styles.firstUseStepBody, { color: colors.mutedForeground }]}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
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
  globalSearchBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.46)",
  },
  globalSearchSheet: {
    width: "100%",
    maxHeight: "86%",
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 12,
  },
  globalSearchHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  globalSearchTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  globalSearchClose: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  globalSearchBox: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  globalSearchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  globalFilterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  globalFilterChip: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  globalFilterChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  globalResultsList: { maxHeight: 430 },
  globalResultsContent: { gap: 8, paddingBottom: 4 },
  globalResultRow: {
    minHeight: 74,
    borderWidth: 1,
    borderRadius: 10,
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  globalResultThumb: {
    width: 54,
    height: 54,
    borderRadius: 8,
    overflow: "hidden",
  },
  globalResultPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  globalResultCopy: { flex: 1, minWidth: 0, gap: 3 },
  globalResultName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  globalResultContext: { fontSize: 12, fontFamily: "Inter_400Regular" },
  globalResultMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  globalResultValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  globalReadinessChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  globalReadinessText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  globalEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    gap: 7,
  },
  globalEmptyTitle: { fontSize: 15, fontFamily: "Inter_700Bold", textAlign: "center" },
  globalEmptyBody: {
    maxWidth: 280,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  statsCard: {
    borderWidth: 1.5,
    padding: 16,
    gap: 4,
  },
  summaryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  summaryTitleIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  summarySectionLabel: {
    marginBottom: 0,
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
  coverFallbackText: {
    marginTop: 12,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
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
  firstUseWrap: {
    paddingHorizontal: 16,
    paddingTop: 26,
    gap: 12,
  },
  firstUseCard: {
    borderWidth: 1,
    padding: 18,
    alignItems: "center",
    gap: 10,
  },
  firstUseIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  firstUseTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  firstUseBody: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  firstUsePrimary: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  firstUsePrimaryText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  firstUseSteps: {
    gap: 10,
  },
  firstUseStep: {
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  firstUseStepIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  firstUseStepCopy: {
    flex: 1,
    gap: 2,
  },
  firstUseStepTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  firstUseStepBody: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
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
  cardActionRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  cardActionText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
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
