import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
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
import { ExpandableImage } from "@/components/ExpandableImage";
import { ItemEvidenceSection } from "@/components/ItemEvidenceSection";
import { LoadingState } from "@/components/LoadingState";
import { QuantityStepper } from "@/components/QuantityStepper";
import { VoiceFieldButton } from "@/components/voice/VoiceFieldButton";
import { VoiceInputSheet } from "@/components/voice/VoiceInputSheet";
import {
  BarcodeScanFlow,
  type BarcodeApplyValues,
} from "@/components/BarcodeScanFlow";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSignedUrls } from "@/hooks/useSignedUrls";
import { formatCurrencyFull, getItemUnitPrice } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import { buildVoiceItemUpdatePayload } from "@/lib/voice-item-update";
import type { InventoryItem } from "@/types";
import type { VoiceItemField, VoiceItemPatch } from "@/types/voice";

// One-line rollback for the item review/edit trial.
const ITEM_REVIEW_EDIT_TRIAL = true;

type InlineField = "name" | "quantity" | "unit_estimated_price" | "brand_maker";

function DetailRow({
  label,
  value,
  colors,
  onPress,
}: {
  label: string;
  value: string | number | null | undefined;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onPress?: () => void;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      {onPress ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${String(value)}`}
          onPress={onPress}
          hitSlop={6}
          style={styles.detailLink}
        >
          <Text style={[styles.detailValue, styles.linkText, { color: colors.primary }]}>
            {String(value)} <Feather name="external-link" size={12} color={colors.primary} />
          </Text>
        </Pressable>
      ) : (
        <Text
          style={[styles.detailValue, { color: colors.foreground }]}
          numberOfLines={4}
        >
          {String(value)}
        </Text>
      )}
    </View>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function valuationSourceLabel(item: InventoryItem): string | null {
  const priceSource = (item.price_source_type ?? "").toLowerCase();
  if (priceSource === "web_listing" || priceSource.includes("listing")) {
    return "Replacement listing";
  }
  if (priceSource.includes("user") || priceSource.includes("manual")) {
    return "User entered";
  }
  if (priceSource.includes("ai") || priceSource.includes("scan")) {
    return "AI estimate";
  }

  const basis = (item.valuation_basis ?? "").toLowerCase();
  if (basis.includes("listing")) return "Replacement listing";
  if (basis.includes("ai")) return "AI estimate";
  if (basis.includes("user") || basis.includes("manual")) return "User entered";
  return item.valuation_basis;
}

function isWebUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function parseMoneyDraft(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function QuickEditRow({
  label,
  value,
  editing,
  draft,
  keyboardType,
  quantityStepper = false,
  saving,
  colors,
  onStart,
  onChange,
  onSave,
  onCancel,
  onVoice,
}: {
  label: string;
  value: string | number | null | undefined;
  editing: boolean;
  draft: string;
  keyboardType?: "default" | "numeric" | "decimal-pad";
  quantityStepper?: boolean;
  saving: boolean;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onStart: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onVoice: () => void;
}) {
  return (
    <View style={[styles.quickEditRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.quickEditLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      {editing ? (
        <View style={styles.quickEditControls}>
          <View style={styles.quickEditActions}>
            <Pressable
              accessibilityLabel={`Save ${label}`}
              onPress={onSave}
              disabled={saving}
              hitSlop={6}
              style={[styles.iconButton, { backgroundColor: colors.primary }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Feather name="check" size={15} color={colors.primaryForeground} />
              )}
            </Pressable>
            <Pressable
              accessibilityLabel={`Cancel editing ${label}`}
              onPress={onCancel}
              disabled={saving}
              hitSlop={6}
              style={[styles.iconButton, { backgroundColor: colors.secondary }]}
            >
              <Feather name="x" size={15} color={colors.foreground} />
            </Pressable>
          </View>
          {quantityStepper ? (
            <QuantityStepper
              value={draft}
              onChange={onChange}
              disabled={saving}
              compact
            />
          ) : (
            <TextInput
              autoFocus
              value={draft}
              onChangeText={onChange}
              keyboardType={keyboardType ?? "default"}
              selectTextOnFocus
              editable={!saving}
              onSubmitEditing={onSave}
              style={[
                styles.quickEditInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.background,
                  borderColor: colors.primary,
                },
              ]}
            />
          )}
        </View>
      ) : (
        <View style={styles.quickEditReadControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${label}`}
            onPress={onStart}
            hitSlop={6}
            style={styles.quickEditValueButton}
          >
            <Text
              numberOfLines={2}
              style={[
                styles.quickEditValue,
                { color: value === null || value === undefined || value === "" ? colors.mutedForeground : colors.foreground },
              ]}
            >
              {value === null || value === undefined || value === "" ? "Add" : String(value)}
            </Text>
            <Feather name="edit-2" size={13} color={colors.primary} />
          </Pressable>
          <VoiceFieldButton label={label.toLowerCase()} onPress={onVoice} />
        </View>
      )}
    </View>
  );
}

export default function ItemDetailScreen() {
  const { id, name, evidence, roomId, roomName, fileId, fileName } = useLocalSearchParams<{
    id: string;
    name: string;
    evidence?: string;
    roomId?: string;
    roomName?: string;
    fileId?: string;
    fileName?: string;
  }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [editingField, setEditingField] = React.useState<InlineField | null>(null);
  const [inlineDraft, setInlineDraft] = React.useState("");
  const [savingInline, setSavingInline] = React.useState(false);
  const [barcodeScanOpen, setBarcodeScanOpen] = React.useState(false);
  const [voiceInputOpen, setVoiceInputOpen] = React.useState(false);
  const [voiceTargetField, setVoiceTargetField] = React.useState<VoiceItemField | undefined>();
  const [deletingItem, setDeletingItem] = React.useState(false);

  const {
    data: item,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["item", id, session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("id", id)
        .single();
      if (queryError) throw queryError;
      return data as InventoryItem;
    },
    enabled: !!session && !!id,
  });

  const rawPrimaryUri = item?.image_url ?? item?.photo_url;

  const itemPin = React.useMemo(() => {
    const raw = item?.image_pin as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw.x !== "number" || typeof raw.y !== "number") return null;
    return { x: raw.x, y: raw.y };
  }, [item?.image_pin]);

  const rawPhotoUris: string[] = React.useMemo(() => {
    const uris: string[] = [];
    if (rawPrimaryUri) uris.push(rawPrimaryUri);
    for (const att of item?.attachments ?? []) {
      if (att.url && !uris.includes(att.url)) uris.push(att.url);
    }
    return uris;
  }, [rawPrimaryUri, item?.attachments]);

  // Resolve storage paths → 1-hr signed URLs in one batch call.
  // While loading, signedUriMap is empty — use null so ExpandableImage shows its
  // placeholder rather than passing an invalid storage path to the Image component.
  const signedUriMap = useSignedUrls(rawPhotoUris);
  const allPhotoUris = rawPhotoUris.map((u) => signedUriMap.get(u) ?? null).filter((u): u is string => u !== null);
  const primaryUri = allPhotoUris[0] ?? null;

  const handleEdit = () => {
    router.push({
      pathname: "/(tabs)/edit-item/[id]",
      params: { id: id! },
    });
  };

  const openVoiceInput = (targetField?: VoiceItemField) => {
    cancelInlineEdit();
    setVoiceTargetField(targetField);
    setVoiceInputOpen(true);
  };

  const handleReplacementPricing = () => {
    router.push({
      pathname: "/(tabs)/replacement-pricing/[id]",
      params: {
        id,
        origin: "item",
        itemName: item?.name ?? name,
        roomId: roomId ?? item?.room_id ?? "",
        roomName: roomName ?? item?.room ?? "Room",
        fileId: fileId ?? item?.file_id ?? "",
        fileName: fileName ?? "Property",
      },
    } as Href);
  };


  const navigateToItemParent = React.useCallback(() => {
    const targetRoomId = roomId ?? item?.room_id ?? "";
    const targetFileId = fileId ?? item?.file_id ?? "";

    if (targetRoomId) {
      router.replace({
        pathname: "/(tabs)/room/[id]",
        params: {
          id: targetRoomId,
          name: roomName ?? item?.room ?? "Room",
          fileId: targetFileId,
          fileName: fileName ?? "Property",
        },
      } as Href);
      return;
    }

    if (targetFileId) {
      router.replace({
        pathname: "/(tabs)/property/[id]",
        params: { id: targetFileId, name: fileName ?? "Property" },
      } as Href);
      return;
    }

    router.back();
  }, [fileId, fileName, item?.file_id, item?.room, item?.room_id, roomId, roomName]);

  const invalidateItemCollections = React.useCallback(async (target: InventoryItem) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items", target.room_id] }),
      queryClient.invalidateQueries({ queryKey: ["all-items"] }),
      queryClient.invalidateQueries({ queryKey: ["property-items", target.file_id] }),
      queryClient.invalidateQueries({ queryKey: ["room", target.room_id] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", target.file_id] }),
      queryClient.invalidateQueries({ queryKey: ["property", target.file_id] }),
    ]);
  }, [queryClient]);

  const deleteItem = React.useCallback(async () => {
    if (!item || deletingItem) return;
    setDeletingItem(true);
    try {
      const { error: deleteError } = await supabase
        .from("inventory_items")
        .delete()
        .eq("id", item.id);
      if (deleteError) throw deleteError;

      queryClient.removeQueries({ queryKey: ["item", item.id] });
      await invalidateItemCollections(item);
      showToast("Item deleted");
      navigateToItemParent();
    } catch (deleteFailure) {
      Alert.alert(
        "Couldn't delete item",
        deleteFailure instanceof Error ? deleteFailure.message : "Please try again.",
      );
    } finally {
      setDeletingItem(false);
    }
  }, [deletingItem, invalidateItemCollections, item, navigateToItemParent, queryClient, showToast]);

  const handleDeleteItem = React.useCallback(() => {
    if (!item || deletingItem) return;
    Alert.alert(
      "Delete item?",
      `This will remove ${item.name} from your inventory. Evidence files and storage cleanup are not changed by this action.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void deleteItem() },
      ],
    );
  }, [deleteItem, deletingItem, item]);

  const handleApplyBarcode = async (values: BarcodeApplyValues) => {
    if (!item) throw new Error("Item not loaded.");

    const updates: Partial<InventoryItem> = {
      barcode: values.barcode,
      barcode_verified: true,
      ...(values.name ? { name: values.name } : {}),
      ...(values.brandMaker ? { brand_maker: values.brandMaker } : {}),
      ...(values.modelSeries ? { model_series: values.modelSeries } : {}),
      ...(values.description ? { description: values.description } : {}),
    };

    const { data, error: updateError } = await supabase
      .from("inventory_items")
      .update(updates)
      .eq("id", item.id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    queryClient.setQueryData(["item", id, session?.user.id], data as InventoryItem);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
      queryClient.invalidateQueries({ queryKey: ["all-items"] }),
      queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
    ]);
    showToast("Barcode details applied");
  };

  const startInlineEdit = (field: InlineField, value: string | number | null) => {
    setEditingField(field);
    setInlineDraft(value === null ? "" : String(value));
  };

  const cancelInlineEdit = () => {
    setEditingField(null);
    setInlineDraft("");
  };

  const saveInlineEdit = async () => {
    if (!item || !editingField || savingInline) return;

    const trimmed = inlineDraft.trim();
    let updates: Partial<
      Pick<
        InventoryItem,
        | "name"
        | "quantity"
        | "unit_estimated_price"
        | "estimated_price"
        | "brand_maker"
        | "price_source_type"
        | "valuation_basis"
      >
    >;

    if (editingField === "name") {
      if (!trimmed) {
        Alert.alert("Item name required", "Enter a name before saving.");
        return;
      }
      updates = { name: trimmed };
    } else if (editingField === "quantity") {
      const quantity = Number(trimmed);
      if (!Number.isInteger(quantity) || quantity < 1) {
        Alert.alert("Check quantity", "Quantity must be a whole number of 1 or more.");
        return;
      }
      updates = { quantity };
    } else if (editingField === "unit_estimated_price") {
      const price = parseMoneyDraft(trimmed);
      if (price === null) {
        Alert.alert("Check price", "Enter a valid price of zero or more.");
        return;
      }
      const roundedPrice = Math.round(price * 100) / 100;
      updates = {
        estimated_price: roundedPrice,
        unit_estimated_price: roundedPrice,
        price_source_type: "user_entered",
        valuation_basis: "manual",
      };
    } else {
      updates = { brand_maker: trimmed || null };
    }

    setSavingInline(true);
    try {
      const { data, error: updateError } = await supabase
        .from("inventory_items")
        .update(updates)
        .eq("id", item.id)
        .select("*")
        .single();
      if (updateError) throw updateError;

      queryClient.setQueryData(
        ["item", id, session?.user.id],
        data as InventoryItem,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
        queryClient.invalidateQueries({ queryKey: ["all-items"] }),
        queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
      ]);
      cancelInlineEdit();
      showToast("Item updated");
    } catch (updateFailure) {
      Alert.alert(
        "Couldn’t update item",
        updateFailure instanceof Error ? updateFailure.message : "Please try again.",
      );
    } finally {
      setSavingInline(false);
    }
  };

  const handleApplyVoice = async (patch: VoiceItemPatch) => {
    if (!item) throw new Error("Item not loaded.");

    const updates = buildVoiceItemUpdatePayload(patch);
    if (Object.keys(updates).length === 0) {
      throw new Error("No supported changes were selected.");
    }

    const { data, error: updateError } = await supabase
      .from("inventory_items")
      .update(updates)
      .eq("id", item.id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    queryClient.setQueryData(
      ["item", id, session?.user.id],
      data as InventoryItem,
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
      queryClient.invalidateQueries({ queryKey: ["all-items"] }),
      queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
    ]);
    showToast("Voice changes applied");
  };

  const handleOpenReplacementListing = () => {
    if (!isWebUrl(item?.web_listing_url)) return;
    void WebBrowser.openBrowserAsync(item.web_listing_url);
  };

  /**
   * Saves the repositioned pin to Supabase. Called by DraggablePinLayer on drop.
   * Throws on error so DraggablePinLayer can revert the optimistic pin position.
   */
  const handleRepositionPin = React.useCallback(
    async (x: number, y: number) => {
      if (!item) throw new Error("Item not loaded");
      const rawPin = item.image_pin as Record<string, unknown> | null | undefined;
      const { error } = await supabase
        .from("inventory_items")
        .update({
          image_pin: {
            x,
            y,
            sourcePhotoIndex: (rawPin?.sourcePhotoIndex as number | undefined) ?? 0,
            type: rawPin?.type ?? "user",
          },
        })
        .eq("id", item.id);
      if (error) throw new Error(error.message);
      queryClient.invalidateQueries({ queryKey: ["item", id, session?.user.id] });
    },
    [item, id, session?.user.id, queryClient],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: item?.name ?? name ?? "Item Detail",
          headerTitleAlign: "center",
          headerBackVisible: false,
          headerLeft: () => (
            <ContextBackButton
              label={roomName ?? item?.room ?? "Room"}
              onPress={navigateToItemParent}
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
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: insets.bottom + 32,
              ...(Platform.OS === "web" ? { paddingTop: 16 } : {}),
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <ExpandableImage
            uri={primaryUri}
            style={styles.heroImage}
            contentFit="cover"
            placeholderIcon="package"
            placeholderIconSize={48}
            placeholderIconColor={colors.primary}
            placeholderBackgroundColor={colors.secondary}
            allUris={allPhotoUris}
            initialPhotoIndex={0}
            pin={itemPin}
            onReposition={itemPin ? handleRepositionPin : undefined}
          />
          {itemPin && (
            <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
              Long-press the pin to reposition it
            </Text>
          )}

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text style={[styles.itemName, { color: colors.foreground }]}>
                {item.name}
              </Text>
              {item.category && (
                <View
                  style={[
                    styles.categoryBadge,
                    { backgroundColor: colors.accent, borderRadius: 8 },
                  ]}
                >
                  <Text
                    style={[styles.categoryText, { color: colors.accentForeground }]}
                  >
                    {item.category}
                  </Text>
                </View>
              )}
            </View>

            {item.description && (
              <Text style={[styles.description, { color: colors.mutedForeground }]}>
                {item.description}
              </Text>
            )}

            {ITEM_REVIEW_EDIT_TRIAL ? (
              <>
                <Section title="QUICK EDIT" colors={colors}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Edit item with voice"
                    onPress={() => openVoiceInput()}
                    style={({ pressed }) => [
                      styles.voiceEditAction,
                      {
                        borderColor: colors.primary,
                        backgroundColor: colors.background,
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                  >
                    <Feather name="mic" size={16} color={colors.primary} />
                    <View style={styles.voiceEditCopy}>
                      <Text style={[styles.voiceEditTitle, { color: colors.primary }]}>Edit with voice</Text>
                      <Text style={[styles.voiceEditHint, { color: colors.mutedForeground }]}>Speak item details, then review before applying</Text>
                    </View>
                  </Pressable>
                  <QuickEditRow
                    label="Item name"
                    value={item.name}
                    editing={editingField === "name"}
                    draft={inlineDraft}
                    saving={savingInline}
                    colors={colors}
                    onStart={() => startInlineEdit("name", item.name)}
                    onChange={setInlineDraft}
                    onSave={() => void saveInlineEdit()}
                    onCancel={cancelInlineEdit}
                    onVoice={() => openVoiceInput("name")}
                  />
                  <QuickEditRow
                    label="Quantity"
                    value={item.quantity ?? 1}
                    editing={editingField === "quantity"}
                    draft={inlineDraft}
                    keyboardType="numeric"
                    quantityStepper
                    saving={savingInline}
                    colors={colors}
                    onStart={() => startInlineEdit("quantity", item.quantity ?? 1)}
                    onChange={setInlineDraft}
                    onSave={() => void saveInlineEdit()}
                    onCancel={cancelInlineEdit}
                    onVoice={() => openVoiceInput("quantity")}
                  />
                  <QuickEditRow
                    label={(item.quantity ?? 1) > 1 ? "Each price" : "Price"}
                    value={
                      item.unit_estimated_price != null || item.estimated_price != null
                        ? formatCurrencyFull(getItemUnitPrice(item))
                        : null
                    }
                    editing={editingField === "unit_estimated_price"}
                    draft={inlineDraft}
                    keyboardType="decimal-pad"
                    saving={savingInline}
                    colors={colors}
                    onStart={() =>
                      startInlineEdit(
                        "unit_estimated_price",
                        item.unit_estimated_price ?? item.estimated_price,
                      )
                    }
                    onChange={setInlineDraft}
                    onSave={() => void saveInlineEdit()}
                    onCancel={cancelInlineEdit}
                    onVoice={() => openVoiceInput("replacement_price")}
                  />
                  {(item.quantity ?? 1) > 1 &&
                  (item.unit_estimated_price != null || item.estimated_price != null) ? (
                    <View style={[styles.quickSummaryRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.quickSummaryLabel, { color: colors.mutedForeground }]}>
                        Total value
                      </Text>
                      <Text style={[styles.quickSummaryValue, { color: colors.foreground }]}>
                        {formatCurrencyFull(getItemUnitPrice(item) * (item.quantity ?? 1))}
                      </Text>
                    </View>
                  ) : null}
                  <QuickEditRow
                    label="Brand / Maker"
                    value={item.brand_maker}
                    editing={editingField === "brand_maker"}
                    draft={inlineDraft}
                    saving={savingInline}
                    colors={colors}
                    onStart={() => startInlineEdit("brand_maker", item.brand_maker)}
                    onChange={setInlineDraft}
                    onSave={() => void saveInlineEdit()}
                    onCancel={cancelInlineEdit}
                    onVoice={() => openVoiceInput("brand_maker")}
                  />
                </Section>

                <Section title="ACTIONS" colors={colors}>
                  <Pressable
                    onPress={handleReplacementPricing}
                    style={({ pressed }) => [
                      styles.nextActionPrimary,
                      { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                    ]}
                  >
                    <Feather name="search" size={16} color={colors.primaryForeground} />
                    <View style={styles.nextActionCopy}>
                      <Text style={[styles.nextActionTitle, { color: colors.primaryForeground }]}>Review replacement price</Text>
                      <Text style={[styles.nextActionHint, { color: colors.primaryForeground }]}>Find or update the current replacement value</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={colors.primaryForeground} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open advanced item editing"
                    onPress={handleEdit}
                    style={({ pressed }) => [
                      styles.advancedEditAction,
                      { borderTopColor: colors.border, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <Feather name="sliders" size={15} color={colors.mutedForeground} />
                    <View style={styles.nextActionCopy}>
                      <Text style={[styles.advancedEditTitle, { color: colors.foreground }]}>Advanced edit</Text>
                      <Text style={[styles.advancedEditHint, { color: colors.mutedForeground }]}>Manage photos, category, room and additional details</Text>
                    </View>
                    <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete item"
                    onPress={handleDeleteItem}
                    disabled={deletingItem}
                    style={({ pressed }) => [
                      styles.destructiveAction,
                      { borderTopColor: colors.border, opacity: deletingItem || pressed ? 0.65 : 1 },
                    ]}
                  >
                    {deletingItem ? (
                      <ActivityIndicator size="small" color="#B91C1C" />
                    ) : (
                      <Feather name="trash-2" size={15} color="#B91C1C" />
                    )}
                    <View style={styles.nextActionCopy}>
                      <Text style={styles.destructiveTitle}>Delete item</Text>
                      <Text style={[styles.advancedEditHint, { color: colors.mutedForeground }]}>Remove this item from the inventory</Text>
                    </View>
                  </Pressable>
                </Section>
              </>
            ) : (
              <>
                <Pressable
                  onPress={handleEdit}
                  style={({ pressed }) => [
                    styles.editBtn,
                    {
                      backgroundColor: colors.secondary,
                      borderRadius: colors.radius,
                      borderColor: colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Feather name="edit-2" size={15} color={colors.primary} />
                  <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit item</Text>
                </Pressable>
                <Pressable
                  onPress={handleReplacementPricing}
                  style={({ pressed }) => [
                    styles.pricingBtn,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.82 : 1,
                    },
                  ]}
                >
                  <Feather name="search" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.pricingBtnText, { color: colors.primaryForeground }]}>Find replacement price</Text>
                </Pressable>
              </>
            )}

            <Section title="VALUATION CONTEXT" colors={colors}>
              {item.unit_estimated_price != null || item.estimated_price != null ? (
                <DetailRow
                  label="Recorded total"
                  value={formatCurrencyFull(getItemUnitPrice(item) * (item.quantity ?? 1))}
                  colors={colors}
                />
              ) : null}
              <DetailRow
                label="Quantity estimate"
                value={item.quantity_estimate}
                colors={colors}
              />
              <DetailRow
                label="Value source"
                value={valuationSourceLabel(item)}
                colors={colors}
                onPress={
                  item.price_source_type === "web_listing" && isWebUrl(item.web_listing_url)
                    ? handleOpenReplacementListing
                    : undefined
                }
              />
              <DetailRow label="Confidence" value={item.confidence} colors={colors} />
            </Section>

            {session?.user.id ? (
              <ItemEvidenceSection
                itemId={item.id}
                fileId={item.file_id}
                userId={session.user.id}
                userEmail={session.user.email}
                autoOpenAdd={evidence === "add"}
              />
            ) : null}

            <Section title="PRODUCT INFO" colors={colors}>
              {item.barcode_verified ? (
                <View style={[styles.barcodeStatus, { backgroundColor: colors.accent }]}>
                  <Feather name="check-circle" size={14} color={colors.primary} />
                  <View style={styles.barcodeStatusCopy}>
                    <Text style={[styles.barcodeStatusTitle, { color: colors.foreground }]}>Barcode verified</Text>
                    {item.barcode ? (
                      <Text style={[styles.barcodeStatusValue, { color: colors.mutedForeground }]}>{item.barcode}</Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
              <Pressable
                onPress={() => setBarcodeScanOpen(true)}
                style={({ pressed }) => [
                  styles.barcodeAction,
                  {
                    borderColor: colors.primary,
                    backgroundColor: colors.background,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Feather name="camera" size={15} color={colors.primary} />
                <Text style={[styles.barcodeActionText, { color: colors.primary }]}>
                  {item.barcode || item.barcode_verified ? "Update barcode" : "Scan barcode"}
                </Text>
              </Pressable>
              <DetailRow label="Model / Series" value={item.model_series} colors={colors} />
              <DetailRow label="Condition" value={item.condition_label} colors={colors} />
            </Section>

            {(item.original_purchase_price ||
              item.purchase_year_approx ||
              item.purchase_source) && (
              <Section title="PURCHASE HISTORY" colors={colors}>
                <DetailRow
                  label="Original price"
                  value={formatCurrencyFull(item.original_purchase_price)}
                  colors={colors}
                />
                <DetailRow
                  label="Year purchased"
                  value={item.purchase_year_approx}
                  colors={colors}
                />
                <DetailRow
                  label="Source"
                  value={item.purchase_source}
                  colors={colors}
                />
              </Section>
            )}

            {item.notes && (
              <Section title="NOTES" colors={colors}>
                <Text style={[styles.notes, { color: colors.foreground }]}>
                  {item.notes}
                </Text>
              </Section>
            )}
          </View>
        </ScrollView>
      ) : null}
      {item ? (
        <BarcodeScanFlow
          visible={barcodeScanOpen}
          item={item}
          onClose={() => setBarcodeScanOpen(false)}
          onApply={handleApplyBarcode}
        />
      ) : null}
      {item ? (
        <VoiceInputSheet
          visible={voiceInputOpen}
          title={voiceTargetField ? "Edit field with voice" : "Edit item with voice"}
          targetField={voiceTargetField}
          currentValues={{
            name: item.name,
            quantity: item.quantity,
            brand_maker: item.brand_maker,
            model_series: item.model_series,
            purchase_source: item.purchase_source,
            purchase_year_approx: item.purchase_year_approx,
            original_purchase_price: item.original_purchase_price,
            estimated_price: item.estimated_price,
            unit_estimated_price: item.unit_estimated_price,
            description: item.description,
            notes: item.notes,
            price_source_type: item.price_source_type,
            valuation_basis: item.valuation_basis,
          }}
          context={{
            itemId: item.id,
            currentName: item.name,
            currentCategory: item.category ?? undefined,
            currentDescription: item.description ?? undefined,
          }}
          onClose={() => setVoiceInputOpen(false)}
          onApply={handleApplyVoice}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  heroImage: { width: "100%", height: 280 },
  heroPlaceholder: {
    width: "100%",
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 16, gap: 12 },
  barcodeStatus: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 },
  barcodeStatusCopy: { flex: 1, gap: 1 },
  barcodeStatusTitle: { fontSize: 13, fontWeight: "700" },
  barcodeStatusValue: { fontSize: 11, fontFamily: "monospace" },
  barcodeAction: { minHeight: 42, borderWidth: 1, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  barcodeActionText: { fontSize: 13, fontWeight: "700" },
  titleRow: { gap: 8 },
  itemName: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },
  categoryBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "capitalize",
  },
  description: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    marginTop: 4,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  editBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  pricingBtn: {
    minHeight: 46,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pricingBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  quickEditRow: {
    minHeight: 62,
    alignItems: "stretch",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingVertical: 8,
  },
  quickEditLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  quickEditReadControls: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 7,
  },
  quickEditValueButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 44,
  },
  quickEditValue: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium", textAlign: "left" },
  quickEditControls: {
    width: "100%",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  quickEditActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quickEditInput: {
    flex: 1,
    alignSelf: "stretch",
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  quickSummaryRow: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  quickSummaryLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  quickSummaryValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  iconButton: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  voiceEditAction: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  voiceEditCopy: { flex: 1, gap: 1 },
  voiceEditTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  voiceEditHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  nextActionPrimary: {
    minHeight: 62,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  nextActionCopy: { flex: 1, gap: 2 },
  nextActionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  nextActionHint: { fontSize: 11, fontFamily: "Inter_400Regular", opacity: 0.82 },
  advancedEditAction: {
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  advancedEditTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  advancedEditHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  destructiveAction: {
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  destructiveTitle: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#B91C1C" },
  deleteBtn: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  deleteBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#B91C1C" },
  section: {
    borderWidth: 1,
    padding: 16,
    gap: 0,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  detailLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    marginRight: 8,
  },
  detailValue: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
    textAlign: "right",
  },
  detailLink: { flex: 1 },
  linkText: { textDecorationLine: "underline" },
  notes: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  pinHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 5,
    opacity: 0.7,
  },
});
