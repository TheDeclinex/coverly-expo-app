import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Stack, router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import {
  BarcodeScanFlow,
  type BarcodeApplyValues,
} from "@/components/BarcodeScanFlow";
import { ContextBackButton } from "@/components/ContextBackButton";
import { ErrorState } from "@/components/ErrorState";
import { ExpandableImage } from "@/components/ExpandableImage";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { LoadingState } from "@/components/LoadingState";
import { QuantityStepper } from "@/components/QuantityStepper";
import { ReliableImage } from "@/components/ReliableImage";
import { useToast } from "@/components/Toast";
import { VoiceInputSheet } from "@/components/voice/VoiceInputSheet";
import { getCategoryColor } from "@/constants/categoryColors";
import { ENABLE_RECOMMENDED_ACTIONS } from "@/constants/recommendedActions";
import { getRoomPlaceholderIcon } from "@/constants/roomVisuals";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  formatCurrency,
  formatCurrencyFull,
  getItemTotalValue,
  getItemUnitPrice,
  hasValue,
} from "@/lib/inventory-mappers";
import { useSignedImageRecovery, useSignedUrl, useSignedUrls } from "@/hooks/useSignedUrls";
import { isStoragePath } from "@/lib/storage-helpers";
import { formatUploadFailure, uploadCoverPhoto } from "@/lib/photo-upload";
import { itemWithCommittedPin, replaceItemWithCommittedPin } from "@/lib/item-pin-state";
import {
  filterItemsNeedingAttention,
  itemMatchesAttention,
  itemNeedsRoomReview,
  type ItemAttentionFilter,
} from "@/lib/item-attention";
import { takeRecentItemBatch, withoutRecentItem } from "@/lib/recent-items";
import { clearRoomViewSession, getRoomViewSession, resolveRoomRestoreIndex, updateRoomViewSession } from "@/lib/room-view-session";
import { supabase } from "@/lib/supabase";
import { subtractDeletedItems, withoutRoomItems } from "@/lib/room-deletion";
import { formatCurrencyTotals, groupAmountsByCurrency, moneyDisplayToken } from "@/lib/money";
import { parseReplacementPriceInput, resolveReviewedValueCurrency, resolveStoredValueCurrency, resolveValueMarket, supportedCurrencyCode } from "@/lib/replacement-value";
import { roomCoverActions, withRoomCoverPhoto, withRoomListCoverPhoto, type RoomCoverAction } from "@/lib/room-cover-photo";
import type { InventoryItem, InventoryRoom } from "@/types";
import type { VoiceItemPatch } from "@/types/voice";

const COVER_H = 200;
const TEAL = "#1D9E75";
const STICKY_ACTION_CLEARANCE = 96;
const ROOM_COVER_PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  quality: 0.85,
  allowsEditing: true,
  aspect: [16, 9],
};

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

function itemReadinessChip(item: InventoryItem): string | null {
  if (!item.image_url && !item.photo_url) return "No photo";
  if (!hasValue(item)) return "No value";
  if (itemNeedsRoomReview(item)) return "Check details";
  return null;
}

function isWebUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

type CardEditTarget = "name" | "valuation";
type RoomViewMode = "detailed" | "compact";
type RoomReadinessFilter = "all" | "needs_review" | "missing_photo" | "missing_value";
type RoomSortOption = "recent" | "value_desc" | "value_asc" | "name_asc";

function normalizedItemPin(item: InventoryItem): { x: number; y: number } | null {
  const raw = item.image_pin as Record<string, unknown> | null | undefined;
  return raw && typeof raw.x === "number" && typeof raw.y === "number"
    ? { x: raw.x, y: raw.y }
    : null;
}

function roomItemMatchesReadiness(item: InventoryItem, filter: RoomReadinessFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_review") return itemNeedsRoomReview(item);
  if (filter === "missing_photo") return itemMatchesAttention(item, "missing_photo");
  if (filter === "missing_value") return itemMatchesAttention(item, "missing_value");
  return true;
}

function ItemCard({
  item,
  parentRoomName,
  parentPropertyName,
  currencyCode,
  propertyCountryCode,
  colors,
  resolvedImageUrl,
  onImagePermanentError,
  evidenceCount = 0,
  isNew = false,
  editingTarget,
  onBeginEdit,
  onCloseEdit,
  selectionMode = false,
  isSelected = false,
  onToggleSelected,
  onOpenItem,
  onRepositionPin,
  onExpandImage,
}: {
  item: InventoryItem;
  parentRoomName: string;
  parentPropertyName: string;
  currencyCode: string;
  propertyCountryCode: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  /** Pre-resolved signed URL from the parent's batch useSignedUrls() call. */
  resolvedImageUrl?: string | null;
  onImagePermanentError?: () => void;
  evidenceCount?: number;
  isNew?: boolean;
  editingTarget: CardEditTarget | null;
  onBeginEdit: (target: CardEditTarget) => void;
  onCloseEdit: (target: CardEditTarget) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelected?: () => void;
  onOpenItem: (itemId: string) => void;
  onRepositionPin: (item: InventoryItem, x: number, y: number) => Promise<void>;
  onExpandImage: (item: InventoryItem, uri: string) => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { width: windowWidth } = useWindowDimensions();
  const useStackedSummary = windowWidth < 390;
  const activeEditorRef = useRef<View>(null);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [quantityDraft, setQuantityDraft] = useState(String(item.quantity ?? 1));
  const [unitPriceDraft, setUnitPriceDraft] = useState(String(getItemUnitPrice(item)));
  const [draftCurrency, setDraftCurrency] = useState(() => resolveStoredValueCurrency(item.estimated_currency, currencyCode));
  const [savingCard, setSavingCard] = useState(false);
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);
  const [voiceEditOpen, setVoiceEditOpen] = useState(false);
  const displayCurrency = resolveStoredValueCurrency(item.estimated_currency, currencyCode);

  useEffect(() => {
    if (!editingTarget) {
      setNameDraft(item.name);
      setQuantityDraft(String(item.quantity ?? 1));
      setUnitPriceDraft(String(getItemUnitPrice(item)));
      setDraftCurrency(resolveStoredValueCurrency(item.estimated_currency, currencyCode));
    }
  }, [currencyCode, editingTarget, item]);

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
      console.info("[ItemCard]", {
        id: item.id.slice(-8),
        hasImageUrl: Boolean(item.image_url),
        hasPhotoUrl: Boolean(item.photo_url),
        hasRawImageRef: Boolean(rawImageRef),
        type: imageRefType,
        resolved_present: !!resolvedImageUrl,
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
  const draftUnitPrice = parseReplacementPriceInput(unitPriceDraft).value ?? 0;
  const draftTotal = draftUnitPrice * draftQuantity;
  const valLabel = valuationLabel(item);
  const hasReplacementListing = valLabel === "Replacement listing";
  const dotColor = categoryDotColor(item.category);
  const placeholderIcon = categoryIcon(item.category);
  const readinessChip = itemReadinessChip(item);
  const showInlineValuationEditor = false;

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
    if (selectionMode) {
      onToggleSelected?.();
      return;
    }
    Keyboard.dismiss();
    setNameDraft(item.name);
    setQuantityDraft(String(quantity));
    setUnitPriceDraft(String(unitPrice));
    setDraftCurrency(displayCurrency);
    onBeginEdit("name");
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const beginValuationEdit = () => {
    if (selectionMode) {
      onToggleSelected?.();
      return;
    }
    Keyboard.dismiss();
    setNameDraft(item.name);
    setQuantityDraft(String(quantity));
    setUnitPriceDraft(String(unitPrice));
    setDraftCurrency(displayCurrency);
    onBeginEdit("valuation");
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const closeEdit = () => {
    const target = editingTarget;
    if (target) onCloseEdit(target);
  };

  const cancelEdit = () => {
    setNameDraft(item.name);
    setQuantityDraft(String(quantity));
    setUnitPriceDraft(String(unitPrice));
    setDraftCurrency(displayCurrency);
    closeEdit();
    Keyboard.dismiss();
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const saveItemEdit = async () => {
    if (savingCard) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      Alert.alert("Item name required", "Enter a name before saving.");
      return;
    }

    const parsedPrice = parseReplacementPriceInput(unitPriceDraft);
    if (parsedPrice.status === "invalid") {
      Alert.alert("Check replacement price", "Enter a valid replacement price. Use zero to clear the value.");
      return;
    }

    const nextUnitPrice = parsedPrice.value ?? 0;
    const normalizedUnitPrice = nextUnitPrice > 0 ? nextUnitPrice : null;
    const priceChanged = normalizedUnitPrice !== (unitPrice > 0 ? unitPrice : null)
      || (normalizedUnitPrice != null && draftCurrency !== displayCurrency);
    const quantityChanged = draftQuantity !== quantity;
    const nameChanged = nextName !== item.name;
    const updates: Partial<InventoryItem> = {
      name: nextName,
      quantity: draftQuantity,
      estimated_price: normalizedUnitPrice == null ? null : normalizedUnitPrice * draftQuantity,
      unit_estimated_price: normalizedUnitPrice,
      estimated_currency: normalizedUnitPrice == null ? null : draftCurrency,
      valuation_market: normalizedUnitPrice == null ? null : resolveValueMarket(draftCurrency, item.estimated_currency, item.valuation_market, currencyCode, propertyCountryCode),
      ...(priceChanged
        ? { price_source_type: "user_entered", valuation_basis: "manual", estimated_at: normalizedUnitPrice == null ? null : new Date().toISOString() }
        : {}),
    };

    if (!nameChanged && !quantityChanged && !priceChanged) {
      closeEdit();
      Keyboard.dismiss();
      return;
    }
    if (await persistCardUpdate(updates)) {
      closeEdit();
      Keyboard.dismiss();
    }
  };

  const saveValuationEdit = saveItemEdit;
  const cancelInlineEdit = cancelEdit;

  const applyVoicePatchToQuickEdit = (patch: VoiceItemPatch) => {
    if (typeof patch.name === "string" && patch.name.trim()) setNameDraft(patch.name.trim());
    if (typeof patch.quantity === "number" && Number.isFinite(patch.quantity)) {
      setQuantityDraft(String(Math.max(1, Math.round(patch.quantity))));
    }
    const replacementPrice = patch.unit_estimated_price ?? patch.estimated_price;
    const reviewedCurrency = supportedCurrencyCode(patch.estimated_currency);
    if (reviewedCurrency) setDraftCurrency(resolveReviewedValueCurrency(reviewedCurrency, item.estimated_currency, currencyCode));
    if (typeof replacementPrice === "number" && Number.isFinite(replacementPrice) && replacementPrice >= 0) {
      setUnitPriceDraft(String(replacementPrice));
    }
  };

  const goToDetail = async () => {
    onOpenItem(item.id);
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: {
        id: item.id,
        name: item.name,
        roomId: item.room_id ?? "",
        roomName: parentRoomName,
        fileId: item.file_id,
        fileName: parentPropertyName,
        origin: "room",
      },
    });
  };

  const goToEvidence = async () => {
    onOpenItem(item.id);
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: {
        id: item.id,
        name: item.name,
        evidence: "add",
        roomId: item.room_id ?? "",
        roomName: parentRoomName,
        fileId: item.file_id,
        fileName: parentPropertyName,
        origin: "room",
      },
    });
  };

  const goToReplacementPricing = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/replacement-pricing/[id]",
      params: {
        id: item.id,
        origin: "room",
        roomId: item.room_id ?? "",
        roomName: parentRoomName,
        fileId: item.file_id,
        fileName: parentPropertyName,
      },
    } as Href);
  };

  const openReplacementListing = async () => {
    if (!isWebUrl(item.web_listing_url)) return;
    await Haptics.selectionAsync();
    await WebBrowser.openBrowserAsync(item.web_listing_url);
  };

  const openBarcodeScanner = async () => {
    await Haptics.selectionAsync();
    setBarcodeScanOpen(true);
  };

  const applyBarcodeMatch = async (values: BarcodeApplyValues) => {
    const updates: Partial<InventoryItem> = {
      barcode: values.barcode,
      barcode_verified: true,
      ...(values.name ? { name: values.name } : {}),
      ...(values.brandMaker ? { brand_maker: values.brandMaker } : {}),
      ...(values.modelSeries ? { model_series: values.modelSeries } : {}),
      ...(values.description ? { description: values.description } : {}),
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update(updates)
      .eq("id", item.id);
    if (updateError) throw updateError;

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["item", item.id] }),
      queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
      queryClient.invalidateQueries({ queryKey: ["all-items"] }),
      queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
    ]);
    showToast("Barcode details applied");
  };

  return (
    <>
      <View
        style={[
          styles.card,
          {
            backgroundColor: isSelected ? "#E8F8F2" : colors.card,
            borderRadius: colors.radius,
            borderColor: isSelected || isNew ? colors.primary : colors.border,
          },
        ]}
      >
      {/* ── Summary row ── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selectionMode ? `${isSelected ? "Deselect" : "Select"} ${item.name}` : `Open ${item.name} details`}
        accessibilityState={selectionMode ? { selected: isSelected } : undefined}
        onPress={selectionMode ? onToggleSelected : () => void goToDetail()}
        style={({ pressed }) => [
          styles.cardSummary,
          !selectionMode && pressed ? styles.cardSummaryPressed : null,
        ]}
      >
        {selectionMode ? (
          <View
            style={[
              styles.selectionCircle,
              {
                borderColor: isSelected ? colors.primary : colors.border,
                backgroundColor: isSelected ? colors.primary : colors.card,
              },
            ]}
          >
            {isSelected ? <Feather name="check" size={13} color={colors.primaryForeground} /> : null}
          </View>
        ) : null}
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
            viewerTitle={item.name}
            pinPhotoIndex={0}
            onReposition={pin ? (x, y) => onRepositionPin(item, x, y) : undefined}
            onExpand={() => onExpandImage(item, imageUri!)}
            disabled={selectionMode}
            onPermanentError={onImagePermanentError}
          />
        </View>

        {/* Text block */}
        <View style={styles.cardBody}>
          {/* Narrow cards stack price beneath the name so both remain readable. */}
          <View style={[styles.nameRow, useStackedSummary ? styles.nameRowStacked : null]}>
            <View style={styles.nameBlock}>
              {isNew ? (
                <View style={[styles.newBadge, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.newBadgeText, { color: colors.primaryForeground }]}>NEW</Text>
                </View>
              ) : null}
              <Pressable
                accessibilityLabel="Edit item"
                onPress={(event) => {
                  event.stopPropagation();
                  beginNameEdit();
                }}
                hitSlop={5}
                style={styles.namePressable}
              >
                <Text
                  style={[styles.cardName, { color: colors.foreground }]}
                  numberOfLines={useStackedSummary ? 3 : 2}
                  ellipsizeMode="tail"
                >
                  {item.name}
                </Text>
              </Pressable>
            </View>
            <View
              style={[
                styles.priceBlock,
                useStackedSummary ? styles.priceBlockStacked : null,
              ]}
            >
              {showInlineValuationEditor ? (
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
                      <Text style={[styles.compactCurrency, { color: colors.mutedForeground }]}>{moneyDisplayToken(draftCurrency, currencyCode)}</Text>
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
                    Total {formatCurrencyFull(draftTotal, draftCurrency, currencyCode)}
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
                  <Pressable
                    accessibilityLabel="Edit item valuation"
                    onPress={(event) => {
                      event.stopPropagation();
                      beginValuationEdit();
                    }}
                    hitSlop={5}
                  >
                    <View style={styles.compactValuation}>
                      <Text style={[styles.mainValue, { color: colors.foreground }]} numberOfLines={1}>
                        {formatCurrencyFull(totalValue, displayCurrency, currencyCode)}
                      </Text>
                      {quantity > 1 ? (
                        <Text style={[styles.valueMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                          Qty {quantity} · Each {formatCurrencyFull(unitPrice, displayCurrency, currencyCode)}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                  {valLabel && item.price_source_type === "web_listing" && isWebUrl(item.web_listing_url) ? (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel="Open replacement listing"
                      onPress={(event) => {
                        event.stopPropagation();
                        void openReplacementListing();
                      }}
                      hitSlop={6}
                    >
                      <Text style={[styles.valLabel, styles.listingLink, { color: TEAL }]} numberOfLines={1}>
                        {valLabel} <Feather name="external-link" size={10} color={TEAL} />
                      </Text>
                    </Pressable>
                  ) : valLabel ? (
                    <Text style={[styles.valLabel, { color: colors.mutedForeground }]} numberOfLines={1}>{valLabel}</Text>
                  ) : null}
                </>
              )}
            </View>
          </View>

          {/* Category chip */}
          <View style={styles.chipWrap}>
            <View style={styles.chipRow}>
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
              <Text
                style={[styles.chipText, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {item.category ?? "General items"}
              </Text>
            </View>
            {readinessChip ? (
              <View style={[styles.readinessChip, { borderColor: colors.warning, backgroundColor: colors.warning + "10" }]}>
                <Feather name="alert-circle" size={10} color={colors.warning} />
                <Text style={[styles.readinessChipText, { color: colors.warning }]}>
                  {readinessChip}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

      </Pressable>

      {/* ── Divider ── */}
      {!selectionMode ? (
        <>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* ── Actions ── */}
      <View style={styles.actions}>
        {hasReplacementListing ? (
          <Pressable
            onPress={goToReplacementPricing}
            style={({ pressed }) => [
              styles.updatePriceBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.secondary,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Feather name="refresh-cw" size={12} color={TEAL} />
            <Text style={[styles.updatePriceTxt, { color: TEAL }]}>Update price</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={goToReplacementPricing}
            style={({ pressed }) => [
              styles.findPriceBtn,
              { borderColor: TEAL, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Feather name="search" size={13} color={TEAL} />
            <Text style={[styles.findPriceTxt, { color: TEAL }]}>Find replacement price</Text>
          </Pressable>
        )}

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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              item.barcode_verified
                ? "View verified barcode"
                : item.barcode
                  ? "View saved barcode"
                  : "Scan barcode"
            }
            onPress={() => void openBarcodeScanner()}
            style={({ pressed }) => [
              styles.barcodeIconBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.secondary,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <View style={styles.barcodeIconWrap}>
              <MaterialCommunityIcons
                name={item.barcode ? "barcode" : "barcode-scan"}
                size={19}
                color={item.barcode_verified ? colors.primary : colors.mutedForeground}
              />
              {item.barcode_verified ? (
                <View style={[styles.barcodeVerifiedBadge, { backgroundColor: colors.primary }]}>
                  <Feather name="check" size={7} color={colors.primaryForeground} />
                </View>
              ) : item.barcode ? (
                <View style={[styles.barcodeSavedDot, { backgroundColor: colors.primary }]} />
              ) : null}
            </View>
          </Pressable>
        </View>
        </View>
        </>
      ) : null}
      </View>
      <Modal
        visible={editingTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={cancelEdit}
      >
        <Pressable style={styles.nameModalBackdrop} onPress={cancelEdit}>
          <View
            onStartShouldSetResponder={() => true}
            style={[
              styles.nameModalCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius + 4,
              },
            ]}
          >
            <View style={styles.quickEditHeader}>
              <Text style={[styles.nameModalTitle, { color: colors.foreground }]}>Edit item</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Update quick-edit fields with voice"
                onPress={() => setVoiceEditOpen(true)}
                style={[styles.quickEditVoiceButton, { backgroundColor: colors.secondary }]}
              >
                <Feather name="mic" size={15} color={colors.primary} />
                <Text style={[styles.quickEditVoiceText, { color: colors.primary }]}>Voice</Text>
              </Pressable>
            </View>
            <View style={styles.editFieldGroup}>
              <Text style={[styles.editFieldLabel, { color: colors.mutedForeground }]}>Name</Text>
              <TextInput
                accessibilityLabel="Item name"
                value={nameDraft}
                onChangeText={setNameDraft}
                editable={!savingCard}
                disableFullscreenUI
                returnKeyType="next"
                style={[
                  styles.editModalInput,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              />
            </View>
            <View style={styles.editModalRow}>
              <View style={[styles.editFieldGroup, styles.editQuantityField]}>
                <Text style={[styles.editFieldLabel, { color: colors.mutedForeground }]}>Quantity</Text>
                <QuantityStepper
                  value={quantityDraft}
                  onChange={setQuantityDraft}
                  disabled={savingCard}
                />
              </View>
              <View style={[styles.editFieldGroup, styles.editPriceField]}>
                <Text style={[styles.editFieldLabel, { color: colors.mutedForeground }]}>Replacement price</Text>
                <View
                  style={[
                    styles.editPriceInputWrap,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.editCurrencyPrefix, { color: colors.mutedForeground }]}>{moneyDisplayToken(draftCurrency, currencyCode)}</Text>
                  <TextInput
                    accessibilityLabel="Replacement price"
                    value={unitPriceDraft}
                    onChangeText={setUnitPriceDraft}
                    editable={!savingCard}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    disableFullscreenUI
                    selectTextOnFocus
                    onSubmitEditing={() => void saveItemEdit()}
                    style={[styles.editPriceInput, { color: colors.foreground }]}
                  />
                </View>
              </View>
            </View>
            {draftQuantity > 1 ? (
              <Text style={[styles.editTotalPreview, { color: colors.mutedForeground }]}>
                Total {formatCurrencyFull(draftTotal, draftCurrency, currencyCode)}
              </Text>
            ) : null}
            <View style={styles.nameModalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={cancelEdit}
                disabled={savingCard}
                style={({ pressed }) => [
                  styles.nameModalButton,
                  { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.nameModalButtonText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void saveItemEdit()}
                disabled={savingCard}
                style={({ pressed }) => [
                  styles.nameModalButton,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                    opacity: savingCard || pressed ? 0.72 : 1,
                  },
                ]}
              >
                {savingCard ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.nameModalButtonText, { color: colors.primaryForeground }]}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
      <VoiceInputSheet
        visible={voiceEditOpen}
        title="Update item with voice"
        currentValues={{
          name: nameDraft,
          quantity: draftQuantity,
          estimated_price: draftUnitPrice,
          unit_estimated_price: draftUnitPrice,
        }}
        context={{ currentName: nameDraft }}
        onClose={() => setVoiceEditOpen(false)}
        onApply={applyVoicePatchToQuickEdit}
      />
      <BarcodeScanFlow
        visible={barcodeScanOpen}
        item={item}
        onClose={() => setBarcodeScanOpen(false)}
        onApply={applyBarcodeMatch}
      />
    </>
  );
}

function AnimatedItemCard(props: React.ComponentProps<typeof ItemCard>) {
  const enter = useRef(new Animated.Value(props.isNew ? 0 : 1)).current;

  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | null = null;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (!props.isNew || reduceMotion) {
        enter.setValue(1);
        return;
      }
      enter.setValue(0);
      animation = Animated.timing(enter, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start();
    });

    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [enter, props.isNew]);

  const animatedStyle = {
    opacity: enter,
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View style={animatedStyle}>
      <ItemCard {...props} />
    </Animated.View>
  );
}

function CompactItemCard({
  item,
  parentRoomName,
  parentPropertyName,
  currencyCode,
  colors,
  resolvedImageUrl,
  onImagePermanentError,
  isNew = false,
  selectionMode = false,
  isSelected = false,
  onToggleSelected,
  onOpenItem,
  onRepositionPin,
  onExpandImage,
}: {
  item: InventoryItem;
  parentRoomName: string;
  parentPropertyName: string;
  currencyCode: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  resolvedImageUrl?: string | null;
  onImagePermanentError?: () => void;
  isNew?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelected?: () => void;
  onOpenItem: (itemId: string) => void;
  onRepositionPin: (item: InventoryItem, x: number, y: number) => Promise<void>;
  onExpandImage: (item: InventoryItem, uri: string) => void;
}) {
  const readinessChip = itemReadinessChip(item);
  const totalValue = getItemTotalValue(item);
  const displayCurrency = item.estimated_currency ?? currencyCode;
  const placeholderIcon = categoryIcon(item.category);
  const pin = normalizedItemPin(item);

  const goToDetail = async () => {
    if (selectionMode) {
      onToggleSelected?.();
      return;
    }
    onOpenItem(item.id);
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/item/[id]",
      params: {
        id: item.id,
        name: item.name,
        roomId: item.room_id ?? "",
        roomName: parentRoomName,
        fileId: item.file_id,
        fileName: parentPropertyName,
        origin: "room",
      },
    });
  };

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: 1,
      }}
    >
      <Pressable
        onPress={goToDetail}
        style={({ pressed }) => [
          styles.gridCard,
          {
            backgroundColor: isSelected ? "#E8F8F2" : colors.card,
            borderColor: isSelected || isNew ? colors.primary : colors.border,
            borderRadius: colors.radius,
            opacity: pressed ? 0.78 : 1,
          },
        ]}
      >
        {selectionMode ? (
          <View
            style={[
              styles.gridSelectionCircle,
              {
                borderColor: isSelected ? colors.primary : colors.border,
                backgroundColor: isSelected ? colors.primary : colors.card,
              },
            ]}
          >
            {isSelected ? <Feather name="check" size={12} color={colors.primaryForeground} /> : null}
          </View>
        ) : null}
        {resolvedImageUrl ? (
          <ExpandableImage
            uri={resolvedImageUrl}
            style={styles.gridThumb}
            contentFit="cover"
            placeholderIcon={placeholderIcon}
            placeholderIconSize={24}
            placeholderIconColor={TEAL}
            placeholderBackgroundColor={colors.muted}
            pin={pin}
            pinPhotoIndex={0}
            viewerTitle={item.name}
            onReposition={pin ? (x, y) => onRepositionPin(item, x, y) : undefined}
            onExpand={() => onExpandImage(item, resolvedImageUrl)}
            disabled={selectionMode}
            onPermanentError={onImagePermanentError}
          />
        ) : (
          <View style={[styles.gridThumb, styles.gridThumbPlaceholder, { backgroundColor: colors.muted }]}>
            <Feather name={placeholderIcon} size={24} color={TEAL} />
          </View>
        )}
        <View style={styles.gridCopy}>
          <Text style={[styles.gridName, { color: colors.foreground }]} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={[styles.gridValue, { color: colors.mutedForeground }]} numberOfLines={1}>
            {totalValue > 0 ? formatCurrencyFull(totalValue, displayCurrency, currencyCode) : "No value"}
          </Text>
          {readinessChip ? (
            <View style={[styles.gridReadinessChip, { borderColor: colors.warning, backgroundColor: colors.warning + "10" }]}>
              <Text style={[styles.gridReadinessText, { color: colors.warning }]} numberOfLines={1}>
                {readinessChip}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function detailedCardPropsEqual(
  previous: React.ComponentProps<typeof ItemCard>,
  next: React.ComponentProps<typeof ItemCard>,
): boolean {
  return previous.item === next.item
    && previous.colors === next.colors
    && previous.parentRoomName === next.parentRoomName
    && previous.parentPropertyName === next.parentPropertyName
    && previous.resolvedImageUrl === next.resolvedImageUrl
    && previous.evidenceCount === next.evidenceCount
    && previous.isNew === next.isNew
    && previous.editingTarget === next.editingTarget
    && previous.selectionMode === next.selectionMode
    && previous.isSelected === next.isSelected;
}

function compactCardPropsEqual(
  previous: React.ComponentProps<typeof CompactItemCard>,
  next: React.ComponentProps<typeof CompactItemCard>,
): boolean {
  return previous.item === next.item
    && previous.colors === next.colors
    && previous.parentRoomName === next.parentRoomName
    && previous.parentPropertyName === next.parentPropertyName
    && previous.resolvedImageUrl === next.resolvedImageUrl
    && previous.isNew === next.isNew
    && previous.selectionMode === next.selectionMode
    && previous.isSelected === next.isSelected;
}

const MemoizedAnimatedItemCard = React.memo(AnimatedItemCard, detailedCardPropsEqual);
const MemoizedCompactItemCard = React.memo(CompactItemCard, compactCardPropsEqual);

export default function ItemsScreen() {
  const { id, name, fileId, fileName, addedCount } = useLocalSearchParams<{
    id: string;
    name: string;
    fileId?: string;
    fileName?: string;
    addedCount?: string;
  }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const initialViewSession = React.useMemo(() => getRoomViewSession(id), [id]);

  const [coverUploading, setCoverUploading] = useState(false);
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);
  const [coverSavedTick, setCoverSavedTick] = useState(false);
  const [coverActionSheetVisible, setCoverActionSheetVisible] = useState(false);
  const [archivingRoom, setArchivingRoom] = useState(false);
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  const [roomImageViewer, setRoomImageViewer] = useState<{ item?: InventoryItem; uri: string; title: string } | null>(null);
  const [activeEdit, setActiveEdit] = useState<{
    itemId: string;
    target: CardEditTarget;
  } | null>(null);
  const [viewMode, setViewMode] = useState<RoomViewMode>((initialViewSession?.viewMode as RoomViewMode | undefined) ?? "detailed");
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [searchText, setSearchText] = useState(initialViewSession?.searchText ?? "");
  const [categoryFilter, setCategoryFilter] = useState<string>(initialViewSession?.categoryFilter ?? "all");
  const [readinessFilter, setReadinessFilter] = useState<RoomReadinessFilter>((initialViewSession?.readinessFilter as RoomReadinessFilter | undefined) ?? "all");
  const [sortOption, setSortOption] = useState<RoomSortOption>((initialViewSession?.sortOption as RoomSortOption | undefined) ?? "recent");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [categorySummaryExpanded, setCategorySummaryExpanded] = useState(false);
  const openingItemRef = useRef(false);
  const restoredRoomScrollRef = useRef(false);
  const roomViewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;
  const liveScrollOffsetRef = useRef(initialViewSession?.offset ?? 0);

  const persistRoomScrollSnapshot = React.useCallback((event?: NativeSyntheticEvent<NativeScrollEvent>) => {
    const settledOffset = event?.nativeEvent.contentOffset.y;
    if (typeof settledOffset === "number") {
      liveScrollOffsetRef.current = settledOffset;
    }
    updateRoomViewSession(id, {
      offset: liveScrollOffsetRef.current,
      viewMode,
      searchText,
      categoryFilter,
      readinessFilter,
      sortOption,
    });
  }, [categoryFilter, id, readinessFilter, searchText, sortOption, viewMode]);

  useFocusEffect(
    React.useCallback(() => {
      const latestBatch = takeRecentItemBatch(id);
      if (latestBatch) setNewItemIds(latestBatch);

      return () => {
        if (openingItemRef.current) {
          openingItemRef.current = false;
          return;
        }
        setNewItemIds(new Set());
      };
    }, [id]),
  );

  // Parallax hero — scrollY drives image translateY 0→-40 as user scrolls down
  const scrollY = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<InventoryItem> | null>(null);
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

  const clearNewItemOnOpen = React.useCallback((itemId: string) => {
    persistRoomScrollSnapshot();
    openingItemRef.current = true;
    setNewItemIds((current) => current.has(itemId) ? withoutRecentItem(current, itemId) : current);
  }, [persistRoomScrollSnapshot]);

  const removeNewItemIds = React.useCallback((itemIds: Iterable<string>) => {
    const idsToRemove = new Set(itemIds);
    setNewItemIds((current) => {
      const next = new Set([...current].filter((itemId) => !idsToRemove.has(itemId)));
      return next.size === current.size ? current : next;
    });
  }, []);

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

  const resolvedFileId = fileId ?? room?.file_id;
  const { data: parentProperty } = useQuery({
    queryKey: ["property-context", resolvedFileId, session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_files")
        .select("id, name, currency_code, country_code")
        .eq("id", resolvedFileId!)
        .single();
      if (queryError) throw queryError;
      return data as { id: string; name: string; currency_code: string; country_code: string };
    },
    enabled: Boolean(session && resolvedFileId),
  });
  const resolvedPropertyName = fileName ?? parentProperty?.name ?? "Property";
  const resolvedPropertyCurrency = parentProperty?.currency_code ?? "NZD";
  const resolvedPropertyCountry = parentProperty?.country_code ?? "NZ";
  const resolvedRoomName = room?.name ?? name ?? "Room";
  const scanAddedCount = Number.parseInt(addedCount ?? "", 10);
  const scanSuccessMessage = Number.isFinite(scanAddedCount) && scanAddedCount > 0
    ? `${scanAddedCount} item${scanAddedCount === 1 ? "" : "s"} added`
    : null;
  const { data: moveTargetRooms = [] } = useQuery({
    queryKey: ["rooms", resolvedFileId, session?.user.id, "move-targets"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_rooms")
        .select("*")
        .eq("file_id", resolvedFileId!)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      if (queryError) throw queryError;
      return (data ?? []) as InventoryRoom[];
    },
    enabled: Boolean(session && resolvedFileId),
  });

  const roomItemIds = React.useMemo(() => (items ?? []).map((item) => item.id), [items]);
  const roomItemIdsKey = React.useMemo(
    () => [...roomItemIds].sort().join(","),
    [roomItemIds],
  );
  const { data: evidenceCounts = {}, isLoading: evidenceCountsLoading } = useQuery<Record<string, number>>({
    queryKey: ["room-evidence-counts", id, session?.user.id, roomItemIdsKey],
    queryFn: async () => {
      if (roomItemIds.length === 0) return {};

      const { data, error: countError } = await supabase
        .from("claim_evidence_items")
        .select("item_id")
        .in("item_id", roomItemIds);

      if (countError) {
        if (__DEV__) console.warn("[roomEvidenceCounts] unable to load", {
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
  const recoverRoomCoverUrl = useSignedImageRecovery([room?.cover_photo_url]);

  // Batch-resolve item thumbnail paths → signed URLs in one round-trip.
  // Memoised so the array reference is stable between renders (avoids redundant key recomputation).
  const itemImagePaths = React.useMemo(
    () => (items ?? []).map((it) => it.image_url ?? it.photo_url ?? null),
    [items],
  );
  const itemSignedUrls = useSignedUrls(itemImagePaths);
  const recoverItemImageUrl = useSignedImageRecovery(itemImagePaths);
  const repositionRoomItemPin = React.useCallback(async (target: InventoryItem, x: number, y: number) => {
    const committed = itemWithCommittedPin(target, { x, y });
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ image_pin: committed.image_pin })
      .eq("id", target.id);
    if (updateError) throw new Error(updateError.message);

    queryClient.setQueriesData<InventoryItem[]>(
      { queryKey: ["items", id] },
      (current) => replaceItemWithCommittedPin(current, target.id, { x, y }),
    );
    queryClient.setQueryData(
      ["item", target.id, session?.user.id],
      (current: InventoryItem | undefined) => current ? itemWithCommittedPin(current, { x, y }) : committed,
    );
    queryClient.setQueryData<InventoryItem[]>(
      ["all-items", "home-valuation", session?.user.id],
      (current) => replaceItemWithCommittedPin(current, target.id, { x, y }),
    );
    queryClient.setQueryData<InventoryItem[]>(
      ["property-items", target.file_id, session?.user.id],
      (current) => replaceItemWithCommittedPin(current, target.id, { x, y }),
    );
  }, [id, queryClient, session?.user.id]);
  const openRoomItemImage = React.useCallback((target: InventoryItem, uri: string) => {
    setRoomImageViewer({ item: target, uri, title: target.name });
  }, []);
  const repositionRoomViewerPin = React.useCallback(async (x: number, y: number) => {
    const target = roomImageViewer?.item;
    if (!target) throw new Error("Item image is no longer available");
    await repositionRoomItemPin(target, x, y);
    setRoomImageViewer((current) => current?.item?.id === target.id
      ? { ...current, item: itemWithCommittedPin(current.item, { x, y }) }
      : current);
  }, [repositionRoomItemPin, roomImageViewer?.item]);
  const roomCategoryOptions = React.useMemo(() => {
    const categorySet = new Set<string>();
    (items ?? []).forEach((item) => {
      const category = item.category?.trim();
      if (category) categorySet.add(category);
    });
    return [...categorySet].sort((a, b) => a.localeCompare(b));
  }, [items]);
  const normalizedSearchText = searchText.trim().toLowerCase();
  const filtersActive =
    normalizedSearchText.length > 0 ||
    categoryFilter !== "all" ||
    readinessFilter !== "all" ||
    sortOption !== "recent";
  const clearRoomFilters = React.useCallback(() => {
    setSearchText("");
    setCategoryFilter("all");
    setReadinessFilter("all");
    setSortOption("recent");
  }, []);

  useEffect(() => {
    updateRoomViewSession(id, {
      viewMode,
      searchText,
      categoryFilter,
      readinessFilter,
      sortOption,
    });
  }, [categoryFilter, id, readinessFilter, searchText, sortOption, viewMode]);
  const visibleItems = React.useMemo(() => {
    const filtered = (items ?? []).filter((item) => {
      const matchesSearch =
        !normalizedSearchText ||
        item.name.toLowerCase().includes(normalizedSearchText) ||
        (item.brand_maker ?? "").toLowerCase().includes(normalizedSearchText) ||
        (item.category ?? "").toLowerCase().includes(normalizedSearchText);
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      return matchesSearch && matchesCategory && roomItemMatchesReadiness(item, readinessFilter);
    });

    return [...filtered].sort((a, b) => {
      if (sortOption === "value_desc") return getItemTotalValue(b) - getItemTotalValue(a);
      if (sortOption === "value_asc") return getItemTotalValue(a) - getItemTotalValue(b);
      if (sortOption === "name_asc") return a.name.localeCompare(b.name);
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }, [categoryFilter, items, normalizedSearchText, readinessFilter, sortOption]);

  const roomSummary = React.useMemo(() => {
    const roomItems = items ?? [];
    const totalsByCurrency = groupAmountsByCurrency(roomItems, getItemTotalValue, (item) => item.estimated_currency ?? resolvedPropertyCurrency);
    const primaryItems = roomItems.filter((item) => (item.estimated_currency ?? resolvedPropertyCurrency) === resolvedPropertyCurrency);
    const totalValue = totalsByCurrency[resolvedPropertyCurrency] ?? 0;
    const categoryMap = new Map<string, { label: string; value: number; count: number; color: string }>();

    primaryItems.forEach((item) => {
      const label = item.category?.trim() || "General items";
      const current = categoryMap.get(label) ?? {
        label,
        value: 0,
        count: 0,
        color: categoryDotColor(item.category),
      };
      current.value += getItemTotalValue(item);
      current.count += 1;
      categoryMap.set(label, current);
    });

    const categories = [...categoryMap.values()].sort((a, b) => b.value - a.value || b.count - a.count);
    return {
      itemCount: roomItems.length,
      totalValue,
      totalsByCurrency,
      categories,
    };
  }, [items, resolvedPropertyCurrency]);

  useEffect(() => {
    if (isLoading || visibleItems.length === 0 || restoredRoomScrollRef.current) return;
    const saved = getRoomViewSession(id);
    if (!saved) return;
    restoredRoomScrollRef.current = true;
    const frame = requestAnimationFrame(() => {
      if (saved.offset > 0) {
        listRef.current?.scrollToOffset({ offset: saved.offset, animated: false });
        return;
      }
      const anchorIndex = resolveRoomRestoreIndex(saved, visibleItems.map((item) => item.id));
      if (anchorIndex != null) {
        listRef.current?.scrollToIndex({ index: anchorIndex, animated: false, viewPosition: 0.2 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [id, isLoading, visibleItems]);

  const onRoomViewableItemsChanged = React.useCallback(
    ({ viewableItems }: { viewableItems: Array<{ item: InventoryItem }> }) => {
      updateRoomViewSession(id, { anchorItemId: viewableItems[0]?.item.id ?? null });
    },
    [id],
  );

  useEffect(() => {
    if (!selectionMode) return;
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    setSelectedItemIds((current) => {
      const next = new Set([...current].filter((itemId) => visibleIds.has(itemId)));
      return next.size === current.size ? current : next;
    });
  }, [selectionMode, visibleItems]);

  const selectedCount = selectedItemIds.size;
  const availableMoveTargets = React.useMemo(
    () => moveTargetRooms.filter((candidate) => candidate.id !== id),
    [id, moveTargetRooms],
  );

  const clearSelection = React.useCallback(() => {
    setSelectionMode(false);
    setSelectedItemIds(new Set());
    setMoveModalVisible(false);
  }, []);

  const toggleSelectedItem = React.useCallback((itemId: string) => {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const invalidateRoomBulkQueries = React.useCallback(async (targetRoomId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items", id] }),
      targetRoomId ? queryClient.invalidateQueries({ queryKey: ["items", targetRoomId] }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["room", id] }),
      targetRoomId ? queryClient.invalidateQueries({ queryKey: ["room", targetRoomId] }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["rooms", resolvedFileId] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", resolvedFileId, session?.user.id] }),
      queryClient.invalidateQueries({ queryKey: ["property", resolvedFileId] }),
      queryClient.invalidateQueries({ queryKey: ["property-items", resolvedFileId] }),
      queryClient.invalidateQueries({ queryKey: ["all-items"] }),
      queryClient.invalidateQueries({ queryKey: ["all-items", "home-valuation", session?.user.id] }),
      queryClient.invalidateQueries({ queryKey: ["all-items", "exact-count", session?.user.id] }),
    ]);
  }, [id, queryClient, resolvedFileId, session?.user.id]);

  const handleScanRoom = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/scan",
      params: {
        roomId: id,
        roomName: resolvedRoomName,
        fileId: resolvedFileId ?? "",
        fileName: resolvedPropertyName,
      },
    });
  };

  const handleAddManually = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/add-item",
      params: {
        roomId: id,
        roomName: resolvedRoomName,
        fileId: resolvedFileId ?? "",
        fileName: resolvedPropertyName,
      },
    });
  };

  const enterSelectionMode = React.useCallback(() => {
    setActiveEdit(null);
    setSelectionMode(true);
    setSelectedItemIds(new Set());
    void Haptics.selectionAsync().catch(() => undefined);
  }, []);

  const deleteSelectedItems = React.useCallback(async () => {
    if (selectedCount === 0 || bulkWorking) return;
    setBulkWorking(true);
    try {
      const ids = [...selectedItemIds];
      const { error: deleteError } = await supabase
        .from("inventory_items")
        .delete()
        .in("id", ids);
      if (deleteError) throw deleteError;

      ids.forEach((itemId) => queryClient.removeQueries({ queryKey: ["item", itemId] }));
      removeNewItemIds(ids);
      await invalidateRoomBulkQueries();
      showToast(`${ids.length} item${ids.length === 1 ? "" : "s"} deleted`);
      clearSelection();
    } catch (deleteFailure) {
      Alert.alert(
        "Couldn't delete selected items",
        deleteFailure instanceof Error ? deleteFailure.message : "Please try again.",
      );
    } finally {
      setBulkWorking(false);
    }
  }, [bulkWorking, clearSelection, invalidateRoomBulkQueries, queryClient, removeNewItemIds, selectedCount, selectedItemIds, showToast]);

  const confirmDeleteSelectedItems = React.useCallback(() => {
    if (selectedCount === 0 || bulkWorking) return;
    Alert.alert(
      `Delete ${selectedCount} item${selectedCount === 1 ? "" : "s"}?`,
      "This will remove the selected items from your inventory. Evidence files and storage cleanup are not changed by this action.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void deleteSelectedItems() },
      ],
    );
  }, [bulkWorking, deleteSelectedItems, selectedCount]);

  const openMoveSelected = React.useCallback(() => {
    if (selectedCount === 0 || bulkWorking) return;
    if (availableMoveTargets.length === 0) {
      Alert.alert("Create another room first", "Create another room before moving items.");
      return;
    }
    setMoveModalVisible(true);
  }, [availableMoveTargets.length, bulkWorking, selectedCount]);

  const moveSelectedItems = React.useCallback(async (targetRoom: InventoryRoom) => {
    if (selectedCount === 0 || bulkWorking || !resolvedFileId) return;
    setBulkWorking(true);
    try {
      const ids = [...selectedItemIds];
      const { data: movedRows, error: moveError } = await supabase
        .from("inventory_items")
        .update({ room_id: targetRoom.id, room: targetRoom.name })
        .in("id", ids)
        .eq("file_id", resolvedFileId)
        .select("id");
      if (moveError) throw moveError;
      if ((movedRows ?? []).length !== ids.length) {
        throw new Error("Some selected items could not be moved. Please refresh and try again.");
      }

      await invalidateRoomBulkQueries(targetRoom.id);
      removeNewItemIds(ids);
      showToast(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to ${targetRoom.name}`);
      clearSelection();
    } catch (moveFailure) {
      Alert.alert(
        "Couldn't move selected items",
        moveFailure instanceof Error ? moveFailure.message : "Please try again.",
      );
    } finally {
      setBulkWorking(false);
    }
  }, [
    bulkWorking,
    clearSelection,
    invalidateRoomBulkQueries,
    removeNewItemIds,
    resolvedFileId,
    selectedCount,
    selectedItemIds,
    showToast,
  ]);

  const roomRecommendedAction = React.useMemo(() => {
    if (!ENABLE_RECOMMENDED_ACTIONS || !items) return null;

    const openAttention = (filter: ItemAttentionFilter) => {
      router.push({
        pathname: "/(tabs)/items-needing-attention",
        params: {
          roomId: id,
          roomName: resolvedRoomName,
          fileId: resolvedFileId ?? "",
          fileName: resolvedPropertyName,
          filter,
        },
      } as Href);
    };

    if (items.length === 0) {
      return {
        body: "Start this room",
        detail: "Scan visible items or add them manually.",
        primaryLabel: "Scan items",
        onPrimaryPress: () => void handleScanRoom(),
      };
    }

    const missingPhotoItems = filterItemsNeedingAttention(items, "missing_photo");
    if (missingPhotoItems.length > 0) {
      return {
        body: `${missingPhotoItems.length} item${missingPhotoItems.length === 1 ? " is" : "s are"} missing a photo`,
        detail: "Add a primary photo to make these records easier to identify.",
        primaryLabel: "View items",
        onPrimaryPress: () => openAttention("missing_photo"),
      };
    }

    const missingValueItems = filterItemsNeedingAttention(items, "missing_value");
    if (missingValueItems.length > 0) {
      return {
        body: `${missingValueItems.length} item${missingValueItems.length === 1 ? " is" : "s are"} missing a value`,
        detail: "Add or review values to improve this room's recorded total.",
        primaryLabel: "View items",
        onPrimaryPress: () => openAttention("missing_value"),
      };
    }

    const detailReviewItems = filterItemsNeedingAttention(items, "needs_details");
    if (detailReviewItems.length > 0) {
      return {
        body: `${detailReviewItems.length} item${detailReviewItems.length === 1 ? " needs" : "s need"} review`,
        detail: "Review items with an unclear name, quantity, or confidence level.",
        primaryLabel: "View items",
        onPrimaryPress: () => openAttention("needs_details"),
      };
    }

    if (!evidenceCountsLoading) {
      const highValueWithoutEvidence = filterItemsNeedingAttention(items, "missing_evidence", evidenceCounts);
      if (highValueWithoutEvidence.length > 0) {
        return {
          body: "Add evidence to high-value items",
          detail: "Receipts or photos can strengthen these records.",
          primaryLabel: "View items",
          onPrimaryPress: () => openAttention("missing_evidence"),
        };
      }
    }

    const aiEstimateItems = filterItemsNeedingAttention(items, "ai_value");
    if (aiEstimateItems.length > 0) {
      return {
        body: "Check replacement values",
        detail: "Replace AI estimates with current replacement listings where useful.",
        primaryLabel: "View items",
        onPrimaryPress: () => openAttention("ai_value"),
      };
    }

    return null;
  }, [
    clearNewItemOnOpen,
    evidenceCounts,
    evidenceCountsLoading,
    handleScanRoom,
    id,
    items,
    resolvedFileId,
    resolvedPropertyName,
    resolvedRoomName,
  ]);


  const navigateToProperty = React.useCallback(() => {
    clearRoomViewSession(id);
    if (resolvedFileId) {
      router.replace({
        pathname: "/(tabs)/property/[id]",
        params: { id: resolvedFileId, name: resolvedPropertyName },
      } as Href);
      return;
    }
    router.replace("/(tabs)");
  }, [id, resolvedFileId, resolvedPropertyName]);

  const archiveRoom = React.useCallback(async () => {
    if (!id || archivingRoom) return;
    setArchivingRoom(true);
    try {
      const { error: archiveError } = await supabase
        .from("inventory_rooms")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (archiveError) throw archiveError;

      const { data: deletedItems, error: deleteItemsError } = await supabase
        .from("inventory_items")
        .delete()
        .eq("room_id", id)
        .select("id, room_id");
      if (deleteItemsError) {
        // Keep the room visible if its child rows could not be removed. This
        // avoids leaving an archived room whose values still affect summaries.
        await supabase
          .from("inventory_rooms")
          .update({ archived_at: null })
          .eq("id", id);
        throw deleteItemsError;
      }

      const deletedItemCount = deletedItems?.length ?? 0;
      queryClient.setQueryData<InventoryItem[]>(
        ["property-items", resolvedFileId, session?.user.id],
        (current) => withoutRoomItems(current, id),
      );
      queryClient.setQueryData<InventoryItem[]>(
        ["all-items", "home-valuation", session?.user.id],
        (current) => withoutRoomItems(current, id),
      );
      queryClient.setQueryData<number>(
        ["all-items", "exact-count", session?.user.id],
        (current) => subtractDeletedItems(current, deletedItemCount),
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["room", id] }),
        queryClient.invalidateQueries({ queryKey: ["items", id] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", resolvedFileId] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", resolvedFileId, session?.user.id] }),
        queryClient.invalidateQueries({ queryKey: ["property", resolvedFileId] }),
        queryClient.invalidateQueries({ queryKey: ["property-items", resolvedFileId] }),
        queryClient.invalidateQueries({ queryKey: ["all-items"] }),
        queryClient.invalidateQueries({ queryKey: ["all-rooms-count", session?.user.id] }),
        queryClient.invalidateQueries({ queryKey: ["item-scan-dates", resolvedFileId] }),
        queryClient.invalidateQueries({ queryKey: ["claim-pack-items", resolvedFileId] }),
      ]);
      queryClient.removeQueries({ queryKey: ["items", id] });
      showToast("Room and its items deleted");
      navigateToProperty();
    } catch (archiveFailure) {
      Alert.alert(
        "Couldn't remove room",
        archiveFailure instanceof Error ? archiveFailure.message : "Please try again.",
      );
    } finally {
      setArchivingRoom(false);
    }
  }, [archivingRoom, id, navigateToProperty, queryClient, resolvedFileId, session?.user.id, showToast]);

  const handleArchiveRoom = React.useCallback(() => {
    if (archivingRoom) return;
    Alert.alert(
      "Remove room?",
      `${resolvedRoomName} and all items in it will be permanently deleted. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove room", style: "destructive", onPress: () => void archiveRoom() },
      ],
    );
  }, [archiveRoom, archivingRoom, resolvedRoomName]);

  const refreshRoomCover = React.useCallback((coverPhotoUrl: string | null) => {
    queryClient.setQueryData<InventoryRoom>(
      ["room", id, session?.user.id],
      (current) => withRoomCoverPhoto(current, coverPhotoUrl),
    );
    if (resolvedFileId) {
      queryClient.setQueriesData<InventoryRoom[]>(
        { queryKey: ["rooms", resolvedFileId] },
        (current) => withRoomListCoverPhoto(current, id, coverPhotoUrl),
      );
    }
  }, [id, queryClient, resolvedFileId, session?.user.id]);

  const showPermissionHelp = React.useCallback((source: "camera" | "photo library") => {
    Alert.alert(
      `${source === "camera" ? "Camera" : "Photo library"} access needed`,
      `Coverly needs ${source} access to ${source === "camera" ? "take" : "choose"} a room cover photo. You can enable access in your device settings.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open settings",
          onPress: () => void Linking.openSettings().catch(() => {
            Alert.alert("Settings unavailable", "Please open your device settings and allow photo access for Coverly.");
          }),
        },
      ],
    );
  }, []);

  const saveRoomCover = React.useCallback(async (selectedUri: string) => {
    if (coverUploading) return;
    if (!session?.user.id) return;
    const previousLocalCoverUrl = localCoverUrl;
    setCoverUploading(true);
    setLocalCoverUrl(selectedUri);
    try {
      const uploaded = await uploadCoverPhoto(
        selectedUri,
        session.user.id,
        { source: "room_cover", fileId: resolvedFileId ?? undefined }
      );
      if (!uploaded.ok) {
        const diagnostic = formatUploadFailure(uploaded);
        if (__DEV__) console.warn("[roomCover] Upload diagnostic\n" + diagnostic);
        setLocalCoverUrl(previousLocalCoverUrl);
        Alert.alert("Room cover upload failed", diagnostic);
        return;
      }
      setLocalCoverUrl(uploaded.displayUrl ?? selectedUri);
      // Store the durable storage path in the DB, not the short-lived signed URL.
      const { data: updatedRows, error: updateError } = await supabase
        .from("inventory_rooms")
        .update({ cover_photo_url: uploaded.path })
        .eq("id", id)
        .select("id");
      if (updateError) {
        if (__DEV__) console.error("[roomCover] DB update error:", updateError);
        setLocalCoverUrl(previousLocalCoverUrl);
        Alert.alert("Save failed", updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        if (__DEV__) console.error("[roomCover] DB update matched 0 rows — possible missing UPDATE RLS policy. Run supabase/migrations/add_update_policies.sql.");
        setLocalCoverUrl(previousLocalCoverUrl);
        Alert.alert("Save failed", "Cover photo could not be saved. Please check your connection and try again.");
        return;
      }
      // Invalidate the room query and the signed URL cache for the new path so
      // useSignedUrl immediately re-fetches and the new cover appears right away.
      refreshRoomCover(uploaded.path);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["room", id] }),
        queryClient.invalidateQueries({ queryKey: ["signed-url", uploaded.path] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", resolvedFileId] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", resolvedFileId, session.user.id] }),
      ]);
      showToast("Room photo saved");
      setCoverSavedTick(true);
      setTimeout(() => setCoverSavedTick(false), 1800);
    } catch (error) {
      setLocalCoverUrl(previousLocalCoverUrl);
      Alert.alert(
        "Couldn't update room photo",
        error instanceof Error ? error.message : "The photo could not be processed or uploaded. Please try again.",
      );
    } finally {
      setCoverUploading(false);
    }
  }, [coverUploading, id, localCoverUrl, queryClient, refreshRoomCover, resolvedFileId, session?.user.id, showToast]);

  const pickRoomCover = React.useCallback(async (source: "camera" | "library") => {
    if (coverUploading) return;
    try {
      if (Platform.OS !== "web") {
        const permission = source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.status !== "granted") {
          showPermissionHelp(source === "camera" ? "camera" : "photo library");
          return;
        }
      }
      const result = source === "camera" && Platform.OS !== "web"
        ? await ImagePicker.launchCameraAsync(ROOM_COVER_PICKER_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(ROOM_COVER_PICKER_OPTIONS);
      if (result.canceled || !result.assets[0]) return;
      await saveRoomCover(result.assets[0].uri);
    } catch (error) {
      Alert.alert(
        "Couldn't open photos",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }, [coverUploading, saveRoomCover, showPermissionHelp]);

  const removeRoomCover = React.useCallback(async () => {
    if (coverUploading) return;
    setCoverUploading(true);
    try {
      const { data: updatedRows, error } = await supabase
        .from("inventory_rooms")
        .update({ cover_photo_url: null })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!updatedRows?.length) throw new Error("Cover photo could not be removed. Please check your connection and try again.");
      setLocalCoverUrl(null);
      refreshRoomCover(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["room", id] }),
        queryClient.invalidateQueries({ queryKey: ["rooms", resolvedFileId] }),
      ]);
      showToast("Room cover removed");
    } catch (error) {
      Alert.alert("Couldn't remove room cover", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setCoverUploading(false);
    }
  }, [coverUploading, id, queryClient, refreshRoomCover, resolvedFileId, showToast]);

  const handleRoomCoverAction = React.useCallback((action: RoomCoverAction) => {
    setCoverActionSheetVisible(false);
    if (action === "camera" || action === "library") {
      void pickRoomCover(action);
    } else if (action === "remove") {
      Alert.alert("Remove room cover?", "The current room cover photo will be removed.", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove cover", style: "destructive", onPress: () => void removeRoomCover() },
      ]);
    }
  }, [pickRoomCover, removeRoomCover]);

  const renderRoomCover = () => (
    <>
    {roomSummary.itemCount > 0 ? (
      <View style={[styles.roomSummaryStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.roomSummaryTopRow}>
          <View>
            <Text style={[styles.roomSummaryLabel, { color: colors.mutedForeground }]}>ROOM TOTAL</Text>
            <Text style={[styles.roomSummaryCount, { color: colors.foreground }]}>
              {roomSummary.itemCount} item{roomSummary.itemCount === 1 ? "" : "s"}
            </Text>
          </View>
          <Text style={[styles.roomSummaryValue, { color: colors.primary }]}>
            {formatCurrencyTotals(roomSummary.totalsByCurrency, { contextCurrency: resolvedPropertyCurrency })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={categorySummaryExpanded ? "Hide category breakdown" : "View category breakdown"}
          onPress={() => setCategorySummaryExpanded((current) => !current)}
          style={styles.categoryBarTap}
        >
          <View style={styles.categorySegmentBar}>
            {roomSummary.categories.map((category) => {
              const flexValue = roomSummary.totalValue > 0 ? Math.max(category.value, 1) : category.count;
              return (
                <View
                  key={category.label}
                  style={[
                    styles.categorySegment,
                    { backgroundColor: category.color, flex: Math.max(flexValue, 0.1) },
                  ]}
                />
              );
            })}
          </View>
          <View style={styles.categoryBreakdownToggle}>
            <Text style={[styles.categoryBreakdownText, { color: colors.mutedForeground }]}>
              {categorySummaryExpanded ? "Hide breakdown" : "View breakdown"}
            </Text>
            <Feather
              name={categorySummaryExpanded ? "chevron-up" : "chevron-down"}
              size={13}
              color={colors.mutedForeground}
            />
          </View>
        </Pressable>
        {categorySummaryExpanded ? (
          <View style={styles.categoryLegend}>
            {roomSummary.categories.slice(0, 6).map((category) => (
              <View key={category.label} style={[styles.categoryLegendChip, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <View style={[styles.categoryLegendDot, { backgroundColor: category.color }]} />
                <Text style={[styles.categoryLegendName, { color: colors.foreground }]} numberOfLines={1}>
                  {category.label}
                </Text>
                <Text style={[styles.categoryLegendValue, { color: colors.mutedForeground }]}>
                  {category.value > 0 ? formatCurrency(category.value, resolvedPropertyCurrency) : `${category.count}`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    ) : null}
    <View style={[styles.coverContainer, { backgroundColor: colors.secondary }]}>
      {localCoverUrl ?? signedCoverUrl ? (
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
          <ExpandableImage
            uri={localCoverUrl ?? signedCoverUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            viewerTitle={resolvedRoomName}
            placeholderIcon="image"
            placeholderIconSize={54}
            placeholderIconColor={colors.primary}
            placeholderBackgroundColor={colors.secondary}
            onExpand={() => setRoomImageViewer({
              uri: localCoverUrl ?? signedCoverUrl!,
              title: resolvedRoomName,
            })}
            onPermanentError={() => recoverRoomCoverUrl(room?.cover_photo_url)}
          />
        </Animated.View>
      ) : (
        <View style={styles.coverPlaceholder}>
          <MaterialCommunityIcons
            name={getRoomPlaceholderIcon(room?.room_type, room?.name ?? name)}
            size={62}
            color={colors.primary}
            style={{ opacity: 0.55 }}
          />
          <View style={styles.coverPlaceholderCopy}>
            <Text style={[styles.coverPlaceholderTitle, { color: colors.foreground }]}>
              Add a room photo
            </Text>
            <Text style={[styles.coverPlaceholderBody, { color: colors.mutedForeground }]}>
              Use a photo to make this room easier to recognise.
            </Text>
          </View>
        </View>
      )}
      <Pressable
        onPress={() => setCoverActionSheetVisible(true)}
        disabled={coverUploading}
        style={[styles.cameraBtn, { backgroundColor: "rgba(0,0,0,0.45)" }]}
        hitSlop={8}
      >
        {coverUploading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : coverSavedTick ? (
          <Feather name="check" size={16} color="#fff" />
        ) : (
          <Feather name="camera" size={16} color="#fff" />
        )}
      </Pressable>
    </View>
    <Modal
      visible={coverActionSheetVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setCoverActionSheetVisible(false)}
    >
      <Pressable style={styles.coverActionBackdrop} onPress={() => setCoverActionSheetVisible(false)}>
        <Pressable style={[styles.coverActionSheet, { backgroundColor: colors.card }]} onPress={(event) => event.stopPropagation()}>
          <Text style={[styles.coverActionTitle, { color: colors.foreground }]}>Room cover photo</Text>
          {roomCoverActions(Boolean(localCoverUrl ?? room?.cover_photo_url)).map((action) => (
            <Pressable
              key={action}
              accessibilityRole="button"
              onPress={() => handleRoomCoverAction(action)}
              style={({ pressed }) => [styles.coverActionButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
            >
              <Text style={[styles.coverActionText, { color: action === "remove" ? colors.destructive : colors.foreground }]}>{action === "camera" ? "Take photo" : action === "library" ? "Choose from library" : action === "remove" ? "Remove cover" : "Cancel"}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
    {scanSuccessMessage ? (
      <View style={[styles.scanSuccessBanner, { backgroundColor: "#E8F8F2", borderColor: "rgba(29,158,117,0.22)" }]}>
        <Feather name="check-circle" size={15} color={TEAL} />
        <Text style={[styles.scanSuccessText, { color: "#085041" }]}>{scanSuccessMessage}</Text>
      </View>
    ) : null}
    {roomRecommendedAction ? (
      <View style={styles.recommendedActionWrap}>
        <View style={[styles.compactRecommendedCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <View style={styles.compactRecommendedCopy}>
            <Text style={[styles.compactRecommendedKicker, { color: colors.mutedForeground }]}>RECOMMENDED ACTION</Text>
            <Text style={[styles.compactRecommendedTitle, { color: colors.foreground }]} numberOfLines={1}>
              {roomRecommendedAction.body}
            </Text>
            <Text style={[styles.compactRecommendedDetail, { color: colors.mutedForeground }]} numberOfLines={2}>
              {roomRecommendedAction.detail}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={roomRecommendedAction.onPrimaryPress}
            style={({ pressed }) => [
              styles.compactRecommendedButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <Text style={[styles.compactRecommendedButtonText, { color: colors.primaryForeground }]}>
              {roomRecommendedAction.primaryLabel}
            </Text>
            <Feather name="arrow-right" size={13} color={colors.primaryForeground} />
          </Pressable>
        </View>
      </View>
    ) : null}
    <View style={styles.itemListInlineControls}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selectionMode ? "Cancel selecting items" : "Select items"}
        onPress={selectionMode ? clearSelection : enterSelectionMode}
        style={({ pressed }) => [
          styles.itemListSelectTiny,
          {
            borderColor: selectionMode ? colors.primary : colors.border,
            backgroundColor: selectionMode ? "#E8F8F2" : colors.secondary,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
        hitSlop={8}
      >
        <View
          style={[
            styles.itemListSelectBox,
            {
              borderColor: selectionMode ? colors.primary : colors.mutedForeground,
              backgroundColor: selectionMode ? colors.primary : "transparent",
            },
          ]}
        >
          {selectionMode ? <Feather name="check" size={9} color={colors.primaryForeground} /> : null}
        </View>
        <Text style={[styles.itemListSelectText, { color: colors.primary }]}>
          {selectionMode ? `${selectedCount} selected · Cancel` : "Select"}
        </Text>
      </Pressable>
    </View>
    {filtersActive ? (
      <View style={[styles.filterSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={14} color={colors.primary} />
        <Text style={[styles.filterSummaryText, { color: colors.mutedForeground }]}>
          {visibleItems.length} of {(items ?? []).length} items
        </Text>
        <Pressable onPress={clearRoomFilters} hitSlop={6}>
          <Text style={[styles.filterSummaryClear, { color: colors.primary }]}>Clear</Text>
        </Pressable>
      </View>
    ) : null}
    </>
  );

  const renderFilterChip = ({
    label,
    selected,
    onPress,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: selected ? colors.primary : colors.card,
          borderColor: selected ? colors.primary : colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[styles.filterChipText, { color: selected ? colors.primaryForeground : colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );

  const renderEmptyItems = () => {
    if ((items ?? []).length > 0 && filtersActive) {
      return (
        <EmptyState
          icon="search"
          title="No matching items"
          subtitle="Try a broader search, category, readiness filter, or sort."
          action={
            <Pressable
              accessibilityRole="button"
              onPress={clearRoomFilters}
              style={({ pressed }) => [
                styles.emptyAction,
                { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={[styles.emptyActionText, { color: colors.primaryForeground }]}>Clear filters</Text>
            </Pressable>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="package"
        title="No items in this room"
        subtitle="Scan visible items or add them manually to start this room."
      />
    );
  };

  const renderRoomItem = ({ item }: { item: InventoryItem }) => {
    if (viewMode === "compact") {
      return (
        <MemoizedCompactItemCard
          item={item}
          parentRoomName={resolvedRoomName}
          parentPropertyName={resolvedPropertyName}
          currencyCode={resolvedPropertyCurrency}
          colors={colors}
          isNew={newItemIds.has(item.id)}
          resolvedImageUrl={itemSignedUrls.get(item.image_url ?? item.photo_url ?? "") ?? null}
          onImagePermanentError={() => recoverItemImageUrl(item.image_url ?? item.photo_url)}
          selectionMode={selectionMode}
          isSelected={selectedItemIds.has(item.id)}
          onToggleSelected={() => toggleSelectedItem(item.id)}
          onOpenItem={clearNewItemOnOpen}
          onRepositionPin={repositionRoomItemPin}
          onExpandImage={openRoomItemImage}
        />
      );
    }

    return (
      <MemoizedAnimatedItemCard
        item={item}
        parentRoomName={resolvedRoomName}
        parentPropertyName={resolvedPropertyName}
        currencyCode={resolvedPropertyCurrency}
        propertyCountryCode={resolvedPropertyCountry}
        colors={colors}
        evidenceCount={evidenceCounts[item.id] ?? 0}
        isNew={newItemIds.has(item.id)}
        resolvedImageUrl={itemSignedUrls.get(item.image_url ?? item.photo_url ?? "") ?? null}
        onImagePermanentError={() => recoverItemImageUrl(item.image_url ?? item.photo_url)}
        editingTarget={activeEdit?.itemId === item.id ? activeEdit.target : null}
        selectionMode={selectionMode}
        isSelected={selectedItemIds.has(item.id)}
        onToggleSelected={() => toggleSelectedItem(item.id)}
        onOpenItem={clearNewItemOnOpen}
        onRepositionPin={repositionRoomItemPin}
        onExpandImage={openRoomItemImage}
        onBeginEdit={(target) => setActiveEdit({ itemId: item.id, target })}
        onCloseEdit={(target) =>
          setActiveEdit((current) =>
            current?.itemId === item.id && current.target === target ? null : current,
          )
        }
      />
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: resolvedRoomName,
          headerTitleAlign: "center",
          headerBackVisible: false,
          headerLeft: () => (
            <ContextBackButton
              label={resolvedPropertyName}
              onPress={navigateToProperty}
            />
          ),
          headerRight: () => (
            <View style={styles.headerActions}>
              <View style={[styles.headerViewTools, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Search and filter items"
                  onPress={() => setFilterModalVisible(true)}
                  style={styles.headerIconButton}
                  hitSlop={8}
                >
                  <Feather name="search" size={19} color={colors.primary} />
                  {filtersActive ? <View style={[styles.headerActiveDot, { backgroundColor: colors.primary }]} /> : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={viewMode === "compact" ? "Show detailed list" : "Show compact grid"}
                  onPress={() => {
                    const nextMode = viewMode === "compact" ? "detailed" : "compact";
                    liveScrollOffsetRef.current = 0;
                    updateRoomViewSession(id, { viewMode: nextMode, offset: 0, anchorItemId: null });
                    restoredRoomScrollRef.current = true;
                    setViewMode(nextMode);
                  }}
                  style={styles.headerIconButton}
                  hitSlop={8}
                >
                  <Feather name={viewMode === "compact" ? "list" : "grid"} size={19} color={colors.primary} />
                </Pressable>
              </View>
              <Pressable
                onPress={handleArchiveRoom}
                disabled={archivingRoom}
                style={[styles.headerDeleteButton, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                hitSlop={8}
              >
                {archivingRoom ? (
                  <ActivityIndicator size="small" color="#B91C1C" />
                ) : (
                  <Feather name="trash-2" size={19} color="#B91C1C" />
                )}
              </Pressable>
            </View>
          ),
        }}
      />
      <ImageViewerModal
        uris={roomImageViewer ? [roomImageViewer.uri] : []}
        visible={!!roomImageViewer}
        title={roomImageViewer?.title ?? "Image preview"}
        onClose={() => setRoomImageViewer(null)}
        pin={roomImageViewer?.item ? normalizedItemPin(roomImageViewer.item) : null}
        pinPhotoIndex={0}
        onPinReposition={roomImageViewer?.item && normalizedItemPin(roomImageViewer.item) ? repositionRoomViewerPin : undefined}
        onPermanentError={() => {
          const imageRef = roomImageViewer?.item?.image_url ?? roomImageViewer?.item?.photo_url ?? room?.cover_photo_url;
          recoverItemImageUrl(imageRef);
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
            ref={listRef}
            key={viewMode}
            data={visibleItems}
            keyExtractor={(item) => item.id}
            renderItem={renderRoomItem}
            numColumns={viewMode === "compact" ? 2 : 1}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            updateCellsBatchingPeriod={40}
            columnWrapperStyle={viewMode === "compact" ? styles.gridRow : undefined}
            ListHeaderComponent={renderRoomCover}
            ListFooterComponent={<View style={{ height: insets.bottom + STICKY_ACTION_CLEARANCE }} />}
            contentContainerStyle={[
              styles.list,
              viewMode === "compact" ? styles.gridList : null,
              {
                paddingBottom: 12,
                ...(Platform.OS === "web" ? { paddingTop: 0 } : {}),
              },
            ]}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { y: scrollY } } }],
              { useNativeDriver: true },
            )}
            onScrollEndDrag={persistRoomScrollSnapshot}
            onMomentumScrollEnd={persistRoomScrollSnapshot}
            onViewableItemsChanged={onRoomViewableItemsChanged}
            viewabilityConfig={roomViewabilityConfig}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              const saved = getRoomViewSession(id);
              listRef.current?.scrollToOffset({
                offset: saved?.offset ?? Math.max(0, index * averageItemLength),
                animated: false,
              });
            }}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refetch}
                tintColor={colors.primary}
              />
            }
            ListEmptyComponent={renderEmptyItems}
          />
          {selectionMode ? (
            <View
              style={[
                styles.fabRow,
                {
                  backgroundColor: colors.card,
                  borderTopColor: colors.border,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <View style={styles.bulkCountPill}>
                <Text style={[styles.bulkCountText, { color: colors.foreground }]}>
                  {selectedCount} selected
                </Text>
              </View>
              <Pressable
                onPress={openMoveSelected}
                disabled={bulkWorking || selectedCount === 0}
                style={({ pressed }) => [
                  styles.bulkActionBtn,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.secondary,
                    opacity: pressed || bulkWorking || selectedCount === 0 ? 0.55 : 1,
                  },
                ]}
                hitSlop={4}
              >
                <Feather name="corner-up-right" size={16} color={colors.foreground} />
                <Text style={[styles.bulkActionText, { color: colors.foreground }]}>Move</Text>
              </Pressable>
              <Pressable
                onPress={confirmDeleteSelectedItems}
                disabled={bulkWorking || selectedCount === 0}
                style={({ pressed }) => [
                  styles.bulkActionBtn,
                  {
                    borderColor: "#FCA5A5",
                    backgroundColor: "#FEF2F2",
                    opacity: pressed || bulkWorking || selectedCount === 0 ? 0.55 : 1,
                  },
                ]}
                hitSlop={4}
              >
                <Feather name="trash-2" size={16} color="#B91C1C" />
                <Text style={[styles.bulkActionText, { color: "#B91C1C" }]}>Delete</Text>
              </Pressable>
              <Pressable
                onPress={clearSelection}
                disabled={bulkWorking}
                style={({ pressed }) => [
                  styles.bulkCancelBtn,
                  { opacity: pressed || bulkWorking ? 0.65 : 1 },
                ]}
                hitSlop={4}
              >
                <Text style={[styles.bulkCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={[
                styles.fabRow,
                {
                  backgroundColor: colors.card,
                  borderTopColor: colors.border,
                  paddingBottom: insets.bottom + 12,
                },
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
          )}
          <Modal
            visible={moveModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setMoveModalVisible(false)}
          >
            <Pressable style={styles.filterBackdrop} onPress={() => setMoveModalVisible(false)}>
              <Pressable
                accessibilityRole="none"
                onPress={(event) => event.stopPropagation()}
                style={[
                  styles.filterSheet,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius + 6,
                    paddingBottom: insets.bottom + 16,
                  },
                ]}
              >
                <View style={styles.filterHeader}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.filterTitle, { color: colors.foreground }]}>Move items</Text>
                    <Text style={[styles.moveSheetSubtitle, { color: colors.mutedForeground }]}>
                      Choose a room in {resolvedPropertyName}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close move room chooser"
                    onPress={() => setMoveModalVisible(false)}
                    style={styles.filterClose}
                    hitSlop={8}
                  >
                    <Feather name="x" size={20} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                {availableMoveTargets.length === 0 ? (
                  <View style={[styles.moveEmpty, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.moveEmptyText, { color: colors.mutedForeground }]}>
                      Create another room before moving items.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.moveRoomList}>
                    {availableMoveTargets.map((targetRoom) => (
                      <Pressable
                        key={targetRoom.id}
                        accessibilityRole="button"
                        onPress={() => void moveSelectedItems(targetRoom)}
                        disabled={bulkWorking}
                        style={({ pressed }) => [
                          styles.moveRoomOption,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                            opacity: pressed || bulkWorking ? 0.65 : 1,
                          },
                        ]}
                      >
                        <View style={[styles.moveRoomIcon, { backgroundColor: colors.secondary }]}>
                          <MaterialCommunityIcons
                            name={getRoomPlaceholderIcon(targetRoom.room_type, targetRoom.name)}
                            size={19}
                            color={colors.primary}
                          />
                        </View>
                        <Text style={[styles.moveRoomName, { color: colors.foreground }]} numberOfLines={1}>
                          {targetRoom.name}
                        </Text>
                        <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </Pressable>
            </Pressable>
          </Modal>
          <Modal
            visible={filterModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setFilterModalVisible(false)}
          >
            <KeyboardAvoidingView
              style={styles.filterModalRoot}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <Pressable style={styles.filterBackdrop} onPress={() => setFilterModalVisible(false)}>
                <Pressable
                  accessibilityRole="none"
                  onPress={(event) => event.stopPropagation()}
                  style={[
                    styles.filterSheet,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius + 6,
                      paddingBottom: insets.bottom + 16,
                    },
                  ]}
                >
                  <View style={styles.filterHeader}>
                    <Text style={[styles.filterTitle, { color: colors.foreground }]}>Find items</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close filters"
                      onPress={() => setFilterModalVisible(false)}
                      style={styles.filterClose}
                      hitSlop={8}
                    >
                      <Feather name="x" size={20} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                  <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <Feather name="search" size={16} color={colors.mutedForeground} />
                    <TextInput
                      value={searchText}
                      onChangeText={setSearchText}
                      placeholder="Search name, brand, category"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.searchInput, { color: colors.foreground }]}
                      returnKeyType="search"
                    />
                    {searchText ? (
                      <Pressable onPress={() => setSearchText("")} hitSlop={6}>
                        <Feather name="x-circle" size={16} color={colors.mutedForeground} />
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={styles.filterGroup}>
                    <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Category</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
                      {renderFilterChip({ label: "All", selected: categoryFilter === "all", onPress: () => setCategoryFilter("all") })}
                      {roomCategoryOptions.map((category) => (
                        <React.Fragment key={category}>
                          {renderFilterChip({
                            label: category,
                            selected: categoryFilter === category,
                            onPress: () => setCategoryFilter(category),
                          })}
                        </React.Fragment>
                      ))}
                    </ScrollView>
                  </View>
                  <View style={styles.filterGroup}>
                    <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Readiness</Text>
                    <View style={styles.filterWrapRow}>
                      {renderFilterChip({ label: "All", selected: readinessFilter === "all", onPress: () => setReadinessFilter("all") })}
                      {renderFilterChip({ label: "Needs review", selected: readinessFilter === "needs_review", onPress: () => setReadinessFilter("needs_review") })}
                      {renderFilterChip({ label: "Missing photo", selected: readinessFilter === "missing_photo", onPress: () => setReadinessFilter("missing_photo") })}
                      {renderFilterChip({ label: "Missing value", selected: readinessFilter === "missing_value", onPress: () => setReadinessFilter("missing_value") })}
                    </View>
                  </View>
                  <View style={styles.filterGroup}>
                    <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Sort</Text>
                    <View style={styles.filterWrapRow}>
                      {renderFilterChip({ label: "Recent", selected: sortOption === "recent", onPress: () => setSortOption("recent") })}
                      {renderFilterChip({ label: "Value high-low", selected: sortOption === "value_desc", onPress: () => setSortOption("value_desc") })}
                      {renderFilterChip({ label: "Value low-high", selected: sortOption === "value_asc", onPress: () => setSortOption("value_asc") })}
                      {renderFilterChip({ label: "Name A-Z", selected: sortOption === "name_asc", onPress: () => setSortOption("name_asc") })}
                    </View>
                  </View>
                  <View style={styles.filterActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={clearRoomFilters}
                      style={({ pressed }) => [
                        styles.filterSecondaryAction,
                        { borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
                      ]}
                    >
                      <Text style={[styles.filterSecondaryText, { color: colors.foreground }]}>Clear</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setFilterModalVisible(false)}
                      style={({ pressed }) => [
                        styles.filterPrimaryAction,
                        { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                      ]}
                    >
                      <Text style={[styles.filterPrimaryText, { color: colors.primaryForeground }]}>Done</Text>
                    </Pressable>
                  </View>
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>
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
    gap: 10,
    paddingHorizontal: 32,
  },
  coverPlaceholderCopy: {
    alignItems: "center",
    gap: 4,
    maxWidth: 280,
  },
  coverPlaceholderTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  coverPlaceholderBody: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  recommendedActionWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  roomSummaryStrip: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    gap: 8,
  },
  roomSummaryTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  roomSummaryLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.7 },
  roomSummaryCount: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  roomSummaryValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  categoryBarTap: { gap: 6 },
  categorySegmentBar: {
    height: 5,
    borderRadius: 999,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: "#E2E8F0",
  },
  categorySegment: { height: "100%" },
  categoryBreakdownToggle: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start" },
  categoryBreakdownText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  categoryLegend: { flexDirection: "row", flexWrap: "wrap", gap: 7, paddingTop: 2 },
  categoryLegendChip: {
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  categoryLegendDot: { width: 7, height: 7, borderRadius: 4 },
  categoryLegendName: { maxWidth: 130, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  categoryLegendValue: { fontSize: 11, fontFamily: "Inter_500Medium" },
  compactRecommendedCard: {
    borderWidth: 1,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  compactRecommendedCopy: { flex: 1, minWidth: 0, gap: 2 },
  compactRecommendedKicker: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.7 },
  compactRecommendedTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  compactRecommendedDetail: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_400Regular" },
  compactRecommendedButton: {
    minHeight: 34,
    borderRadius: 9,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  compactRecommendedButtonText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  itemListInlineControls: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  itemListSelectTiny: {
    minHeight: 28,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  itemListSelectBox: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  itemListSelectText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  scanSuccessBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 2,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scanSuccessText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
  gridList: {
    gap: 12,
  },
  gridRow: {
    gap: 10,
  },
  headerIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  headerViewTools: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
  },
  headerDeleteButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
  },
  headerActiveDot: {
    position: "absolute",
    right: 3,
    top: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  selectionCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  filterSummary: {
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterSummaryText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  filterSummaryClear: { fontSize: 12, fontFamily: "Inter_700Bold" },
  gridCard: {
    flex: 1,
    minHeight: 194,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 10,
    position: "relative",
  },
  gridSelectionCircle: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  gridThumb: {
    width: "100%",
    aspectRatio: 1.15,
  },
  gridThumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  gridCopy: {
    padding: 10,
    gap: 5,
  },
  gridName: {
    minHeight: 38,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_600SemiBold",
  },
  gridValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  gridReadinessChip: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  gridReadinessText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
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
    gap: 10,
  },
  cardSummaryPressed: { opacity: 0.82 },
  thumbWrap: {
    width: 76,
    height: 76,
    borderRadius: 10,
    borderWidth: 2,
    overflow: "hidden",
  },
  thumb: { width: "100%", height: "100%" },
  cardBody: { flex: 1, minWidth: 0, gap: 4 },
  nameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  nameRowStacked: { flexDirection: "column", alignItems: "stretch", gap: 4 },
  nameBlock: { flex: 1, minWidth: 0, gap: 4 },
  namePressable: { minWidth: 0, maxWidth: "100%" },
  cardName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  newBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 1 },
  newBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  priceBlock: { alignItems: "flex-end", gap: 3, width: 104, flexShrink: 0 },
  priceBlockStacked: { width: "100%", alignItems: "flex-end" },
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
    minWidth: 0,
  },
  chipWrap: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontFamily: "Inter_400Regular", flexShrink: 1 },
  readinessChip: {
    minHeight: 22,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  readinessChipText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
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
  updatePriceBtn: {
    alignSelf: "flex-end",
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  updatePriceTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  secondaryRow: { flexDirection: "row", gap: 8 },
  barcodeIconBtn: {
    width: 38,
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  barcodeIconWrap: { position: "relative", alignItems: "center", justifyContent: "center" },
  barcodeVerifiedBadge: {
    position: "absolute",
    right: -5,
    bottom: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  barcodeSavedDot: {
    position: "absolute",
    right: -3,
    bottom: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  nameModalBackdrop: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 128 : 104,
    paddingBottom: 320,
    justifyContent: "flex-start",
    backgroundColor: "rgba(15, 23, 42, 0.46)",
  },
  nameModalCard: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderWidth: 1,
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },
  nameModalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  quickEditHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  quickEditVoiceButton: { minHeight: 32, borderRadius: 16, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  quickEditVoiceText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  nameModalInput: {
    minHeight: 92,
    maxHeight: 150,
    borderWidth: 1.5,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  editFieldGroup: { gap: 6 },
  editFieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  editModalInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  editModalRow: { flexDirection: "row", gap: 10 },
  editQuantityField: { width: 104 },
  editPriceField: { flex: 1, minWidth: 0 },
  editPriceInputWrap: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  editCurrencyPrefix: { fontSize: 15, fontFamily: "Inter_500Medium" },
  editPriceInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  editTotalPreview: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  nameModalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 9 },
  nameModalButton: {
    minWidth: 92,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  nameModalButtonText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
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
  bulkCountPill: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkCountText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  bulkActionBtn: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  bulkActionText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  bulkCancelBtn: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkCancelText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  emptyAction: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyActionText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  filterModalRoot: { flex: 1, justifyContent: "flex-end" },
  filterBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.46)",
  },
  filterSheet: {
    width: "100%",
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 12,
  },
  filterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  filterTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  filterClose: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBox: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  filterGroup: { gap: 8 },
  filterLabel: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  filterChipRow: { gap: 8, paddingRight: 16 },
  filterWrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  filterActions: { flexDirection: "row", gap: 10, paddingTop: 2 },
  filterSecondaryAction: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  filterPrimaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  filterSecondaryText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  filterPrimaryText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  moveSheetSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  moveEmpty: { borderWidth: 1, borderRadius: 10, padding: 12 },
  moveEmptyText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  moveRoomList: { gap: 8 },
  moveRoomOption: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  moveRoomIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  moveRoomName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  coverActionBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.46)",
    padding: 12,
  },
  coverActionSheet: {
    width: "100%",
    borderRadius: 16,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 12,
  },
  coverActionTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  coverActionButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  coverActionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
