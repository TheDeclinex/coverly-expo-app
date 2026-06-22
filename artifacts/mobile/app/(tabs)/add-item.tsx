import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
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
import { ContextBackButton } from "@/components/ContextBackButton";
import { ExpandableImage } from "@/components/ExpandableImage";
import { QuantityStepper } from "@/components/QuantityStepper";
import { useToast } from "@/components/Toast";
import { VoiceFieldButton } from "@/components/voice/VoiceFieldButton";
import { VoiceInputSheet } from "@/components/voice/VoiceInputSheet";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatCurrencyFull } from "@/lib/inventory-mappers";
import { buildItemInsertPayload } from "@/lib/item-insert-helpers";
import { formatUploadFailure, uploadItemPhoto } from "@/lib/photo-upload";
import { markRecentItem } from "@/lib/recent-items";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryRoom } from "@/types";
import type { VoiceItemField, VoiceItemPatch } from "@/types/voice";

function FormField({
  label,
  required,
  children,
  action,
  colors,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_500Medium",
            letterSpacing: 0.3,
            color: colors.mutedForeground,
          }}
        >
          {label}
          {required ? (
            <Text style={{ color: colors.destructive }}>{" *"}</Text>
          ) : null}
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

export default function AddItemScreen() {
  const { fileId, roomId, fileName, roomName } = useLocalSearchParams<{
    fileId?: string;
    roomId?: string;
    fileName?: string;
    roomName?: string;
  }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [selectedFileId, setSelectedFileId] = useState(fileId ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(roomId ?? "");
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
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);

  const { data: properties } = useQuery({
    queryKey: ["properties", session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("id, name")
        .order("last_modified", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Pick<InventoryFile, "id" | "name">[];
    },
    enabled: !!session,
  });

  const { data: rooms } = useQuery({
    queryKey: ["rooms", selectedFileId, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_rooms")
        .select("id, name, file_id")
        .eq("file_id", selectedFileId)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Pick<InventoryRoom, "id" | "name" | "file_id">[];
    },
    enabled: !!session && !!selectedFileId,
  });

  const { data: selectedFile } = useQuery({
    queryKey: ["file-detail", selectedFileId, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("id, name, user_id")
        .eq("id", selectedFileId)
        .single();
      if (error) throw error;
      return data as Pick<InventoryFile, "id" | "name" | "user_id">;
    },
    enabled: !!session && !!selectedFileId,
  });

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to add photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  /**
   * Upload a photo and return the durable storage path.
   * The path (not a signed URL) is what gets stored in the DB.
   */
  const uploadPhoto = async (
    uri: string,
    itemFileId: string
  ): Promise<{ path: string | null; uploadErrMsg: string | null }> => {
    const userId = session?.user?.id;
    if (!userId) return { path: null, uploadErrMsg: "Not signed in" };
    const uploaded = await uploadItemPhoto(uri, userId, itemFileId);
    if (!uploaded.ok) return { path: null, uploadErrMsg: formatUploadFailure(uploaded) };
    return { path: uploaded.path, uploadErrMsg: null };
  };

  const openVoice = (targetField?: VoiceItemField) => {
    setVoiceTargetField(targetField);
    setVoiceVisible(true);
  };

  const applyVoicePatchToDraft = (patch: VoiceItemPatch) => {
    const has = (key: keyof VoiceItemPatch) => Object.prototype.hasOwnProperty.call(patch, key);
    if (has("name")) setName(patch.name ?? "");
    if (has("description")) setDescription(patch.description ?? "");
    if (has("quantity") && patch.quantity != null) setQuantity(String(patch.quantity));
    if (has("brand_maker")) setBrandMaker(patch.brand_maker ?? "");
    if (has("model_series")) setModelSeries(patch.model_series ?? "");
    if (has("purchase_source")) setPurchaseSource(patch.purchase_source ?? "");
    if (has("purchase_year_approx")) setPurchaseYearApprox(patch.purchase_year_approx ?? "");
    if (has("original_purchase_price")) {
      const originalPrice = patch.original_purchase_price;
      setOriginalPurchasePrice(originalPrice == null ? "" : String(originalPrice));

      // On a new item, a single spoken price is useful as the initial item value
      // as well as purchase history. A separately extracted replacement price
      // remains authoritative and is handled below.
      if (
        originalPrice != null &&
        !has("unit_estimated_price") &&
        !has("estimated_price")
      ) {
        setEstimatedPrice(String(originalPrice));
        setVoicePriceSourceType("user_entered");
        setVoiceValuationBasis("manual");
      }
    }
    if (has("notes")) setNotes(patch.notes ?? "");
    if (has("unit_estimated_price") || has("estimated_price")) {
      const price = patch.unit_estimated_price ?? patch.estimated_price;
      setEstimatedPrice(price == null ? "" : String(price));
      setVoicePriceSourceType(patch.price_source_type ?? "user_entered");
      setVoiceValuationBasis(patch.valuation_basis ?? "manual");
    }
    if (["brand_maker", "model_series", "purchase_source", "purchase_year_approx", "original_purchase_price", "notes"].some((key) => has(key as keyof VoiceItemPatch))) {
      setDetailsExpanded(true);
    }
    setErrorMsg(null);
  };

  const handleSave = async () => {
    setErrorMsg(null);
    setPhotoWarning(null);

    if (!name.trim()) {
      setErrorMsg("Item name is required.");
      return;
    }
    if (!selectedFileId) {
      setErrorMsg("Please select a property above.");
      return;
    }
    if (!selectedRoomId) {
      setErrorMsg("Please select a room above.");
      return;
    }
    if (!session?.user.id) {
      setErrorMsg("Not signed in — please sign in again.");
      return;
    }

    setSaving(true);

    // Upload returns a durable storage path. Display code resolves paths to signed URLs at render time.
    let uploadedPhotoUrl: string | null = null;
    if (photoUri) {
      const { path, uploadErrMsg } = await uploadPhoto(photoUri, selectedFileId);
      uploadedPhotoUrl = path;
      if (!path) {
        setPhotoWarning(
          `Photo upload failed: ${uploadErrMsg ?? "unknown error"} — item will be saved without a photo.`
        );
      }
    }

    const price = parseMoneyDraft(estimatedPrice);
    const originalPrice = parseMoneyDraft(originalPurchasePrice);
    const qty = parseInt(quantity, 10) || 1;
    const destRoomName =
      rooms?.find((r) => r.id === selectedRoomId)?.name ?? roomName ?? null;

    const payload = buildItemInsertPayload({
      fileId: selectedFileId,
      roomId: selectedRoomId,
      roomName: destRoomName,
      name,
      description: description || null,
      category: category || null,
      estimatedPrice: price,
      unitEstimatedPrice: price,
      quantity: qty,
      notes,
      brandMaker,
      modelSeries,
      purchaseSource,
      purchaseYearApprox,
      originalPurchasePrice: originalPrice,
      priceSourceType: voicePriceSourceType,
      valuationBasis: voiceValuationBasis,
      imageUrl: uploadedPhotoUrl,
      photoUrl: uploadedPhotoUrl,
    });

    // --- RLS diagnostics ---
    const selectedRoom = rooms?.find((r) => r.id === selectedRoomId);
    const diag = {
      session_email: session?.user?.email ?? "n/a",
      session_user_id: session?.user?.id ?? "n/a",
      selected_file_id: selectedFileId,
      selected_file_name: selectedFile?.name ?? "n/a",
      selected_file_user_id: selectedFile?.user_id ?? "n/a",
      selected_room_id: selectedRoomId,
      selected_room_name: selectedRoom?.name ?? destRoomName ?? "n/a",
      selected_room_file_id: selectedRoom?.file_id ?? "n/a",
      payload_file_id: payload.file_id,
      payload_room_id: payload.room_id,
      file_user_matches_session:
        selectedFile?.user_id === session?.user?.id ? "YES" : "NO",
      room_file_matches_payload:
        selectedRoom?.file_id === payload.file_id ? "YES" : "NO",
    };
    const diagStr = Object.entries(diag)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    console.log("[AddItem RLS debug]\n" + diagStr);

    const { error } = await supabase.from("inventory_items").insert(payload);

    setSaving(false);

    if (error) {
      console.error("[AddItem] Insert failed:", error.message, error.code);
      const diagText = Object.entries(diag)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      setErrorMsg(
        `Save failed: ${error.message}` +
          (error.code ? ` (${error.code})` : "") +
          "\n\n--- RLS debug ---\n" +
          diagText
      );
      return;
    }

    console.log("[AddItem] Insert succeeded — navigating to room", selectedRoomId);
    markRecentItem(payload.id);
    showToast(`Item added to ${destRoomName ?? "room"}`);

    queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
    queryClient.invalidateQueries({ queryKey: ["all-items"] });
    queryClient.invalidateQueries({
      queryKey: ["property-items", selectedFileId],
    });

    router.replace({
      pathname: "/(tabs)/room/[id]",
      params: {
        id: selectedRoomId,
        name: destRoomName ?? "Room",
        fileId: selectedFileId,
        fileName: selectedPropertyName,
      },
    });
  };

  const selectedPropertyName =
    properties?.find((p) => p.id === selectedFileId)?.name ??
    fileName ??
    "Select property";

  return (
    <>
      <Stack.Screen
        options={{
          title: "Add Item",
          headerBackVisible: false,
          headerLeft: () => (
            <ContextBackButton
              label={roomId ? roomName ?? "Room" : fileName ?? "Home"}
              onPress={() => {
                if (roomId) {
                  router.replace({
                    pathname: "/(tabs)/room/[id]",
                    params: {
                      id: roomId,
                      name: roomName ?? "Room",
                      fileId: fileId ?? "",
                      fileName: fileName ?? "Property",
                    },
                  });
                } else if (fileId) {
                  router.replace({
                    pathname: "/(tabs)/property/[id]",
                    params: { id: fileId, name: fileName ?? "Property" },
                  });
                } else {
                  router.replace("/(tabs)");
                }
              }}
            />
          ),
        }}
      />
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
          {/* LOCATION */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              LOCATION
            </Text>

            {!fileId ? (
              <FormField label="Property" required colors={colors}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
                >
                  {(properties ?? []).map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setSelectedFileId(p.id);
                        setSelectedRoomId("");
                        setErrorMsg(null);
                      }}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor:
                            selectedFileId === p.id
                              ? colors.primary
                              : colors.secondary,
                          borderRadius: 20,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: "Inter_500Medium",
                          color:
                            selectedFileId === p.id
                              ? colors.primaryForeground
                              : colors.foreground,
                        }}
                      >
                        {p.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </FormField>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Feather name="home" size={14} color={colors.primary} />
                <Text
                  style={{
                    fontSize: 14,
                    fontFamily: "Inter_500Medium",
                    color: colors.foreground,
                  }}
                >
                  {selectedPropertyName}
                </Text>
              </View>
            )}

            <FormField label="Room" required colors={colors}>
              {!selectedFileId ? (
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: "Inter_400Regular",
                    color: colors.mutedForeground,
                  }}
                >
                  Select a property first
                </Text>
              ) : !roomId ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
                >
                  {(rooms ?? []).map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => {
                        setSelectedRoomId(r.id);
                        setErrorMsg(null);
                      }}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor:
                            selectedRoomId === r.id
                              ? colors.primary
                              : colors.secondary,
                          borderRadius: 20,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: "Inter_500Medium",
                          color:
                            selectedRoomId === r.id
                              ? colors.primaryForeground
                              : colors.foreground,
                        }}
                      >
                        {r.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="layers" size={14} color={colors.primary} />
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: "Inter_500Medium",
                      color: colors.foreground,
                    }}
                  >
                    {roomName}
                  </Text>
                </View>
              )}
            </FormField>
          </View>

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
                { backgroundColor: colors.accent, borderColor: colors.primary, borderRadius: colors.radius, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Feather name="mic" size={17} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.voiceFillTitle, { color: colors.primary }]}>Fill with voice</Text>
                <Text style={[styles.voiceFillHint, { color: colors.mutedForeground }]}>Describe the item, then review suggestions</Text>
              </View>
            </Pressable>

            <FormField label="Name" required colors={colors} action={<VoiceFieldButton label="item name" onPress={() => openVoice("name")} />}>
              <StyledInput
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setErrorMsg(null);
                }}
                placeholder='e.g. Samsung TV 65"'
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

          {/* PHOTO */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              PHOTO
            </Text>

            {photoUri ? (
              <View style={{ gap: 10 }}>
                <ExpandableImage
                  uri={photoUri}
                  style={[styles.photoPreview, { borderRadius: colors.radius }]}
                  contentFit="cover"
                />
                <Pressable
                  onPress={() => setPhotoUri(null)}
                  style={({ pressed }) => [
                    styles.removePhotoBtn,
                    {
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Feather name="x" size={14} color={colors.destructive} />
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Inter_500Medium",
                      color: colors.destructive,
                    }}
                  >
                    Remove photo
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={takePhoto}
                  style={({ pressed }) => [
                    styles.photoBtn,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Feather name="camera" size={20} color={colors.primary} />
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: "Inter_500Medium",
                      color: colors.primary,
                    }}
                  >
                    Camera
                  </Text>
                </Pressable>
                <Pressable
                  onPress={pickPhoto}
                  style={({ pressed }) => [
                    styles.photoBtn,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Feather name="image" size={20} color={colors.primary} />
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: "Inter_500Medium",
                      color: colors.primary,
                    }}
                  >
                    Library
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* PHOTO UPLOAD WARNING */}
          {photoWarning ? (
            <View
              style={[
                styles.warningBanner,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.warning ?? "#f59e0b",
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Feather
                name="alert-triangle"
                size={14}
                color={colors.warning ?? "#f59e0b"}
              />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_400Regular",
                  color: colors.foreground,
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
                  Save item
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
        context={{ currentName: name, currentCategory: category, currentDescription: description }}
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
  photoPreview: { width: "100%", height: 200 },
  removePhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderWidth: 1,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderWidth: 1,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderWidth: 1,
  },
  voiceFillButton: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11 },
  voiceFillTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  voiceFillHint: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  detailsHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailsHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  linkedTotal: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  linkedTotalLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  linkedTotalValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    marginTop: 4,
  },
});
