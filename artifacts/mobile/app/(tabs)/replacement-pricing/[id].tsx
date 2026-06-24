import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorState } from "@/components/ErrorState";
import { ContextBackButton } from "@/components/ContextBackButton";
import { LimitReachedModal } from "@/components/LimitReachedModal";
import { LoadingState } from "@/components/LoadingState";
import { ReplacementListingCard } from "@/components/ReplacementListingCard";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import {
  buildReplacementSearchQuery,
  filterReplacementResults,
  getItemUnitEstimate,
  ReplacementPriceSearchError,
  searchReplacementPrices,
  type ReplacementPriceFilter,
  type ReplacementPriceResult,
} from "@/lib/replacement-pricing";
import { normalizeLimitError, type NormalizedLimitError } from "@/lib/limit-errors";
import { supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";

const FILTERS: Array<{ id: ReplacementPriceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "lower", label: "Lower" },
  { id: "around", label: "Similar" },
  { id: "premium", label: "Higher" },
];

type LoadingTile = {
  icon: React.ComponentProps<typeof Feather>["name"];
};

const SEARCH_PROCESS_TILES: LoadingTile[] = [
  { icon: "search" },
  { icon: "box" },
  { icon: "tag" },
  { icon: "shopping-bag" },
  { icon: "sliders" },
  { icon: "check-circle" },
];

const ACTIVE_TILE_INDEX = 2;

function formatEstimate(value: number | null): string {
  if (value == null) return "No current estimate";
  return value.toLocaleString("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
  });
}

function ReplacementSearchLoadingPanel({
  colors,
}: {
  colors: ReturnType<typeof useColors>;
}) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const carousel = React.useRef(new Animated.Value(0)).current;
  const carouselTiles = React.useMemo(
    () => [...SEARCH_PROCESS_TILES, ...SEARCH_PROCESS_TILES],
    [],
  );

  React.useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1150,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1150,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const carouselLoop = Animated.loop(
      Animated.timing(carousel, {
        toValue: 1,
        duration: 5200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );

    pulseLoop.start();
    carouselLoop.start();
    return () => {
      pulseLoop.stop();
      carouselLoop.stop();
    };
  }, [carousel, pulse]);

  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.58, 0.92],
  });
  const iconScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const carouselTranslate = carousel.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, -154],
  });
  const tileScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.985, 1],
  });

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Searching replacement prices"
      style={[
        styles.loadingPanel,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
        },
      ]}
    >
      <View style={styles.loadingHeader}>
        <Animated.View
          style={[
            styles.loadingIconWrap,
            {
              backgroundColor: colors.secondary,
              transform: [{ scale: iconScale }],
            },
          ]}
        >
          <Feather name="search" size={22} color={colors.primary} />
          <Animated.View
            style={[
              styles.loadingDot,
              {
                backgroundColor: colors.primary,
                opacity: pulseOpacity,
              },
            ]}
          />
        </Animated.View>
        <View style={styles.loadingCopy}>
          <Text style={[styles.loadingTitle, { color: colors.foreground }]}>
            Searching replacement prices
          </Text>
          <Text style={[styles.loadingSubtitle, { color: colors.mutedForeground }]}>
            Checking current NZ listings for similar items...
          </Text>
        </View>
      </View>

      <View style={styles.loadingCarouselWindow}>
        <Animated.View
          style={[
            styles.loadingCarouselTrack,
            { transform: [{ translateX: carouselTranslate }] },
          ]}
        >
          {carouselTiles.map((tile, index) => {
            const isActive = index % SEARCH_PROCESS_TILES.length === ACTIVE_TILE_INDEX;
            return (
            <Animated.View
              key={`${tile.icon}-${index}`}
              style={[
                styles.loadingTile,
                {
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: isActive ? 1 : pulseOpacity,
                  transform: [{ scale: isActive ? tileScale : 1 }],
                },
              ]}
            >
              <View
                style={[
                  styles.loadingTileIcon,
                  {
                    backgroundColor: isActive ? colors.primary : colors.secondary,
                  },
                ]}
              >
                <Feather
                  name={tile.icon}
                  size={18}
                  color={isActive ? colors.primaryForeground : colors.primary}
                />
              </View>
            </Animated.View>
            );
          })}
        </Animated.View>
      </View>

      <Text style={[styles.loadingFooter, { color: colors.mutedForeground }]}>
        Comparing listings, prices, and retailers...
      </Text>
    </Animated.View>
  );
}

export default function ReplacementPricingScreen() {
  const { id, origin, itemName, roomId, roomName, fileId, fileName } = useLocalSearchParams<{
    id: string;
    origin?: "item" | "room";
    itemName?: string;
    roomId?: string;
    roomName?: string;
    fileId?: string;
    fileName?: string;
  }>();
  const { session } = useAuth();
  const { enforce } = useEntitlements();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ReplacementPriceResult[] | null>(null);
  const [filter, setFilter] = useState<ReplacementPriceFilter>("all");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [limitModal, setLimitModal] = useState<NormalizedLimitError | null>(null);
  const [selectingPosition, setSelectingPosition] = useState<number | null>(null);
  const autoSearchedItemId = React.useRef<string | null>(null);

  const {
    data: item,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["item", id, session?.user.id],
    queryFn: async () => {
      const { data, error: itemError } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("id", id)
        .single();
      if (itemError) throw itemError;
      return data as InventoryItem;
    },
    enabled: Boolean(session && id),
  });

  const estimate = item ? getItemUnitEstimate(item) : null;
  const filteredResults = useMemo(
    () => filterReplacementResults(results ?? [], filter, estimate),
    [results, filter, estimate],
  );

  const runSearch = React.useCallback(async (query: string) => {
    if (!item || !query.trim()) return;
    if (!enforce("replacement_pricing")) return;
    setSearching(true);
    setSearchError(null);
    setLimitModal(null);
    setFilter("all");
    try {
      const response = await searchReplacementPrices({
        itemName: item.name,
        description: item.description ?? undefined,
        category: item.category ?? undefined,
        brand: item.brand_maker ?? undefined,
        country: "NZ",
        searchQuery: query.trim(),
        num: 10,
        itemId: item.id,
      });
      setResults(response.results);
    } catch (searchFailure) {
      const normalizedLimit = searchFailure instanceof ReplacementPriceSearchError
        ? normalizeLimitError({
            status: searchFailure.status,
            errorCode: searchFailure.errorCode,
            responseBody: searchFailure.responseBody,
          })
        : null;

      setResults(null);
      if (normalizedLimit) {
        setLimitModal(normalizedLimit);
      } else {
        console.error("[replacement-pricing] Search failed", searchFailure);
        setSearchError("Replacement price search failed. Your item value is unchanged.");
      }
    } finally {
      setSearching(false);
    }
  }, [item, enforce]);

  const handleSearch = () => {
    void runSearch(searchQuery);
  };

  const goBackToItem = React.useCallback(() => {
    if (!item) {
      setLimitModal(null);
      return;
    }
    if (origin === "room") {
      router.dismissTo({
        pathname: "/(tabs)/room/[id]",
        params: {
          id: roomId ?? item.room_id ?? "",
          name: roomName ?? item.room ?? "Room",
          fileId: fileId ?? item.file_id,
          fileName: fileName ?? "Property",
        },
      } as Href);
    } else {
      router.dismissTo({
        pathname: "/(tabs)/item/[id]",
        params: {
          id: item.id,
          name: item.name,
          roomId: roomId ?? item.room_id ?? "",
          roomName: roomName ?? item.room ?? "Room",
          fileId: fileId ?? item.file_id,
          fileName: fileName ?? "Property",
        },
      } as Href);
    }
  }, [fileId, fileName, item, origin, roomId, roomName]);

  React.useEffect(() => {
    if (!item || autoSearchedItemId.current === item.id) return;
    const suggestedQuery = buildReplacementSearchQuery(item);
    autoSearchedItemId.current = item.id;
    setSearchQuery(suggestedQuery);
    void runSearch(suggestedQuery);
  }, [item, runSearch]);

  const handleOpen = async (result: ReplacementPriceResult) => {
    if (!/^https?:\/\//i.test(result.link)) return;
    await WebBrowser.openBrowserAsync(result.link);
  };

  const handleUse = async (result: ReplacementPriceResult) => {
    if (!item || result.price == null || result.price <= 0) return;
    setSelectingPosition(result.position);
    try {
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({
          estimated_price: result.price,
          unit_estimated_price: result.price,
          price_source_type: "web_listing",
          valuation_basis: "replacement_listing",
          web_listing_url: result.link,
          web_listing_title: result.title,
          web_listing_price: result.price,
          web_listing_source: result.source,
          web_listing_match_type: result.matchType,
        })
        .eq("id", item.id)
        .select("id")
        .single();
      if (updateError) throw updateError;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["item", item.id] }),
        queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
        queryClient.invalidateQueries({ queryKey: ["all-items"] }),
        queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
      ]);
      showToast("Replacement price updated");
      if (origin === "room") {
        router.dismissTo({
          pathname: "/(tabs)/room/[id]",
          params: {
            id: roomId ?? item.room_id ?? "",
            name: roomName ?? item.room ?? "Room",
            fileId: fileId ?? item.file_id,
            fileName: fileName ?? "Property",
          },
        } as Href);
      } else {
        router.dismissTo({
          pathname: "/(tabs)/item/[id]",
          params: {
            id: item.id,
            name: item.name,
            roomId: roomId ?? item.room_id ?? "",
            roomName: roomName ?? item.room ?? "Room",
            fileId: fileId ?? item.file_id,
            fileName: fileName ?? "Property",
          },
        } as Href);
      }
    } catch (updateFailure) {
      console.error("[replacement-pricing] Listing save failed", updateFailure);
      Alert.alert(
        "Couldn’t update item",
        updateFailure instanceof Error ? updateFailure.message : "Please try again.",
      );
    } finally {
      setSelectingPosition(null);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Replacement pricing",
          headerBackVisible: false,
          headerLeft: () => (
            <ContextBackButton
              label={origin === "room" ? roomName ?? item?.room ?? "Room" : itemName ?? item?.name ?? "Item"}
              onPress={() => {
                if (origin === "room") {
                  router.replace({
                    pathname: "/(tabs)/room/[id]",
                    params: {
                      id: roomId ?? item?.room_id ?? "",
                      name: roomName ?? item?.room ?? "Room",
                      fileId: fileId ?? item?.file_id ?? "",
                      fileName: fileName ?? "Property",
                    },
                  });
                } else {
                  router.replace({
                    pathname: "/(tabs)/item/[id]",
                    params: {
                      id,
                      name: itemName ?? item?.name ?? "Item",
                      roomId: roomId ?? item?.room_id ?? "",
                      roomName: roomName ?? item?.room ?? "Room",
                      fileId: fileId ?? item?.file_id ?? "",
                      fileName: fileName ?? "Property",
                    },
                  });
                }
              }}
            />
          ),
        }}
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState
          message="Failed to load item"
          detail={(error as Error).message}
          onRetry={refetch}
        />
      ) : item ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 32 },
          ]}
        >
          <View
            style={[
              styles.summary,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>ITEM</Text>
            <Text style={[styles.itemName, { color: colors.foreground }]}>{item.name}</Text>
            <Text style={[styles.estimate, { color: colors.mutedForeground }]}>
              Current per-item estimate: {formatEstimate(estimate)}
              {(item.quantity ?? 1) > 1 ? ` · Quantity ${item.quantity}` : ""}
            </Text>
          </View>

          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            Find comparable NZ listings. Your item value changes only when you choose
            “Use this listing”.
          </Text>

          <View style={styles.searchRow}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Brand, model, item"
              placeholderTextColor={colors.mutedForeground}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
              editable={!searching}
              style={[
                styles.searchInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.input,
                },
              ]}
            />
            <Pressable
              onPress={handleSearch}
              disabled={searching || !searchQuery.trim()}
              style={({ pressed }) => [
                styles.searchButton,
                {
                  backgroundColor: colors.primary,
                  opacity: searching ? 0.82 : !searchQuery.trim() ? 0.45 : pressed ? 0.8 : 1,
                },
              ]}
            >
              {searching ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Feather name="search" size={18} color={colors.primaryForeground} />
              )}
            </Pressable>
          </View>

          {!searching && searchError ? (
            <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
              <Feather name="alert-circle" size={17} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>
                {searchError}. Your item value is unchanged.
              </Text>
            </View>
          ) : null}

          {searching ? (
            <ReplacementSearchLoadingPanel colors={colors} />
          ) : results ? (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filters}
              >
                {FILTERS.map((option) => {
                  const active = option.id === filter;
                  const disabled = option.id !== "all" && estimate == null;
                  return (
                    <Pressable
                      key={option.id}
                      disabled={disabled}
                      onPress={() => setFilter(option.id)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                          opacity: disabled ? 0.45 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterText,
                          { color: active ? colors.primaryForeground : colors.foreground },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>
                {filteredResults.length} of {results.length} listings
              </Text>

              {filteredResults.length ? (
                <View style={styles.results}>
                  {filteredResults.map((result) => (
                    <ReplacementListingCard
                      key={`${result.position}-${result.link}-${result.title}`}
                      result={result}
                      selecting={selectingPosition === result.position}
                      onOpen={() => handleOpen(result)}
                      onUse={() => handleUse(result)}
                    />
                  ))}
                </View>
              ) : (
                <View style={[styles.empty, { backgroundColor: colors.card }]}>
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    No listings in this range
                  </Text>
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    Try another filter or refine the search terms.
                  </Text>
                </View>
              )}
            </>
          ) : !searching ? (
            <View style={[styles.empty, { backgroundColor: colors.card }]}>
              <Feather name="search" size={26} color={colors.primary} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Search NZ replacement listings
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Results may be comparable replacements rather than the exact original item.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
      <LimitReachedModal
        visible={!!limitModal}
        content={limitModal}
        onPrimary={() => {
          setLimitModal(null);
          router.push({ pathname: "/upgrade", params: { feature: "replacement_pricing" } } as Href);
        }}
        onSecondary={goBackToItem}
        onDismiss={() => setLimitModal(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  summary: { borderWidth: 1, padding: 16, gap: 5 },
  eyebrow: { fontSize: 10, letterSpacing: 0.8, fontFamily: "Inter_600SemiBold" },
  itemName: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  estimate: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  helper: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 13,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  searchButton: {
    width: 48,
    minHeight: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  filters: { gap: 8, paddingVertical: 2 },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  filterText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  resultCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  results: { gap: 12 },
  loadingPanel: {
    borderWidth: 1,
    padding: 16,
    gap: 16,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  loadingHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  loadingIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingDot: {
    position: "absolute",
    right: 11,
    top: 11,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  loadingCopy: { flex: 1, gap: 3 },
  loadingTitle: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
  loadingSubtitle: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  loadingCarouselWindow: {
    minHeight: 104,
    overflow: "hidden",
    justifyContent: "center",
  },
  loadingCarouselTrack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  loadingTile: {
    width: 68,
    minHeight: 68,
    borderWidth: 1,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingTileIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingFooter: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  empty: { borderRadius: 12, padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
