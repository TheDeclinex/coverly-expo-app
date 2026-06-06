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
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { buildItemInsertPayload } from "@/lib/item-insert-helpers";
import {
  MAX_MULTI_PHOTO_IMAGES,
  runAiScan,
  validateScanInput,
} from "@/lib/scan-service";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryRoom } from "@/types";
import type { ScanDetectedItem, ScanMode, ScanStatus } from "@/types/scan";

interface ScanModeCard {
  mode: ScanMode;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  creditLabel: string;
  comingSoon?: boolean;
}

const SCAN_MODES: ScanModeCard[] = [
  {
    mode: "single_photo_room",
    icon: "camera",
    title: "Single photo scan",
    subtitle: "Take or upload one room photo to detect all visible items at once.",
    creditLabel: "1 scan credit",
  },
  {
    mode: "multi_photo_room",
    icon: "grid",
    title: "Multi-photo room scan",
    subtitle:
      "Up to 5 photos of the same room for thorough coverage. Items detected across photos are merged.",
    creditLabel: `Up to ${MAX_MULTI_PHOTO_IMAGES} photos · 3 credits`,
  },
  {
    mode: "single_item",
    icon: "package",
    title: "Single item scan",
    subtitle:
      "Close-up of one item. Enriches brand, model, condition, and replacement value.",
    creditLabel: "1 scan credit",
  },
  {
    mode: "video_room",
    icon: "video",
    title: "Video room scan",
    subtitle:
      "Record or upload a room walkthrough video for maximum coverage.",
    creditLabel: "Coming soon",
    comingSoon: true,
  },
];

export default function ScanScreen() {
  const { fileId: paramFileId, roomId: paramRoomId } =
    useLocalSearchParams<{ fileId?: string; roomId?: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [selectedMode, setSelectedMode] = useState<ScanMode | null>(null);
  const [selectedFileId, setSelectedFileId] = useState(paramFileId ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(paramRoomId ?? "");
  const [images, setImages] = useState<string[]>([]);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [detectedItems, setDetectedItems] = useState<ScanDetectedItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());

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

  const pickImages = async () => {
    if (!selectedMode) return;
    const isMulti = selectedMode === "multi_photo_room";
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: isMulti,
      selectionLimit: isMulti ? MAX_MULTI_PHOTO_IMAGES : 1,
      quality: 0.8,
    });
    if (!result.canceled) {
      const uris = result.assets.map((a) => a.uri);
      setImages(isMulti ? uris : uris.slice(0, 1));
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImages([result.assets[0].uri]);
    }
  };

  const handleStartScan = async () => {
    if (!selectedMode) {
      Alert.alert("Select a scan type", "Choose a scan mode above.");
      return;
    }
    const input = {
      mode: selectedMode,
      fileId: selectedFileId,
      roomId: selectedRoomId,
      imageUris: images,
    };
    const validationError = validateScanInput(input);
    if (validationError) {
      Alert.alert("Cannot start scan", validationError);
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setScanStatus("scanning");
    setScanError(null);

    const result = await runAiScan(input);

    if (result.status === "not_configured") {
      setScanStatus("idle");
      setScanError(result.errorMessage ?? null);
      Alert.alert(
        "AI scan not yet available",
        "The scan service is not configured yet. Your photos and item data are ready — connect the Supabase Edge Function to enable AI processing.",
        [{ text: "OK" }]
      );
      return;
    }

    if (result.status === "error") {
      setScanStatus("error");
      setScanError(result.errorMessage ?? "Unknown scan error");
      return;
    }

    setDetectedItems(result.items);
    setScanStatus("reviewing");
  };

  const handleSaveItem = async (item: ScanDetectedItem, index: number) => {
    if (!session?.user.id || !selectedFileId || !selectedRoomId) return;
    setSavingIds((prev) => new Set(prev).add(index));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const payload = buildItemInsertPayload({
      fileId: selectedFileId,
      roomId: selectedRoomId,
      userId: session.user.id,
      name: item.name,
      description: item.description,
      category: item.category,
      estimatedPrice: item.estimatedPrice,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      brandMaker: item.brandMaker,
      modelSeries: item.modelSeries,
      conditionLabel: item.conditionLabel,
      confidence: item.confidence,
      valuationBasis: item.valuationBasis,
    });

    const { error } = await supabase.from("inventory_items").insert(payload);

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });

    if (error) {
      Alert.alert("Save failed", error.message);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
      queryClient.invalidateQueries({ queryKey: ["all-items"] });
      queryClient.invalidateQueries({
        queryKey: ["property-items", selectedFileId],
      });
      setDetectedItems((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleSaveAll = async () => {
    if (!session?.user.id || !selectedFileId || !selectedRoomId) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setScanStatus("saving");

    const payloads = detectedItems.map((item) =>
      buildItemInsertPayload({
        fileId: selectedFileId,
        roomId: selectedRoomId,
        userId: session.user.id!,
        name: item.name,
        description: item.description,
        category: item.category,
        estimatedPrice: item.estimatedPrice,
        quantity: item.quantity,
        imageUrl: item.imageUrl,
        brandMaker: item.brandMaker,
        modelSeries: item.modelSeries,
        conditionLabel: item.conditionLabel,
        confidence: item.confidence,
        valuationBasis: item.valuationBasis,
      })
    );

    const { error } = await supabase.from("inventory_items").insert(payloads);

    if (error) {
      setScanStatus("reviewing");
      Alert.alert("Save failed", error.message);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
    queryClient.invalidateQueries({ queryKey: ["all-items"] });
    queryClient.invalidateQueries({ queryKey: ["property-items", selectedFileId] });
    setScanStatus("done");
    setDetectedItems([]);

    const roomName =
      rooms?.find((r) => r.id === selectedRoomId)?.name ?? "Room";
    router.replace({
      pathname: "/(tabs)/room/[id]",
      params: { id: selectedRoomId, name: roomName, fileId: selectedFileId },
    });
  };

  const resetScan = () => {
    setSelectedMode(null);
    setImages([]);
    setDetectedItems([]);
    setScanStatus("idle");
    setScanError(null);
  };

  if (scanStatus === "reviewing" && detectedItems.length > 0) {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Review detected items",
            headerLeft: () => (
              <Pressable onPress={resetScan} hitSlop={8} style={{ padding: 4 }}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            ),
          }}
        />
        <View style={{ flex: 1 }}>
          <FlatList
            data={detectedItems}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{
              padding: 16,
              gap: 12,
              paddingBottom: insets.bottom + 100,
            }}
            renderItem={({ item, index }) => {
              const isSaving = savingIds.has(index);
              return (
                <View
                  style={[
                    reviewStyles.card,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  {item.sourceImageUri && (
                    <Image
                      source={{ uri: item.sourceImageUri }}
                      style={reviewStyles.thumb}
                      contentFit="cover"
                    />
                  )}
                  <View style={reviewStyles.cardBody}>
                    <Text
                      style={[reviewStyles.itemName, { color: colors.foreground }]}
                    >
                      {item.name}
                    </Text>
                    {item.category && (
                      <Text
                        style={[
                          reviewStyles.itemMeta,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {item.category}
                      </Text>
                    )}
                    {item.estimatedPrice != null && (
                      <Text
                        style={[reviewStyles.itemPrice, { color: colors.primary }]}
                      >
                        ${item.estimatedPrice.toLocaleString("en-US")}
                      </Text>
                    )}
                  </View>
                  <Pressable
                    onPress={() => handleSaveItem(item, index)}
                    disabled={isSaving}
                    style={({ pressed }) => [
                      reviewStyles.saveBtn,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: 8,
                        opacity: pressed || isSaving ? 0.7 : 1,
                      },
                    ]}
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <Feather name="check" size={16} color={colors.primaryForeground} />
                    )}
                  </Pressable>
                </View>
              );
            }}
            ListHeaderComponent={
              <Text
                style={[reviewStyles.header, { color: colors.mutedForeground }]}
              >
                {detectedItems.length} items detected — save individually or all
                at once
              </Text>
            }
          />
          <View
            style={[
              reviewStyles.saveAllBar,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            <Pressable
              onPress={handleSaveAll}
              style={({ pressed }) => [
                reviewStyles.saveAllBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Feather name="check-circle" size={18} color={colors.primaryForeground} />
              <Text
                style={[
                  reviewStyles.saveAllText,
                  { color: colors.primaryForeground },
                ]}
              >
                Save all {detectedItems.length} items
              </Text>
            </Pressable>
          </View>
        </View>
      </>
    );
  }

  const canScan =
    selectedMode &&
    selectedFileId &&
    selectedRoomId &&
    (selectedMode === "video_room" || images.length > 0);

  return (
    <>
      <Stack.Screen options={{ title: "Scan items" }} />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        {/* Scan mode selection */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            SCAN TYPE
          </Text>
          {SCAN_MODES.map((m) => (
            <Pressable
              key={m.mode}
              onPress={() => {
                if (m.comingSoon) return;
                setSelectedMode(m.mode);
                setImages([]);
              }}
              style={({ pressed }) => [
                styles.modeCard,
                {
                  backgroundColor:
                    selectedMode === m.mode ? colors.primary : colors.card,
                  borderColor:
                    selectedMode === m.mode ? colors.primary : colors.border,
                  borderRadius: colors.radius,
                  opacity: m.comingSoon ? 0.55 : pressed ? 0.9 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.modeIconWrap,
                  {
                    backgroundColor:
                      selectedMode === m.mode
                        ? "rgba(255,255,255,0.2)"
                        : colors.secondary,
                  },
                ]}
              >
                <Feather
                  name={m.icon}
                  size={20}
                  color={
                    selectedMode === m.mode ? colors.primaryForeground : colors.primary
                  }
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text
                    style={[
                      styles.modeTitle,
                      {
                        color:
                          selectedMode === m.mode
                            ? colors.primaryForeground
                            : colors.foreground,
                      },
                    ]}
                  >
                    {m.title}
                  </Text>
                  {m.comingSoon && (
                    <View
                      style={[
                        styles.comingSoonBadge,
                        { backgroundColor: colors.muted },
                      ]}
                    >
                      <Text
                        style={[
                          styles.comingSoonText,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Soon
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.modeSubtitle,
                    {
                      color:
                        selectedMode === m.mode
                          ? "rgba(255,255,255,0.75)"
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  {m.subtitle}
                </Text>
                <Text
                  style={[
                    styles.modeCredit,
                    {
                      color:
                        selectedMode === m.mode
                          ? "rgba(255,255,255,0.6)"
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  {m.creditLabel}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Property + room selectors */}
        {selectedMode && selectedMode !== "video_room" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              LOCATION
            </Text>

            {!paramFileId && (
              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: "Inter_500Medium",
                    color: colors.mutedForeground,
                  }}
                >
                  Property
                </Text>
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
                            selectedFileId === p.id
                              ? colors.primary
                              : colors.secondary,
                          borderRadius: 20,
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
              </View>
            )}

            {selectedFileId && !paramRoomId && (
              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: "Inter_500Medium",
                    color: colors.mutedForeground,
                  }}
                >
                  Room
                </Text>
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
                            selectedRoomId === r.id
                              ? colors.primary
                              : colors.secondary,
                          borderRadius: 20,
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
              </View>
            )}
          </View>
        )}

        {/* Photo picker */}
        {selectedMode && selectedMode !== "video_room" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              {selectedMode === "multi_photo_room"
                ? `PHOTOS (max ${MAX_MULTI_PHOTO_IMAGES})`
                : "PHOTO"}
            </Text>

            {images.length > 0 ? (
              <View style={{ gap: 10 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {images.map((uri, i) => (
                    <View key={i} style={{ position: "relative" }}>
                      <Image
                        source={{ uri }}
                        style={[
                          styles.photoThumb,
                          { borderRadius: colors.radius },
                        ]}
                        contentFit="cover"
                      />
                      <Pressable
                        onPress={() =>
                          setImages((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        style={styles.removeThumb}
                      >
                        <Feather name="x" size={12} color="#fff" />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
                {selectedMode === "multi_photo_room" &&
                  images.length < MAX_MULTI_PHOTO_IMAGES && (
                    <Pressable
                      onPress={pickImages}
                      style={({ pressed }) => [
                        styles.addMoreBtn,
                        {
                          borderColor: colors.border,
                          borderRadius: colors.radius,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Feather name="plus" size={16} color={colors.primary} />
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: "Inter_500Medium",
                          color: colors.primary,
                        }}
                      >
                        Add more ({images.length}/{MAX_MULTI_PHOTO_IMAGES})
                      </Text>
                    </Pressable>
                  )}
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
                  onPress={pickImages}
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
        )}

        {/* Video coming soon */}
        {selectedMode === "video_room" && (
          <View
            style={[
              styles.comingSoonCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Feather name="video" size={32} color={colors.border} />
            <Text style={[styles.comingSoonCardTitle, { color: colors.foreground }]}>
              Video scan coming soon
            </Text>
            <Text
              style={[styles.comingSoonCardSub, { color: colors.mutedForeground }]}
            >
              This mode will extract representative frames from a room walkthrough
              video and avoid duplicate items automatically.
            </Text>
          </View>
        )}

        {/* Scan error */}
        {scanError && (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Feather name="alert-circle" size={16} color={colors.warning} />
            <Text
              style={[styles.errorText, { color: colors.mutedForeground }]}
            >
              {scanError}
            </Text>
          </View>
        )}

        {/* Start scan button */}
        {selectedMode && selectedMode !== "video_room" && (
          <Pressable
            onPress={handleStartScan}
            disabled={!canScan || scanStatus === "scanning"}
            style={({ pressed }) => [
              styles.scanBtn,
              {
                backgroundColor:
                  !canScan || scanStatus === "scanning"
                    ? colors.muted
                    : colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {scanStatus === "scanning" ? (
              <>
                <ActivityIndicator color={colors.primaryForeground} />
                <Text
                  style={[styles.scanBtnText, { color: colors.primaryForeground }]}
                >
                  Scanning…
                </Text>
              </>
            ) : (
              <>
                <Feather
                  name="zap"
                  size={18}
                  color={!canScan ? colors.mutedForeground : colors.primaryForeground}
                />
                <Text
                  style={[
                    styles.scanBtnText,
                    {
                      color: !canScan
                        ? colors.mutedForeground
                        : colors.primaryForeground,
                    },
                  ]}
                >
                  Start scan
                </Text>
              </>
            )}
          </Pressable>
        )}

        {!selectedMode && (
          <View style={{ paddingTop: 8 }}>
            <EmptyState
              icon="zap"
              title="Choose a scan type above"
              subtitle="AI scan will detect and value your items automatically once connected"
            />
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 20 },
  section: { gap: 12 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  modeCard: {
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  modeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modeTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modeSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  modeCredit: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  comingSoonBadge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  comingSoonText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  chip: { paddingHorizontal: 14, paddingVertical: 8 },
  photoThumb: { width: 100, height: 100 },
  removeThumb: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  addMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
  comingSoonCard: {
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  comingSoonCardTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  comingSoonCardSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  errorCard: {
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    flex: 1,
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    marginTop: 4,
  },
  scanBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

const reviewStyles = StyleSheet.create({
  header: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  card: {
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    gap: 0,
  },
  thumb: { width: 72, height: 72 },
  cardBody: { flex: 1, padding: 12, gap: 2 },
  itemName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  itemMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  itemPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  saveAllBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    padding: 16,
  },
  saveAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  saveAllText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
