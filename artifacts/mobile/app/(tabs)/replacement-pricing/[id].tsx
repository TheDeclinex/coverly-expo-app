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
import { ReplacementSearchRefinementModal } from "@/components/ReplacementSearchRefinementModal";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { callVoiceDescribe } from "@/lib/voice-input";
import {
  mainReplacementVoiceDisabled,
  shouldApplyMainReplacementVoiceResult,
} from "@/lib/replacement-pricing-voice-state";
import {
  areReplacementCriteriaEqual,
  buildOriginalReplacementCriteria,
  buildReplacementPriceSearchRequest,
  buildReplacementRefinementDraft,
  buildReplacementSearchQuery,
  canStartReplacementSearch,
  filterReplacementResults,
  filterReplacementResultsToPriceRange,
  getItemUnitEstimate,
  replacementCriteriaDetails,
  replacementPriceRangeDescription,
  replacementSearchFailed,
  replacementSearchSucceeded,
  replacementVoiceTranscriptToQuery,
  ReplacementPriceSearchError,
  searchReplacementPrices,
  type ReplacementPriceFilter,
  type ReplacementPriceResult,
  type ReplacementSearchCriteria,
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
const VOICE_EDIT_FALLBACK_MESSAGE = "Voice edit could not start. Please try again or type your changes manually.";

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
  const voice = useVoiceRecording(20, "replacement_price_voice_search");
  const {
    permission: voicePermission,
    requestPermission: requestVoicePermission,
    isRequestingPermission: voiceIsRequestingPermission,
    isStartingRecording: voiceIsStartingRecording,
    isRecording: voiceIsRecording,
    maxDurationReached: voiceMaxDurationReached,
    startRecording: startVoiceRecording,
    stopRecording: stopVoiceRecording,
    reset: resetVoiceRecording,
    logDiagnostic: logVoiceDiagnostic,
  } = voice;

  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ReplacementPriceResult[] | null>(null);
  const [filter, setFilter] = useState<ReplacementPriceFilter>("all");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [limitModal, setLimitModal] = useState<NormalizedLimitError | null>(null);
  const [selectingPosition, setSelectingPosition] = useState<number | null>(null);
  const [originalCriteria, setOriginalCriteria] = useState<ReplacementSearchCriteria | null>(null);
  const [currentCriteria, setCurrentCriteria] = useState<ReplacementSearchCriteria | null>(null);
  const [refinementVisible, setRefinementVisible] = useState(false);
  const [searchKind, setSearchKind] = useState<"initial" | "refined" | "original">("initial");
  const autoSearchedItemId = React.useRef<string | null>(null);
  const searchInFlightRef = React.useRef(false);
  const searchControllerRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);
  const refinementVisibleRef = React.useRef(false);
  const mainVoiceRequestIdRef = React.useRef(0);

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

  const activeCriteriaDetails = useMemo(
    () => (currentCriteria ? replacementCriteriaDetails(currentCriteria) : []),
    [currentCriteria],
  );
  const currentSearchIsRefined = !areReplacementCriteriaEqual(currentCriteria, originalCriteria);
  const currentPriceRangeDescription = currentCriteria
    ? replacementPriceRangeDescription(currentCriteria)
    : null;
  const refinementItemContext = useMemo(
    () => ({
      itemName: item?.name ?? itemName ?? "Item",
      description: item?.description,
      category: item?.category,
      brand: item?.brand_maker,
      model: item?.model_series,
      condition: item?.condition_label,
    }),
    [item, itemName],
  );
  const refinementDraft = useMemo(
    () => buildReplacementRefinementDraft(
      currentCriteria ?? originalCriteria ?? { searchTerm: searchQuery },
      searchQuery,
      !currentSearchIsRefined && item
        ? {
            brand: item.brand_maker ?? "",
            model: item.model_series ?? "",
            additionalDetails: item.description ?? "",
          }
        : undefined,
    ),
    [currentCriteria, currentSearchIsRefined, item, originalCriteria, searchQuery],
  );

  const runSearch = React.useCallback(async (
    criteria: ReplacementSearchCriteria,
    kind: "initial" | "refined" | "original",
  ) => {
    if (!item || !canStartReplacementSearch(searchInFlightRef.current, criteria.searchTerm)) return;
    if (!enforce("replacement_pricing")) return;
    searchInFlightRef.current = true;
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setSearching(true);
    setSearchKind(kind);
    setSearchError(null);
    setSearchNotice(null);
    setLimitModal(null);
    try {
      const response = await searchReplacementPrices(
        buildReplacementPriceSearchRequest(item, criteria),
        { signal: controller.signal },
      );
      if (!mountedRef.current) return;
      const returnedResults = filterReplacementResultsToPriceRange(
        response.results,
        criteria.minPrice,
        criteria.maxPrice,
      );
      const hasPriceRange = criteria.minPrice != null || criteria.maxPrice != null;
      const nextState = replacementSearchSucceeded(returnedResults, {
        currentResults: results,
        currentFilter: filter,
        preservePreviousWhenEmpty: kind === "refined" && hasPriceRange,
      });
      if (nextState.preservedPrevious) {
        const attemptedRange = replacementPriceRangeDescription(criteria);
        setSearchNotice(
          `No listings were found ${attemptedRange ?? "within this price range"}. Try widening the range.`,
        );
        return;
      }
      setResults(nextState.results);
      setFilter(nextState.filter);
      setCurrentCriteria(criteria);
      setSearchQuery(criteria.searchTerm);
    } catch (searchFailure) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const normalizedLimit = searchFailure instanceof ReplacementPriceSearchError
        ? normalizeLimitError({
            status: searchFailure.status,
            errorCode: searchFailure.errorCode,
            responseBody: searchFailure.responseBody,
          })
        : null;

      setResults((current) => replacementSearchFailed(current));
      if (normalizedLimit) {
        setLimitModal(normalizedLimit);
      } else {
        const message = searchFailure instanceof Error ? searchFailure.message : "Replacement price search failed. Your item value is unchanged.";
        const expectedNetworkFailure = /offline|connection|network|timed out|try again/i.test(message);
        if (__DEV__ && !expectedNetworkFailure) console.error("[replacement-pricing] Search failed", searchFailure);
        setSearchError(searchFailure instanceof ReplacementPriceSearchError ? message : "Replacement price search failed. Please try again.");
      }
    } finally {
      searchInFlightRef.current = false;
      if (searchControllerRef.current === controller) searchControllerRef.current = null;
      if (mountedRef.current) setSearching(false);
    }
  }, [item, enforce, filter, results]);

  const openRefinementModal = React.useCallback(() => {
    mainVoiceRequestIdRef.current += 1;
    refinementVisibleRef.current = true;
    setRefinementVisible(true);
    setVoiceProcessing(false);
    setVoiceError(null);
    setVoiceNotice(null);
    void resetVoiceRecording();
  }, [resetVoiceRecording]);

  const closeRefinementModal = React.useCallback(() => {
    refinementVisibleRef.current = false;
    setRefinementVisible(false);
  }, []);

  const mainVoiceDisabled = mainReplacementVoiceDisabled({
    searching,
    processing: voiceProcessing,
    requestingPermission: voiceIsRequestingPermission,
    startingRecording: voiceIsStartingRecording,
    refinementVisible,
  });

  const handleSearch = () => {
    if (!item) return;
    if (results !== null) {
      openRefinementModal();
      return;
    }
    const base = originalCriteria ?? buildOriginalReplacementCriteria(item, searchQuery);
    void runSearch({ ...base, searchTerm: searchQuery.trim() }, "initial");
  };

  const stopAndTranscribeSearch = React.useCallback(async () => {
    const requestId = mainVoiceRequestIdRef.current;
    if (refinementVisibleRef.current) {
      await resetVoiceRecording();
      return;
    }
    setVoiceError(null);
    setVoiceNotice(null);
    const recording = await stopVoiceRecording();
    const canApply = () =>
      shouldApplyMainReplacementVoiceResult({
        requestId,
        activeRequestId: mainVoiceRequestIdRef.current,
        refinementVisible: refinementVisibleRef.current,
        mounted: mountedRef.current,
      });
    if (!recording) {
      if (canApply()) setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
      return;
    }

    if (!canApply()) {
      await resetVoiceRecording();
      return;
    }
    setVoiceProcessing(true);
    try {
      const result = await callVoiceDescribe(recording, {
        mode: "item_edit",
        currentName: item?.name,
        currentCategory: item?.category ?? undefined,
        currentDescription: searchQuery,
      });
      const transcript = result.response?.success
        ? replacementVoiceTranscriptToQuery(result.response.transcript)
        : "";
      if (!canApply()) return;
      if (!transcript) {
        setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
        return;
      }
      setSearchQuery(transcript);
    } catch {
      if (canApply()) setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
    } finally {
      if (canApply()) setVoiceProcessing(false);
      await resetVoiceRecording();
    }
  }, [item?.category, item?.name, resetVoiceRecording, searchQuery, stopVoiceRecording]);

  const handleVoiceSearchDescription = React.useCallback(async () => {
    if (
      mainReplacementVoiceDisabled({
        searching,
        processing: voiceProcessing,
        requestingPermission: voiceIsRequestingPermission,
        startingRecording: voiceIsStartingRecording,
        refinementVisible: refinementVisibleRef.current,
      })
    )
      return;
    setVoiceError(null);
    setVoiceNotice(null);
    if (voiceIsRecording) {
      await stopAndTranscribeSearch();
      return;
    }
    const requestId = mainVoiceRequestIdRef.current + 1;
    mainVoiceRequestIdRef.current = requestId;
    const canApply = () =>
      shouldApplyMainReplacementVoiceResult({
        requestId,
        activeRequestId: mainVoiceRequestIdRef.current,
        refinementVisible: refinementVisibleRef.current,
        mounted: mountedRef.current,
      });
    if (voicePermission !== "granted") {
      logVoiceDiagnostic("voice_permission_button_pressed");
      try {
        const granted = await requestVoicePermission();
        if (!canApply()) return;
        if (granted) {
          setVoiceNotice("Microphone enabled. Tap the mic again to speak your search.");
        } else {
          setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
        }
      } catch {
        setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
      }
      return;
    }
    try {
      const started = await startVoiceRecording();
      if (!canApply()) {
        await resetVoiceRecording();
        return;
      }
      if (!started) {
        setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
      }
    } catch {
      setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
    }
  }, [
    logVoiceDiagnostic,
    requestVoicePermission,
    resetVoiceRecording,
    searching,
    startVoiceRecording,
    stopAndTranscribeSearch,
    voiceIsRecording,
    voiceIsRequestingPermission,
    voiceIsStartingRecording,
    voicePermission,
    voiceProcessing,
  ]);

  React.useEffect(() => {
    if (voiceMaxDurationReached && !refinementVisible)
      void stopAndTranscribeSearch();
  }, [refinementVisible, stopAndTranscribeSearch, voiceMaxDurationReached]);

  React.useEffect(() => () => {
    void resetVoiceRecording();
  }, [resetVoiceRecording]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mainVoiceRequestIdRef.current += 1;
      searchControllerRef.current?.abort();
      searchControllerRef.current = null;
      searchInFlightRef.current = false;
    };
  }, []);

  const returnRoomId = roomId ?? item?.room_id ?? "";
  const returnFileId = fileId ?? item?.file_id ?? "";
  const returnRoomName = roomName ?? item?.room ?? "Room";
  const returnFileName = fileName ?? "Property";

  const dismissToRoomOrProperty = React.useCallback(() => {
    if (returnRoomId) {
      router.dismissTo({
        pathname: "/(tabs)/room/[id]",
        params: {
          id: returnRoomId,
          name: returnRoomName,
          fileId: returnFileId,
          fileName: returnFileName,
        },
      } as Href);
      return;
    }
    if (returnFileId) {
      router.dismissTo({
        pathname: "/(tabs)/property/[id]",
        params: { id: returnFileId, name: returnFileName },
      } as Href);
      return;
    }
    router.back();
  }, [returnFileId, returnFileName, returnRoomId, returnRoomName]);

  const replaceToRoomOrProperty = React.useCallback(() => {
    if (returnRoomId) {
      router.replace({
        pathname: "/(tabs)/room/[id]",
        params: {
          id: returnRoomId,
          name: returnRoomName,
          fileId: returnFileId,
          fileName: returnFileName,
        },
      } as Href);
      return;
    }
    if (returnFileId) {
      router.replace({
        pathname: "/(tabs)/property/[id]",
        params: { id: returnFileId, name: returnFileName },
      } as Href);
      return;
    }
    router.back();
  }, [returnFileId, returnFileName, returnRoomId, returnRoomName]);
  const goBackToItem = React.useCallback(() => {
    if (!item) {
      setLimitModal(null);
      return;
    }
    if (origin === "room") {
      dismissToRoomOrProperty();
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
  }, [dismissToRoomOrProperty, fileId, fileName, item, origin, roomId, roomName]);

  React.useEffect(() => {
    if (!item || autoSearchedItemId.current === item.id) return;
    const suggestedQuery = buildReplacementSearchQuery(item);
    const criteria = buildOriginalReplacementCriteria(item, suggestedQuery);
    autoSearchedItemId.current = item.id;
    setOriginalCriteria(criteria);
    setSearchQuery(criteria.searchTerm);
    void runSearch(criteria, "initial");
  }, [item, runSearch]);

  const handleRefinedSearch = React.useCallback((criteria: ReplacementSearchCriteria) => {
    closeRefinementModal();
    void runSearch(criteria, "refined");
  }, [closeRefinementModal, runSearch]);

  const handleRerunOriginalSearch = React.useCallback(() => {
    if (!originalCriteria) return;
    setSearchQuery(originalCriteria.searchTerm);
    void runSearch(originalCriteria, "original");
  }, [originalCriteria, runSearch]);

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
      dismissToRoomOrProperty();
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
      if (__DEV__) console.error("[replacement-pricing] Listing save failed", updateFailure);
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
                  replaceToRoomOrProperty();
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

          <Text style={[styles.searchLabel, { color: colors.mutedForeground }]}>SEARCH TERM</Text>
          <View style={styles.searchRow}>
            <View
              style={[
                styles.searchInputWrap,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.input,
                },
              ]}
            >
              <TextInput
                value={searchQuery}
                onChangeText={(value) => {
                  setSearchQuery(value);
                  setSearchNotice(null);
                  setVoiceError(null);
                  setVoiceNotice(null);
                }}
                placeholder="Brand, model, item"
                placeholderTextColor={colors.mutedForeground}
                returnKeyType="search"
                onSubmitEditing={handleSearch}
                editable={!searching}
                style={[
                  styles.searchInput,
                  {
                    color: colors.foreground,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Speak search description"
                disabled={mainVoiceDisabled}
                onPress={() => void handleVoiceSearchDescription()}
                style={({ pressed }) => [
                  styles.voiceButton,
                  {
                    backgroundColor: voiceIsRecording ? colors.primary : colors.secondary,
                    opacity: mainVoiceDisabled ? 0.5 : pressed ? 0.72 : 1,
                  },
                ]}
              >
                {voiceProcessing || voiceIsRequestingPermission || voiceIsStartingRecording ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name={voiceIsRecording ? "square" : "mic"} size={16} color={voiceIsRecording ? colors.primaryForeground : colors.primary} />
                )}
              </Pressable>
            </View>
            {results === null ? (
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
            ) : null}
          </View>

          {voiceIsRecording || voiceProcessing || voiceError || voiceNotice ? (
            <Text style={[styles.voiceStatus, { color: voiceError ? colors.destructive : colors.mutedForeground }]}>
              {voiceError ?? voiceNotice ?? (voiceProcessing ? "Transcribing..." : "Listening... tap the mic to finish.")}
            </Text>
          ) : null}

          {results !== null && currentCriteria ? (
            <View
              style={[
                styles.criteriaCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <View style={styles.criteriaHeader}>
                <View style={styles.criteriaCopy}>
                  <Text style={[styles.criteriaEyebrow, { color: colors.mutedForeground }]}>
                    {currentSearchIsRefined ? "CURRENT REFINED SEARCH" : "CURRENT SEARCH"}
                  </Text>
                  <Text style={[styles.criteriaTerm, { color: colors.foreground }]}>
                    {currentCriteria.searchTerm}
                  </Text>
                </View>
                <Feather name="check-circle" size={19} color={colors.primary} />
              </View>
              {activeCriteriaDetails.length ? (
                <Text style={[styles.criteriaDetails, { color: colors.mutedForeground }]} numberOfLines={3}>
                  {activeCriteriaDetails.join("  ·  ")}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={searching}
                onPress={openRefinementModal}
                style={({ pressed }) => [
                  styles.refineButton,
                  { backgroundColor: colors.primary, opacity: searching ? 0.5 : pressed ? 0.82 : 1 },
                ]}
              >
                <Feather name="sliders" size={17} color={colors.primaryForeground} />
                <Text style={[styles.refineButtonText, { color: colors.primaryForeground }]}>Refine search</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={searching || !originalCriteria}
                onPress={handleRerunOriginalSearch}
                style={({ pressed }) => [
                  styles.originalButton,
                  { borderColor: colors.border, opacity: searching || !originalCriteria ? 0.45 : pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="rotate-ccw" size={15} color={colors.primary} />
                <Text style={[styles.originalButtonText, { color: colors.primary }]}>Rerun original search</Text>
              </Pressable>
              <Text style={[styles.newSearchHelper, { color: colors.mutedForeground }]}>Refining or rerunning starts a new price search.</Text>
            </View>
          ) : null}

          {!searching && searchError ? (
            <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
              <Feather name="alert-circle" size={17} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>
                {searchError}. Your item value is unchanged.
              </Text>
            </View>
          ) : null}

          {!searching && searchNotice ? (
            <View style={[styles.noticeBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="info" size={17} color={colors.primary} />
              <Text style={[styles.noticeText, { color: colors.foreground }]}>{searchNotice}</Text>
            </View>
          ) : null}

          {searching && results === null ? (
            <ReplacementSearchLoadingPanel colors={colors} />
          ) : results !== null ? (
            <>
              {searching ? (
                <View
                  accessibilityRole="progressbar"
                  style={[
                    styles.refreshingBanner,
                    { backgroundColor: colors.secondary, borderColor: colors.border },
                  ]}
                >
                  <ActivityIndicator size="small" color={colors.primary} />
                  <View style={styles.refreshingCopy}>
                    <Text style={[styles.refreshingTitle, { color: colors.foreground }]}>Searching new listings</Text>
                    <Text style={[styles.refreshingText, { color: colors.mutedForeground }]}>Your current results stay visible while the {searchKind === "refined" ? "refined" : "original"} search runs.</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.filterHeading}>
                <Text style={[styles.filterEyebrow, { color: colors.mutedForeground }]}>FILTER THESE RESULTS</Text>
                <Text style={[styles.filterHelper, { color: colors.mutedForeground }]}>Low, Similar, and High only filter the listings already returned.</Text>
                {estimate == null ? (
                  <Text style={[styles.filterHelper, { color: colors.mutedForeground }]}>Add an estimated replacement value to enable Low, Similar and High filters.</Text>
                ) : null}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filters}
              >
                {FILTERS.map((option) => {
                  const active = option.id === filter;
                  const disabled = searching || (option.id !== "all" && estimate == null);
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
                {currentPriceRangeDescription
                  ? filter === "all"
                    ? `${results.length} ${results.length === 1 ? "listing" : "listings"} found ${currentPriceRangeDescription}.`
                    : `${filteredResults.length} of ${results.length} listings shown ${currentPriceRangeDescription}.`
                  : `${filteredResults.length} of ${results.length} listings`}
              </Text>

              {filteredResults.length ? (
                <View style={styles.results}>
                  {filteredResults.map((result) => (
                    <ReplacementListingCard
                      key={`${result.position}-${result.link}-${result.title}`}
                      result={result}
                      selecting={selectingPosition === result.position}
                      disabled={searching}
                      onOpen={() => handleOpen(result)}
                      onUse={() => handleUse(result)}
                    />
                  ))}
                </View>
              ) : (
                <View style={[styles.empty, { backgroundColor: colors.card }]}>
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    {results.length ? "No listings in this range" : "No listings found"}
                  </Text>
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    {results.length ? "Try another filter or refine the search terms." : "Adjust the search details and run another refined search."}
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
      <ReplacementSearchRefinementModal
        visible={refinementVisible}
        initialDraft={refinementDraft}
        itemContext={refinementItemContext}
        submitting={searching}
        onDismiss={closeRefinementModal}
        onSubmit={handleRefinedSearch}
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
  searchLabel: { marginBottom: -8, fontSize: 10, letterSpacing: 0.8, fontFamily: "Inter_600SemiBold" },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInputWrap: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingLeft: 13,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 0,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  voiceButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceStatus: {
    marginTop: -6,
    fontSize: 12,
    lineHeight: 17,
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
  noticeBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium" },
  criteriaCard: { borderWidth: 1, padding: 14, gap: 10 },
  criteriaHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  criteriaCopy: { flex: 1, gap: 3 },
  criteriaEyebrow: { fontSize: 10, letterSpacing: 0.7, fontFamily: "Inter_600SemiBold" },
  criteriaTerm: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
  criteriaDetails: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  refineButton: { minHeight: 46, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14 },
  refineButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  originalButton: { minHeight: 42, borderWidth: 1, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12 },
  originalButtonText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  newSearchHelper: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", textAlign: "center" },
  refreshingBanner: { borderWidth: 1, borderRadius: 11, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  refreshingCopy: { flex: 1, gap: 2 },
  refreshingTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  refreshingText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  filterHeading: { gap: 2 },
  filterEyebrow: { fontSize: 10, letterSpacing: 0.7, fontFamily: "Inter_600SemiBold" },
  filterHelper: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
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
