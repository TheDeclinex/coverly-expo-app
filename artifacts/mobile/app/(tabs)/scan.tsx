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
  uploadScanImages,
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
  const {
    fileId: paramFileId,
    roomId: paramRoomId,
    fileName: paramFileName,
    roomName: paramRoomName,
  } = useLocalSearchParams<{
    fileId?: string;
    roomId?: string;
    fileName?: string;
    roomName?: string;
  }>();
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
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [scanSaveError, setScanSaveError] = useState<string | null>(null);

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
      Alert.alert("Permission needed", "Allow photo library access to continue.");
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
      Alert.alert("Permission needed", "Allow camera access to continue.");
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
      setScanError("Select a scan type above.");
      return;
    }
    if (!selectedFileId) {
      setScanError("Select a property.");
      return;
    }
    if (!selectedRoomId) {
      setScanError("Select a room.");
      return;
    }
    if (images.length === 0) {
      setScanError("Add at least one photo.");
      return;
    }
    if (!session?.user.id) {
      setScanError("Not signed in — please sign in again.");
      return;
    }

    setScanError(null);
    setUploadWarning(null);

    // Step 1 — upload images to inventory-photos (private bucket)
    setScanStatus("uploading");
    const { uploadedPaths, failedCount } = await uploadScanImages(
      images,
      selectedFileId,
      session.user.id
    );

    if (uploadedPaths.length === 0) {
      setScanStatus("idle");
      setScanError(
        failedCount === 1
          ? "Photo upload failed. Please check your connection and try again."
          : `All ${failedCount} photos failed to upload. Please check your connection and try again.`
      );
      return;
    }

    if (failedCount > 0) {
      setUploadWarning(
        `${failedCount} of ${images.length} photo${failedCount > 1 ? "s" : ""} failed to upload — scanning with ${uploadedPaths.length} photo${uploadedPaths.length > 1 ? "s" : ""}.`
      );
    }

    // Step 2 — validate and call Edge Function with storage paths
    const destRoomName =
      paramRoomName ?? rooms?.find((r) => r.id === selectedRoomId)?.name ?? null;

    const input = {
      mode: selectedMode,
      fileId: selectedFileId,
      roomId: selectedRoomId,
      roomName: destRoomName ?? undefined,
      imagePaths: uploadedPaths,
    };

    const validationError = validateScanInput(input);
    if (validationError) {
      setScanStatus("idle");
      setScanError(validationError);
      return;
    }

    setScanStatus("scanning");

    const result = await runAiScan(input);

    if (result.status === "not_configured") {
      setScanStatus("idle");
      setScanError(
        result.errorMessage ??
          "AI scan is not configured yet. The Edge Function needs to be deployed."
      );
      return;
    }

    if (result.status === "error") {
      setScanStatus("error");
      setScanError(result.errorMessage ?? "Scan failed. Please try again.");
      return;
    }

    if (result.items.length === 0) {
      setScanStatus("idle");
      setScanError(
        "No items were detected in this photo. Try a clearer shot or a different angle."
      );
      return;
    }

    setDetectedItems(result.items);
    setScanStatus("reviewing");
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDiscardItem = (index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetectedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveItem = async (item: ScanDetectedItem, index: number) => {
    if (!selectedFileId || !selectedRoomId) return;
    setSavingIds((prev) => new Set(prev).add(index));
    setScanSaveError(null);

    const destRoomName =
      paramRoomName ?? rooms?.find((r) => r.id === selectedRoomId)?.name ?? null;

    const payload = buildItemInsertPayload({
      fileId: selectedFileId,
      roomId: selectedRoomId,
      roomName: destRoomName,
      name: item.name,
      description: item.description,
      notes: item.notes,
      category: item.category,
      estimatedPrice: item.estimatedPrice,
      unitEstimatedPrice: item.unitEstimatedPrice,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      photoUrl: item.photoUrl,
      brandMaker: item.brandMaker,
      modelSeries: item.modelSeries,
      conditionLabel: item.conditionLabel,
      confidence: item.confidence,
      valuationBasis: item.valuationBasis ?? "ai_estimate",
      priceSourceType: item.priceSourceType ?? "ai_scan",
    });

    const { error } = await supabase.from("inventory_items").insert(payload);

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });

    if (error) {
      console.error("[Scan] Save item failed:", error.message);
      setScanSaveError(error.message);
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
      queryClient.invalidateQueries({ queryKey: ["all-items"] });
      queryClient.invalidateQueries({
        queryKey: ["property-items", selectedFileId],
      });
      setDetectedItems((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleSaveAll = async () => {
    if (!selectedFileId || !selectedRoomId) return;
    setScanStatus("saving");
    setScanSaveError(null);

    const destRoomName =
      paramRoomName ?? rooms?.find((r) => r.id === selectedRoomId)?.name ?? null;

    const payloads = detectedItems.map((item) =>
      buildItemInsertPayload({
        fileId: selectedFileId,
        roomId: selectedRoomId,
        roomName: destRoomName,
        name: item.name,
        description: item.description,
        notes: item.notes,
        category: item.category,
        estimatedPrice: item.estimatedPrice,
        unitEstimatedPrice: item.unitEstimatedPrice,
        quantity: item.quantity,
        imageUrl: item.imageUrl,
        photoUrl: item.photoUrl,
        brandMaker: item.brandMaker,
        modelSeries: item.modelSeries,
        conditionLabel: item.conditionLabel,
        confidence: item.confidence,
        valuationBasis: item.valuationBasis ?? "ai_estimate",
        priceSourceType: item.priceSourceType ?? "ai_scan",
      })
    );

    const { error } = await supabase.from("inventory_items").insert(payloads);

    if (error) {
      setScanStatus("reviewing");
      console.error("[Scan] Save all failed:", error.message);
      setScanSaveError(error.message);
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
    queryClient.invalidateQueries({ queryKey: ["all-items"] });
    queryClient.invalidateQueries({
      queryKey: ["property-items", selectedFileId],
    });
    setScanStatus("done");
    setDetectedItems([]);

    const roomName =
      paramRoomName ??
      rooms?.find((r) => r.id === selectedRoomId)?.name ??
      "Room";
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
    setUploadWarning(null);
    setScanSaveError(null);
  };

  // ── Review screen ──────────────────────────────────────────────────────────

  if ((scanStatus === "reviewing" || scanStatus === "saving") && detectedItems.length > 0) {
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
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <FlatList
            data={detectedItems}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{
              padding: 16,
              gap: 12,
              paddingBottom: insets.bottom + 100,
            }}
            ListHeaderComponent={
              <View style={{ gap: 8, marginBottom: 4 }}>
                <Text
                  style={[reviewStyles.header, { color: colors.mutedForeground }]}
                >
                  {detectedItems.length} item{detectedItems.length !== 1 ? "s" : ""} detected — review and save
                </Text>
                {uploadWarning && (
                  <View
                    style={[
                      reviewStyles.warningBanner,
                      { backgroundColor: "#FEF3C7", borderColor: "#F59E0B" },
                    ]}
                  >
                    <Feather name="alert-triangle" size={14} color="#D97706" />
                    <Text style={[reviewStyles.warningText, { color: "#92400E" }]}>
                      {uploadWarning}
                    </Text>
                  </View>
                )}
                {scanSaveError && (
                  <View
                    style={[
                      reviewStyles.warningBanner,
                      {
                        backgroundColor: "#FEE2E2",
                        borderColor: "#B91C1C",
                      },
                    ]}
                  >
                    <Feather name="alert-circle" size={14} color="#B91C1C" />
                    <Text style={[reviewStyles.warningText, { color: "#7F1D1D" }]}>
                      Save failed: {scanSaveError}
                    </Text>
                  </View>
                )}
              </View>
            }
            renderItem={({ item, index }) => {
              const isSaving = savingIds.has(index);
              const confidenceLow = item.confidence === "low";
              const confidenceColor =
                item.confidence === "high"
                  ? "#1D9E75"
                  : item.confidence === "medium"
                  ? "#D97706"
                  : "#94a3b8";
              const hasMeta =
                item.brandMaker || item.modelSeries || item.conditionLabel;
              const hasDescription = !!item.description;
              const qty = item.quantity ?? 1;

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
                    {/* Name */}
                    <Text
                      style={[reviewStyles.itemName, { color: colors.foreground }]}
                      numberOfLines={2}
                    >
                      {item.name}
                    </Text>

                    {/* Category · Quantity */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {item.category && (
                        <Text
                          style={[
                            reviewStyles.itemChip,
                            {
                              color: colors.mutedForeground,
                              backgroundColor: colors.secondary,
                            },
                          ]}
                        >
                          {item.category}
                        </Text>
                      )}
                      {qty > 1 && (
                        <Text
                          style={[
                            reviewStyles.itemChip,
                            {
                              color: colors.mutedForeground,
                              backgroundColor: colors.secondary,
                            },
                          ]}
                        >
                          Qty {qty}
                        </Text>
                      )}
                    </View>

                    {/* Brand / Model / Condition */}
                    {hasMeta && (
                      <Text
                        style={[reviewStyles.itemMeta, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {[item.brandMaker, item.modelSeries, item.conditionLabel]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    )}

                    {/* Description */}
                    {hasDescription && (
                      <Text
                        style={[reviewStyles.itemDesc, { color: colors.mutedForeground }]}
                        numberOfLines={2}
                      >
                        {item.description}
                      </Text>
                    )}

                    {/* Confidence · Price */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                      {item.confidence && (
                        <View
                          style={[
                            reviewStyles.confidenceBadge,
                            { borderColor: confidenceColor },
                          ]}
                        >
                          <Text
                            style={[
                              reviewStyles.confidenceText,
                              { color: confidenceColor },
                            ]}
                          >
                            {item.confidence.charAt(0).toUpperCase() +
                              item.confidence.slice(1)}{" "}
                            confidence
                          </Text>
                        </View>
                      )}
                      {item.estimatedPrice != null && (
                        <Text
                          style={[reviewStyles.itemPrice, { color: colors.primary }]}
                        >
                          £{item.estimatedPrice.toLocaleString("en-GB")}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Action buttons: discard + save */}
                  <View style={reviewStyles.actionCol}>
                    <Pressable
                      onPress={() => handleDiscardItem(index)}
                      disabled={isSaving}
                      hitSlop={4}
                      style={({ pressed }) => [
                        reviewStyles.actionBtn,
                        {
                          backgroundColor: colors.secondary,
                          borderRadius: 8,
                          opacity: pressed || isSaving ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Feather
                        name="x"
                        size={15}
                        color={colors.mutedForeground}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => void handleSaveItem(item, index)}
                      disabled={isSaving}
                      hitSlop={4}
                      style={({ pressed }) => [
                        reviewStyles.actionBtn,
                        {
                          backgroundColor: colors.primary,
                          borderRadius: 8,
                          opacity: pressed || isSaving ? 0.7 : 1,
                        },
                      ]}
                    >
                      {isSaving ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.primaryForeground}
                        />
                      ) : (
                        <Feather
                          name="check"
                          size={15}
                          color={colors.primaryForeground}
                        />
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />

          {/* Save all bar */}
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
              onPress={() => void handleSaveAll()}
              disabled={scanStatus === "saving"}
              style={({ pressed }) => [
                reviewStyles.saveAllBtn,
                {
                  backgroundColor:
                    scanStatus === "saving" ? colors.muted : colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {scanStatus === "saving" ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Feather
                  name="check-circle"
                  size={18}
                  color={colors.primaryForeground}
                />
              )}
              <Text
                style={[
                  reviewStyles.saveAllText,
                  { color: colors.primaryForeground },
                ]}
              >
                {scanStatus === "saving"
                  ? "Saving…"
                  : `Save all ${detectedItems.length} item${detectedItems.length !== 1 ? "s" : ""}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </>
    );
  }

  // ── Main scan screen ───────────────────────────────────────────────────────

  const isWorking =
    scanStatus === "uploading" || scanStatus === "scanning";

  const canScan =
    selectedMode &&
    selectedFileId &&
    selectedRoomId &&
    (selectedMode === "video_room" || images.length > 0);

  const scanBtnLabel =
    scanStatus === "uploading"
      ? "Uploading…"
      : scanStatus === "scanning"
      ? "Scanning…"
      : "Start scan";

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
                setScanError(null);
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
                    selectedMode === m.mode
                      ? colors.primaryForeground
                      : colors.primary
                  }
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
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

            {paramFileId ? (
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
                <View
                  style={[
                    styles.chip,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: 20,
                      alignSelf: "flex-start",
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Inter_500Medium",
                      color: colors.primaryForeground,
                    }}
                  >
                    {paramFileName ?? paramFileId}
                  </Text>
                </View>
              </View>
            ) : (
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

            {selectedFileId &&
              (paramRoomId ? (
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
                  <View
                    style={[
                      styles.chip,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: 20,
                        alignSelf: "flex-start",
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontFamily: "Inter_500Medium",
                        color: colors.primaryForeground,
                      }}
                    >
                      {paramRoomName ?? paramRoomId}
                    </Text>
                  </View>
                </View>
              ) : (
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
              ))}
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
            <Text
              style={[styles.comingSoonCardTitle, { color: colors.foreground }]}
            >
              Video scan coming soon
            </Text>
            <Text
              style={[
                styles.comingSoonCardSub,
                { color: colors.mutedForeground },
              ]}
            >
              This mode will extract representative frames from a room walkthrough
              video and avoid duplicate items automatically.
            </Text>
          </View>
        )}

        {/* Upload warning (non-blocking) */}
        {uploadWarning && !isWorking && (
          <View
            style={[
              styles.warningCard,
              { backgroundColor: "#FEF3C7", borderColor: "#F59E0B" },
            ]}
          >
            <Feather name="alert-triangle" size={15} color="#D97706" />
            <Text style={[styles.warningText, { color: "#92400E" }]}>
              {uploadWarning}
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
            onPress={() => void handleStartScan()}
            disabled={!canScan || isWorking}
            style={({ pressed }) => [
              styles.scanBtn,
              {
                backgroundColor:
                  !canScan || isWorking ? colors.muted : colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {isWorking ? (
              <>
                <ActivityIndicator color={colors.primaryForeground} />
                <Text
                  style={[
                    styles.scanBtnText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {scanBtnLabel}
                </Text>
              </>
            ) : (
              <>
                <Feather
                  name="zap"
                  size={18}
                  color={
                    !canScan ? colors.mutedForeground : colors.primaryForeground
                  }
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
                  {scanBtnLabel}
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
  warningCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  warningText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    flex: 1,
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
    marginBottom: 2,
  },
  warningBanner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  warningText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
    flex: 1,
  },
  card: {
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
  },
  thumb: { width: 80, height: "100%" as unknown as number },
  cardBody: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  itemName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  itemChip: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  itemMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  itemDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  confidenceBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  confidenceText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },
  itemPrice: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  actionCol: {
    paddingVertical: 12,
    paddingRight: 12,
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
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
