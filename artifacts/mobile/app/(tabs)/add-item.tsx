import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
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

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { buildItemInsertPayload } from "@/lib/item-insert-helpers";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryRoom } from "@/types";

const ITEM_PHOTOS_BUCKET = "item-photos";

function FormField({
  label,
  required,
  children,
  colors,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row" }}>
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
      </View>
      {children}
    </View>
  );
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

  const [selectedFileId, setSelectedFileId] = useState(fileId ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(roomId ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
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
      allowsEditing: true,
      aspect: [4, 3],
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
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const uploadPhoto = async (
    uri: string,
    itemFileId: string
  ): Promise<{ url: string | null; uploadErrMsg: string | null }> => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const ext = (uri.split(".").pop() ?? "jpg").split("?")[0];
      const path = `${itemFileId}/${Date.now()}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(ITEM_PHOTOS_BUCKET)
        .upload(path, blob, { contentType: `image/${ext}`, upsert: false });
      if (uploadError) {
        console.warn("[AddItem] Photo upload failed:", uploadError.message);
        return { url: null, uploadErrMsg: uploadError.message };
      }
      const { data: urlData } = supabase.storage
        .from(ITEM_PHOTOS_BUCKET)
        .getPublicUrl(uploadData.path);
      return { url: urlData.publicUrl ?? null, uploadErrMsg: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[AddItem] Photo upload error:", msg);
      return { url: null, uploadErrMsg: msg };
    }
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

    let uploadedPhotoUrl: string | null = null;
    if (photoUri) {
      const { url, uploadErrMsg } = await uploadPhoto(photoUri, selectedFileId);
      uploadedPhotoUrl = url;
      if (!url) {
        setPhotoWarning(
          `Photo upload failed: ${uploadErrMsg ?? "unknown error"} — item will be saved without a photo.`
        );
      }
    }

    const price = estimatedPrice.trim()
      ? parseFloat(estimatedPrice.replace(/[^0-9.]/g, "")) || null
      : null;
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
      quantity: qty,
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
      },
    });
  };

  const selectedPropertyName =
    properties?.find((p) => p.id === selectedFileId)?.name ??
    fileName ??
    "Select property";

  return (
    <>
      <Stack.Screen options={{ title: "Add Item" }} />
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

            <FormField label="Name" required colors={colors}>
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

            <FormField label="Description" colors={colors}>
              <StyledInput
                value={description}
                onChangeText={setDescription}
                placeholder="Optional description"
                colors={colors}
                multiline
              />
            </FormField>

            <FormField label="Category" colors={colors}>
              <StyledInput
                value={category}
                onChangeText={setCategory}
                placeholder="e.g. Electronics, Furniture"
                colors={colors}
              />
            </FormField>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 2 }}>
                <FormField label="Estimated value ($)" colors={colors}>
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
                <FormField label="Quantity" colors={colors}>
                  <StyledInput
                    value={quantity}
                    onChangeText={setQuantity}
                    placeholder="1"
                    keyboardType="numeric"
                    colors={colors}
                  />
                </FormField>
              </View>
            </View>
          </View>

          {/* PHOTO */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              PHOTO
            </Text>

            {photoUri ? (
              <View style={{ gap: 10 }}>
                <Image
                  source={{ uri: photoUri }}
                  style={[
                    styles.photoPreview,
                    { borderRadius: colors.radius },
                  ]}
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
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    marginTop: 4,
  },
});
