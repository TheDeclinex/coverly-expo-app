import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AiScanningOverlay } from "@/components/AiScanningOverlay";
import { EmptyState } from "@/components/EmptyState";
import { ExpandableImage } from "@/components/ExpandableImage";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { buildItemInsertPayload } from "@/lib/item-insert-helpers";
import { formatCurrency } from "@/lib/inventory-mappers";
import {
  MAX_MULTI_PHOTO_IMAGES,
  runAiScan,
  validateScanInput,
} from "@/lib/scan-service";
import { clearScanPhotoUploadCache, uploadScanPhoto } from "@/lib/photo-upload";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryRoom } from "@/types";
import type {
  ScanDetectedItem,
  ScanEncodedImage,
  ScanMode,
  ScanStatus,
} from "@/types/scan";

// Future option: auto-save detected scan results after review confidence improves / with undo.

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
      "Close-up of one item. AI identifies the item with as much detail as visible.",
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

interface PartialFailure {
  itemName: string;
  error: string;
}

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
  const [newRoomName, setNewRoomName] = useState("");
  const [images, setImages] = useState<ScanEncodedImage[]>([]);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [detectedItems, setDetectedItems] = useState<ScanDetectedItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [scanSaveError, setScanSaveError] = useState<string | null>(null);
  const [partialFailures, setPartialFailures] = useState<PartialFailure[]>([]);
  const [activePinIndex, setActivePinIndex] = useState<number | null>(null);
  const [activeSourcePhotoIdx, setActiveSourcePhotoIdx] = useState(0);

  const flatListRef = useRef<FlatList<ScanDetectedItem>>(null);

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
      base64: true,
    });
    if (!result.canceled) {
      const picked: ScanEncodedImage[] = result.assets
        .filter((a) => !!a.base64)
        .map((a) => ({
          uri: a.uri,
          base64: a.base64!,
          mimeType: a.mimeType ?? "image/jpeg",
        }));
      setImages(isMulti ? picked : picked.slice(0, 1));
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access to continue.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      const a = result.assets[0];
      setImages([
        {
          uri: a.uri,
          base64: a.base64!,
          mimeType: a.mimeType ?? "image/jpeg",
        },
      ]);
    }
  };

  const getDestRoomName = (resolvedRoomId?: string) => {
    const rid = resolvedRoomId ?? selectedRoomId;
    return paramRoomName ?? rooms?.find((r) => r.id === rid)?.name ?? (newRoomName.trim() || null);
  };

  /**
   * Build the Supabase insert payload for a detected item.
   * @param item - Detected item from AI scan.
   * @param uploadedPhotoUrl - Public URL from storage upload; overrides any URL on the item itself.
   */
  const buildPayload = (item: ScanDetectedItem, uploadedPhotoUrl?: string | null) =>
    buildItemInsertPayload({
      fileId: selectedFileId,
      roomId: selectedRoomId,
      roomName: getDestRoomName(),
      name: item.name,
      description: item.description,
      notes: item.notes,
      category: item.category,
      estimatedPrice: item.estimatedPrice,
      unitEstimatedPrice: item.unitEstimatedPrice,
      quantity: item.quantity,
      imageUrl: uploadedPhotoUrl ?? item.imageUrl,
      photoUrl: uploadedPhotoUrl ?? item.photoUrl,
      brandMaker: item.brandMaker,
      modelSeries: item.modelSeries,
      conditionLabel: item.conditionLabel,
      confidence: item.confidence,
      valuationBasis: item.valuationBasis ?? "ai_estimate",
      priceSourceType: item.priceSourceType ?? "ai_scan",
      pin: item.pin,
      sourcePhotoIndex: item.sourcePhotoIndex,
    });

  const invalidateRoomQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] });
    queryClient.invalidateQueries({ queryKey: ["all-items"] });
    queryClient.invalidateQueries({ queryKey: ["property-items", selectedFileId] });
  };

  const handleStartScan = async () => {
    if (!selectedMode) { setScanError("Select a scan type above."); return; }
    if (!selectedFileId) { setScanError("Select a property."); return; }
    if (images.length === 0) { setScanError("Add at least one photo."); return; }

    // Resolve room: use existing selection, or create a new room from the typed name.
    let resolvedRoomId = selectedRoomId;
    if (!resolvedRoomId) {
      const trimmedName = newRoomName.trim();
      if (!trimmedName) { setScanError("Enter a room name to scan into."); return; }
      const roomId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
      const { error: roomErr } = await supabase.from("inventory_rooms").insert({
        id: roomId,
        file_id: selectedFileId,
        user_id: session!.user.id,
        name: trimmedName,
        sort_order: 1,
      });
      if (roomErr) { setScanError(`Could not create room: ${roomErr.message}`); return; }
      resolvedRoomId = roomId;
      setSelectedRoomId(roomId);
      queryClient.invalidateQueries({ queryKey: ["rooms", selectedFileId] });
      queryClient.invalidateQueries({ queryKey: ["rooms", selectedFileId, session?.user.id] });
    }

    setScanError(null);

    const input = {
      mode: selectedMode,
      fileId: selectedFileId,
      roomId: resolvedRoomId,
      roomName: getDestRoomName(resolvedRoomId) ?? undefined,
      images,
    };

    const validationError = validateScanInput(input);
    if (validationError) { setScanError(validationError); return; }

    setScanStatus("scanning");

    const result = await runAiScan(input);

    if (result.status === "not_configured") {
      setScanStatus("idle");
      setScanError(result.errorMessage ?? "AI scan is not configured yet. Deploy the scan-room-photo Edge Function.");
      return;
    }

    if (result.status === "error") {
      setScanStatus("error");
      setScanError(result.errorMessage ?? "Scan failed. Please try again.");
      return;
    }

    if (result.items.length === 0) {
      setScanStatus("idle");
      setScanError("No items were detected. Try a clearer shot or a different angle.");
      return;
    }

    // Attach source image thumbnails for review cards.
    // Use sourcePhotoIndex returned by Edge Function to route each item to the correct source photo.
    const fallbackUri = images[0]?.uri ?? null;
    const itemsWithThumbs: ScanDetectedItem[] = result.items.map((item) => ({
      ...item,
      sourceImageUri:
        item.sourcePhotoIndex != null
          ? (images[item.sourcePhotoIndex]?.uri ?? fallbackUri)
          : (item.sourceImageUri ?? fallbackUri),
    }));

    setActiveSourcePhotoIdx(0);
    setActivePinIndex(null);
    setDetectedItems(itemsWithThumbs);
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

    // Upload the source scan photo to inventory-photos before inserting.
    // A missing or failed upload is treated as a hard failure — we never save
    // an item with a null photo_url when a source image is available.
    const userId = session?.user.id;
    if (!userId) {
      setScanSaveError("You must be signed in to save items.");
      setSavingIds((prev) => { const n = new Set(prev); n.delete(index); return n; });
      return;
    }

    if (!item.sourceImageUri) {
      setScanSaveError("Source image is missing — cannot save this item.");
      setSavingIds((prev) => { const n = new Set(prev); n.delete(index); return n; });
      return;
    }

    const dedupeKey = `${item.sourcePhotoIndex ?? 0}:${item.sourceImageUri}`;
    const uploaded = await uploadScanPhoto(item.sourceImageUri, userId, dedupeKey);
    if (!uploaded) {
      setScanSaveError("Photo upload failed. Check your connection and try again.");
      setSavingIds((prev) => { const n = new Set(prev); n.delete(index); return n; });
      return;
    }

    // Store the durable storage path in the DB, not the short-lived signed URL.
    const { error } = await supabase.from("inventory_items").insert(buildPayload(item, uploaded.path));

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });

    if (error) {
      console.error("[Scan] Save item failed:", error.message);
      setScanSaveError(`Failed to save "${item.name}": ${error.message}`);
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      invalidateRoomQueries();
      setDetectedItems((prev) => prev.filter((_, i) => i !== index));
    }
  };

  /** Save all items sequentially. On partial failure, keep unsaved items visible and report failures inline. */
  const handleSaveAll = async () => {
    if (!selectedFileId || !selectedRoomId) return;
    setScanStatus("saving");
    setScanSaveError(null);
    setPartialFailures([]);

    const userId = session?.user.id;
    if (!userId) {
      setScanStatus("reviewing");
      setScanSaveError("You must be signed in to save items.");
      return;
    }

    // Phase 1: Upload each unique source photo once.
    // Track successful uploads (photoIdx → URL) and failures (photoIdx in failedPhotoIndices).
    // Items whose photo failed to upload are treated as partial failures and never inserted.
    // Stores durable storage paths (not signed URLs) keyed by photo index.
    const photoUrlByIndex = new Map<number, string>();
    const failedPhotoIndices = new Set<number>();

    for (const item of detectedItems) {
      const photoIdx = item.sourcePhotoIndex ?? 0;
      if (photoUrlByIndex.has(photoIdx) || failedPhotoIndices.has(photoIdx)) continue;
      const uri = item.sourceImageUri ?? images[photoIdx]?.uri ?? null;
      if (!uri) { failedPhotoIndices.add(photoIdx); continue; }
      const dedupeKey = `${photoIdx}:${uri}`;
      const uploaded = await uploadScanPhoto(uri, userId, dedupeKey);
      // Store the durable path (not the short-lived displayUrl) in the DB map.
      if (uploaded) { photoUrlByIndex.set(photoIdx, uploaded.path); }
      else { failedPhotoIndices.add(photoIdx); }
    }

    const failures: PartialFailure[] = [];
    const savedIndices: number[] = [];

    // Phase 2: Sequential insert — skip items whose source photo failed to upload.
    for (let i = 0; i < detectedItems.length; i++) {
      const item = detectedItems[i];
      const photoIdx = item.sourcePhotoIndex ?? 0;

      if (failedPhotoIndices.has(photoIdx)) {
        failures.push({ itemName: item.name, error: "Photo upload failed — check your connection" });
        continue;
      }

      const uploadedUrl = photoUrlByIndex.get(photoIdx) ?? null;
      const { error } = await supabase.from("inventory_items").insert(buildPayload(item, uploadedUrl));
      if (error) {
        console.error("[Scan] Save all — item failed:", item.name, error.message);
        failures.push({ itemName: item.name, error: error.message });
      } else {
        savedIndices.push(i);
      }
    }

    if (savedIndices.length > 0) {
      invalidateRoomQueries();
    }

    if (failures.length > 0) {
      // Keep unsaved items in review; surface partial failure list
      setDetectedItems((prev) => prev.filter((_, i) => !savedIndices.includes(i)));
      setPartialFailures(failures);
      setScanStatus("reviewing");
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setScanStatus("done");
    setDetectedItems([]);

    const roomName = getDestRoomName() ?? "Room";
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
    setScanSaveError(null);
    setPartialFailures([]);
    setActivePinIndex(null);
    setActiveSourcePhotoIdx(0);
    clearScanPhotoUploadCache();
  };

  // ── Confidence badge helpers ─────────────────────────────────────────────────

  const confidenceBadgeStyle = (confidence: string | null | undefined) => {
    switch (confidence) {
      case "high":   return { bg: "#E8F8F2", text: "#085041" };
      case "medium": return { bg: "#FEF3C7", text: "#92400E" };
      default:       return { bg: "#F1F5F9", text: "#64748b" };
    }
  };

  // ── Review screen ────────────────────────────────────────────────────────────

  if ((scanStatus === "reviewing" || scanStatus === "saving") && detectedItems.length > 0) {
    // Pin map layout — computed once per render of the review screen
    const PHOTO_W = Dimensions.get("window").width - 32;
    const PHOTO_H = Math.round(PHOTO_W * 0.72);
    const PIN_R = 11;
    const sourceUri = images[activeSourcePhotoIdx]?.uri ?? null;
    const visiblePins = detectedItems
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.pin != null && (item.sourcePhotoIndex ?? 0) === activeSourcePhotoIdx);

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
            ref={flatListRef}
            data={detectedItems}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{
              padding: 16,
              gap: 10,
              paddingBottom: insets.bottom + 100,
            }}
            onScrollToIndexFailed={() => {/* item not yet rendered — ignore */}}
            ListHeaderComponent={
              <View style={{ gap: 8, marginBottom: 4 }}>

                {/* ── Source photo with pin overlay ───────────────────────── */}
                {sourceUri && (
                  <View style={{ gap: 6 }}>
                    {/* Photo navigation for multi-photo scans */}
                    {images.length > 1 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Pressable
                          onPress={() => setActiveSourcePhotoIdx(i => Math.max(0, i - 1))}
                          disabled={activeSourcePhotoIdx === 0}
                          style={{ opacity: activeSourcePhotoIdx === 0 ? 0.3 : 1, padding: 4 }}
                        >
                          <Feather name="chevron-left" size={18} color={colors.foreground} />
                        </Pressable>
                        <Text style={[revStyles.headerNote, { flex: 1, textAlign: "center", color: colors.mutedForeground }]}>
                          Photo {activeSourcePhotoIdx + 1} of {images.length}
                        </Text>
                        <Pressable
                          onPress={() => setActiveSourcePhotoIdx(i => Math.min(images.length - 1, i + 1))}
                          disabled={activeSourcePhotoIdx === images.length - 1}
                          style={{ opacity: activeSourcePhotoIdx === images.length - 1 ? 0.3 : 1, padding: 4 }}
                        >
                          <Feather name="chevron-right" size={18} color={colors.foreground} />
                        </Pressable>
                      </View>
                    )}

                    {/* Photo frame */}
                    <View style={{
                      width: PHOTO_W, height: PHOTO_H,
                      borderRadius: 10, overflow: "hidden",
                      backgroundColor: colors.secondary,
                    }}>
                      <ExpandableImage uri={sourceUri} style={{ width: PHOTO_W, height: PHOTO_H }} contentFit="cover" />
                      {/* Numbered pin markers */}
                      {visiblePins.map(({ item, idx }) => (
                        <Pressable
                          key={idx}
                          onPress={() => {
                            setActivePinIndex(idx);
                            try {
                              flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewOffset: 8 });
                            } catch { /* not yet rendered */ }
                          }}
                          style={[
                            pinStyles.pin,
                            {
                              left: (item.pin!.x / 100) * PHOTO_W - PIN_R,
                              top: (item.pin!.y / 100) * PHOTO_H - PIN_R,
                              width: PIN_R * 2, height: PIN_R * 2, borderRadius: PIN_R,
                              backgroundColor: activePinIndex === idx ? "#1D9E75" : "#085041",
                              transform: [{ scale: activePinIndex === idx ? 1.2 : 1 }],
                            },
                          ]}
                        >
                          <Text style={pinStyles.pinLabel}>{idx + 1}</Text>
                        </Pressable>
                      ))}
                    </View>

                    {/* Summary below the photo */}
                    <Text style={[revStyles.headerNote, { color: colors.mutedForeground }]}>
                      {detectedItems.length} item{detectedItems.length !== 1 ? "s" : ""} detected
                      {visiblePins.length > 0
                        ? ` · ${visiblePins.length} pinned — tap a pin or card`
                        : " — review and save"}
                    </Text>
                  </View>
                )}

                {/* Fallback note when no source image (shouldn't normally occur) */}
                {!sourceUri && (
                  <Text style={[revStyles.headerNote, { color: colors.mutedForeground }]}>
                    {detectedItems.length} item{detectedItems.length !== 1 ? "s" : ""} detected — review and save
                  </Text>
                )}

                {/* Partial failure list */}
                {partialFailures.length > 0 && (
                  <View style={[revStyles.failureBanner, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}>
                    <Feather name="alert-circle" size={14} color="#DC2626" />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#991B1B" }}>
                        {partialFailures.length} item{partialFailures.length !== 1 ? "s" : ""} failed to save
                      </Text>
                      {partialFailures.map((f, i) => (
                        <Text key={i} style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#B91C1C" }} numberOfLines={2}>
                          • {f.itemName}: {f.error}
                        </Text>
                      ))}
                    </View>
                  </View>
                )}

                {/* Single-item save error */}
                {scanSaveError && partialFailures.length === 0 && (
                  <View style={[revStyles.failureBanner, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}>
                    <Feather name="alert-circle" size={14} color="#DC2626" />
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#991B1B", flex: 1 }}>
                      {scanSaveError}
                    </Text>
                  </View>
                )}
              </View>
            }
            renderItem={({ item, index }) => {
              const isSaving = savingIds.has(index);
              const badge = confidenceBadgeStyle(item.confidence);
              const isActive = activePinIndex === index;

              return (
                <Pressable
                  onPress={() => {
                    setActivePinIndex(isActive ? null : index);
                    // Switch the source photo panel to this card's source image so the
                    // matching pin is always visible after tapping a card.
                    setActiveSourcePhotoIdx(item.sourcePhotoIndex ?? 0);
                  }}
                  style={[
                    revStyles.card,
                    {
                      backgroundColor: "#FFFFFF",
                      borderColor: isActive ? "#1D9E75" : colors.border,
                      borderLeftColor: isActive ? "#1D9E75" : colors.border,
                      borderLeftWidth: isActive ? 3 : 1,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  {/* Thumbnail with optional pin number badge */}
                  <View style={{ position: "relative" }}>
                    <ExpandableImage
                      uri={item.sourceImageUri}
                      style={[revStyles.thumb, { borderTopLeftRadius: colors.radius, borderBottomLeftRadius: colors.radius }]}
                      contentFit="cover"
                      placeholderIcon="image"
                      placeholderIconSize={18}
                      placeholderIconColor={colors.border}
                      placeholderBackgroundColor={colors.secondary}
                    />
                    {/* Pin number badge — only shown when item has a pin */}
                    {item.pin != null && (
                      <View style={[pinStyles.cardBadge, { backgroundColor: isActive ? "#1D9E75" : "#085041" }]}>
                        <Text style={pinStyles.cardBadgeLabel}>{index + 1}</Text>
                      </View>
                    )}
                  </View>

                  {/* Card body */}
                  <View style={revStyles.cardBody}>
                    <Text style={[revStyles.itemName, { color: colors.foreground }]} numberOfLines={2}>
                      {item.name}
                    </Text>

                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                      {item.category ? (
                        <View style={[revStyles.pill, { backgroundColor: colors.secondary }]}>
                          <Text style={[revStyles.pillText, { color: colors.mutedForeground }]}>
                            {item.category}
                          </Text>
                        </View>
                      ) : null}
                      {(item.quantity ?? 1) > 1 ? (
                        <View style={[revStyles.pill, { backgroundColor: colors.secondary }]}>
                          <Text style={[revStyles.pillText, { color: colors.mutedForeground }]}>
                            Qty {item.quantity}
                          </Text>
                        </View>
                      ) : null}
                      {item.confidence ? (
                        <View style={[revStyles.pill, { backgroundColor: badge.bg }]}>
                          <Text style={[revStyles.pillText, { color: badge.text }]}>
                            {item.confidence.charAt(0).toUpperCase() + item.confidence.slice(1)}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {item.brandMaker ? (
                      <Text style={[revStyles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {item.brandMaker}
                      </Text>
                    ) : null}

                    {item.description ? (
                      <Text style={[revStyles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}

                    {item.estimatedPrice != null ? (
                      <Text style={[revStyles.price, { color: colors.foreground }]}>
                        {formatCurrency(item.estimatedPrice)}
                      </Text>
                    ) : null}
                  </View>

                  {/* Actions */}
                  <View style={revStyles.actionCol}>
                    <Pressable
                      onPress={() => handleDiscardItem(index)}
                      disabled={isSaving}
                      hitSlop={4}
                      style={({ pressed }) => [
                        revStyles.actionBtn,
                        { backgroundColor: colors.secondary, borderRadius: 8, opacity: pressed || isSaving ? 0.6 : 1 },
                      ]}
                    >
                      <Feather name="x" size={15} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable
                      onPress={() => void handleSaveItem(item, index)}
                      disabled={isSaving}
                      hitSlop={4}
                      style={({ pressed }) => [
                        revStyles.actionBtn,
                        { backgroundColor: colors.primary, borderRadius: 8, opacity: pressed || isSaving ? 0.7 : 1 },
                      ]}
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color={colors.primaryForeground} />
                      ) : (
                        <Feather name="check" size={15} color={colors.primaryForeground} />
                      )}
                    </Pressable>
                  </View>
                </Pressable>
              );
            }}
          />

          {/* Save all bar */}
          <View
            style={[
              revStyles.saveAllBar,
              { backgroundColor: "#FFFFFF", borderTopColor: colors.border, paddingBottom: insets.bottom + 12 },
            ]}
          >
            <Pressable
              onPress={() => void handleSaveAll()}
              disabled={scanStatus === "saving"}
              style={({ pressed }) => [
                revStyles.saveAllBtn,
                {
                  backgroundColor: scanStatus === "saving" ? colors.muted : colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {scanStatus === "saving" ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Feather name="check-circle" size={18} color={colors.primaryForeground} />
              )}
              <Text style={[revStyles.saveAllText, { color: colors.primaryForeground }]}>
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

  // ── Main scan screen ──────────────────────────────────────────────────────────

  const isScanning = scanStatus === "scanning";
  const canScan =
    selectedMode &&
    selectedFileId &&
    (selectedRoomId || newRoomName.trim()) &&
    (selectedMode === "video_room" || images.length > 0);

  // ── Scanning overlay — full screen while AI processes ─────────────────────
  if (isScanning) {
    return (
      <>
        <Stack.Screen options={{ title: "Scanning…", headerShown: false }} />
        <AiScanningOverlay images={images} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Scan items" }} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Scan mode cards */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SCAN TYPE</Text>
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
                  backgroundColor: selectedMode === m.mode ? colors.primary : colors.card,
                  borderColor: selectedMode === m.mode ? colors.primary : colors.border,
                  borderRadius: colors.radius,
                  opacity: m.comingSoon ? 0.5 : pressed ? 0.9 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.modeIcon,
                  { backgroundColor: selectedMode === m.mode ? "rgba(255,255,255,0.2)" : colors.secondary },
                ]}
              >
                <Feather
                  name={m.icon}
                  size={20}
                  color={selectedMode === m.mode ? colors.primaryForeground : colors.primary}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text
                    style={[
                      styles.modeTitle,
                      { color: selectedMode === m.mode ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {m.title}
                  </Text>
                  {m.comingSoon && (
                    <View style={[styles.soonBadge, { backgroundColor: colors.muted }]}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground }}>
                        SOON
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.modeSub,
                    { color: selectedMode === m.mode ? "rgba(255,255,255,0.75)" : colors.mutedForeground },
                  ]}
                >
                  {m.subtitle}
                </Text>
                <Text
                  style={[
                    styles.modeCredit,
                    { color: selectedMode === m.mode ? "rgba(255,255,255,0.6)" : colors.mutedForeground },
                  ]}
                >
                  {m.creditLabel}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Location */}
        {selectedMode && selectedMode !== "video_room" && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>LOCATION</Text>

            {paramFileId ? (
              <View style={{ gap: 4 }}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Property</Text>
                <View style={[styles.chip, { backgroundColor: colors.primary, alignSelf: "flex-start" }]}>
                  <Text style={[styles.chipText, { color: colors.primaryForeground }]}>
                    {paramFileName ?? paramFileId}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={{ gap: 4 }}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Property</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {(properties ?? []).map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => { setSelectedFileId(p.id); setSelectedRoomId(""); }}
                      style={[styles.chip, { backgroundColor: selectedFileId === p.id ? colors.primary : colors.secondary }]}
                    >
                      <Text style={[styles.chipText, { color: selectedFileId === p.id ? colors.primaryForeground : colors.foreground }]}>
                        {p.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {selectedFileId && (
              paramRoomId ? (
                <View style={{ gap: 4 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Room</Text>
                  <View style={[styles.chip, { backgroundColor: colors.primary, alignSelf: "flex-start" }]}>
                    <Text style={[styles.chipText, { color: colors.primaryForeground }]}>
                      {paramRoomName ?? paramRoomId}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={{ gap: 4 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Room</Text>
                  {(rooms ?? []).length === 0 ? (
                    /* No rooms yet — let the user name one inline; it will be
                       created automatically when the scan starts. */
                    <TextInput
                      value={newRoomName}
                      onChangeText={setNewRoomName}
                      placeholder="e.g. Living Room, Kitchen…"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="words"
                      style={{
                        borderWidth: 1.5,
                        borderColor: newRoomName.trim() ? colors.primary : colors.border,
                        borderRadius: colors.radius,
                        paddingHorizontal: 12,
                        paddingVertical: 9,
                        fontSize: 14,
                        fontFamily: "Inter_400Regular",
                        color: colors.foreground,
                        backgroundColor: colors.muted,
                      }}
                    />
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {(rooms ?? []).map((r) => (
                        <Pressable
                          key={r.id}
                          onPress={() => { setSelectedRoomId(r.id); setNewRoomName(""); }}
                          style={[styles.chip, { backgroundColor: selectedRoomId === r.id ? colors.primary : colors.secondary }]}
                        >
                          <Text style={[styles.chipText, { color: selectedRoomId === r.id ? colors.primaryForeground : colors.foreground }]}>
                            {r.name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>
              )
            )}
          </View>
        )}

        {/* Photo picker */}
        {selectedMode && selectedMode !== "video_room" && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {selectedMode === "multi_photo_room" ? `PHOTOS (max ${MAX_MULTI_PHOTO_IMAGES})` : "PHOTO"}
            </Text>

            {images.length > 0 ? (
              <View style={{ gap: 10 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {images.map((img, i) => (
                    <View key={i} style={{ position: "relative" }}>
                      <ExpandableImage
                        uri={img.uri}
                        style={[styles.photoThumb, { borderRadius: colors.radius }]}
                        contentFit="cover"
                      />
                      <Pressable
                        onPress={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                        style={styles.removeThumb}
                      >
                        <Feather name="x" size={12} color="#fff" />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
                {selectedMode === "multi_photo_room" && images.length < MAX_MULTI_PHOTO_IMAGES && (
                  <Pressable
                    onPress={pickImages}
                    style={({ pressed }) => [
                      styles.addMoreBtn,
                      { borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Feather name="plus" size={15} color={colors.primary} />
                    <Text style={[styles.addMoreText, { color: colors.primary }]}>
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
                    { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Feather name="camera" size={20} color={colors.primary} />
                  <Text style={[styles.photoBtnText, { color: colors.primary }]}>Camera</Text>
                </Pressable>
                <Pressable
                  onPress={pickImages}
                  style={({ pressed }) => [
                    styles.photoBtn,
                    { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Feather name="image" size={20} color={colors.primary} />
                  <Text style={[styles.photoBtnText, { color: colors.primary }]}>Library</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* Video coming soon */}
        {selectedMode === "video_room" && (
          <View style={[styles.comingSoonCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Feather name="video" size={32} color={colors.border} />
            <Text style={[styles.comingSoonTitle, { color: colors.foreground }]}>Video scan coming soon</Text>
            <Text style={[styles.comingSoonSub, { color: colors.mutedForeground }]}>
              This mode will extract representative frames from a room walkthrough video and avoid duplicate items automatically.
            </Text>
          </View>
        )}

        {/* Inline error */}
        {scanError && (
          <View style={[styles.errorCard, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5", borderRadius: colors.radius }]}>
            <Feather name="alert-circle" size={15} color="#DC2626" />
            <Text style={[styles.errorText, { color: "#991B1B" }]}>{scanError}</Text>
          </View>
        )}

        {/* Start scan button */}
        {selectedMode && selectedMode !== "video_room" && (
          <Pressable
            onPress={() => void handleStartScan()}
            disabled={!canScan || isScanning}
            style={({ pressed }) => [
              styles.scanBtn,
              {
                backgroundColor: !canScan || isScanning ? colors.muted : colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {isScanning ? (
              <>
                <ActivityIndicator color={colors.primaryForeground} />
                <Text style={[styles.scanBtnText, { color: colors.primaryForeground }]}>Scanning…</Text>
              </>
            ) : (
              <>
                <Feather name="zap" size={18} color={!canScan ? colors.mutedForeground : colors.primaryForeground} />
                <Text style={[styles.scanBtnText, { color: !canScan ? colors.mutedForeground : colors.primaryForeground }]}>
                  Start scan
                </Text>
              </>
            )}
          </Pressable>
        )}

        {!selectedMode && (
          <EmptyState
            icon="zap"
            title="Choose a scan type above"
            subtitle="AI scan will detect and value your items automatically once connected"
          />
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 20 },
  section: { gap: 12 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  modeCard: { borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  modeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modeSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  modeCredit: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  soonBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  chip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  photoThumb: { width: 100, height: 100 },
  removeThumb: {
    position: "absolute", top: 4, right: 4,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10,
    width: 20, height: 20, alignItems: "center", justifyContent: "center",
  },
  addMoreBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, alignSelf: "flex-start",
  },
  addMoreText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  photoBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderWidth: 1 },
  photoBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  comingSoonCard: { borderWidth: 1, padding: 24, alignItems: "center", gap: 12 },
  comingSoonTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  comingSoonSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  errorCard: { borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, flex: 1 },
  scanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, marginTop: 4 },
  scanBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

const revStyles = StyleSheet.create({
  headerNote: { fontSize: 13, fontFamily: "Inter_400Regular" },
  failureBanner: { borderWidth: 1, borderRadius: 8, padding: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  card: { borderWidth: 1, flexDirection: "row", alignItems: "stretch", overflow: "hidden" },
  thumb: { width: 76, height: 110 },
  thumbPlaceholder: { width: 76, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, padding: 10, gap: 4 },
  itemName: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  price: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  actionCol: { paddingVertical: 10, paddingRight: 10, gap: 8, alignItems: "center", justifyContent: "center" },
  actionBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  saveAllBar: { position: "absolute", bottom: 0, left: 0, right: 0, borderTopWidth: 1, padding: 16 },
  saveAllBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  saveAllText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

/** Styles for the pin overlay on the source photo and card badge. */
const pinStyles = StyleSheet.create({
  pin: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
  },
  pinLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: 13,
  },
  cardBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
  },
  cardBadgeLabel: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: 12,
  },
});
