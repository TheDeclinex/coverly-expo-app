import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryPicker } from "@/components/CategoryPicker";
import {
  DraggablePhotoStrip,
  type PhotoEntry,
} from "@/components/DraggablePhotoStrip";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { QuantityStepper } from "@/components/QuantityStepper";
import { useToast } from "@/components/Toast";
import { VoiceFieldButton } from "@/components/voice/VoiceFieldButton";
import { VoiceInputSheet } from "@/components/voice/VoiceInputSheet";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatCurrencyFull } from "@/lib/inventory-mappers";
import { getItemPhotos } from "@/lib/inventory-mappers";
import { buildItemUpdatePayload } from "@/lib/item-insert-helpers";
import { formatUploadFailure, uploadItemPhoto } from "@/lib/photo-upload";
import { supabase } from "@/lib/supabase";
import type { InventoryItem, InventoryRoom } from "@/types";
import type { VoiceItemField, VoiceItemPatch } from "@/types/voice";

function FormField({
  label,
  required,
  children,
  colors,
  action,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  action?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_500Medium",
            letterSpacing: 0.3,
            color: colors.mutedForeground,
          }}
        >
          {label}
          {required && <Text style={{ color: colors.destructive }}> *</Text>}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function parseMoneyDraft(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function StyledInput({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  colors,
  multiline,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "decimal-pad";
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  multiline?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType={keyboardType ?? "default"}
      multiline={multiline}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius,
        backgroundColor: colors.card,
        color: colors.foreground,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
        fontFamily: "Inter_400Regular",
        minHeight: multiline ? 80 : 44,
        textAlignVertical: multiline ? "top" : "center",
      }}
    />
  );
}

export default function EditItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [brandMaker, setBrandMaker] = useState("");
  const [modelSeries, setModelSeries] = useState("");
  const [purchaseSource, setPurchaseSource] = useState("");
  const [purchaseYearApprox, setPurchaseYearApprox] = useState("");
  const [originalPurchasePrice, setOriginalPurchasePrice] = useState("");
  const [notes, setNotes] = useState("");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [voiceTargetField, setVoiceTargetField] = useState<VoiceItemField | undefined>();
  const [voicePriceSourceType, setVoicePriceSourceType] = useState<string | undefined>();
  const [voiceValuationBasis, setVoiceValuationBasis] = useState<string | undefined>();
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  // Track whether the user explicitly changed the photo strip.
  // We only write image_url/photo_url in the update when photos were modified;
  // this prevents accidental nullification when the user edits non-photo fields.
  const [photosModified, setPhotosModified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);

  const {
    data: item,
    isLoading: itemLoading,
    error: itemError,
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

  useEffect(() => {
    if (item && !hydrated) {
      setName(item.name ?? "");
      setDescription(item.description ?? "");
      setCategory(item.category ?? "");
      setEstimatedPrice(
        item.unit_estimated_price != null
          ? String(item.unit_estimated_price)
          : item.estimated_price != null
            ? String(item.estimated_price)
            : ""
      );
      setQuantity(item.quantity != null ? String(item.quantity) : "1");
      setBrandMaker(item.brand_maker ?? "");
      setModelSeries(item.model_series ?? "");
      setPurchaseSource(item.purchase_source ?? "");
      setPurchaseYearApprox(item.purchase_year_approx ?? "");
      setOriginalPurchasePrice(
        item.original_purchase_price != null ? String(item.original_purchase_price) : ""
      );
      setNotes(item.notes ?? "");
      setDetailsExpanded(
        Boolean(
          item.brand_maker ||
            item.model_series ||
            item.purchase_source ||
            item.purchase_year_approx ||
            item.original_purchase_price != null ||
            item.notes
        )
      );
      setSelectedRoomId(item.room_id ?? "");
      const existingPhotos = getItemPhotos(item);
      setPhotos(existingPhotos);
      setHydrated(true);
    }
  }, [item, hydrated]);

  const { data: rooms } = useQuery({
    queryKey: ["rooms", item?.file_id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_rooms")
        .select("id, name, file_id")
        .eq("file_id", item!.file_id)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Pick<InventoryRoom, "id" | "name" | "file_id">[];
    },
    enabled: !!session && !!item?.file_id,
  });

  /**
   * Upload a photo and return the durable storage path.
   * The path (not a signed URL) is what gets stored in the DB.
   */
  const uploadPhoto = async (
    uri: string,
    fileId: string
  ): Promise<{ path: string | null; uploadErrMsg: string | null }> => {
    const userId = session?.user.id;
    if (!userId) return { path: null, uploadErrMsg: "Not signed in" };
    const uploaded = await uploadItemPhoto(uri, userId, fileId);
    if (!uploaded.ok) return { path: null, uploadErrMsg: formatUploadFailure(uploaded) };
    return { path: uploaded.path, uploadErrMsg: null };
  };

  // Returns true if `url` is a local device URI that must be uploaded before saving.
  // blob: is included because web ImagePicker returns blob: URIs — these are
  // in-memory browser references that are NOT persistent and MUST be uploaded
  // to Supabase Storage before being stored in the database.
  const isLocalUri = (url: string) =>
    url.startsWith("file://") ||
    url.startsWith("ph://") ||
    url.startsWith("content://") ||
    url.startsWith("blob:");

  const openVoice = (targetField?: VoiceItemField) => {
    setVoiceTargetField(targetField);
    setVoiceVisible(true);
  };

  const applyVoicePatchToDraft = (patch: VoiceItemPatch) => {
    const has = (key: keyof VoiceItemPatch) =>
      Object.prototype.hasOwnProperty.call(patch, key);
    if (has("name")) setName(patch.name ?? "");
    if (has("description")) setDescription(patch.description ?? "");
    if (has("quantity") && patch.quantity != null) setQuantity(String(patch.quantity));
    if (has("brand_maker")) setBrandMaker(patch.brand_maker ?? "");
    if (has("model_series")) setModelSeries(patch.model_series ?? "");
    if (has("purchase_source")) setPurchaseSource(patch.purchase_source ?? "");
    if (has("purchase_year_approx")) setPurchaseYearApprox(patch.purchase_year_approx ?? "");
    if (has("original_purchase_price")) {
      setOriginalPurchasePrice(
        patch.original_purchase_price == null ? "" : String(patch.original_purchase_price)
      );
    }
    if (has("notes")) setNotes(patch.notes ?? "");
    if (has("unit_estimated_price") || has("estimated_price")) {
      const price = patch.unit_estimated_price ?? patch.estimated_price;
      setEstimatedPrice(price == null ? "" : String(price));
      setVoicePriceSourceType(patch.price_source_type ?? "user_entered");
      setVoiceValuationBasis(patch.valuation_basis ?? "manual");
    }
    if (
      [
        "brand_maker",
        "model_series",
        "purchase_source",
        "purchase_year_approx",
        "original_purchase_price",
        "notes",
      ].some((key) => has(key as keyof VoiceItemPatch))
    ) {
      setDetailsExpanded(true);
    }
    setErrorMsg(null);
  };

  const handleSave = async () => {
    setErrorMsg(null);

    if (!name.trim()) {
      setErrorMsg("Item name is required.");
      return;
    }
    if (!selectedRoomId) {
      setErrorMsg("Please select a room.");
      return;
    }

    setSaving(true);
    setPhotoWarning(null);

    try {
      const fileId = item?.file_id ?? "";

      const uploadedPhotos: PhotoEntry[] = [];
      const failedUploads: string[] = [];

      for (const photo of photos) {
        if (isLocalUri(photo.url)) {
          // uploadPhoto returns a durable storage path — store the path in the DB.
          const { path, uploadErrMsg } = await uploadPhoto(photo.url, fileId);
          if (path) {
            uploadedPhotos.push({ url: path, caption: photo.caption });
          } else {
            failedUploads.push(uploadErrMsg ?? "unknown error");
          }
        } else {
          uploadedPhotos.push(photo);
        }
      }

      if (failedUploads.length > 0) {
        setPhotoWarning(
          `${failedUploads.length} photo(s) failed to upload and were skipped.`
        );
      }

      const price = parseMoneyDraft(estimatedPrice);
      const originalPrice = parseMoneyDraft(originalPurchasePrice);
      const qty = parseInt(quantity, 10) || 1;
      const destRoomName =
        rooms?.find((r) => r.id === selectedRoomId)?.name ?? null;

      // Only include photos in the update when the user explicitly changed them.
      // If photosModified is false, image_url/photo_url are omitted from the
      // PATCH so existing DB values are preserved unchanged.
      // This prevents accidental nullification when editing non-photo fields,
      // and also when all uploads fail (failedUploads.length > 0).
      const photosForUpdate: PhotoEntry[] | undefined = photosModified
        ? uploadedPhotos   // may be empty → intentional clear
        : undefined;       // not changed → omit from update

      const currentUnitPrice = item?.unit_estimated_price ?? item?.estimated_price ?? null;
      const priceChanged = price !== currentUnitPrice;

      const updates = buildItemUpdatePayload({
        roomId: selectedRoomId,
        roomName: destRoomName,
        name,
        description,
        category,
        estimatedPrice: price,
        unitEstimatedPrice: price,
        quantity: qty,
        notes,
        brandMaker,
        modelSeries,
        purchaseSource,
        purchaseYearApprox,
        originalPurchasePrice: originalPrice,
        priceSourceType: priceChanged
          ? voicePriceSourceType ?? "user_entered"
          : undefined,
        valuationBasis: priceChanged
          ? voiceValuationBasis ?? "manual"
          : undefined,
        photos: photosForUpdate,
      });

      if (__DEV__) console.log("[EditItem] Update payload keys:", Object.keys(updates));

      const { error } = await supabase
        .from("inventory_items")
        .update(updates)
        .eq("id", id);

      if (error) {
        if (__DEV__) console.error("[EditItem] Update failed:", error.message);
        setErrorMsg(
          `Save failed: ${error.message}` +
            (error.code ? ` (${error.code})` : "")
        );
        return;
      }

      if (__DEV__) console.log("[EditItem] Update succeeded — navigating back");

      queryClient.invalidateQueries({ queryKey: ["item", id] });
      queryClient.invalidateQueries({ queryKey: ["items", item?.room_id] });
      queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
      queryClient.invalidateQueries({ queryKey: ["all-items"] });
      queryClient.invalidateQueries({
        queryKey: ["property-items", item?.file_id],
      });

      showToast("Item updated");
      router.back();
    } catch (err) {
      if (__DEV__) console.error("[EditItem] Unexpected error:", err);
      setErrorMsg(
        err instanceof Error ? err.message : "Could not save changes."
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePhotosChange = useCallback((next: PhotoEntry[]) => {
    setPhotos(next);
    setPhotosModified(true);
  }, []);

  if (itemLoading) return <LoadingState />;
  if (itemError)
    return (
      <ErrorState
        message="Failed to load item"
        detail={(itemError as Error).message}
        onRetry={refetch}
      />
    );

  const originalRoomId = item?.room_id;
  const isMoving = selectedRoomId && selectedRoomId !== originalRoomId;

  return (
    <>
      <Stack.Screen options={{ title: "Edit Item" }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* ITEM DETAILS */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              ITEM DETAILS
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fill item details with voice"
              onPress={() => openVoice()}
              style={({ pressed }) => [
                styles.voiceFillButton,
                {
                  backgroundColor: colors.accent,
                  borderColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Feather name="mic" size={17} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.voiceFillTitle, { color: colors.primary }]}>Fill with voice</Text>
                <Text style={[styles.voiceFillHint, { color: colors.mutedForeground }]}>Describe changes, then review suggestions</Text>
              </View>
            </Pressable>

            <FormField label="Name" required colors={colors} action={<VoiceFieldButton label="item name" onPress={() => openVoice("name")} />}>
              <StyledInput
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setErrorMsg(null);
                }}
                placeholder="Item name"
                colors={colors}
              />
            </FormField>

            <FormField label="Description" colors={colors} action={<VoiceFieldButton label="description" onPress={() => openVoice("description")} />}>
              <StyledInput
                value={description}
                onChangeText={setDescription}
                placeholder="Optional description"
                colors={colors}
                multiline
              />
            </FormField>

            <FormField label="Category" colors={colors}>
              <CategoryPicker value={category} onChange={setCategory} />
            </FormField>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 2 }}>
                <FormField label="Each price ($)" colors={colors} action={<VoiceFieldButton label="each price" onPress={() => openVoice("replacement_price")} />}>
                  <StyledInput
                    value={estimatedPrice}
                    onChangeText={setEstimatedPrice}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    colors={colors}
                  />
                </FormField>
              </View>
              <View style={{ flex: 1 }}>
                <FormField label="Quantity" colors={colors} action={<VoiceFieldButton label="quantity" onPress={() => openVoice("quantity")} />}>
                  <QuantityStepper
                    value={quantity}
                    onChange={setQuantity}
                  />
                </FormField>
              </View>
            </View>
            {(Number.parseInt(quantity, 10) || 1) > 1 && estimatedPrice ? (
              <View style={[styles.linkedTotal, { borderColor: colors.border }]}>
                <Text style={[styles.linkedTotalLabel, { color: colors.mutedForeground }]}>Total price</Text>
                <Text style={[styles.linkedTotalValue, { color: colors.foreground }]}>
                  {formatCurrencyFull(
                    (Number.parseFloat(estimatedPrice.replace(/[^0-9.]/g, "")) || 0) *
                      (Number.parseInt(quantity, 10) || 1),
                  )}
                </Text>
              </View>
            ) : null}
          </View>

          {/* PRODUCT & PURCHASE DETAILS */}
          <View style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${detailsExpanded ? "Hide" : "Show"} product and purchase details`}
              onPress={() => setDetailsExpanded((value) => !value)}
              style={styles.detailsHeader}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PRODUCT & PURCHASE DETAILS</Text>
                <Text style={[styles.detailsHint, { color: colors.mutedForeground }]}>Optional information for a stronger item record</Text>
              </View>
              <Feather name={detailsExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
            </Pressable>
            {detailsExpanded ? (
              <>
                <FormField label="Brand / Maker" colors={colors} action={<VoiceFieldButton label="brand or maker" onPress={() => openVoice("brand_maker")} />}>
                  <StyledInput value={brandMaker} onChangeText={setBrandMaker} placeholder="e.g. Samsung" colors={colors} />
                </FormField>
                <FormField label="Model / Series" colors={colors} action={<VoiceFieldButton label="model or series" onPress={() => openVoice("model_series")} />}>
                  <StyledInput value={modelSeries} onChangeText={setModelSeries} placeholder="e.g. QN90B" colors={colors} />
                </FormField>
                <FormField label="Purchased from" colors={colors} action={<VoiceFieldButton label="purchase source" onPress={() => openVoice("purchase_source")} />}>
                  <StyledInput value={purchaseSource} onChangeText={setPurchaseSource} placeholder="e.g. Harvey Norman" colors={colors} />
                </FormField>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <FormField label="Purchase year" colors={colors} action={<VoiceFieldButton label="purchase year" onPress={() => openVoice("purchase_year_approx")} />}>
                      <StyledInput value={purchaseYearApprox} onChangeText={setPurchaseYearApprox} placeholder="e.g. 2022" colors={colors} />
                    </FormField>
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormField label="Original price ($)" colors={colors} action={<VoiceFieldButton label="original purchase price" onPress={() => openVoice("original_purchase_price")} />}>
                      <StyledInput value={originalPurchasePrice} onChangeText={setOriginalPurchasePrice} placeholder="0" keyboardType="decimal-pad" colors={colors} />
                    </FormField>
                  </View>
                </View>
                <FormField label="Notes" colors={colors} action={<VoiceFieldButton label="notes" onPress={() => openVoice("notes")} />}>
                  <StyledInput value={notes} onChangeText={setNotes} placeholder="Optional notes" colors={colors} multiline />
                </FormField>
              </>
            ) : null}
          </View>

          {/* MOVE TO ROOM */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              MOVE TO ROOM
            </Text>
            {isMoving && (
              <View
                style={[
                  styles.moveNotice,
                  {
                    backgroundColor: colors.accent,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Feather name="move" size={14} color={colors.accentForeground} />
                <Text
                  style={[
                    styles.moveNoticeText,
                    { color: colors.accentForeground },
                  ]}
                >
                  Item will be moved to{" "}
                  {rooms?.find((r) => r.id === selectedRoomId)?.name ??
                    "new room"}
                </Text>
              </View>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {(rooms ?? []).map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    setSelectedRoomId(r.id);
                    setErrorMsg(null);
                  }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        selectedRoomId === r.id
                          ? colors.primary
                          : colors.secondary,
                      borderRadius: 20,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color:
                          selectedRoomId === r.id
                            ? colors.primaryForeground
                            : colors.foreground,
                      },
                    ]}
                  >
                    {r.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* PHOTOS */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              PHOTOS
            </Text>
            <DraggablePhotoStrip
              photos={photos}
              onChange={handlePhotosChange}
              colors={colors}
            />
          </View>

          {/* PHOTO UPLOAD WARNING */}
          {photoWarning ? (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.warning ?? "#F59E0B",
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Feather
                name="alert-triangle"
                size={14}
                color={colors.warning ?? "#F59E0B"}
              />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_500Medium",
                  color: colors.warning ?? "#F59E0B",
                  flex: 1,
                }}
              >
                {photoWarning}
              </Text>
            </View>
          ) : null}

          {/* INLINE ERROR BANNER */}
          {errorMsg ? (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.destructive,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_500Medium",
                  color: colors.destructive,
                  flex: 1,
                }}
              >
                {errorMsg}
              </Text>
            </View>
          ) : null}

          {/* SAVE BUTTON */}
          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              {
                backgroundColor: saving ? colors.muted : colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather
                  name="check"
                  size={18}
                  color={colors.primaryForeground}
                />
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: "Inter_600SemiBold",
                    color: colors.primaryForeground,
                  }}
                >
                  Save Changes
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <VoiceInputSheet
        visible={voiceVisible}
        title={voiceTargetField ? "Fill field with voice" : "Fill item with voice"}
        targetField={voiceTargetField}
        currentValues={{
          name,
          description,
          quantity: Number.parseInt(quantity, 10) || 1,
          estimated_price: parseMoneyDraft(estimatedPrice),
          unit_estimated_price: parseMoneyDraft(estimatedPrice),
          brand_maker: brandMaker,
          model_series: modelSeries,
          purchase_source: purchaseSource,
          purchase_year_approx: purchaseYearApprox,
          original_purchase_price: parseMoneyDraft(originalPurchasePrice),
          notes,
        }}
        context={{
          itemId: id,
          currentName: name,
          currentCategory: category,
          currentDescription: description,
        }}
        onClose={() => setVoiceVisible(false)}
        onApply={applyVoicePatchToDraft}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 20 },
  section: { gap: 14 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  chip: { paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  moveNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
  },
  moveNoticeText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderWidth: 1,
  },
  linkedTotal: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  linkedTotalLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  linkedTotalValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  voiceFillButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  voiceFillTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  voiceFillHint: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  detailsHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailsHint: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    marginTop: 4,
  },
});
