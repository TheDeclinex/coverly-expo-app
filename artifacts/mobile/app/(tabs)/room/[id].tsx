import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams, type Href } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { ExpandableImage } from "@/components/ExpandableImage";
import { LoadingState } from "@/components/LoadingState";
import { useToast } from "@/components/Toast";
import { getCategoryColor } from "@/constants/categoryColors";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatCurrencyFull, getItemUnitPrice } from "@/lib/inventory-mappers";
import { useSignedUrl, useSignedUrls } from "@/hooks/useSignedUrls";
import { isStoragePath } from "@/lib/storage-helpers";
import { formatUploadFailure, uploadCoverPhoto } from "@/lib/photo-upload";
import { isRecentItem } from "@/lib/recent-items";
import { supabase } from "@/lib/supabase";
import type { InventoryItem, InventoryRoom } from "@/types";

const COVER_H = 200;
const TEAL = "#1D9E75";

/** Maps category key → Feather icon name */
const CATEGORY_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  electronics: "monitor",
  furniture: "home",
  appliances: "tool",
  decor: "sun",
  jewellery: "star",
  jewelry: "star",
  clothing: "scissors",
  kitchen: "coffee",
  outdoor: "compass",
  garden: "sun",
  lighting: "zap",
  art: "star",
  sport: "activity",
  tools: "tool",
  automotive: "truck",
};

function categoryIcon(cat: string | null): keyof typeof Feather.glyphMap {
  if (!cat) return "package";
  const key = cat.toLowerCase().split(/[\s&]/)[0];
  return CATEGORY_ICONS[key] ?? "package";
}

function categoryDotColor(cat: string | null): string {
  return getCategoryColor(cat);
}

function valuationLabel(item: InventoryItem): string | null {
  const src = ((item.price_source_type ?? item.valuation_basis ?? "") as string).toLowerCase();
  if (src.includes("user") || src.includes("manual")) return "User added";
  if (src.includes("listing") || src.includes("link")) return "Replacement listing";
  if (src.includes("ai") || src.includes("scan")) return "AI identified";
  if (item.estimated_price != null || item.unit_estimated_price != null) return "Estimated";
  return null;
}

function isWebUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

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

function roomIconName(roomType: string | null): keyof typeof Feather.glyphMap {
  if (!roomType) return "home";
  const key = roomType.toLowerCase().replace(/\s+/g, "_");
  return (ROOM_ICONS[key] ?? "home") as keyof typeof Feather.glyphMap;
}

function parsePrice(value: string): number | null {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type CardEditTarget = "name" | "valuation";

function ItemCard({
  item,
  colors,
  resolvedImageUrl,
  evidenceCount = 0,
  isNew = false,
  editingTarget,
  onBeginEdit,
  onCloseEdit,
}: {
  item: InventoryItem;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  /** Pre-resolved signed URL from the parent's batch useSignedUrls() call. */
  resolvedImageUrl?: string | null;
  evidenceCount?: number;
  isNew?: boolean;
  editingTarget: CardEditTarget | null;
  onBeginEdit: (target: CardEditTarget) => void;
  onCloseEdit: (target: CardEditTarget) => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const activeEditorRef = useRef<View>(null);
  const nameActionPressRef = useRef(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [quantityDraft, setQuantityDraft] = useState(String(item.quantity ?? 1));
  const [unitPriceDraft, setUnitPriceDraft] = useState(String(getItemUnitPrice(item)));
  const [savingCard, setSavingCard] = useState(false);

  useEffect(() => {
    if (!editingTarget) {
      setNameDraft(item.name);
      setQuantityDraft(String(item.quantity ?? 1));
      setUnitPriceDraft(String(getItemUnitPrice(item)));
    }
  }, [editingTarget, item]);

  // The single source of truth for this item's image reference in the DB.
  // image_url takes priority; photo_url is the legacy fallback column.
  const rawImageRef = item.image_url ?? item.photo_url ?? null;

  const imageRefType = !rawImageRef
    ? "null"
    : isStoragePath(rawImageRef)
      ? "storage-path"
      : rawImageRef.startsWith("http")
        ? "legacy-url"
        : "local-uri";

  // Structured diagnostic log: item id, raw DB values, detected type, resolved URL status.
  useEffect(() => {
    if (__DEV__) {
      console.log("[ItemCard]", {
        id: item.id.slice(-8),
        raw_image_url: item.image_url ? item.image_url.slice(0, 60) : null,
        raw_photo_url: item.photo_url ? item.photo_url.slice(0, 60) : null,
        rawImageRef: rawImageRef ? rawImageRef.slice(0, 60) : null,
        type: imageRefType,
        resolved_present: !!resolvedImageUrl,
        resolved_url: resolvedImageUrl ? resolvedImageUrl.slice(0, 70) : null,
      });
    }
  }, [item.id, rawImageRef, imageRefType, resolvedImageUrl]);

  // Do NOT fall back to rawImageRef — it may be a raw storage path that expo-image
  // cannot load. resolvedImageUrl is the signed URL (or null while loading).
  // ExpandableImage shows the placeholder until the signed URL arrives.
  const imageUri = resolvedImageUrl ?? null;

  const rawPin = item.image_pin as Record<string, unknown> | null | undefined;
  const pin =
    rawPin && typeof rawPin.x === "number" && typeof rawPin.y === "number"
      ? { x: rawPin.x, y: rawPin.y }
      : null;

  const quantity = item.quantity ?? 1;
  const unitPrice = getItemUnitPrice(item);
  const totalValue = unitPrice * quantity;
  const draftQuantity = Math.max(1, Number.parseInt(quantityDraft, 10) || 1);
  const draftUnitPrice = parsePrice(unitPriceDraft) ?? 0;
  const draftTotal = draftUnitPrice * draftQuantity;
  const valLabel = valuationLabel(item);
  const dotColor = categoryDotColor(item.category);
  const placeholderIcon = categoryIcon(item.category);

  const persistCardUpdate = async (updates: Partial<InventoryItem>): Promise<boolean> => {
    setSavingCard(true);
    try {
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update(updates)
        .eq("id", item.id)
        .select("*")
        .single();
      if (updateError) throw updateError;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["item", item.id] }),
        queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
        queryClient.invalidateQueries({ queryKey: ["all-items"] }),
        queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
      ]);
      showToast("Item updated");
      return true;
    } catch (updateFailure) {
      Alert.alert(
        "Couldn’t update item",
        updateFailure instanceof Error ? updateFailure.message : "Please try again.",
      );
      return false;
    } finally {
      setSavingCard(false);
    }
  };

  const beginNameEdit = () => {
    setNameDraft(item.name);
    onBeginEdit("name");
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const beginValuationEdit = () => {
    setQuantityDraft(String(quantity));
    setUnitPriceDraft(String(unitPrice));
    onBeginEdit("valuation");
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const cancelInlineEdit = () => {
    setNameDraft(item.name);
    setQuantityDraft(String(quantity));
    setUnitPriceDraft(String(unitPrice));
    if (editingTarget) onCloseEdit(editingTarget);
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const saveNameEdit = async () => {
    if (savingCard) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      Alert.alert("Item name required", "Enter a name before saving.");
      return;
    }
    if (nextName === item.name) {
      onCloseEdit("name");
      return;
    }
    if (await persistCardUpdate({ name: nextName })) onCloseEdit("name");
  };

  const saveValuationEdit = async () => {
    if (savingCard) return;
    const nextUnitPrice = parsePrice(unitPriceDraft);
    if (nextUnitPrice === null) {
      Alert.alert("Check price", "Enter a valid each price of zero or more.");
      return;
    }

    const roundedUnitPrice = Math.round(nextUnitPrice * 100) / 100;
    const priceChanged = roundedUnitPrice !== unitPrice;
    const updates: Partial<InventoryItem> = {
      quantity: draftQuantity,
      estimated_price: roundedUnitPrice,
      unit_estimated_price: roundedUnitPrice,
      ...(priceChanged
        ? { price_source_type: "user_entered", valuation_basis: "manual" }
        : {}),
    };

    if (await persistCardUpdate(updates)) onCloseEdit("valuation");
  };

  const handleNameBlur = () => {
    setTimeout(() => {
      if (!nameActionPressRef.current) void saveNameEdit();
    }, 0);
  };

  const finishNameActionPress = () => {
    setTimeout(() => {
      nameActionPressRef.current = false;
    }, 100);
  };

  useEffect(() => {
    if (Platform.OS !== "web" || !editingTarget) return;

    const handlePointerDown = (event: PointerEvent) => {
      const editor = activeEditorRef.current as unknown as {
        contains?: (target: EventTarget | null) => boolean;
      } | null;
      if (editor?.contains?.(event.target)) return;

      if (editingTarget === "name") void saveNameEdit();
      else void saveValuationEdit();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [editingTarget, nameDraft, quantityDraft, unitPriceDraft, savingCard]);

  const goToDetail = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: { id: item.id, name: item.name },
    });
  };

  const goToEvidence = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: { id: item.id, name: item.name, evidence: "add" },
    });
  };

  const goToReplacementPricing = async () => {
    await Haptics.selectionAsync();
    router.push(`/(tabs)/replacement-pricing/${item.id}` as Href);
  };

  const openReplacementListing = async () => {
    if (!isWebUrl(item.web_listing_url)) return;
    await Haptics.selectionAsync();
    await WebBrowser.openBrowserAsync(item.web_listing_url);
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: isNew ? colors.primary : colors.border,
        },
      ]}
    >
      {/* ── Summary row ── */}
      <View style={styles.cardSummary}>
        {/* Thumbnail */}
        <View style={[styles.thumbWrap, { borderColor: colors.border }]}>
          <ExpandableImage
            uri={imageUri}
            style={styles.thumb}
            contentFit="cover"
            placeholderIcon={placeholderIcon}
            placeholderIconSize={26}
            placeholderIconColor={TEAL}
            placeholderBackgroundColor={colors.muted}
            pin={pin}
          />
        </View>

        {/* Text block */}
        <View style={styles.cardBody}>
          {/* Name (left) + Price (right) — same row */}
          <View style={styles.nameRow}>
            <View style={styles.nameBlock}>
              {isNew ? (
                <View style={[styles.newBadge, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.newBadgeText, { color: colors.primaryForeground }]}>NEW</Text>
                </View>
              ) : null}
              {editingTarget === "name" ? (
                <View ref={activeEditorRef} style={styles.compactNameEdit}>
                  <TextInput
                    autoFocus
                    accessibilityLabel="Item name"
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    editable={!savingCard}
                    onSubmitEditing={() => void saveNameEdit()}
                    onBlur={handleNameBlur}
                    style={[
                      styles.compactNameInput,
                      { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.primary },
                    ]}
                  />
                  <Pressable
                    accessibilityLabel="Save item name"
                    onPress={() => void saveNameEdit()}
                    onPressIn={() => {
                      nameActionPressRef.current = true;
                    }}
                    onPressOut={finishNameActionPress}
                    disabled={savingCard}
                    hitSlop={5}
                  >
                    {savingCard ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Feather name="check" size={15} color={colors.primary} />
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Cancel item name edit"
                    onPress={cancelInlineEdit}
                    onPressIn={() => {
                      nameActionPressRef.current = true;
                    }}
                    onPressOut={finishNameActionPress}
                    disabled={savingCard}
                    hitSlop={5}
                  >
                    <Feather name="x" size={15} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ) : (
                <Pressable accessibilityLabel="Edit item name" onPress={beginNameEdit} hitSlop={5}>
                  <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={2}>
                    {item.name}
                  </Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.priceBlock, editingTarget === "valuation" ? styles.priceBlockEditing : null]}>
              {editingTarget === "valuation" ? (
                <View ref={activeEditorRef} style={styles.compactValuationEdit}>
                  <View style={styles.compactQuantityRow}>
                    <Text style={[styles.compactEditLabel, { color: colors.mutedForeground }]}>Qty</Text>
                    <Pressable
                      accessibilityLabel="Decrease quantity"
                      onPress={() => setQuantityDraft(String(Math.max(1, draftQuantity - 1)))}
                      disabled={savingCard || draftQuantity <= 1}
                      hitSlop={4}
                      style={[
                        styles.compactStepButton,
                        { borderColor: colors.border, opacity: draftQuantity <= 1 ? 0.4 : 1 },
                      ]}
                    >
                      <Feather name="minus" size={12} color={colors.foreground} />
                    </Pressable>
                    <Text style={[styles.compactQuantityValue, { color: colors.foreground }]}>{draftQuantity}</Text>
                    <Pressable
                      accessibilityLabel="Increase quantity"
                      onPress={() => setQuantityDraft(String(draftQuantity + 1))}
                      disabled={savingCard}
                      hitSlop={4}
                      style={[styles.compactStepButton, { borderColor: colors.border }]}
                    >
                      <Feather name="plus" size={12} color={colors.foreground} />
                    </Pressable>
                  </View>
                  <View style={styles.compactPriceRow}>
                    <Text style={[styles.compactEditLabel, { color: colors.mutedForeground }]}>
                      {draftQuantity > 1 ? "Each" : "Price"}
                    </Text>
                    <View style={[styles.compactPriceInputWrap, { borderColor: colors.primary, backgroundColor: colors.card }]}>
                      <Text style={[styles.compactCurrency, { color: colors.mutedForeground }]}>$</Text>
                      <TextInput
                        autoFocus
                        accessibilityLabel={draftQuantity > 1 ? "Each price" : "Price"}
                        value={unitPriceDraft}
                        onChangeText={setUnitPriceDraft}
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                        selectTextOnFocus
                        editable={!savingCard}
                        onSubmitEditing={() => void saveValuationEdit()}
                        style={[styles.compactPriceInput, { color: colors.foreground }]}
                      />
                    </View>
                  </View>
                  <Text style={[styles.compactTotalPreview, { color: colors.mutedForeground }]}>
                    Total {formatCurrencyFull(draftTotal)}
                  </Text>
                  <View style={styles.compactEditFooter}>
                    <Pressable
                      accessibilityLabel="Save valuation"
                      onPress={() => void saveValuationEdit()}
                      disabled={savingCard}
                      hitSlop={5}
                      style={styles.compactIconButton}
                    >
                      {savingCard ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Feather name="check" size={16} color={colors.primary} />
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Cancel valuation edit"
                      onPress={cancelInlineEdit}
                      disabled={savingCard}
                      hitSlop={5}
                      style={styles.compactIconButton}
                    >
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <Pressable accessibilityLabel="Edit item valuation" onPress={beginValuationEdit} hitSlop={5}>
                    <View style={styles.compactValuation}>
                      <Text style={[styles.mainValue, { color: colors.foreground }]}>
                        {formatCurrencyFull(totalValue)}
                      </Text>
                      {quantity > 1 ? (
                        <Text style={[styles.valueMeta, { color: colors.mutedForeground }]}>
                          Qty {quantity} · Each {formatCurrencyFull(unitPrice)}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                  {valLabel && item.price_source_type === "web_listing" && isWebUrl(item.web_listing_url) ? (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel="Open replacement listing"
                      onPress={() => void openReplacementListing()}
                      hitSlop={6}
                    >
                      <Text style={[styles.valLabel, styles.listingLink, { color: TEAL }]}>
                        {valLabel} <Feather name="external-link" size={10} color={TEAL} />
                      </Text>
                    </Pressable>
                  ) : valLabel ? (
                    <Text style={[styles.valLabel, { color: colors.mutedForeground }]}>{valLabel}</Text>
                  ) : null}
                </>
              )}
            </View>
          </View>

          {/* Category chip */}
          <View style={styles.chipRow}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text
              style={[styles.chipText, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {item.category ?? "General items"}
            </Text>
          </View>
        </View>

      </View>

      {/* ── Divider ── */}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* ── Actions ── */}
      <View style={styles.actions}>
        {/* Primary: Find replacement price */}
        <Pressable
          onPress={goToReplacementPricing}
          style={({ pressed }) => [
            styles.findPriceBtn,
            { borderColor: TEAL, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Feather name="search" size={13} color={TEAL} />
          <Text style={[styles.findPriceTxt, { color: TEAL }]}>
            Find replacement price
          </Text>
        </Pressable>

        {/* Compact secondary actions; quick edits live in the summary above. */}
        <View style={styles.secondaryRow}>
          <Pressable
            onPress={goToEvidence}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.secondary,
                flex: 1,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Feather name="paperclip" size={13} color={colors.primary} />
            <Text style={[styles.secondaryTxt, { color: colors.foreground }]}>
              {evidenceCount > 0 ? `Evidence · ${evidenceCount}` : "Add evidence"}
            </Text>
          </Pressable>
          <Pressable
            onPress={goToDetail}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.secondary,
                flex: 1,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryTxt, { color: colors.foreground }]}>
              View details
            </Text>
            <Feather
              name="chevron-right"
              size={13}
              color={colors.mutedForeground}
            />
          </Pressable>
        </View>
      </View>
    </View>
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
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [coverUploading, setCoverUploading] = useState(false);
  const [recentTick, setRecentTick] = useState(0);
  const [activeEdit, setActiveEdit] = useState<{
    itemId: string;
    target: CardEditTarget;
  } | null>(null);

  // Parallax hero — scrollY drives image translateY 0→-40 as user scrolls down
  const scrollY = useRef(new Animated.Value(0)).current;
  const heroTranslateY = scrollY.interpolate({
    inputRange: [0, COVER_H],
    outputRange: [0, -40],
    extrapolate: "clamp",
  });

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

  useEffect(() => {
    if (!(items ?? []).some((item) => isRecentItem(item.id))) return;
    const timer = setTimeout(() => setRecentTick((value) => value + 1), 6000);
    return () => clearTimeout(timer);
  }, [items]);

  const { data: room } = useQuery({
    queryKey: ["room", id, session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_rooms")
        .select("*")
        .eq("id", id)
        .single();
      if (queryError) throw queryError;
      return data as InventoryRoom;
    },
    enabled: !!session && !!id,
  });

  const roomItemIds = React.useMemo(() => (items ?? []).map((item) => item.id), [items]);
  const roomItemIdsKey = React.useMemo(
    () => [...roomItemIds].sort().join(","),
    [roomItemIds],
  );
  const { data: evidenceCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["room-evidence-counts", id, session?.user.id, roomItemIdsKey],
    queryFn: async () => {
      if (roomItemIds.length === 0) return {};

      const { data, error: countError } = await supabase
        .from("claim_evidence_items")
        .select("item_id")
        .in("item_id", roomItemIds);

      if (countError) {
        console.warn("[roomEvidenceCounts] unable to load", {
          roomId: id,
          message: countError.message,
          code: countError.code,
          details: countError.details,
          hint: countError.hint,
        });
        return {};
      }

      return (data ?? []).reduce<Record<string, number>>((counts, link) => {
        if (link.item_id) counts[link.item_id] = (counts[link.item_id] ?? 0) + 1;
        return counts;
      }, {});
    },
    enabled: !!session && !!id && roomItemIds.length > 0,
  });

  // Signed URL for the room cover photo (resolves storage path → 1-hr signed URL)
  const signedCoverUrl = useSignedUrl(room?.cover_photo_url);

  // Batch-resolve item thumbnail paths → signed URLs in one round-trip.
  // Memoised so the array reference is stable between renders (avoids redundant key recomputation).
  const itemImagePaths = React.useMemo(
    () => (items ?? []).map((it) => it.image_url ?? it.photo_url ?? null),
    [items],
  );
  const itemSignedUrls = useSignedUrls(itemImagePaths);

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

  const handlePickRoomCover = async () => {
    if (coverUploading) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow access to your photos to set a room cover image."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (result.canceled || !result.assets[0]) return;
    if (!session?.user.id) return;
    setCoverUploading(true);
    try {
      const uploaded = await uploadCoverPhoto(
        result.assets[0].uri,
        session.user.id,
        { source: "room_cover", fileId: fileId ?? undefined }
      );
      if (!uploaded.ok) {
        const diagnostic = formatUploadFailure(uploaded);
        console.error("[roomCover] Upload diagnostic\n" + diagnostic);
        Alert.alert("Room cover upload failed", diagnostic);
        return;
      }
      // Store the durable storage path in the DB, not the short-lived signed URL.
      const { data: updatedRows, error: updateError } = await supabase
        .from("inventory_rooms")
        .update({ cover_photo_url: uploaded.path })
        .eq("id", id)
        .select("id");
      if (updateError) {
        console.error("[roomCover] DB update error:", updateError);
        Alert.alert("Save failed", updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        console.error("[roomCover] DB update matched 0 rows — possible missing UPDATE RLS policy. Run supabase/migrations/add_update_policies.sql.");
        Alert.alert("Save failed", "Cover photo could not be saved. Please check your connection and try again.");
        return;
      }
      // Invalidate the room query and the signed URL cache for the new path so
      // useSignedUrl immediately re-fetches and the new cover appears right away.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["room", id] }),
        queryClient.invalidateQueries({ queryKey: ["signed-url", uploaded.path] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", fileId] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", fileId, session.user.id] }),
      ]);
      showToast("Room photo saved");
    } finally {
      setCoverUploading(false);
    }
  };

  const renderRoomCover = () => (
    <View style={[styles.coverContainer, { backgroundColor: colors.secondary }]}>
      {signedCoverUrl ? (
        /* Parallax image — taller than container so it can shift up */
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: COVER_H + 40,
            transform: [{ translateY: heroTranslateY }],
          }}
        >
          <Image
            source={{ uri: signedCoverUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        </Animated.View>
      ) : (
        <View style={styles.coverPlaceholder}>
          <Feather
            name={roomIconName(room?.room_type ?? null)}
            size={72}
            color={colors.primary}
            style={{ opacity: 0.55 }}
          />
        </View>
      )}
      <Pressable
        onPress={handlePickRoomCover}
        disabled={coverUploading}
        style={[styles.cameraBtn, { backgroundColor: "rgba(0,0,0,0.45)" }]}
        hitSlop={8}
      >
        {coverUploading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Feather name="camera" size={16} color="#fff" />
        )}
      </Pressable>
    </View>
  );

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
          <Animated.FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ItemCard
                item={item}
                colors={colors}
                evidenceCount={evidenceCounts[item.id] ?? 0}
                isNew={isRecentItem(item.id) && recentTick >= 0}
                resolvedImageUrl={itemSignedUrls.get(item.image_url ?? item.photo_url ?? "") ?? null}
                editingTarget={activeEdit?.itemId === item.id ? activeEdit.target : null}
                onBeginEdit={(target) => setActiveEdit({ itemId: item.id, target })}
                onCloseEdit={(target) =>
                  setActiveEdit((current) =>
                    current?.itemId === item.id && current.target === target ? null : current,
                  )
                }
              />
            )}
            ListHeaderComponent={renderRoomCover}
            contentContainerStyle={[
              styles.list,
              {
                paddingBottom: insets.bottom + 160,
                ...(Platform.OS === "web" ? { paddingTop: 0 } : {}),
              },
            ]}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { y: scrollY } } }],
              { useNativeDriver: false }
            )}
            scrollEventThrottle={16}
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
                Scan items
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
  coverContainer: {
    height: COVER_H,
    overflow: "hidden",
  },
  coverPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBtn: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    padding: 12,
    paddingTop: 10,
    gap: 10,
  },
  /* ── Card shell ── */
  card: {
    borderWidth: 1,
    overflow: "hidden",
    // shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  /* ── Summary row ── */
  cardSummary: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  thumbWrap: {
    width: 76,
    height: 76,
    borderRadius: 10,
    borderWidth: 2,
    overflow: "hidden",
  },
  thumb: { width: "100%", height: "100%" },
  cardBody: { flex: 1, gap: 4 },
  nameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  nameBlock: { flex: 1, minWidth: 0, gap: 4 },
  compactNameEdit: { flexDirection: "row", alignItems: "center", gap: 6 },
  compactNameInput: {
    flex: 1,
    minWidth: 72,
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  cardName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
    flex: 1,
  },
  newBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 1 },
  newBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  priceBlock: { alignItems: "stretch", gap: 3, width: 124, flexShrink: 0 },
  priceBlockEditing: { width: 184 },
  compactValuation: { alignItems: "flex-end", gap: 2, paddingTop: 1 },
  compactValuationEdit: { alignItems: "stretch", gap: 6 },
  compactQuantityRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  compactEditLabel: { width: 32, fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "right" },
  compactStepButton: {
    width: 25,
    height: 25,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  compactQuantityValue: { minWidth: 18, fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  compactPriceRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  compactPriceInputWrap: {
    width: 88,
    height: 32,
    borderWidth: 1,
    borderRadius: 7,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 5,
    overflow: "hidden",
  },
  compactCurrency: { fontSize: 11, fontFamily: "Inter_400Regular" },
  compactPriceInput: {
    flex: 1,
    width: 0,
    minWidth: 0,
    paddingHorizontal: 2,
    paddingVertical: 4,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "right",
  },
  compactIconButton: { width: 18, height: 26, alignItems: "center", justifyContent: "center" },
  compactTotalPreview: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_500Medium", textAlign: "right", paddingRight: 2 },
  compactEditFooter: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingRight: 1 },
  mainValue: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold", textAlign: "right" },
  valueMeta: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_400Regular", textAlign: "right" },
  valLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
  },
  listingLink: { textDecorationLine: "underline" },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "nowrap",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontFamily: "Inter_400Regular", flexShrink: 1 },
  /* ── Divider ── */
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  /* ── Actions ── */
  actions: { padding: 10, gap: 8 },
  findPriceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 9,
  },
  findPriceTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  secondaryRow: { flexDirection: "row", gap: 8 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  secondaryTxt: { fontSize: 12, fontFamily: "Inter_500Medium" },
  fabRow: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    gap: 10,
  },
  fabBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 18,
  },
  fabText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
