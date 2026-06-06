import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
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

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { getItemPhoto } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryItem, InventoryRoom } from "@/types";

// TODO: Confirm bucket name — check Supabase dashboard → Storage → Buckets
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

export default function EditItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const {
    data: item,
    isLoading: itemLoading,
    error: itemError,
    refetch,
  } = useQuery({
    queryKey: ["item", id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as InventoryItem;
    },
    enabled: !!session && !!id,
  });

  useEffect(() => {
    if (item && !hydrated) {
      setName(item.name ?? "");
      setDescription(item.description ?? "");
      setCategory(item.category ?? "");
      setEstimatedPrice(item.estimated_price != null ? String(item.estimated_price) : "");
      setQuantity(item.quantity != null ? String(item.quantity) : "1");
      setSelectedRoomId(item.room_id ?? "");
      const photo = getItemPhoto(item);
      setExistingPhotoUrl(photo);
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

  const uploadPhoto = async (uri: string, fileId: string): Promise<string | null> => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const ext = uri.split(".").pop() ?? "jpg";
      const path = `${fileId}/${Date.now()}.${ext}`;
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
    if (!selectedRoomId) {
      Alert.alert("Room required", "Please select a room.");
      return;
    }

    setSaving(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      let uploadedPhotoUrl: string | null = existingPhotoUrl;

      if (photoUri && item?.file_id) {
        const uploaded = await uploadPhoto(photoUri, item.file_id);
        if (uploaded) uploadedPhotoUrl = uploaded;
      }

      const price = estimatedPrice
        ? parseFloat(estimatedPrice.replace(/[^0-9.]/g, "")) || null
        : null;
      const qty = parseInt(quantity, 10) || 1;

      const updates: Partial<InventoryItem> = {
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        estimated_price: price,
        quantity: qty,
        room_id: selectedRoomId,
        image_url: uploadedPhotoUrl,
      };

      const { error } = await supabase
        .from("inventory_items")
        .update(updates)
        .eq("id", id);

      if (error) throw error;

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      queryClient.invalidateQueries({ queryKey: ["item", id] });
      queryClient.invalidateQueries({ queryKey: ["items", item?.room_id] });
      queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
      queryClient.invalidateQueries({ queryKey: ["all-items"] });
      queryClient.invalidateQueries({ queryKey: ["property-items", item?.file_id] });

      router.back();
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Save failed",
        err instanceof Error ? err.message : "Could not save changes."
      );
    } finally {
      setSaving(false);
    }
  };

  if (itemLoading) return <LoadingState />;
  if (itemError)
    return (
      <ErrorState
        message="Failed to load item"
        detail={(itemError as Error).message}
        onRetry={refetch}
      />
    );

  const displayPhoto = photoUri ?? existingPhotoUrl;
  const originalRoomId = item?.room_id;
  const isMoving = selectedRoomId && selectedRoomId !== originalRoomId;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Edit Item",
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
              ITEM DETAILS
            </Text>

            <FormField label="Name" required colors={colors}>
              <StyledInput
                value={name}
                onChangeText={setName}
                placeholder="Item name"
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
                  style={[styles.moveNoticeText, { color: colors.accentForeground }]}
                >
                  Item will be moved to{" "}
                  {rooms?.find((r) => r.id === selectedRoomId)?.name ?? "new room"}
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
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              PHOTO
            </Text>

            {displayPhoto ? (
              <View style={{ gap: 10 }}>
                <Image
                  source={{ uri: displayPhoto }}
                  style={[styles.photoPreview, { borderRadius: colors.radius }]}
                  contentFit="cover"
                />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    onPress={pickPhoto}
                    style={({ pressed }) => [
                      styles.photoActionBtn,
                      {
                        backgroundColor: colors.secondary,
                        borderRadius: colors.radius,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Feather name="image" size={14} color={colors.primary} />
                    <Text style={[styles.photoActionText, { color: colors.primary }]}>
                      Change
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setPhotoUri(null);
                      setExistingPhotoUrl(null);
                    }}
                    style={({ pressed }) => [
                      styles.photoActionBtn,
                      {
                        backgroundColor: colors.secondary,
                        borderRadius: colors.radius,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Feather name="x" size={14} color={colors.destructive} />
                    <Text
                      style={[styles.photoActionText, { color: colors.destructive }]}
                    >
                      Remove
                    </Text>
                  </Pressable>
                </View>
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
                <Text
                  style={[styles.saveBtnText, { color: colors.primaryForeground }]}
                >
                  Save changes
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
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  moveNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
  },
  moveNoticeText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  photoPreview: { width: "100%", height: 200 },
  photoActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  photoActionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderWidth: 1,
  },
  photoBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    marginTop: 4,
  },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
