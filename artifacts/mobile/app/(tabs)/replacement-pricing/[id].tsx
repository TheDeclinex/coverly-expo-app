import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  AccessibilityInfo,
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
import { ReplacementSearchRefinementSheet } from "@/components/ReplacementSearchRefinementSheet";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { callVoiceDescribe } from "@/lib/voice-input";
import {
  buildReplacementSearchQuery,
  filterReplacementResults,
  getItemUnitEstimate,
  replacementVoiceTranscriptToQuery,
  ReplacementPriceSearchError,
  searchReplacementPrices,
  type ReplacementPriceFilter,
  type ReplacementPriceResult,
  type ReplacementSearchContext,
} from "@/lib/replacement-pricing";
import { normalizeLimitError, type NormalizedLimitError } from "@/lib/limit-errors";
import { replacementMarketPresentation } from "@/lib/replacement-market-presentation";
import { buildReplacementListingUpdate, resolveReplacementListingCurrency } from "@/lib/replacement-listing-policy";
import { supabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/money";
import {
  buildCurrentSearchSummary,
  cloneReplacementRefinementDraft,
  createOriginalReplacementRefinementDraft,
  effectiveRefinementFieldValue,
  validateReplacementPriceRange,
  type ParsedReplacementPriceRange,
  type ReplacementRefinementDraft,
} from "@/lib/replacement-refinement-model";
import { resolveMarketConfig } from "@/constants/market-config";
import type { InventoryFile, InventoryItem } from "@/types";

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

function formatEstimate(value: number | null, currencyCode: string, contextCurrency?: string | null): string {
  if (value == null) return "No current estimate";
  return formatMoney(value, currencyCode, { contextCurrency, precision: "value" });
}

function ReplacementSearchLoadingPanel({
  colors,
  title = "Searching replacement prices",
  subtitle,
  accessibilityLabel,
  onCancel,
}: {
  colors: ReturnType<typeof useColors>;
  title?: string;
  subtitle: string;
  accessibilityLabel: string;
  onCancel?: () => void;
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
      accessibilityLabel={accessibilityLabel}
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
            {title}
          </Text>
          <Text style={[styles.loadingSubtitle, { color: colors.mutedForeground }]}>
            {subtitle}
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
      {onCancel ? (
        <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.loadingCancel, { borderColor: colors.border }]}>
          <Text style={[styles.loadingCancelText, { color: colors.foreground }]}>Cancel search</Text>
        </Pressable>
      ) : null}
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
  const [searchContext, setSearchContext] = useState<ReplacementSearchContext | null>(null);
  const [filter, setFilter] = useState<ReplacementPriceFilter>("all");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [limitModal, setLimitModal] = useState<NormalizedLimitError | null>(null);
  const [selectingPosition, setSelectingPosition] = useState<number | null>(null);
  const [refinementVisible, setRefinementVisible] = useState(false);
  const [originalRefinementDraft, setOriginalRefinementDraft] = useState<ReplacementRefinementDraft | null>(null);
  const [workingRefinementDraft, setWorkingRefinementDraft] = useState<ReplacementRefinementDraft | null>(null);
  const [lastSuccessfulRefinementDraft, setLastSuccessfulRefinementDraft] = useState<ReplacementRefinementDraft | null>(null);
  const [currentSearchDraft, setCurrentSearchDraft] = useState<ReplacementRefinementDraft | null>(null);
  const [refinedSearching, setRefinedSearching] = useState(false);
  const [lastFailedRefinement, setLastFailedRefinement] = useState<{
    draft: ReplacementRefinementDraft;
    range: ParsedReplacementPriceRange;
  } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const autoSearchedItemId = React.useRef<string | null>(null);
  const refinementSeededItemId = React.useRef<string | null>(null);
  const activeSearchSequence = React.useRef(0);
  const searchAttemptInFlight = React.useRef(false);
  const refinedAbortController = React.useRef<AbortController | null>(null);
  const screenMountedRef = React.useRef(true);
  const initialVoiceSequence = React.useRef(0);
  const resetVoiceRecordingRef = React.useRef(resetVoiceRecording);
  resetVoiceRecordingRef.current = resetVoiceRecording;
  const resultEntrance = React.useRef(new Animated.Value(1)).current;

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

  const {
    data: propertyMarket,
    isPending: propertyMarketPending,
  } = useQuery({
    queryKey: ["replacement-pricing-property-market", item?.file_id, session?.user.id],
    queryFn: async () => {
      const { data, error: propertyError } = await supabase
        .from("inventory_files")
        .select("country_code,currency_code")
        .eq("id", item!.file_id)
        .single();
      if (propertyError) throw propertyError;
      return data as Pick<InventoryFile, "country_code" | "currency_code">;
    },
    enabled: Boolean(session && item?.file_id),
  });

  const activeMarketContext = searchContext ?? (propertyMarket ? {
    countryCode: propertyMarket.country_code,
    currencyCode: propertyMarket.currency_code,
  } : null);
  const marketPresentation = useMemo(
    () => replacementMarketPresentation(activeMarketContext),
    [activeMarketContext],
  );
  const configuredMarket = useMemo(
    () => resolveMarketConfig(activeMarketContext?.countryCode),
    [activeMarketContext?.countryCode],
  );
  const currentSearchSummary = useMemo(
    () => currentSearchDraft ? buildCurrentSearchSummary(currentSearchDraft) : null,
    [currentSearchDraft],
  );
  const currentSearchPriceSummary = useMemo(() => {
    if (!currentSearchDraft || !activeMarketContext?.currencyCode) return null;
    const validation = validateReplacementPriceRange(
      currentSearchDraft.minimumPrice,
      currentSearchDraft.maximumPrice,
      activeMarketContext.currencyCode,
      configuredMarket?.locale,
    );
    const minimum = validation.parsed.minimumPrice;
    const maximum = validation.parsed.maximumPrice;
    if (minimum == null && maximum == null) return null;
    if (minimum != null && maximum != null) {
      return `${formatMoney(minimum, activeMarketContext.currencyCode, { contextCurrency: activeMarketContext.currencyCode, precision: "value" })}–${formatMoney(maximum, activeMarketContext.currencyCode, { contextCurrency: activeMarketContext.currencyCode, precision: "value" })}`;
    }
    return minimum != null
      ? `From ${formatMoney(minimum, activeMarketContext.currencyCode, { contextCurrency: activeMarketContext.currencyCode, precision: "value" })}`
      : `Up to ${formatMoney(maximum, activeMarketContext.currencyCode, { contextCurrency: activeMarketContext.currencyCode, precision: "value" })}`;
  }, [activeMarketContext?.currencyCode, configuredMarket?.locale, currentSearchDraft]);

  React.useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const estimate = item ? getItemUnitEstimate(item) : null;
  const filteredResults = useMemo(
    () => filterReplacementResults(results ?? [], filter, estimate),
    [results, filter, estimate],
  );

  const runSearch = React.useCallback(async (
    query: string,
    options: {
      mode?: "initial" | "refined";
      draft?: ReplacementRefinementDraft;
      range?: ParsedReplacementPriceRange;
      entitlementAlreadyChecked?: boolean;
    } = {},
  ) => {
    if (!item || !query.trim()) return;
    if (!options.entitlementAlreadyChecked && !enforce("replacement_pricing")) return;
    if (searchAttemptInFlight.current) return;
    searchAttemptInFlight.current = true;
    const mode = options.mode ?? "initial";
    const refinementDraft = mode === "refined" ? options.draft : undefined;
    const isRefined = refinementDraft != null;
    const sequence = activeSearchSequence.current + 1;
    activeSearchSequence.current = sequence;
    if (isRefined) {
      refinedAbortController.current?.abort();
      refinedAbortController.current = new AbortController();
      setRefinedSearching(true);
    }
    setSearching(true);
    setSearchError(null);
    setLimitModal(null);
    try {
      const response = await searchReplacementPrices({
        itemName: item.name,
        countryCode: propertyMarket?.country_code,
        currencyCode: propertyMarket?.currency_code,
        description: isRefined
          ? effectiveRefinementFieldValue(refinementDraft, "additionalDetails") || undefined
          : item.description ?? undefined,
        category: item.category ?? undefined,
        brand: isRefined
          ? effectiveRefinementFieldValue(refinementDraft, "brand") || undefined
          : item.brand_maker ?? undefined,
        minPrice: options.range?.minimumPrice,
        maxPrice: options.range?.maximumPrice,
        searchQuery: query.trim(),
        num: 10,
        itemId: item.id,
        refinement: isRefined ? {
          version: 2,
          searchTerm: refinementDraft.searchTerm.trim(),
          brand: refinementDraft.brand.trim() || undefined,
          model: refinementDraft.model.trim() || undefined,
          additionalDetails: refinementDraft.additionalDetails.trim() || undefined,
          chipValues: refinementDraft.chipContributions.map((chip) => chip.value),
        } : undefined,
      }, {
        automaticTransportRetry: Boolean(isRefined),
        signal: isRefined ? refinedAbortController.current?.signal : undefined,
      });
      if (sequence !== activeSearchSequence.current) return;
      setFilter("all");
      setResults(response.results);
      setSearchContext(response.context);
      const successfulDraft = isRefined
        ? cloneReplacementRefinementDraft(refinementDraft)
        : {
            ...createOriginalReplacementRefinementDraft(item),
            searchTerm: query.trim(),
          };
      setCurrentSearchDraft(successfulDraft);
      setLastSuccessfulRefinementDraft(cloneReplacementRefinementDraft(successfulDraft));
      setWorkingRefinementDraft(cloneReplacementRefinementDraft(successfulDraft));
      if (isRefined) setLastFailedRefinement(null);
      if (!reduceMotion) {
        resultEntrance.setValue(0);
        Animated.timing(resultEntrance, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      } else {
        resultEntrance.setValue(1);
      }
    } catch (searchFailure) {
      if (sequence !== activeSearchSequence.current) return;
      if (searchFailure instanceof ReplacementPriceSearchError && searchFailure.errorCode === "CANCELLED") return;
      if (isRefined) {
        setLastFailedRefinement({
          draft: cloneReplacementRefinementDraft(refinementDraft),
          range: { ...options.range },
        });
      }
      const normalizedLimit = searchFailure instanceof ReplacementPriceSearchError
        ? normalizeLimitError({
            status: searchFailure.status,
            errorCode: searchFailure.errorCode,
            responseBody: searchFailure.responseBody,
          })
        : null;

      if (!isRefined) setResults(null);
      if (normalizedLimit) {
        setLimitModal(normalizedLimit);
      } else {
        const message = searchFailure instanceof Error ? searchFailure.message : "Replacement price search failed. Your item value is unchanged.";
        const expectedNetworkFailure = /offline|connection|network|timed out|try again/i.test(message);
        if (__DEV__ && !expectedNetworkFailure) console.error("[replacement-pricing] Search failed", searchFailure);
        setSearchError(searchFailure instanceof ReplacementPriceSearchError ? message : "Replacement price search failed. Your item value is unchanged.");
      }
    } finally {
      if (sequence === activeSearchSequence.current) {
        searchAttemptInFlight.current = false;
        setSearching(false);
        setRefinedSearching(false);
        refinedAbortController.current = null;
      }
    }
  }, [item, enforce, propertyMarket, reduceMotion, resultEntrance]);

  const handleSearch = () => {
    void runSearch(searchQuery);
  };

  const handleRunRefinedSearch = (
    submittedDraft: ReplacementRefinementDraft,
    range: ParsedReplacementPriceRange,
  ) => {
    if (!enforce("replacement_pricing")) return;
    setWorkingRefinementDraft(cloneReplacementRefinementDraft(submittedDraft));
    setRefinementVisible(false);
    const query = effectiveRefinementFieldValue(submittedDraft, "searchTerm");
    void runSearch(query, {
      mode: "refined",
      draft: submittedDraft,
      range,
      entitlementAlreadyChecked: true,
    });
  };

  const cancelRefinedSearch = () => {
    activeSearchSequence.current += 1;
    searchAttemptInFlight.current = false;
    refinedAbortController.current?.abort();
    refinedAbortController.current = null;
    setSearching(false);
    setRefinedSearching(false);
  };

  const stopAndTranscribeSearch = React.useCallback(async () => {
    const requestId = initialVoiceSequence.current + 1;
    initialVoiceSequence.current = requestId;
    setVoiceError(null);
    setVoiceNotice(null);
    const recording = await stopVoiceRecording();
    if (!screenMountedRef.current || requestId !== initialVoiceSequence.current) return;
    if (!recording) {
      setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
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
      if (!screenMountedRef.current || requestId !== initialVoiceSequence.current) return;
      const transcript = result.response?.success
        ? replacementVoiceTranscriptToQuery(result.response.transcript)
        : "";
      if (!transcript) {
        setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
        return;
      }
      setSearchQuery(transcript);
    } catch {
      if (screenMountedRef.current && requestId === initialVoiceSequence.current) {
        setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
      }
    } finally {
      if (screenMountedRef.current && requestId === initialVoiceSequence.current) {
        setVoiceProcessing(false);
      }
      await resetVoiceRecording();
    }
  }, [item?.category, item?.name, resetVoiceRecording, searchQuery, stopVoiceRecording]);

  const handleVoiceSearchDescription = React.useCallback(async () => {
    if (searching || voiceProcessing || voiceIsRequestingPermission || voiceIsStartingRecording) return;
    setVoiceError(null);
    setVoiceNotice(null);
    if (voiceIsRecording) {
      await stopAndTranscribeSearch();
      return;
    }
    const requestId = initialVoiceSequence.current + 1;
    initialVoiceSequence.current = requestId;
    if (voicePermission !== "granted") {
      logVoiceDiagnostic("voice_permission_button_pressed");
      try {
        const granted = await requestVoicePermission();
        if (!screenMountedRef.current || requestId !== initialVoiceSequence.current) return;
        if (granted) {
          setVoiceNotice("Microphone enabled. Tap the mic again to speak your search.");
        } else {
          setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
        }
      } catch {
        if (screenMountedRef.current && requestId === initialVoiceSequence.current) {
          setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
        }
      }
      return;
    }
    try {
      const started = await startVoiceRecording();
      if (!screenMountedRef.current || requestId !== initialVoiceSequence.current) {
        if (started) await resetVoiceRecordingRef.current();
        return;
      }
      if (!started) {
        setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
      }
    } catch {
      if (screenMountedRef.current && requestId === initialVoiceSequence.current) {
        setVoiceError(VOICE_EDIT_FALLBACK_MESSAGE);
      }
    }
  }, [
    logVoiceDiagnostic,
    requestVoicePermission,
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
    if (voiceMaxDurationReached) void stopAndTranscribeSearch();
  }, [stopAndTranscribeSearch, voiceMaxDurationReached]);

  React.useEffect(() => {
    screenMountedRef.current = true;
    return () => {
      screenMountedRef.current = false;
      initialVoiceSequence.current += 1;
      activeSearchSequence.current += 1;
      searchAttemptInFlight.current = false;
      void resetVoiceRecordingRef.current();
      refinedAbortController.current?.abort();
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
    if (!item || propertyMarketPending || autoSearchedItemId.current === item.id) return;
    const suggestedQuery = buildReplacementSearchQuery(item);
    if (refinementSeededItemId.current !== item.id) {
      const originalDraft = createOriginalReplacementRefinementDraft(item);
      refinementSeededItemId.current = item.id;
      setOriginalRefinementDraft(originalDraft);
      setWorkingRefinementDraft(cloneReplacementRefinementDraft(originalDraft));
      setLastSuccessfulRefinementDraft(cloneReplacementRefinementDraft(originalDraft));
      setCurrentSearchDraft(cloneReplacementRefinementDraft(originalDraft));
    }
    autoSearchedItemId.current = item.id;
    setSearchQuery(suggestedQuery);
    void runSearch(suggestedQuery);
  }, [item, propertyMarketPending, runSearch]);

  const handleOpen = async (result: ReplacementPriceResult) => {
    if (!/^https?:\/\//i.test(result.link)) return;
    await WebBrowser.openBrowserAsync(result.link);
  };

  const saveListing = async (result: ReplacementPriceResult, currencyCode: string) => {
    if (!item || result.price == null || result.price <= 0) return;
    const update = buildReplacementListingUpdate(result, currencyCode, {
      quantity: item.quantity,
      marketCountryCode: searchContext?.countryCode,
    });
    if (!update) return;
    setSelectingPosition(result.position);
    try {
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update(update)
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

  const handleUse = (result: ReplacementPriceResult) => {
    const currencyDecision = resolveReplacementListingCurrency(result, searchContext?.currencyCode);
    const currencyCode = currencyDecision.currencyCode;
    if (!currencyDecision.canUse || !currencyCode) return;
    if (currencyDecision.requiresForeignCurrencyConfirmation && searchContext) {
      Alert.alert("Use a foreign-currency listing?", `This listing is in ${currencyCode}, while the property uses ${searchContext.currencyCode}. Coverly will store the original amount without conversion and keep it separate in totals.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Use listing", onPress: () => void saveListing(result, currencyCode) },
      ]);
      return;
    }
    void saveListing(result, currencyCode);
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
              Current per-item estimate: {formatEstimate(estimate, item.estimated_currency ?? marketPresentation.currencyCode ?? "NZD", marketPresentation.currencyCode)}
              {(item.quantity ?? 1) > 1 ? ` · Quantity ${item.quantity}` : ""}
            </Text>
          </View>

          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            {marketPresentation.introLead} Your item value changes only when you choose
            “Use this listing”.
          </Text>

          {results !== null && currentSearchSummary && workingRefinementDraft ? (
            <View
              accessibilityLabel={[
                "Current search",
                currentSearchSummary.primary,
                ...currentSearchSummary.details,
                currentSearchPriceSummary,
              ].filter(Boolean).join(". ")}
              style={[styles.currentSearchCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.currentSearchCopy}>
                <Text style={[styles.currentSearchEyebrow, { color: colors.mutedForeground }]}>CURRENT SEARCH</Text>
                <Text numberOfLines={2} style={[styles.currentSearchPrimary, { color: colors.foreground }]}>{currentSearchSummary.primary}</Text>
                {currentSearchSummary.details.length ? (
                  <Text numberOfLines={2} style={[styles.currentSearchDetails, { color: colors.mutedForeground }]}>{currentSearchSummary.details.join(" · ")}</Text>
                ) : null}
                {currentSearchPriceSummary ? <Text style={[styles.currentSearchPrice, { color: colors.foreground }]}>{currentSearchPriceSummary}</Text> : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refine current search"
                disabled={searching}
                onPress={() => setRefinementVisible(true)}
                style={({ pressed }) => [styles.refineButton, { backgroundColor: colors.primary, opacity: searching ? 0.45 : pressed ? 0.8 : 1 }]}
              >
                <Feather name="sliders" size={16} color={colors.primaryForeground} />
                <Text style={[styles.refineButtonText, { color: colors.primaryForeground }]}>Refine</Text>
              </Pressable>
            </View>
          ) : null}

          {results === null ? (
          <>
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
                disabled={searching || voiceProcessing || voiceIsRequestingPermission || voiceIsStartingRecording}
                onPress={() => void handleVoiceSearchDescription()}
                style={({ pressed }) => [
                  styles.voiceButton,
                  {
                    backgroundColor: voiceIsRecording ? colors.primary : colors.secondary,
                    opacity: searching || voiceProcessing || voiceIsRequestingPermission || voiceIsStartingRecording ? 0.5 : pressed ? 0.72 : 1,
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={marketPresentation.searchAccessibilityLabel}
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

          {voiceIsRecording || voiceProcessing || voiceError || voiceNotice ? (
            <Text style={[styles.voiceStatus, { color: voiceError ? colors.destructive : colors.mutedForeground }]}>
              {voiceError ?? voiceNotice ?? (voiceProcessing ? "Transcribing..." : "Listening... tap the mic to finish.")}
            </Text>
          ) : null}
          </>
          ) : null}

          {!searching && searchError ? (
            <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
              <Feather name="alert-circle" size={17} color={colors.destructive} />
              <View style={styles.errorContent}>
                <Text style={[styles.errorText, { color: colors.destructive }]}>
                  {searchError}. Your item value is unchanged.
                </Text>
                {lastFailedRefinement ? (
                  <View style={styles.errorActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => handleRunRefinedSearch(lastFailedRefinement.draft, lastFailedRefinement.range)}
                      style={[styles.errorActionButton, { borderColor: colors.destructive }]}
                    >
                      <Text style={[styles.errorActionText, { color: colors.destructive }]}>Try again</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setWorkingRefinementDraft(cloneReplacementRefinementDraft(lastFailedRefinement.draft));
                        setRefinementVisible(true);
                      }}
                      style={[styles.errorActionButton, { borderColor: colors.destructive }]}
                    >
                      <Text style={[styles.errorActionText, { color: colors.destructive }]}>Edit criteria</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {searching ? (
            <ReplacementSearchLoadingPanel
              colors={colors}
              title={refinedSearching ? "Starting a new retailer search" : "Searching replacement prices"}
              subtitle={marketPresentation.loadingSubtitle}
              accessibilityLabel={marketPresentation.searchAccessibilityLabel}
              onCancel={refinedSearching ? cancelRefinedSearch : undefined}
            />
          ) : null}

          {results ? (
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
                      disabled={disabled || refinedSearching}
                      onPress={() => setFilter(option.id)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                          opacity: disabled || refinedSearching ? 0.45 : 1,
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
              {searchContext ? <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>{marketPresentation.resultContext}{searchContext.pricingSupportTier === "preview" ? " · Local pricing preview" : ""}</Text> : null}

              {filteredResults.length ? (
                <Animated.View
                  style={[
                    styles.results,
                    {
                      opacity: refinedSearching ? 0.56 : resultEntrance,
                      transform: [{
                        translateY: refinedSearching || reduceMotion
                          ? 0
                          : resultEntrance.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
                      }],
                    },
                  ]}
                >
                  {filteredResults.map((result) => (
                    <ReplacementListingCard
                      key={`${result.position}-${result.link}-${result.title}`}
                      result={result}
                      contextCurrency={searchContext?.currencyCode}
                      selecting={selectingPosition === result.position}
                      disabled={refinedSearching}
                      onOpen={() => handleOpen(result)}
                      onUse={() => handleUse(result)}
                    />
                  ))}
                </Animated.View>
              ) : (
                <View style={[styles.empty, { backgroundColor: colors.card }]}>
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    {currentSearchPriceSummary ? "No products were found within your price range" : "No matching products found"}
                  </Text>
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    {currentSearchPriceSummary
                      ? "Adjust or clear the optional price range, then run another refined search."
                      : "Try removing one detail or add a brand, model, size, or key feature."}
                  </Text>
                </View>
              )}
            </>
          ) : !searching ? (
            <View style={[styles.empty, { backgroundColor: colors.card }]}>
              <Feather name="search" size={26} color={colors.primary} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Search local replacement listings
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Results may be comparable replacements rather than the exact original item.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
      {item && originalRefinementDraft && workingRefinementDraft && lastSuccessfulRefinementDraft && configuredMarket ? (
        <ReplacementSearchRefinementSheet
          visible={refinementVisible}
          item={item}
          marketName={configuredMarket.countryName}
          currencyCode={configuredMarket.currencyCode}
          locale={configuredMarket.locale}
          supportLabel={configuredMarket.pricingSupportTier === "verified"
            ? null
            : configuredMarket.pricingSupportTier === "preview"
              ? "Local pricing preview"
              : "Limited market"}
          aiEnabled={configuredMarket.aiEstimatesEnabled}
          draft={workingRefinementDraft}
          originalDraft={originalRefinementDraft}
          lastSuccessfulDraft={lastSuccessfulRefinementDraft}
          submitting={searching}
          onDraftChange={setWorkingRefinementDraft}
          onClose={() => setRefinementVisible(false)}
          onSubmit={handleRunRefinedSearch}
        />
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
  currentSearchCard: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  currentSearchCopy: { flex: 1, gap: 3 },
  currentSearchEyebrow: { fontSize: 9, letterSpacing: 0.75, fontFamily: "Inter_600SemiBold" },
  currentSearchPrimary: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
  currentSearchDetails: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  currentSearchPrice: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  refineButton: { minHeight: 48, borderRadius: 12, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  refineButtonText: { fontSize: 13, fontFamily: "Inter_700Bold" },
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
  errorContent: { flex: 1, gap: 9 },
  errorText: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  errorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  errorActionButton: { minHeight: 40, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  errorActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
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
  loadingCancel: { minHeight: 44, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  loadingCancelText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  empty: { borderRadius: 12, padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
