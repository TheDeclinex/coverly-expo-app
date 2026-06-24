import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
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
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
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
import { LoadingState } from "@/components/LoadingState";
import { RecommendedActionCard } from "@/components/RecommendedActionCard";
import { useToast } from "@/components/Toast";
import { getCategoryColor } from "@/constants/categoryColors";
import { ENABLE_RECOMMENDED_ACTIONS } from "@/constants/recommendedActions";
import { getRoomPlaceholderIcon } from "@/constants/roomVisuals";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  formatCurrencyFull,
  getItemTotalValue,
  getItemUnitPrice,
  hasValue,
} from "@/lib/inventory-mappers";
import { useSignedUrl, useSignedUrls } from "@/hooks/useSignedUrls";
import { isStoragePath } from "@/lib/storage-helpers";
import { formatUploadFailure, uploadCoverPhoto } from "@/lib/photo-upload";
import { isRecentItem } from "@/lib/recent-items";
import { supabase } from "@/lib/supabase";
import type { InventoryItem, InventoryRoom } from "@/types";

const COVER_H = 200;
const TEAL = "#1D9E75";
const STICKY_ACTION_CLEARANCE = 96;
const HIGH_VALUE_EVIDENCE_THRESHOLD = 1000;

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

function isAiEstimate(item: InventoryItem): boolean {
  const source = `${item.price_source_type ?? ""} ${item.valuation_basis ?? ""}`.toLowerCase();
  return source.includes("ai") || source.includes("scan");
}

function hasUnclearDetails(item: InventoryItem): boolean {
  const name = item.name.trim().toLowerCase();
  return (
    name.length < 3 ||
    ["item", "unknown", "object", "misc", "miscellaneous"].includes(name)
  );
}

function needsRoomReview(item: InventoryItem): boolean {
  const lowConfidence = item.confidence != null && item.confidence < 0.7;
  return !hasValue(item) || item.quantity == null || lowConfidence || hasUnclearDetails(item);
}

function isWebUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function parsePrice(value: string): number | null {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type CardEditTarget = "name" | "valuation";

function ItemCard({
  item,
  parentRoomName,
  parentPropertyName,
  colors,
  resolvedImageUrl,
  evidenceCount = 0,
  isNew = false,
  editingTarget,
  onBeginEdit,
  onCloseEdit,
}: {
  item: InventoryItem;
  parentRoomName: string;
  parentPropertyName: string;
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
  const { width: windowWidth } = useWindowDimensions();
  const useStackedSummary = windowWidth < 390;
  const activeEditorRef = useRef<View>(null);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [quantityDraft, setQuantityDraft] = useState(String(item.quantity ?? 1));
  const [unitPriceDraft, setUnitPriceDraft] = useState(String(getItemUnitPrice(item)));
  const [savingCard, setSavingCard] = useState(false);
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);

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
  const hasReplacementListing = valLabel === "Replacement listing";
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

  useEffect(() => {
    if (Platform.OS !== "web" || editingTarget !== "valuation") return;

    const handlePointerDown = (event: PointerEvent) => {
      const editor = activeEditorRef.current as unknown as {
        contains?: (target: EventTarget | null) => boolean;
      } | null;
      if (editor?.contains?.(event.target)) return;

      void saveValuationEdit();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [editingTarget, nameDraft, quantityDraft, unitPriceDraft, savingCard]);

  const goToDetail = async () => {
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
      },
    });
  };

  const goToEvidence = async () => {
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
          {/* Narrow cards stack price beneath the name so both remain readable. */}
          <View style={[styles.nameRow, useStackedSummary ? styles.nameRowStacked : null]}>
            <View style={styles.nameBlock}>
              {isNew ? (
                <View style={[styles.newBadge, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.newBadgeText, { color: colors.primaryForeground }]}>NEW</Text>
                </View>
              ) : null}
              <Pressable accessibilityLabel="Edit item name" onPress={beginNameEdit} hitSlop={5}>
                <Text
                  style={[styles.cardName, { color: colors.foreground }]}
                  numberOfLines={useStackedSummary ? 3 : 2}
                >
                  {item.name}
                </Text>
              </Pressable>
            </View>
            <View
              style={[
                styles.priceBlock,
                useStackedSummary ? styles.priceBlockStacked : null,
                editingTarget === "valuation" ? styles.priceBlockEditing : null,
              ]}
            >
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
      </View>
      <Modal
        visible={editingTarget === "name"}
        transparent
        animationType="fade"
        onRequestClose={cancelInlineEdit}
      >
        <KeyboardAvoidingView
          style={styles.nameModalKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.nameModalBackdrop} onPress={cancelInlineEdit}>
            <Pressable
              accessibilityRole="none"
              onPress={(event) => event.stopPropagation()}
              style={[
                styles.nameModalCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius + 4,
                },
              ]}
            >
              <Text style={[styles.nameModalTitle, { color: colors.foreground }]}>Edit item name</Text>
              <TextInput
                autoFocus
                accessibilityLabel="Item name"
                value={nameDraft}
                onChangeText={setNameDraft}
                editable={!savingCard}
                multiline
                textAlignVertical="top"
                style={[
                  styles.nameModalInput,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.background,
                    borderColor: colors.primary,
                  },
                ]}
              />
              <View style={styles.nameModalActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={cancelInlineEdit}
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
                  onPress={() => void saveNameEdit()}
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
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      <BarcodeScanFlow
        visible={barcodeScanOpen}
        item={item}
        onClose={() => setBarcodeScanOpen(false)}
        onApply={applyBarcodeMatch}
      />
    </>
  );
}

export default function ItemsScreen() {
  const { id, name, fileId, fileName } = useLocalSearchParams<{
    id: string;
    name: string;
    fileId?: string;
    fileName?: string;
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

  const resolvedFileId = fileId ?? room?.file_id;
  const { data: parentProperty } = useQuery({
    queryKey: ["property-context", resolvedFileId, session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_files")
        .select("id, name")
        .eq("id", resolvedFileId!)
        .single();
      if (queryError) throw queryError;
      return data as { id: string; name: string };
    },
    enabled: Boolean(session && resolvedFileId && !fileName),
  });
  const resolvedPropertyName = fileName ?? parentProperty?.name ?? "Property";
  const resolvedRoomName = room?.name ?? name ?? "Room";

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

  const roomRecommendedAction = React.useMemo(() => {
    if (!ENABLE_RECOMMENDED_ACTIONS || !items) return null;

    const openItem = (item: InventoryItem, extraParams?: Record<string, string>) => {
      router.push({
        pathname: "/(tabs)/item/[id]",
        params: {
          id: item.id,
          name: item.name,
          roomId: id,
          roomName: resolvedRoomName,
          fileId: resolvedFileId ?? "",
          fileName: resolvedPropertyName,
          ...extraParams,
        },
      });
    };

    if (items.length === 0) {
      return {
        body: "Start this room",
        detail: "Scan visible items or add them manually.",
        primaryLabel: "Scan items",
        onPrimaryPress: () => void handleScanRoom(),
      };
    }

    const reviewItems = items.filter(needsRoomReview);
    if (reviewItems.length > 0) {
      return {
        body: `${reviewItems.length} item${reviewItems.length === 1 ? "" : "s"} need review`,
        detail: "Review items that may be missing a value, quantity, or clear details.",
        primaryLabel: "Show item",
        onPrimaryPress: () => openItem(reviewItems[0]),
      };
    }

    if (!evidenceCountsLoading) {
      const highValueWithoutEvidence = items.filter(
        (item) =>
          getItemTotalValue(item) >= HIGH_VALUE_EVIDENCE_THRESHOLD &&
          (evidenceCounts[item.id] ?? 0) === 0,
      );
      if (highValueWithoutEvidence.length > 0) {
        return {
          body: "Add evidence to high-value items",
          detail: "Receipts or photos can strengthen these records.",
          primaryLabel: "Review",
          onPrimaryPress: () => openItem(highValueWithoutEvidence[0], { evidence: "add" }),
        };
      }
    }

    const aiEstimateItems = items.filter(isAiEstimate);
    if (aiEstimateItems.length > 0) {
      return {
        body: "Check replacement values",
        detail: "Replace AI estimates with current replacement listings where useful.",
        primaryLabel: "Review",
        onPrimaryPress: () => openItem(aiEstimateItems[0]),
      };
    }

    return null;
  }, [
    evidenceCounts,
    evidenceCountsLoading,
    handleScanRoom,
    id,
    items,
    resolvedFileId,
    resolvedPropertyName,
    resolvedRoomName,
  ]);

  const handlePickRoomCover = async () => {
    if (coverUploading) return;
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Allow camera access to take a room cover photo."
        );
        return;
      }
    }
    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [16, 9],
    };
    const result = Platform.OS === "web"
      ? await ImagePicker.launchImageLibraryAsync(pickerOptions)
      : await ImagePicker.launchCameraAsync(pickerOptions);
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
    <>
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
          <MaterialCommunityIcons
            name={getRoomPlaceholderIcon(room?.room_type, room?.name ?? name)}
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
    {roomRecommendedAction ? (
      <View style={styles.recommendedActionWrap}>
        <RecommendedActionCard {...roomRecommendedAction} />
      </View>
    ) : null}
    </>
  );

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
              onPress={() =>
                router.replace({
                  pathname: "/(tabs)/property/[id]",
                  params: { id: resolvedFileId ?? "", name: resolvedPropertyName },
                })
              }
            />
          ),
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
                parentRoomName={resolvedRoomName}
                parentPropertyName={resolvedPropertyName}
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
            ListFooterComponent={<View style={{ height: insets.bottom + STICKY_ACTION_CLEARANCE }} />}
            contentContainerStyle={[
              styles.list,
              {
                paddingBottom: 12,
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
  recommendedActionWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
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
  nameRowStacked: { flexDirection: "column", alignItems: "stretch", gap: 4 },
  nameBlock: { flex: 1, minWidth: 0, gap: 4 },
  cardName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
    flex: 1,
  },
  newBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 1 },
  newBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  priceBlock: { alignItems: "stretch", gap: 3, width: 124, flexShrink: 0 },
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
  nameModalKeyboard: { flex: 1 },
  nameModalBackdrop: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
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
});
