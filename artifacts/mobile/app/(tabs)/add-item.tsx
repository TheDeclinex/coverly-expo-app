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
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryRoom } from "@/types";

// TODO: Confirm the correct Supabase storage bucket name for item photos
// Check Supabase dashboard → Storage → Buckets and update this constant
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
    <View style={fieldStyles.container}>
      <Text style={[fieldStyles.label, { color: colors.mutedForeground }]}>
        {label}
        {required && (
          <Text style={{ color: colors.destructive }}> *</Text>
        )}
      </Text>
      {children}
    </View>
  );
}
const fieldStyles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
});

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
      style={[
        inputStyles.input,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          color: colors.foreground,
          minHeight: multiline ? 80 : 44,
          textAlignVertical: multiline ? "top" : "center",
        },
      ]}
    />
  );
}
const inputStyles = StyleSheet.create({
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
});

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

  const uploadPhoto = async (uri: string, itemFileId: string): Promise<string | null> => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const ext = uri.split(".").pop() ?? "jpg";
      const path = `${itemFileId}/${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(ITEM_PHOTOS_BUCKET)
        .upload(path, blob, { contentType: `image/${ext}`, upsert: false });

      if (uploadError) {
        console.warn("Photo upload failed:", uploadError.message);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from(ITEM_PHOTOS_BUCKET)
        .getPublicUrl(uploadData.path);

      return urlData.publicUrl ?? null;
    } catch (err) {
      console.warn("Photo upload error:", err);
      return null;
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter an item name.");
      return;
    }
    if (!selectedFileId) {
      Alert.alert("Property required", "Please select a property.");
      return;
    }
    if (!selectedRoomId) {
      Alert.alert("Room required", "Please select a room.");
      return;
    }

    setSaving(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      let uploadedPhotoUrl: string | null = null;
      if (photoUri) {
        uploadedPhotoUrl = await uploadPhoto(photoUri, selectedFileId);
      }

      const price = parseFloat(estimatedPrice.replace(/[^0-9.]/g, "")) || null;
      const qty = parseInt(quantity, 10) || 1;

      const { error } = await supabase.from("inventory_items").insert({
        file_id: selectedFileId,
        room_id: selectedRoomId,
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        estimated_price: price,
        quantity: qty,
        image_url: uploadedPhotoUrl,
        // Fall back to local URI for display while photo is not yet confirmed uploaded
        // photo_url intentionally left null — image_url is the canonical field
      });

      if (error) throw error;

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
      queryClient.invalidateQueries({ queryKey: ["all-items"] });
      queryClient.invalidateQueries({ queryKey: ["property-items", selectedFileId] });

      router.back();
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Save failed",
        err instanceof Error ? err.message : "Could not save item."
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedPropertyName =
    properties?.find((p) => p.id === selectedFileId)?.name ?? fileName ?? "Select property";
  const selectedRoomName =
    rooms?.find((r) => r.id === selectedRoomId)?.name ?? roomName ?? "Select room";

  return (
    <>
      <Stack.Screen
        options={{
          title: "Add Item",
          headerRight: () =>
            saving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Pressable onPress={handleSave} hitSlop={8} style={{ padding: 4 }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: "Inter_600SemiBold",
                    color: colors.primary,
                  }}
                >
                  Save
                </Text>
              </Pressable>
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
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              LOCATION
            </Text>

            {!fileId && (
              <FormField label="Property" required colors={colors}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {(properties ?? []).map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setSelectedFileId(p.id);
                        setSelectedRoomId("");
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            selectedFileId === p.id ? colors.primary : colors.secondary,
                          borderRadius: 20,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color:
                              selectedFileId === p.id
                                ? colors.primaryForeground
                                : colors.foreground,
                          },
                        ]}
                      >
                        {p.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </FormField>
            )}

            {fileId && (
              <View style={styles.locRow}>
                <Feather name="home" size={14} color={colors.primary} />
                <Text style={[styles.locText, { color: colors.foreground }]}>
                  {selectedPropertyName}
                </Text>
              </View>
            )}

            <FormField label="Room" required colors={colors}>
              {!selectedFileId ? (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  Select a property first
                </Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {(rooms ?? []).map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => setSelectedRoomId(r.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            selectedRoomId === r.id ? colors.primary : colors.secondary,
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
              )}
            </FormField>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              ITEM DETAILS
            </Text>

            <FormField label="Name" required colors={colors}>
              <StyledInput
                value={name}
                onChangeText={setName}
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

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              PHOTO
            </Text>

            {photoUri ? (
              <View style={{ gap: 10 }}>
                <Image
                  source={{ uri: photoUri }}
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
                  <Text style={[styles.removePhotoText, { color: colors.destructive }]}>
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
                  <Text style={[styles.photoBtnText, { color: colors.primary }]}>
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
                  <Text style={[styles.photoBtnText, { color: colors.primary }]}>
                    Library
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

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
                <Feather name="check" size={18} color={colors.primaryForeground} />
                <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
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
  scroll: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  locRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  locText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  hint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  photoPreview: {
    width: "100%",
    height: 200,
  },
  removePhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  removePhotoText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
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
  photoBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    marginTop: 8,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
