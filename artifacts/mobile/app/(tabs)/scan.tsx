import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { Stack, router, useLocalSearchParams, type Href } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AiScanningOverlay } from "@/components/AiScanningOverlay";
import { ContextBackButton } from "@/components/ContextBackButton";
import { EmptyState } from "@/components/EmptyState";
import { ExpandableImage } from "@/components/ExpandableImage";
import { LimitReachedModal } from "@/components/LimitReachedModal";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import { buildItemInsertPayload } from "@/lib/item-insert-helpers";
import { formatCurrencyFull } from "@/lib/inventory-mappers";
import {
  SCAN_LIBRARY_IMAGE_CONVERSION_ERROR,
  normalizeScanLibrarySelection,
  scanLibrarySourceFormat,
} from "@/lib/scan-image-normalization";
import {
  MAX_MULTI_PHOTO_IMAGES,
  MAX_VIDEO_SCAN_FRAMES,
  runAiScan,
  validateScanInput,
} from "@/lib/scan-service";
import { normalizeLimitError, type NormalizedLimitError } from "@/lib/limit-errors";
import { buildManualScanValuePatch } from "@/lib/replacement-value";
import {
  clearScanPhotoUploadCache,
  formatUploadFailure,
  uploadScanPhoto,
  type UploadFailure,
} from "@/lib/photo-upload";
import { stageRecentItemBatch } from "@/lib/recent-items";
import { pinMarkerPosition } from "@/lib/pin-position";
import {
  DUPLICATE_ROOM_NAME_MESSAGE,
  formatRoomCreationError,
  hasActiveRoomNameDuplicate,
} from "@/lib/room-creation";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryItem, InventoryRoom } from "@/types";
import type {
  ScanDetectedItem,
  ScanEncodedImage,
  ScanMode,
  ScanStatus,
} from "@/types/scan";

// Future option: auto-save detected scan results after review confidence improves / with undo.

const VIDEO_SCAN_USED_DURATION_MS = 10_000;
const VIDEO_SCAN_USED_SECONDS = VIDEO_SCAN_USED_DURATION_MS / 1000;
const VIDEO_SCAN_LIMIT_COPY = `Record or upload a room walkthrough. Coverly will scan up to the first ${VIDEO_SCAN_USED_SECONDS} seconds.`;
const VIDEO_SCAN_START_ERROR = "Video scan could not start. Please try again or choose a video from gallery.";
const ANDROID_SCAN_STATE_STORAGE_KEY = "coverly:android-scan-state:v1";
const ANDROID_SCAN_STATE_MAX_AGE_MS = 30 * 60 * 1000;
const EXTREME_IMAGE_MAX_DIMENSION = 5200;
const EXTREME_IMAGE_MAX_MEGA_PIXELS = 20;
const COMPAT_IMAGE_MAX_DIMENSION = 1600;
const COMPAT_IMAGE_COMPRESSION = 0.72;
const LIBRARY_IMAGE_JPEG_COMPRESSION = 0.8;
const COMPATIBILITY_ERROR_COPY =
  "This phone had trouble processing the photo. Try again in compatibility mode or choose a photo from gallery.";

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
    subtitle: VIDEO_SCAN_LIMIT_COPY,
    creditLabel: `First ${VIDEO_SCAN_USED_SECONDS} seconds · 3 credits`,
  },
];

const SCAN_MODE_COLORS: Record<ScanMode, { fill: string; border: string; chip: string; icon: string }> = {
  single_photo_room: {
    fill: "#EFF8FF",
    border: "#B9E0FF",
    chip: "#DBF0FF",
    icon: "#2563EB",
  },
  multi_photo_room: {
    fill: "#F6F0FF",
    border: "#D9C7FF",
    chip: "#EEE2FF",
    icon: "#7C3AED",
  },
  single_item: {
    fill: "#FFF8E7",
    border: "#F3D59B",
    chip: "#FFEBC2",
    icon: "#B45309",
  },
  video_room: {
    fill: "#F0FDF4",
    border: "#B7E4C7",
    chip: "#DCFCE7",
    icon: "#15803D",
  },
};

interface PartialFailure {
  itemName: string;
  error: string;
}

type ScanLaunchStep = "property" | "room" | "type";
type ScanSaveStage =
  | "scan-review-save"
  | "photo-handling"
  | "storage-upload"
  | "db-insert"
  | "room-refresh";

interface SaveInsertResult {
  ok: boolean;
  savedViaDuplicateKey?: boolean;
  error?: unknown;
}

interface ScanAssetMetadata {
  uriScheme: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
}

type ScanInputSource = "camera" | "library" | "video";

interface CompatibilityPrompt {
  reason: string;
  message: string;
}

interface StartScanOptions {
  compatibilityMode?: boolean;
  compatibilityReason?: string;
}

interface PersistedAndroidScanState {
  version: 1;
  savedAt: number;
  selectedMode: ScanMode | null;
  selectedFileId: string;
  selectedRoomId: string;
  newRoomName: string;
  images: ScanEncodedImage[];
  scanStatus: ScanStatus;
}

function scanLog(message: string, details?: Record<string, unknown>) {
  if (!__DEV__) return;
  if (details) {
    console.info(`[Scan] ${message}`, details);
  } else {
    console.info(`[Scan] ${message}`);
  }
}

function uriScheme(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const match = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return match?.[1]?.toLowerCase() ?? null;
}

function platformConstant(name: string): string {
  const constants = Platform.constants as Record<string, unknown> | undefined;
  const value = constants?.[name];
  return typeof value === "string" ? value : "";
}

function androidDeviceSummary(): Record<string, unknown> {
  if (Platform.OS !== "android") return { platform: Platform.OS };
  const brand = platformConstant("Brand") || platformConstant("brand");
  const manufacturer = platformConstant("Manufacturer") || platformConstant("manufacturer");
  const model = platformConstant("Model") || platformConstant("model");
  return {
    platform: Platform.OS,
    brand: brand || null,
    manufacturer: manufacturer || null,
    model: model || null,
  };
}

function isKnownProblemAndroidDevice(): boolean {
  if (Platform.OS !== "android") return false;
  const haystack = [
    platformConstant("Brand"),
    platformConstant("brand"),
    platformConstant("Manufacturer"),
    platformConstant("manufacturer"),
    platformConstant("Model"),
    platformConstant("model"),
  ].join(" ").toLowerCase();

  return (
    haystack.includes("galaxy a05") ||
    haystack.includes("sm-a055") ||
    haystack.includes("sm-a057")
  );
}

function isExtremeImage(image: ScanEncodedImage): boolean {
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const longestEdge = Math.max(width, height);
  const megaPixels = width > 0 && height > 0 ? (width * height) / 1_000_000 : 0;
  return longestEdge >= EXTREME_IMAGE_MAX_DIMENSION || megaPixels >= EXTREME_IMAGE_MAX_MEGA_PIXELS;
}

function hasCompatibilityCandidate(imagesToCheck: ScanEncodedImage[]): boolean {
  return (
    Platform.OS === "android" &&
    imagesToCheck.some((image) => !!image.uri && !image.compatibilityPrepared)
  );
}

function compatibilityReasonFor(imagesToCheck: ScanEncodedImage[], fallbackReason = "manual_retry"): string | null {
  if (!hasCompatibilityCandidate(imagesToCheck)) return null;
  if (isKnownProblemAndroidDevice()) return "known_problem_android_device";
  if (imagesToCheck.some(isExtremeImage)) return "extreme_image_size";
  return fallbackReason;
}

function safeImageDiagnostics(image: ScanEncodedImage, index: number): Record<string, unknown> {
  return {
    index,
    uriScheme: uriScheme(image.uri),
    width: image.width ?? null,
    height: image.height ?? null,
    fileSize: image.fileSize ?? null,
    mimeType: image.mimeType,
    compatibilityPrepared: Boolean(image.compatibilityPrepared),
  };
}

async function localFileSize(uri: string): Promise<number | null> {
  if (Platform.OS === "web") return null;
  try {
    const file = new File(uri);
    return typeof file.size === "number" && Number.isFinite(file.size) ? file.size : null;
  } catch {
    return null;
  }
}

async function metadataForAsset(asset: ImagePicker.ImagePickerAsset): Promise<ScanAssetMetadata> {
  const assetRecord = asset as ImagePicker.ImagePickerAsset & { fileSize?: number | null };
  return {
    uriScheme: uriScheme(asset.uri),
    width: typeof asset.width === "number" && Number.isFinite(asset.width) ? asset.width : null,
    height: typeof asset.height === "number" && Number.isFinite(asset.height) ? asset.height : null,
    fileSize:
      typeof assetRecord.fileSize === "number" && Number.isFinite(assetRecord.fileSize)
        ? assetRecord.fileSize
        : await localFileSize(asset.uri),
  };
}

async function imageFromPickerAsset(
  asset: ImagePicker.ImagePickerAsset,
  source: ScanInputSource,
  index: number,
): Promise<ScanEncodedImage | null> {
  if (!asset.uri) return null;
  const metadata = await metadataForAsset(asset);
  scanLog("selected asset metadata", {
    source,
    assetIndex: index,
    uriScheme: metadata.uriScheme,
    width: metadata.width,
    height: metadata.height,
    fileSize: metadata.fileSize,
    mimeType: asset.mimeType ?? "image/jpeg",
  });
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? "image/jpeg",
    width: metadata.width,
    height: metadata.height,
    fileSize: metadata.fileSize,
  };
}

function hasJpegExtension(uri: string): boolean {
  return /\.jpe?g$/i.test(uri.split(/[?#]/, 1)[0]);
}

function ensureNativeJpegFileUri(uri: string, index: number): string {
  if (Platform.OS === "web" || hasJpegExtension(uri)) return uri;
  const destination = new File(
    Paths.cache,
    `coverly-scan-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}.jpg`,
  );
  new File(uri).copy(destination);
  return destination.uri;
}

async function normalizeLibraryPickerAssets(
  assets: ImagePicker.ImagePickerAsset[],
): Promise<ScanEncodedImage[]> {
  return normalizeScanLibrarySelection(assets, async (asset, index) => {
    const metadata = await metadataForAsset(asset as ImagePicker.ImagePickerAsset);
    const sourceFormat = scanLibrarySourceFormat(asset);
    scanLog("library image normalization started", {
      assetIndex: index,
      sourceFormat,
      uriScheme: metadata.uriScheme,
      originalWidth: metadata.width,
      originalHeight: metadata.height,
      originalFileSize: metadata.fileSize,
      originalMimeType: asset.mimeType ?? null,
      compression: LIBRARY_IMAGE_JPEG_COMPRESSION,
    });

    const result = await ImageManipulator.manipulateAsync(
      asset.uri,
      [],
      {
        compress: LIBRARY_IMAGE_JPEG_COMPRESSION,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      },
    );
    const normalizedUri = ensureNativeJpegFileUri(result.uri, index);
    const fileSize = await localFileSize(normalizedUri);
    scanLog("library image normalization completed", {
      assetIndex: index,
      sourceFormat,
      uriScheme: uriScheme(normalizedUri),
      width: result.width,
      height: result.height,
      fileSize,
      mimeType: "image/jpeg",
    });

    return {
      uri: normalizedUri,
      width: result.width,
      height: result.height,
      fileSize,
    };
  });
}

async function prepareImageForCompatibility(
  image: ScanEncodedImage,
  index: number,
  reason: string,
): Promise<ScanEncodedImage> {
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const longestEdge = Math.max(width, height);
  const shouldResize = longestEdge > COMPAT_IMAGE_MAX_DIMENSION || longestEdge === 0;
  const resizeAction = shouldResize
    ? [{ resize: width >= height ? { width: COMPAT_IMAGE_MAX_DIMENSION } : { height: COMPAT_IMAGE_MAX_DIMENSION } }]
    : [];

  scanLog("resize/manipulation start", {
    imageIndex: index,
    reason,
    uriScheme: uriScheme(image.uri),
    originalWidth: image.width ?? null,
    originalHeight: image.height ?? null,
    originalFileSize: image.fileSize ?? null,
    targetMaxDimension: COMPAT_IMAGE_MAX_DIMENSION,
    compression: COMPAT_IMAGE_COMPRESSION,
    willResize: shouldResize,
  });

  const result = await ImageManipulator.manipulateAsync(
    image.uri,
    resizeAction,
    {
      compress: COMPAT_IMAGE_COMPRESSION,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: false,
    },
  );
  const fileSize = await localFileSize(result.uri);
  scanLog("resize/manipulation success", {
    imageIndex: index,
    reason,
    uriScheme: uriScheme(result.uri),
    width: result.width,
    height: result.height,
    fileSize,
  });

  return {
    ...image,
    uri: result.uri,
    mimeType: "image/jpeg",
    width: result.width,
    height: result.height,
    fileSize,
    compatibilityPrepared: true,
  };
}

async function prepareImagesForCompatibility(
  scanImages: ScanEncodedImage[],
  reason: string,
): Promise<ScanEncodedImage[]> {
  const prepared: ScanEncodedImage[] = [];
  for (let index = 0; index < scanImages.length; index += 1) {
    const image = scanImages[index];
    if (!image.uri || image.compatibilityPrepared) {
      prepared.push(image);
      continue;
    }
    try {
      prepared.push(await prepareImageForCompatibility(image, index, reason));
    } catch (error) {
      scanLog("resize/manipulation failure", {
        imageIndex: index,
        reason,
        uriScheme: uriScheme(image.uri),
        message: errorMessage(error),
      });
      throw error;
    }
  }
  return prepared;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
  }
  return String(error);
}

function isTimeoutMessage(message: string): boolean {
  return /network request timed out|timed out|timeout/i.test(message);
}

function isNetworkFailureMessage(message: string): boolean {
  return /network request failed|failed to fetch|networkerror|internet connection|offline|not connected/i.test(message);
}

function isTransientSaveFailure(error: unknown): boolean {
  const message = errorMessage(error);
  return isTimeoutMessage(message) || isNetworkFailureMessage(message);
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (record.code === "23505") return true;
  }
  return /duplicate key|already exists/i.test(errorMessage(error));
}

function scanSaveErrorMessage(stage: ScanSaveStage, error: unknown, itemName?: string): string {
  const message = errorMessage(error);
  if (stage === "storage-upload" || stage === "photo-handling") {
    if (isTimeoutMessage(message)) return "Photo upload timed out while saving this item.";
    if (isNetworkFailureMessage(message)) return "Network request failed while saving item.";
    return "Photo upload failed while saving this item. Please try again.";
  }
  if (stage === "db-insert") {
    if (isTimeoutMessage(message)) return "Item save timed out. Please try again.";
    if (isNetworkFailureMessage(message)) return "Network request failed while saving item.";
    return itemName ? `Failed to save "${itemName}": ${message}` : `Item save failed: ${message}`;
  }
  if (stage === "room-refresh") {
    return "The item may have saved, but refresh timed out. Pull to refresh or reopen the room.";
  }
  if (stage === "scan-review-save") {
    if (isTimeoutMessage(message)) return "Item save timed out. Please try again.";
    if (isNetworkFailureMessage(message)) return "Network request failed while saving item.";
  }
  return message;
}

async function insertScanReviewItem(
  payload: InventoryItem,
  context: { itemIndex: number; itemCount: number },
): Promise<SaveInsertResult> {
  const payloadChars = JSON.stringify(payload).length;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = Date.now();
    scanLog("DB insert started", {
      stage: "db-insert",
      itemIndex: context.itemIndex,
      itemCount: context.itemCount,
      attempt,
      payloadChars,
      hasImageStoragePath: Boolean(payload.image_url || payload.photo_url),
    });

    try {
      const { error } = await supabase.from("inventory_items").insert(payload);
      if (!error) {
        scanLog("DB insert completed", {
          stage: "db-insert",
          itemIndex: context.itemIndex,
          itemCount: context.itemCount,
          attempt,
          elapsedMs: Date.now() - startedAt,
        });
        return { ok: true };
      }

      if (isDuplicateKeyError(error)) {
        scanLog("DB insert completed after duplicate-key retry", {
          stage: "db-insert",
          itemIndex: context.itemIndex,
          itemCount: context.itemCount,
          attempt,
          elapsedMs: Date.now() - startedAt,
        });
        return { ok: true, savedViaDuplicateKey: true };
      }

      scanLog("DB insert failed", {
        stage: "db-insert",
        itemIndex: context.itemIndex,
        itemCount: context.itemCount,
        attempt,
        message: error.message,
        elapsedMs: Date.now() - startedAt,
      });

      if (attempt === 1 && isTransientSaveFailure(error)) {
        scanLog("DB insert retrying once with same item id", {
          stage: "db-insert",
          itemIndex: context.itemIndex,
          itemCount: context.itemCount,
        });
        continue;
      }

      return { ok: false, error };
    } catch (error) {
      scanLog("DB insert failed", {
        stage: "db-insert",
        itemIndex: context.itemIndex,
        itemCount: context.itemCount,
        attempt,
        message: errorMessage(error),
        elapsedMs: Date.now() - startedAt,
      });

      if (attempt === 1 && isTransientSaveFailure(error)) {
        scanLog("DB insert retrying once with same item id", {
          stage: "db-insert",
          itemIndex: context.itemIndex,
          itemCount: context.itemCount,
        });
        continue;
      }

      return { ok: false, error };
    }
  }

  return { ok: false, error: new Error("Item save failed after retry.") };
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
  const { enforce } = useEntitlements();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [selectedMode, setSelectedMode] = useState<ScanMode | null>(null);
  const [selectedFileId, setSelectedFileId] = useState(paramFileId ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(paramRoomId ?? "");
  const [newRoomName, setNewRoomName] = useState("");
  const roomNameInputRef = useRef<TextInput>(null);
  const [images, setImages] = useState<ScanEncodedImage[]>([]);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [detectedItems, setDetectedItems] = useState<ScanDetectedItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [compatibilityPrompt, setCompatibilityPrompt] = useState<CompatibilityPrompt | null>(null);
  const [limitModal, setLimitModal] = useState<NormalizedLimitError | null>(null);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [scanSaveError, setScanSaveError] = useState<string | null>(null);
  const [partialFailures, setPartialFailures] = useState<PartialFailure[]>([]);
  const [activePinIndex, setActivePinIndex] = useState<number | null>(null);
  const [activeSourcePhotoIdx, setActiveSourcePhotoIdx] = useState(0);
  const [multiPhotoPromptVisible, setMultiPhotoPromptVisible] = useState(false);
  const [reviewNameEdit, setReviewNameEdit] = useState<{ index: number; draft: string } | null>(null);
  const isActiveMultiPhotoSession =
    selectedMode === "multi_photo_room" &&
    images.length > 0 &&
    scanStatus === "idle";

  const flatListRef = useRef<FlatList<ScanDetectedItem>>(null);
  const multiPhotoCameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const multiPhotoCameraInteractionRef = useRef<{ cancel: () => void } | null>(null);
  const pendingMultiPhotoCameraRef = useRef(false);
  const aiScanEntitlementCheckedRef = useRef(false);
  const videoProcessingRef = useRef<{ key: string; sessionId: number } | null>(null);
  const videoProcessingSessionRef = useRef(0);
  const scanAttemptRef = useRef(0);
  const saveAllInFlightRef = useRef(false);
  const completionNavigationRef = useRef(false);
  const restoredAndroidScanStateRef = useRef(false);

  useEffect(() => () => {
    if (multiPhotoCameraTimerRef.current) {
      clearTimeout(multiPhotoCameraTimerRef.current);
    }
    multiPhotoCameraInteractionRef.current?.cancel();
  }, []);

  const persistAndroidScanState = async (reason: string) => {
    if (Platform.OS !== "android") return;
    if (!selectedMode && images.length === 0) {
      await AsyncStorage.removeItem(ANDROID_SCAN_STATE_STORAGE_KEY);
      return;
    }

    const payload: PersistedAndroidScanState = {
      version: 1,
      savedAt: Date.now(),
      selectedMode,
      selectedFileId,
      selectedRoomId,
      newRoomName,
      images,
      scanStatus,
    };
    await AsyncStorage.setItem(ANDROID_SCAN_STATE_STORAGE_KEY, JSON.stringify(payload));
    scanLog("android scan state persisted", {
      reason,
      mode: selectedMode,
      imageCount: images.length,
      scanStatus,
    });
  };

  const clearAndroidScanState = async (reason: string) => {
    if (Platform.OS !== "android") return;
    await AsyncStorage.removeItem(ANDROID_SCAN_STATE_STORAGE_KEY);
    scanLog("android scan state cleared", { reason });
  };

  useEffect(() => {
    if (Platform.OS !== "android" || restoredAndroidScanStateRef.current) return;
    restoredAndroidScanStateRef.current = true;

    void AsyncStorage.getItem(ANDROID_SCAN_STATE_STORAGE_KEY).then((raw) => {
      if (!raw) return;
      let parsed: PersistedAndroidScanState | null = null;
      try {
        parsed = JSON.parse(raw) as PersistedAndroidScanState;
      } catch {
        void clearAndroidScanState("restore_parse_error");
        return;
      }

      const isFresh = Date.now() - parsed.savedAt < ANDROID_SCAN_STATE_MAX_AGE_MS;
      const routeFileMatches = !paramFileId || parsed.selectedFileId === paramFileId;
      const routeRoomMatches = !paramRoomId || parsed.selectedRoomId === paramRoomId;
      if (!isFresh || !routeFileMatches || !routeRoomMatches || parsed.images.length === 0 || selectedMode || images.length > 0) {
        if (!isFresh) void clearAndroidScanState("restore_expired");
        return;
      }

      scanLog("android scan state restored", {
        mode: parsed.selectedMode,
        imageCount: parsed.images.length,
        previousScanStatus: parsed.scanStatus,
      });
      setSelectedMode(parsed.selectedMode);
      setSelectedFileId(parsed.selectedFileId);
      setSelectedRoomId(parsed.selectedRoomId);
      setNewRoomName(parsed.newRoomName);
      setImages(parsed.images);
      setScanStatus("error");
      setScanError("Coverly restored your photo after Android paused the app. Try the scan again, or choose a photo from gallery.");
      setCompatibilityPrompt({
        reason: "android_lifecycle_restore",
        message: COMPATIBILITY_ERROR_COPY,
      });
    }).catch((error) => {
      scanLog("android scan state restore failed", { message: errorMessage(error) });
    });
  }, [images.length, paramFileId, paramRoomId, selectedMode]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void persistAndroidScanState("state_change").catch((error) => {
      scanLog("android scan state persist failed", { message: errorMessage(error) });
    });
  }, [selectedMode, selectedFileId, selectedRoomId, newRoomName, images, scanStatus]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        void persistAndroidScanState(`appstate_${state}`).catch((error) => {
          scanLog("android scan state persist failed", { message: errorMessage(error) });
        });
      }
    });
    return () => subscription.remove();
  }, [selectedMode, selectedFileId, selectedRoomId, newRoomName, images, scanStatus]);

  const { data: properties, isLoading: propertiesLoading } = useQuery({
    queryKey: ["properties", session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("id, name, country_code, currency_code")
        .order("last_modified", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Pick<InventoryFile, "id" | "name" | "country_code" | "currency_code">[];
    },
    enabled: !!session,
  });

  const { data: rooms, isLoading: roomsLoading } = useQuery({
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
  const selectedProperty = properties?.find((property) => property.id === selectedFileId) ?? null;

  useEffect(() => {
    if (paramFileId || selectedFileId || !properties || properties.length !== 1) return;
    setSelectedFileId(properties[0].id);
  }, [paramFileId, properties, selectedFileId]);

  useEffect(() => {
    if (paramRoomId || selectedRoomId || !selectedFileId || !rooms || rooms.length !== 1) return;
    setSelectedRoomId(rooms[0].id);
  }, [paramRoomId, rooms, selectedFileId, selectedRoomId]);

  const clearCaptureState = () => {
    scanAttemptRef.current += 1;
    videoProcessingSessionRef.current += 1;
    videoProcessingRef.current = null;
    completionNavigationRef.current = false;
    if (multiPhotoCameraTimerRef.current) {
      clearTimeout(multiPhotoCameraTimerRef.current);
      multiPhotoCameraTimerRef.current = null;
    }
    multiPhotoCameraInteractionRef.current?.cancel();
    multiPhotoCameraInteractionRef.current = null;
    pendingMultiPhotoCameraRef.current = false;
    setSelectedMode(null);
    setImages([]);
    setScanStatus("idle");
    setScanError(null);
    setCompatibilityPrompt(null);
    setLimitModal(null);
    setMultiPhotoPromptVisible(false);
    aiScanEntitlementCheckedRef.current = false;
    void clearAndroidScanState("clear_capture_state");
  };

  const selectedPropertyName =
    paramFileName ?? properties?.find((property) => property.id === selectedFileId)?.name ?? "Property";
  const selectedRoomName =
    paramRoomName ?? rooms?.find((room) => room.id === selectedRoomId)?.name ?? (newRoomName.trim() || "Room");

  const launchStep: ScanLaunchStep = !selectedFileId
    ? "property"
    : !selectedRoomId
      ? "room"
      : "type";

  const createRoomBeforeScan = async () => {
    const trimmedName = newRoomName.trim();
    if (!selectedFileId) { setScanError("Select a property first."); return; }
    if (!trimmedName) { setScanError("Enter a room name before scanning."); return; }
    if (!session?.user.id) { setScanError("You must be signed in to create a room."); return; }
    if (hasActiveRoomNameDuplicate(rooms ?? [], trimmedName)) {
      setScanError(DUPLICATE_ROOM_NAME_MESSAGE);
      requestAnimationFrame(() => roomNameInputRef.current?.focus());
      return;
    }

    const roomId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
    try {
      const { error: roomErr } = await supabase.from("inventory_rooms").insert({
        id: roomId,
        file_id: selectedFileId,
        user_id: session.user.id,
        name: trimmedName,
        sort_order: (rooms?.length ?? 0) + 1,
      });
      if (roomErr) {
        setScanError(formatRoomCreationError(roomErr));
        requestAnimationFrame(() => roomNameInputRef.current?.focus());
        return;
      }
    } catch (error) {
      setScanError(formatRoomCreationError(error));
      requestAnimationFrame(() => roomNameInputRef.current?.focus());
      return;
    }

    setSelectedRoomId(roomId);
    setScanError(null);
    queryClient.invalidateQueries({ queryKey: ["rooms", selectedFileId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", selectedFileId, session.user.id] });
  };

  const pickImages = async (
    mode: ScanMode | null = selectedMode,
    existingImageCount = images.length,
  ) => {
    if (!mode) return;
    if (!selectedFileId || !selectedRoomId) {
      setScanError("Choose a property and room before adding photos.");
      return;
    }
    const isMulti = mode === "multi_photo_room";
    const remainingMultiPhotos = MAX_MULTI_PHOTO_IMAGES - existingImageCount;
    if (isMulti && remainingMultiPhotos <= 0) {
      setMultiPhotoPromptVisible(true);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to continue.");
      return;
    }
    scanLog("image processing started", { source: "library", mode });
    setCompatibilityPrompt(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: isMulti,
      selectionLimit: isMulti ? remainingMultiPhotos : 1,
      quality: 1,
      base64: false,
    });
    scanLog("image picker returned", {
      source: "library",
      mode,
      canceled: result.canceled,
      assetCount: result.canceled ? 0 : result.assets.length,
      hasUri: !result.canceled && result.assets.some((asset) => !!asset.uri),
    });
    if (!result.canceled) {
      let picked: ScanEncodedImage[];
      try {
        picked = await normalizeLibraryPickerAssets(result.assets);
      } catch (error) {
        scanLog("library image normalization failed", {
          mode,
          assetCount: result.assets.length,
          message: errorMessage(error),
        });
        setScanError(SCAN_LIBRARY_IMAGE_CONVERSION_ERROR);
        return;
      }
      scanLog("photo captured", {
        source: "library",
        imageCount: picked.length,
        images: picked.map(safeImageDiagnostics),
      });
      if (picked.length === 0) {
        setScanError("Could not prepare the selected photo for scanning. Please try another image.");
        return;
      }
      if (isMulti) {
        setImages((current) => [...current, ...picked].slice(0, MAX_MULTI_PHOTO_IMAGES));
        if (picked.length > 0) setMultiPhotoPromptVisible(true);
      } else {
        const singleImage = picked.slice(0, 1);
        setImages(singleImage);
        await handleStartScan(mode, singleImage);
      }
    }
    if (result.canceled) {
      scanLog("image picker cancelled", { source: "library", mode });
    }
  };

  const takePhoto = async (
    mode: ScanMode | null = selectedMode,
    autoStart = false,
  ) => {
    if (!mode) return;
    if (!selectedFileId || !selectedRoomId) {
      setScanError("Choose a property and room before opening the camera.");
      return;
    }
    if (mode === "multi_photo_room" && images.length >= MAX_MULTI_PHOTO_IMAGES) {
      setMultiPhotoPromptVisible(true);
      return;
    }
    // On web the camera/file prompt must be opened directly from the mode-card
    // click. Awaiting a permission request first causes browsers to block it.
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow camera access to continue.");
        return;
      }
    }
    scanLog("image processing started", { source: "camera", mode, autoStart });
    setCompatibilityPrompt(null);
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      base64: false,
    });
    scanLog("image picker returned", {
      source: "camera",
      mode,
      canceled: result.canceled,
      assetCount: result.canceled ? 0 : result.assets.length,
      hasUri: !result.canceled && !!result.assets[0]?.uri,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const a = result.assets[0];
      const capturedImage = await imageFromPickerAsset(a, "camera", 0);
      if (!capturedImage) {
        setScanError("Could not prepare the captured photo for scanning. Please try again.");
        return;
      }
      const capturedImages = [capturedImage];
      scanLog("photo captured", {
        source: "camera",
        imageCount: capturedImages.length,
        autoStart,
        images: capturedImages.map(safeImageDiagnostics),
      });
      if (mode === "multi_photo_room") {
        setImages((current) => [...current, capturedImage].slice(0, MAX_MULTI_PHOTO_IMAGES));
        setMultiPhotoPromptVisible(true);
      } else {
        setImages(capturedImages);
      }
      if (autoStart) {
        await handleStartScan(mode, capturedImages);
      }
    } else if (!result.canceled) {
      setScanError("Could not prepare the captured photo for scanning. Please try again.");
    } else {
      scanLog("image picker cancelled", { source: "camera", mode });
    }
  };

  const openPendingMultiPhotoCamera = () => {
    if (!pendingMultiPhotoCameraRef.current || multiPhotoPromptVisible) return;
    pendingMultiPhotoCameraRef.current = false;

    if (selectedMode !== "multi_photo_room" || scanStatus !== "idle" || images.length >= MAX_MULTI_PHOTO_IMAGES) {
      if (images.length >= MAX_MULTI_PHOTO_IMAGES) setMultiPhotoPromptVisible(true);
      return;
    }

    if (multiPhotoCameraTimerRef.current) {
      clearTimeout(multiPhotoCameraTimerRef.current);
      multiPhotoCameraTimerRef.current = null;
    }
    multiPhotoCameraInteractionRef.current?.cancel();
    multiPhotoCameraInteractionRef.current = InteractionManager.runAfterInteractions(() => {
      multiPhotoCameraInteractionRef.current = null;
      multiPhotoCameraTimerRef.current = setTimeout(() => {
        multiPhotoCameraTimerRef.current = null;
        void takePhoto("multi_photo_room", false);
      }, Platform.OS === "ios" ? 650 : 450);
    });
  };

  useEffect(() => {
    openPendingMultiPhotoCamera();
  }, [multiPhotoPromptVisible]);

  const extractVideoFrames = async (videoUri: string, durationMs: number | null | undefined): Promise<ScanEncodedImage[]> => {
    const sourceDuration = durationMs && durationMs > 0 ? durationMs : VIDEO_SCAN_USED_DURATION_MS;
    const effectiveDuration = Math.min(sourceDuration, VIDEO_SCAN_USED_DURATION_MS);
    const frameCount = Math.max(1, Math.min(MAX_VIDEO_SCAN_FRAMES, Math.ceil(effectiveDuration / 1000)));
    const interval = effectiveDuration / frameCount;
    const frames: ScanEncodedImage[] = [];

    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.max(0, Math.min(effectiveDuration - 1, Math.round(index * interval + interval / 2)));
      const thumbnail = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time,
        quality: 0.8,
      });
      const fileSize = await localFileSize(thumbnail.uri);
      scanLog("selected asset metadata", {
        source: "video",
        assetIndex: index,
        uriScheme: uriScheme(thumbnail.uri),
        width: thumbnail.width ?? null,
        height: thumbnail.height ?? null,
        fileSize,
        mimeType: "image/jpeg",
      });
      frames.push({
        uri: thumbnail.uri,
        mimeType: "image/jpeg",
        width: thumbnail.width ?? null,
        height: thumbnail.height ?? null,
        fileSize,
      });
    }

    return frames;
  };

  const scanVideoAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    const videoKey = `${asset.uri}:${asset.duration ?? "unknown"}`;
    if (videoProcessingRef.current) {
      scanLog("video processing ignored because another video is in flight", {
        activeSessionId: videoProcessingRef.current.sessionId,
        sameVideo: videoProcessingRef.current.key === videoKey,
      });
      return;
    }

    const sessionId = videoProcessingSessionRef.current + 1;
    videoProcessingSessionRef.current = sessionId;
    videoProcessingRef.current = { key: videoKey, sessionId };
    setScanStatus("picking");
    setScanError(null);
    try {
      scanLog("video frame extraction started", {
        sessionId,
        durationMs: asset.duration ?? null,
        usedDurationMs: Math.min(asset.duration && asset.duration > 0 ? asset.duration : VIDEO_SCAN_USED_DURATION_MS, VIDEO_SCAN_USED_DURATION_MS),
        maxFrames: MAX_VIDEO_SCAN_FRAMES,
      });
      const frames = await extractVideoFrames(asset.uri, asset.duration);
      if (videoProcessingRef.current?.sessionId !== sessionId) return;
      scanLog("video frame extraction completed", {
        sessionId,
        frameCount: frames.length,
        images: frames.map(safeImageDiagnostics),
      });
      setImages(frames);
      await handleStartScan("video_room", frames);
    } catch (error) {
      if (__DEV__) console.error("[Scan] video frame extraction failed", error);
      setScanStatus("error");
      setScanError(error instanceof Error ? error.message : "Could not prepare video frames. Try a shorter or clearer video.");
    } finally {
      if (videoProcessingRef.current?.sessionId === sessionId) {
        videoProcessingRef.current = null;
      }
    }
  };

  const pickVideo = async () => {
    if (!selectedFileId || !selectedRoomId) {
      setScanError("Choose a property and room before adding video.");
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow photo library access to choose a video.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        quality: 0.8,
        allowsMultipleSelection: false,
      });
      scanLog("image picker returned", {
        source: "video_library",
        mode: "video_room",
        canceled: result.canceled,
        assetCount: result.canceled ? 0 : result.assets.length,
        hasUri: !result.canceled && !!result.assets[0]?.uri,
      });
      if (!result.canceled && result.assets[0]) {
        await scanVideoAsset(result.assets[0]);
      } else if (result.canceled) {
        scanLog("image picker cancelled", { source: "video_library", mode: "video_room" });
      } else {
        setScanError("Could not prepare the selected video. Please try another video.");
      }
    } catch (error) {
      scanLog("video library failed", { message: errorMessage(error) });
      setScanError("Could not open video gallery. Please try again.");
    }
  };

  const recordVideo = async () => {
    if (!selectedFileId || !selectedRoomId) {
      setScanError("Choose a property and room before recording video.");
      return;
    }
    setScanError(null);
    try {
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Allow camera access to record video.");
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["videos"],
        quality: 0.8,
        videoMaxDuration: VIDEO_SCAN_USED_SECONDS,
      });
      scanLog("image picker returned", {
        source: "video_camera",
        mode: "video_room",
        canceled: result.canceled,
        assetCount: result.canceled ? 0 : result.assets.length,
        hasUri: !result.canceled && !!result.assets[0]?.uri,
      });
      if (!result.canceled && result.assets[0]) {
        await scanVideoAsset(result.assets[0]);
      } else if (result.canceled) {
        scanLog("image picker cancelled", { source: "video_camera", mode: "video_room" });
      } else {
        setScanStatus("error");
        setScanError(VIDEO_SCAN_START_ERROR);
      }
    } catch (error) {
      scanLog("video camera failed", { message: errorMessage(error), platform: Platform.OS });
      setScanStatus("error");
      setScanError(VIDEO_SCAN_START_ERROR);
    }
  };

  const takeAnotherMultiPhoto = () => {
    if (images.length >= MAX_MULTI_PHOTO_IMAGES) {
      setMultiPhotoPromptVisible(true);
      return;
    }
    pendingMultiPhotoCameraRef.current = true;
    setScanError(null);
    setMultiPhotoPromptVisible(false);
  };

  const chooseScanMode = (
    mode: ScanMode,
    comingSoon?: boolean,
    source: "camera" | "library" = "camera",
  ) => {
    if (comingSoon) return;
    scanLog("mode selected", {
      mode,
      source,
      hasFileId: Boolean(selectedFileId),
      hasRoomId: Boolean(selectedRoomId),
      device: androidDeviceSummary(),
      knownProblemAndroidDevice: isKnownProblemAndroidDevice(),
    });
    if (!selectedFileId || !selectedRoomId) {
      setScanError("Choose a property and room before selecting a scan type.");
      return;
    }
    if (!enforce("ai_scan")) return;

    if (mode === "multi_photo_room" && isActiveMultiPhotoSession) {
      aiScanEntitlementCheckedRef.current = true;
      if (images.length >= MAX_MULTI_PHOTO_IMAGES) {
        setMultiPhotoPromptVisible(true);
      } else {
        void takePhoto("multi_photo_room", false);
      }
      return;
    }

    clearCaptureState();
    aiScanEntitlementCheckedRef.current = true;
    setSelectedMode(mode);
    if (source === "library") {
      if (mode === "video_room") {
        void pickVideo();
        return;
      }
      void pickImages(mode, 0);
      return;
    }
    if (mode === "video_room") {
      void recordVideo();
      return;
    }
    void takePhoto(mode, mode !== "multi_photo_room");
  };

  const libraryLabelForMode = (mode: ScanMode) => {
    if (mode === "multi_photo_room") return `Select up to ${MAX_MULTI_PHOTO_IMAGES} from Library`;
    if (mode === "video_room") return "Choose Existing Video";
    return "Choose from Library";
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
      estimatedCurrency: item.estimatedCurrency,
      valuationMarket: item.valuationMarket,
      estimatedAt: item.estimatedAt,
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

  const invalidateRoomQueries = (reason = "scan-review-save") => {
    // Invalidate with the full key (matches room/[id].tsx query key exactly).
    // Also use the 2-part prefix as a belt-and-suspenders fallback.
    const userId = session?.user.id;
    scanLog("room refresh/cache invalidation started", {
      stage: "room-refresh",
      reason,
      roomId: selectedRoomId,
      fileId: selectedFileId,
    });

    try {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId, userId] }),
        queryClient.invalidateQueries({ queryKey: ["items", selectedRoomId] }),
        queryClient.invalidateQueries({ queryKey: ["all-items"] }),
        queryClient.invalidateQueries({ queryKey: ["property-items", selectedFileId] }),
      ];

      void Promise.allSettled(invalidations).then((results) => {
        const failures = results.filter((result) => result.status === "rejected");
        if (failures.length > 0) {
          scanLog("room refresh/cache invalidation failed", {
            stage: "room-refresh",
            reason,
            failureCount: failures.length,
          });
          setScanSaveError(scanSaveErrorMessage("room-refresh", new Error("refresh failed")));
          return;
        }
        scanLog("room refresh/cache invalidation completed", {
          stage: "room-refresh",
          reason,
        });
      });
    } catch (error) {
      scanLog("room refresh/cache invalidation failed", {
        stage: "room-refresh",
        reason,
        message: errorMessage(error),
      });
      setScanSaveError(scanSaveErrorMessage("room-refresh", error));
    }
  };

  const showRecoverableScanError = (
    message: string,
    scanImages: ScanEncodedImage[],
    reason: string,
  ) => {
    const compatibilityReason = compatibilityReasonFor(scanImages, reason);
    scanLog("scan failure surfaced", {
      reason,
      message,
      canRetryCompatibility: Boolean(compatibilityReason),
      imageCount: scanImages.length,
    });
    setScanStatus("error");
    setScanError(compatibilityReason ? COMPATIBILITY_ERROR_COPY : message);
    setCompatibilityPrompt(
      compatibilityReason
        ? { reason: compatibilityReason, message: COMPATIBILITY_ERROR_COPY }
        : null,
    );
  };

  const handleStartScan = async (
    modeOverride?: ScanMode,
    imagesOverride?: ScanEncodedImage[],
    options: StartScanOptions = {},
  ) => {
    const mode = modeOverride ?? selectedMode;
    const scanImages = imagesOverride ?? images;
    if (!mode) { setScanError("Select a scan type above."); return; }
    if (!selectedFileId) { setScanError("Select a property."); return; }
    if (!selectedRoomId) { setScanError("Select a room."); return; }
    if (scanImages.length === 0) { setScanError("Add at least one photo."); return; }
    if (!aiScanEntitlementCheckedRef.current && !enforce("ai_scan")) return;

    setScanError(null);
    setCompatibilityPrompt(null);
    scanLog("scan start requested", {
      mode,
      imageCount: scanImages.length,
      compatibilityMode: Boolean(options.compatibilityMode),
      compatibilityReason: options.compatibilityReason ?? null,
      device: androidDeviceSummary(),
      images: scanImages.map(safeImageDiagnostics),
    });

    let imagesForScan = scanImages;
    const shouldUseCompatibility =
      options.compatibilityMode ||
      (Platform.OS === "android" && scanImages.some(isExtremeImage));

    if (shouldUseCompatibility) {
      const reason =
        options.compatibilityReason ??
        compatibilityReasonFor(scanImages, "extreme_image_size") ??
        "compatibility_mode";
      setScanStatus("picking");
      try {
        imagesForScan = await prepareImagesForCompatibility(scanImages, reason);
        setImages(imagesForScan);
      } catch (error) {
        showRecoverableScanError(
          "This phone had trouble preparing the photo. Try again in compatibility mode or choose a photo from gallery.",
          scanImages,
          "image_preparation_failed",
        );
        return;
      }
    }

    const input = {
      mode,
      fileId: selectedFileId,
      roomId: selectedRoomId,
      roomName: getDestRoomName(selectedRoomId) ?? undefined,
      images: imagesForScan,
    };

    const validationError = validateScanInput(input);
    if (validationError) { setScanError(validationError); return; }

    const scanAttemptId = scanAttemptRef.current + 1;
    scanAttemptRef.current = scanAttemptId;
    setScanStatus("scanning");
    void persistAndroidScanState("scan_started").catch((error) => {
      scanLog("android scan state persist failed", { message: errorMessage(error) });
    });

    let result;
    try {
      result = await runAiScan(input);
      if (scanAttemptRef.current !== scanAttemptId) return;
    } catch (error) {
      if (scanAttemptRef.current !== scanAttemptId) return;
      const message = error instanceof Error ? error.message : "Scan failed. Please try again.";
      const expectedNetworkFailure = /timed out|network request failed|network request timed out|failed to fetch/i.test(message);
      if (__DEV__ && !expectedNetworkFailure) console.error("[Scan] unexpected scan failure", error);
      showRecoverableScanError(
        expectedNetworkFailure ? "We couldn't complete the scan. Check your connection and try again." : message,
        imagesForScan,
        expectedNetworkFailure ? "scan_request_network_failure" : "scan_request_unexpected_failure",
      );
      return;
    }

    if (result.status === "not_configured") {
      setScanStatus("error");
      setScanError("AI scan is not available right now. Please try again later.");
      return;
    }

    if (result.status === "error") {
      const normalizedLimit = normalizeLimitError({
        status: result.httpStatus,
        errorCode: result.errorCode ?? (result.httpStatus === 402 ? "AI_SCAN_LIMIT_REACHED" : undefined),
        responseBody: result.responseBody,
      });
      if (normalizedLimit) {
        setScanStatus("idle");
        setScanError(null);
        setCompatibilityPrompt(null);
        setLimitModal(normalizedLimit);
        return;
      }
      const statusReason =
        result.httpStatus === 401 || result.httpStatus === 403
          ? "scan_auth_error"
          : result.httpStatus === 402
            ? "scan_entitlement_error"
            : result.errorCode ?? "scan_result_error";
      const message = result.errorMessage ?? "AI scan failed. No items were saved. Please try again.";
      if (result.httpStatus === 401 || result.httpStatus === 403) {
        setScanStatus("error");
        setScanError(message || "You must be signed in to scan items.");
        setCompatibilityPrompt(null);
        return;
      }
      showRecoverableScanError(message, imagesForScan, String(statusReason));
      return;
    }

    if (result.items.length === 0) {
      showRecoverableScanError(
        "No items were detected. Try a clearer shot or a different angle.",
        imagesForScan,
        "no_usable_items",
      );
      return;
    }

    try {
      // Attach source image thumbnails for review cards.
      // Use sourcePhotoIndex returned by Edge Function to route each item to the correct source photo.
      const fallbackUri = imagesForScan[0]?.uri ?? null;
      const itemsWithThumbs: ScanDetectedItem[] = result.items.map((item) => ({
        ...item,
        sourceImageUri:
          item.sourcePhotoIndex != null
            ? (imagesForScan[item.sourcePhotoIndex]?.uri ?? fallbackUri)
            : (item.sourceImageUri ?? fallbackUri),
      }));

      scanLog("scan auto-save started", {
        mode,
        itemCount: itemsWithThumbs.length,
        imageCount: imagesForScan.length,
        compatibilityMode: imagesForScan.some((image) => image.compatibilityPrepared),
      });
      setActiveSourcePhotoIdx(0);
      setActivePinIndex(null);
      setDetectedItems(itemsWithThumbs);
      setScanStatus("auto_saving");
      setCompatibilityPrompt(null);
      void clearAndroidScanState("scan_auto_saving");
      await saveDetectedItems(itemsWithThumbs, "auto");
    } catch (error) {
      scanLog("scan auto-save transition failed", {
        mode,
        imageCount: imagesForScan.length,
        itemCount: result.items.length,
        message: errorMessage(error),
      });
      showRecoverableScanError(
        "Coverly found scan results but had trouble saving them. Try again in compatibility mode or choose a photo from gallery.",
        imagesForScan,
        "auto_save_transition_failed",
      );
    }
  };

  const retryCurrentScan = () => {
    if (!selectedMode) return;
    if (selectedMode === "video_room" && images.length === 0) {
      void recordVideo();
      return;
    }
    void handleStartScan(selectedMode, images);
  };

  const retryCompatibilityScan = () => {
    if (!selectedMode) return;
    const reason = compatibilityPrompt?.reason ?? compatibilityReasonFor(images, "manual_retry") ?? "manual_retry";
    void handleStartScan(selectedMode, images, {
      compatibilityMode: true,
      compatibilityReason: reason,
    });
  };

  const chooseGalleryFallback = () => {
    if (!selectedMode) return;
    if (selectedMode === "video_room") {
      void pickVideo();
      return;
    }
    void pickImages();
  };

  const handleDiscardItem = (index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetectedItems((prev) => prev.filter((_, i) => i !== index));
    setReviewNameEdit((current) => {
      if (!current) return null;
      if (current.index === index) return null;
      if (current.index > index) return { ...current, index: current.index - 1 };
      return current;
    });
    setActivePinIndex((current) => {
      if (current == null) return current;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  };

  const updateDetectedItem = (index: number, patch: Partial<ScanDetectedItem>) => {
    setDetectedItems((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };

  const updateDetectedName = (index: number, value: string) => {
    const nextName = value.trimStart();
    if (!nextName.trim()) return;
    updateDetectedItem(index, { name: nextName });
  };

  const openReviewNameEdit = (index: number, currentName: string) => {
    setReviewNameEdit({ index, draft: currentName });
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const saveReviewNameEdit = () => {
    if (!reviewNameEdit) return;
    const nextName = reviewNameEdit.draft.trim();
    if (nextName) updateDetectedName(reviewNameEdit.index, nextName);
    setReviewNameEdit(null);
  };

  const updateDetectedQuantity = (index: number, value: string) => {
    const parsed = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
    if (!Number.isInteger(parsed) || parsed < 1) return;
    setDetectedItems((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, quantity: parsed, estimatedPrice: item.unitEstimatedPrice == null ? item.estimatedPrice : item.unitEstimatedPrice * parsed }
      : item));
  };

  const updateDetectedPrice = (index: number, value: string) => {
    const item = detectedItems[index];
    if (!item) return;
    const result = buildManualScanValuePatch(value, item.quantity, {
      countryCode: selectedProperty?.country_code,
      currencyCode: selectedProperty?.currency_code,
    });
    if (result.status === "invalid") return;
    updateDetectedItem(index, result.patch);
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
    const uploaded = await uploadScanPhoto(item.sourceImageUri, userId, dedupeKey, {
      fileId: selectedFileId,
    });
    if (!uploaded.ok) {
      const diagnostic = formatUploadFailure(uploaded);
      if (__DEV__) console.warn("[Scan] Photo upload diagnostic\n" + diagnostic);
      setScanSaveError(diagnostic);
      setSavingIds((prev) => { const n = new Set(prev); n.delete(index); return n; });
      return;
    }

    // Store the durable storage path in the DB, not the short-lived signed URL.
    const payload = buildPayload(item, uploaded.path);
    const { error } = await supabase.from("inventory_items").insert(payload);

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });

    if (error) {
      if (__DEV__) console.error("[Scan] Save item failed:", error.message);
      setScanSaveError(`Failed to save "${item.name}": ${error.message}`);
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      stageRecentItemBatch(selectedRoomId, [payload.id]);
      showToast(`${item.name} added`);
      invalidateRoomQueries();
      setDetectedItems((prev) => prev.filter((_, i) => i !== index));
    }
  };

  /** Save all items sequentially. On partial failure, keep unsaved items visible and report failures inline. */
  const saveDetectedItems = async (
    itemsToSave: ScanDetectedItem[],
    trigger: "auto" | "review" = "review",
  ) => {
    if (!selectedFileId || !selectedRoomId) return;
    if (saveAllInFlightRef.current || (trigger === "review" && scanStatus === "saving")) return;

    saveAllInFlightRef.current = true;
    setScanStatus(trigger === "auto" ? "auto_saving" : "saving");
    setScanSaveError(null);
    setPartialFailures([]);

    try {
      const userId = session?.user.id;
      if (!userId) {
        setScanStatus("reviewing");
        setScanSaveError("You must be signed in to save items.");
        return;
      }

      const selectedEntries = itemsToSave.map((item, index) => ({ item, index }));

      scanLog("scan review save started", {
        stage: "scan-review-save",
        mode: trigger === "auto" ? "auto-save" : "batch",
        selectedItemCount: selectedEntries.length,
      });

      if (selectedEntries.length === 0) {
        setScanStatus("reviewing");
        setScanSaveError("No detected items left to save.");
        return;
      }

    // Phase 1: Upload each unique source photo once.
    // Track successful uploads (photoIdx → URL) and failures (photoIdx in failedPhotoIndices).
    // Items whose photo failed to upload are treated as partial failures and never inserted.
    // Stores durable storage paths (not signed URLs) keyed by photo index.
      const photoUrlByIndex = new Map<number, string>();
      const failedPhotoIndices = new Set<number>();
      const uploadFailureByPhotoIndex = new Map<number, UploadFailure>();

      for (const { item, index: i } of selectedEntries) {
        const photoIdx = item.sourcePhotoIndex ?? 0;
        if (photoUrlByIndex.has(photoIdx) || failedPhotoIndices.has(photoIdx)) continue;

        scanLog("photo handling started", {
          stage: "photo-handling",
          itemIndex: i,
          sourcePhotoIndex: photoIdx,
          hasSourceImageUri: Boolean(item.sourceImageUri ?? images[photoIdx]?.uri),
        });

        const uri = item.sourceImageUri ?? images[photoIdx]?.uri ?? null;
        if (!uri) {
          failedPhotoIndices.add(photoIdx);
          scanLog("photo handling failed", {
            stage: "photo-handling",
            itemIndex: i,
            sourcePhotoIndex: photoIdx,
            message: "Source image is missing before upload",
          });
          continue;
        }

        const dedupeKey = `${photoIdx}:${uri}`;
        const uploaded = await uploadScanPhoto(uri, userId, dedupeKey, {
          fileId: selectedFileId,
        });
        // Store the durable path (not the short-lived displayUrl) in the DB map.
        if (uploaded.ok) {
          photoUrlByIndex.set(photoIdx, uploaded.path);
          scanLog("photo handling completed", {
            stage: "photo-handling",
            itemIndex: i,
            sourcePhotoIndex: photoIdx,
            hasStoragePath: true,
          });
        } else {
          failedPhotoIndices.add(photoIdx);
          uploadFailureByPhotoIndex.set(photoIdx, uploaded);
          if (__DEV__) console.warn("[Scan] Photo upload diagnostic\n" + formatUploadFailure(uploaded));
          scanLog("photo handling failed", {
            stage: "photo-handling",
            itemIndex: i,
            sourcePhotoIndex: photoIdx,
            message: uploaded.error,
          });
        }
      }

      const failures: PartialFailure[] = [];
      const savedIndices: number[] = [];
      const savedItemIds: string[] = [];

    // Phase 2: Sequential insert — skip items whose source photo failed to upload.
      for (const { item, index: i } of selectedEntries) {
        const photoIdx = item.sourcePhotoIndex ?? 0;

        if (failedPhotoIndices.has(photoIdx)) {
          const uploadFailure = uploadFailureByPhotoIndex.get(photoIdx);
          failures.push({
            itemName: item.name,
            error: uploadFailure
              ? scanSaveErrorMessage("storage-upload", uploadFailure.error, item.name)
              : scanSaveErrorMessage("photo-handling", new Error("Source image is missing before upload"), item.name),
          });
          continue;
        }

        scanLog("per-item save started", {
          stage: "scan-review-save",
          mode: "batch",
          itemIndex: i,
          itemCount: selectedEntries.length,
        });
        const uploadedUrl = photoUrlByIndex.get(photoIdx) ?? null;
        const payload = buildPayload(item, uploadedUrl);
        const insertResult = await insertScanReviewItem(payload, {
          itemIndex: i,
          itemCount: selectedEntries.length,
        });
        if (!insertResult.ok) {
          if (__DEV__) console.error("[Scan] Save all item failed:", errorMessage(insertResult.error));
          failures.push({
            itemName: item.name,
            error: scanSaveErrorMessage("db-insert", insertResult.error, item.name),
          });
        } else {
          savedIndices.push(i);
          savedItemIds.push(payload.id);
          scanLog("per-item save completed", {
            stage: "scan-review-save",
            mode: "batch",
            itemIndex: i,
            savedViaDuplicateKey: insertResult.savedViaDuplicateKey ?? false,
          });
        }
      }

      if (savedIndices.length > 0) {
        invalidateRoomQueries("save-all");
      }

    if (failures.length > 0) {
      // Keep unsaved items in review; surface partial failure list
      if (savedItemIds.length > 0) {
        stageRecentItemBatch(selectedRoomId, savedItemIds);
        showToast(`${savedItemIds.length} item${savedItemIds.length === 1 ? "" : "s"} saved`);
      }
      setDetectedItems(itemsToSave.filter((_, i) => !savedIndices.includes(i)));
      setPartialFailures(failures);
      setScanStatus("reviewing");
      setScanSaveError(
        trigger === "auto"
          ? "Some scan results could not be saved automatically. Review the remaining items and retry."
          : null,
      );
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    stageRecentItemBatch(selectedRoomId, savedItemIds);
    showToast(`${savedItemIds.length} item${savedItemIds.length === 1 ? "" : "s"} added to ${getDestRoomName() ?? "room"}`);
    const roomName = getDestRoomName() ?? "Room";
    if (!completionNavigationRef.current) {
      completionNavigationRef.current = true;
      router.replace({
        pathname: "/(tabs)/room/[id]",
        params: {
          id: selectedRoomId,
          name: roomName,
          fileId: selectedFileId,
          fileName: paramFileName ?? "Property",
          addedCount: String(savedItemIds.length),
          addedItemIds: savedItemIds.join(","),
          scrollToTop: `${selectedRoomId}:${Date.now()}`,
        },
      });
    }
    scanLog("save completed", {
      stage: "scan-review-save",
      mode: trigger === "auto" ? "auto-save" : "batch",
      savedItemCount: savedItemIds.length,
    });
    } catch (error) {
      scanLog("save failed", {
        stage: "scan-review-save",
        mode: trigger === "auto" ? "auto-save" : "batch",
        message: errorMessage(error),
      });
      setScanStatus("reviewing");
      setDetectedItems(itemsToSave);
      setScanSaveError(scanSaveErrorMessage("scan-review-save", error));
    } finally {
      saveAllInFlightRef.current = false;
    }
  };

  const handleSaveAll = async () => {
    await saveDetectedItems(detectedItems, "review");
  };

  const resetScan = () => {
    if (multiPhotoCameraTimerRef.current) {
      clearTimeout(multiPhotoCameraTimerRef.current);
      multiPhotoCameraTimerRef.current = null;
    }
    multiPhotoCameraInteractionRef.current?.cancel();
    multiPhotoCameraInteractionRef.current = null;
    pendingMultiPhotoCameraRef.current = false;
    setSelectedMode(null);
    setImages([]);
    setDetectedItems([]);
    setScanStatus("idle");
    setScanError(null);
    setCompatibilityPrompt(null);
    setLimitModal(null);
    setScanSaveError(null);
    setPartialFailures([]);
    setActivePinIndex(null);
    setActiveSourcePhotoIdx(0);
    aiScanEntitlementCheckedRef.current = false;
    clearScanPhotoUploadCache();
    void clearAndroidScanState("reset_scan");
  };

  const goBackToRoom = () => {
    if (completionNavigationRef.current) return;
    completionNavigationRef.current = true;
    if (!selectedRoomId) {
      if (selectedFileId) {
        router.replace({
          pathname: "/(tabs)/property/[id]",
          params: { id: selectedFileId, name: paramFileName ?? "Property" },
        });
        return;
      }
      router.back();
      return;
    }
    router.replace({
      pathname: "/(tabs)/room/[id]",
      params: {
        id: selectedRoomId,
        name: getDestRoomName() ?? "Room",
        fileId: selectedFileId,
        fileName: paramFileName ?? "Property",
      },
    });
  };

  const returnToScanTypeSelection = () => {
    clearCaptureState();
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

  if (scanStatus === "auto_saving") {
    return (
      <>
        <Stack.Screen options={{ title: "Saving items…", headerShown: false }} />
        <View style={[styles.preparingScreen, { backgroundColor: colors.background }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to room"
            onPress={goBackToRoom}
            style={styles.preparingCancelButton}
          >
            <Feather name="x" size={18} color={colors.primary} />
            <Text style={[styles.preparingCancelText, { color: colors.primary }]}>Back to room</Text>
          </Pressable>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.preparingTitle, { color: colors.foreground }]}>Saving items</Text>
          <Text style={[styles.preparingText, { color: colors.mutedForeground }]}>Adding detected items to your room…</Text>
        </View>
      </>
    );
  }

  if ((scanStatus === "reviewing" || scanStatus === "saving") && detectedItems.length === 0) {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Review detected items",
            headerLeft: () => (
              <Pressable onPress={goBackToRoom} hitSlop={8} style={{ padding: 4 }}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            ),
          }}
        />
        <View style={[styles.preparingScreen, { backgroundColor: colors.background }]}>
          <EmptyState
            icon="check-square"
            title="No items left to save"
            subtitle="Scan again to capture another photo, or go back to the room."
          />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <Pressable
              onPress={resetScan}
              style={[styles.photoBtn, { borderColor: colors.border, backgroundColor: colors.card, borderRadius: colors.radius }]}
            >
              <Feather name="camera" size={17} color={colors.primary} />
              <Text style={[styles.photoBtnText, { color: colors.primary }]}>Scan again</Text>
            </Pressable>
            <Pressable
              onPress={goBackToRoom}
              style={[styles.photoBtn, { borderColor: colors.primary, backgroundColor: colors.primary, borderRadius: colors.radius }]}
            >
              <Feather name="arrow-left" size={17} color={colors.primaryForeground} />
              <Text style={[styles.photoBtnText, { color: colors.primaryForeground }]}>Back to room</Text>
            </Pressable>
          </View>
        </View>
      </>
    );
  }

  if ((scanStatus === "reviewing" || scanStatus === "saving") && detectedItems.length > 0) {
    const remainingCount = detectedItems.length;
    // Pin map layout — computed once per render of the review screen
    const PHOTO_W = Dimensions.get("window").width - 32;
    const PHOTO_H = Math.round(PHOTO_W * 0.72);
    const PIN_R = 11;
    const REVIEW_THUMB_W = 76;
    const REVIEW_THUMB_H = 110;
    const REVIEW_THUMB_PIN_R = 7;
    const sourceUri = images[activeSourcePhotoIdx]?.uri ?? null;
    const activeSourceImage = images[activeSourcePhotoIdx];
    const visiblePins = detectedItems
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.pin != null && (item.sourcePhotoIndex ?? 0) === activeSourcePhotoIdx);

    return (
      <>
        <Stack.Screen
          options={{
            title: "Review detected items",
            headerLeft: () => (
              <Pressable onPress={goBackToRoom} hitSlop={8} style={{ padding: 4 }}>
                <Feather name="arrow-left" size={20} color={colors.mutedForeground} />
              </Pressable>
            ),
            headerRight: () => (
              <Pressable onPress={resetScan} hitSlop={8} style={{ padding: 4 }}>
                <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Scan again</Text>
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
                      <ExpandableImage uri={sourceUri} style={{ width: PHOTO_W, height: PHOTO_H }} contentFit="cover" viewerTitle="Scan source photo" />
                      {/* Numbered pin markers */}
                      {visiblePins.map(({ item, idx }) => {
                        const position = pinMarkerPosition({
                          pin: { x: item.pin!.x / 100, y: item.pin!.y / 100 },
                          container: { w: PHOTO_W, h: PHOTO_H },
                          image: { w: activeSourceImage?.width ?? PHOTO_W, h: activeSourceImage?.height ?? PHOTO_H },
                          fit: "cover",
                          marker: { w: PIN_R * 2, h: PIN_R * 2 },
                        });
                        return (
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
                              left: position?.left ?? 0,
                              top: position?.top ?? 0,
                              width: PIN_R * 2, height: PIN_R * 2, borderRadius: PIN_R,
                              backgroundColor: activePinIndex === idx ? "#1D9E75" : "#334155",
                              transform: [{ scale: activePinIndex === idx ? 1.2 : 1 }],
                            },
                          ]}
                        >
                          <Text style={pinStyles.pinLabel}>{idx + 1}</Text>
                        </Pressable>
                        );
                      })}
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
                {detectedItems.some((detected) => detected.pricingSupportTier === "preview") ? (
                  <View style={[revStyles.failureBanner, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                    <Feather name="info" size={14} color={colors.primary} />
                    <Text style={{ fontSize: 12, color: colors.foreground, flex: 1 }}>Local pricing support is in preview. Review estimates before relying on them.</Text>
                  </View>
                ) : null}
              </View>
            }
            renderItem={({ item, index }) => {
              const isSaving = savingIds.has(index);
              const badge = confidenceBadgeStyle(item.confidence);
              const isActive = activePinIndex === index;
              const sourceImage = images[item.sourcePhotoIndex ?? 0];
              const thumbPinPosition = item.pin
                ? pinMarkerPosition({
                    pin: { x: item.pin.x / 100, y: item.pin.y / 100 },
                    container: { w: REVIEW_THUMB_W, h: REVIEW_THUMB_H },
                    image: { w: sourceImage?.width ?? REVIEW_THUMB_W, h: sourceImage?.height ?? REVIEW_THUMB_H },
                    fit: "cover",
                    marker: { w: REVIEW_THUMB_PIN_R * 2, h: REVIEW_THUMB_PIN_R * 2 },
                  })
                : null;
              return (
                <View
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
                  <Pressable
                    onPress={() => {
                      setActivePinIndex(isActive ? null : index);
                      // Switch the source photo panel to this card's source image so the
                      // matching pin is always visible after tapping a card.
                      setActiveSourcePhotoIdx(item.sourcePhotoIndex ?? 0);
                    }}
                    style={[
                      revStyles.thumbWrap,
                      { borderTopLeftRadius: colors.radius, borderBottomLeftRadius: colors.radius },
                    ]}
                  >
                    <ExpandableImage
                      uri={item.sourceImageUri}
                      style={[revStyles.thumb, { borderTopLeftRadius: colors.radius, borderBottomLeftRadius: colors.radius }]}
                      contentFit="cover"
                      placeholderIcon="image"
                      placeholderIconSize={18}
                      placeholderIconColor={colors.border}
                      placeholderBackgroundColor={colors.secondary}
                      viewerTitle={item.name}
                    />
                    {/* Pin number badge — only shown when item has a pin */}
                    {item.pin != null && (
                      <>
                        <View
                          pointerEvents="none"
                          style={[
                            pinStyles.cardPin,
                            {
                              left: thumbPinPosition?.left ?? 0,
                              top: thumbPinPosition?.top ?? 0,
                              width: REVIEW_THUMB_PIN_R * 2,
                              height: REVIEW_THUMB_PIN_R * 2,
                              borderRadius: REVIEW_THUMB_PIN_R,
                              backgroundColor: isActive ? "#1D9E75" : "#334155",
                              transform: [{ scale: isActive ? 1.15 : 1 }],
                            },
                          ]}
                        >
                          <Text style={pinStyles.cardPinLabel}>{index + 1}</Text>
                        </View>
                        <View style={[pinStyles.cardBadge, { backgroundColor: isActive ? "#1D9E75" : "#334155" }]}>
                          <Text style={pinStyles.cardBadgeLabel}>{index + 1}</Text>
                        </View>
                      </>
                    )}
                  </Pressable>

                  {/* Card body */}
                  <View style={revStyles.cardBody}>
                    <View style={revStyles.reviewEditHeader}>
                      <Text style={[revStyles.reviewEditKicker, { color: colors.mutedForeground }]}>
                        AI result
                      </Text>
                      <Text style={[revStyles.reviewEditHint, { color: colors.mutedForeground }]}>
                        Tap fields to correct before saving
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Edit detected item name"
                      onPress={() => openReviewNameEdit(index, item.name)}
                      disabled={isSaving || scanStatus === "saving"}
                      style={({ pressed }) => [
                        revStyles.reviewNameInput,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                          opacity: pressed || isSaving || scanStatus === "saving" ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Text style={[revStyles.reviewNameText, { color: colors.foreground }]} numberOfLines={2}>
                        {item.name}
                      </Text>
                    </Pressable>

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

                    <View style={revStyles.reviewEditGrid}>
                      <View style={revStyles.reviewEditField}>
                        <Text style={[revStyles.reviewEditLabel, { color: colors.mutedForeground }]}>Qty</Text>
                        <TextInput
                          accessibilityLabel="Detected item quantity"
                          value={String(item.quantity ?? 1)}
                          onChangeText={(value) => updateDetectedQuantity(index, value)}
                          keyboardType="numeric"
                          inputMode="numeric"
                          selectTextOnFocus
                          disableFullscreenUI
                          returnKeyType="done"
                          editable={!isSaving && scanStatus !== "saving"}
                          style={[
                            revStyles.reviewSmallInput,
                            {
                              color: colors.foreground,
                              borderColor: colors.border,
                              backgroundColor: colors.background,
                            },
                          ]}
                        />
                      </View>
                      <View style={[revStyles.reviewEditField, { flex: 1.7 }]}>
                        <Text style={[revStyles.reviewEditLabel, { color: colors.mutedForeground }]}>
                          {(item.quantity ?? 1) > 1 ? "Each price" : "Price"}
                        </Text>
                        <TextInput
                          accessibilityLabel="Detected item replacement price"
                          value={
                            item.unitEstimatedPrice != null || item.estimatedPrice != null
                              ? String(item.unitEstimatedPrice ?? item.estimatedPrice)
                              : ""
                          }
                          onChangeText={(value) => updateDetectedPrice(index, value)}
                          keyboardType="decimal-pad"
                          inputMode="decimal"
                          placeholder="0"
                          placeholderTextColor={colors.mutedForeground}
                          selectTextOnFocus
                          disableFullscreenUI
                          returnKeyType="done"
                          editable={!isSaving && scanStatus !== "saving"}
                          style={[
                            revStyles.reviewSmallInput,
                            {
                              color: colors.foreground,
                              borderColor: colors.border,
                              backgroundColor: colors.background,
                            },
                          ]}
                        />
                      </View>
                    </View>
                    {item.estimatedPrice != null ? (
                      <Text style={[revStyles.price, { color: colors.foreground }]}>
                        {formatCurrencyFull((item.unitEstimatedPrice ?? item.estimatedPrice) * (item.quantity ?? 1), item.estimatedCurrency ?? selectedProperty?.currency_code ?? "NZD", selectedProperty?.currency_code)}
                      </Text>
                    ) : null}
                  </View>

                  {/* Actions */}
                  <View style={revStyles.actionCol}>
                    <Pressable
                      onPress={() => handleDiscardItem(index)}
                      disabled={isSaving}
                      accessibilityRole="button"
                      accessibilityLabel={`Discard ${item.name}`}
                      hitSlop={4}
                      style={({ pressed }) => [
                        revStyles.actionBtn,
                        { backgroundColor: "#FEF2F2", borderRadius: 8, opacity: pressed || isSaving ? 0.6 : 1 },
                      ]}
                    >
                      <Feather name="trash-2" size={15} color="#B91C1C" />
                    </Pressable>
                  </View>
                </View>
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
              disabled={scanStatus === "saving" || remainingCount === 0}
              style={({ pressed }) => [
                revStyles.saveAllBtn,
                {
                  backgroundColor: scanStatus === "saving" || remainingCount === 0 ? colors.muted : colors.primary,
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
                  : remainingCount === 0
                    ? "No items to save"
                    : remainingCount === 1
                    ? "Save item"
                    : `Save all ${remainingCount} items`}
              </Text>
            </Pressable>
          </View>
          <Modal
            visible={reviewNameEdit != null}
            transparent
            animationType="fade"
            onRequestClose={() => setReviewNameEdit(null)}
          >
            <KeyboardAvoidingView
              style={revStyles.reviewNameModalRoot}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <Pressable style={revStyles.reviewNameModalBackdrop} onPress={() => setReviewNameEdit(null)}>
                <Pressable
                  accessibilityRole="none"
                  onPress={(event) => event.stopPropagation()}
                  style={[
                    revStyles.reviewNameModalCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius + 4,
                    },
                  ]}
                >
                  <Text style={[revStyles.reviewNameModalTitle, { color: colors.foreground }]}>
                    Edit item name
                  </Text>
                  <TextInput
                    autoFocus
                    accessibilityLabel="Detected item name"
                    value={reviewNameEdit?.draft ?? ""}
                    onChangeText={(draft) =>
                      setReviewNameEdit((current) => (current ? { ...current, draft } : current))
                    }
                    disableFullscreenUI
                    returnKeyType="done"
                    onSubmitEditing={saveReviewNameEdit}
                    style={[
                      revStyles.reviewNameModalInput,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.primary,
                      },
                    ]}
                  />
                  <View style={revStyles.reviewNameModalActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setReviewNameEdit(null)}
                      style={({ pressed }) => [
                        revStyles.reviewNameModalButton,
                        { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Text style={[revStyles.reviewNameModalButtonText, { color: colors.foreground }]}>
                        Cancel
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={saveReviewNameEdit}
                      style={({ pressed }) => [
                        revStyles.reviewNameModalButton,
                        {
                          backgroundColor: colors.primary,
                          borderColor: colors.primary,
                          opacity: pressed ? 0.78 : 1,
                        },
                      ]}
                    >
                      <Text style={[revStyles.reviewNameModalButtonText, { color: colors.primaryForeground }]}>
                        Save
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>
        </View>
      </>
    );
  }

  // ── Main scan screen ──────────────────────────────────────────────────────────

  const isScanning = scanStatus === "scanning";
  const isPreparingVideo = scanStatus === "picking";

  // ── Scanning overlay — full screen while AI processes ─────────────────────
  if (isScanning && !limitModal) {
    return (
      <>
        <Stack.Screen options={{ title: "Scanning…", headerShown: false }} />
        <AiScanningOverlay images={images} onCancel={returnToScanTypeSelection} />
      </>
    );
  }

  if (isPreparingVideo) {
    return (
      <>
        <Stack.Screen options={{ title: "Preparing video…", headerShown: false }} />
        <View style={[styles.preparingScreen, { backgroundColor: colors.background }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel video preparation"
            onPress={returnToScanTypeSelection}
            style={styles.preparingCancelButton}
          >
            <Feather name="x" size={18} color={colors.primary} />
            <Text style={[styles.preparingCancelText, { color: colors.primary }]}>Cancel</Text>
          </Pressable>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.preparingTitle, { color: colors.foreground }]}>Preparing video frames</Text>
          <Text style={[styles.preparingText, { color: colors.mutedForeground }]}>
            Coverly is scanning frames from the first {VIDEO_SCAN_USED_SECONDS} seconds of your video.
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Scan items",
          headerBackVisible: false,
          headerLeft: () => (
            <ContextBackButton
              label={paramRoomName ?? paramFileName ?? "Home"}
              onPress={() => {
                if (paramRoomId) {
                  router.replace({
                    pathname: "/(tabs)/room/[id]",
                    params: {
                      id: paramRoomId,
                      name: paramRoomName ?? "Room",
                      fileId: paramFileId ?? "",
                      fileName: paramFileName ?? "Property",
                    },
                  });
                } else if (paramFileId) {
                  router.replace({
                    pathname: "/(tabs)/property/[id]",
                    params: { id: paramFileId, name: paramFileName ?? "Property" },
                  });
                } else {
                  router.replace("/(tabs)");
                }
              }}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {launchStep === "property" && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PROPERTY</Text>
            {propertiesLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (properties ?? []).length === 0 ? (
              <EmptyState
                icon="home"
                title="Create a property first"
                subtitle="Scans need a property before items can be filed."
              />
            ) : (
              (properties ?? []).map((property) => (
                <Pressable
                  key={property.id}
                  onPress={() => {
                    clearCaptureState();
                    setSelectedFileId(property.id);
                    setSelectedRoomId("");
                    setNewRoomName("");
                  }}
                  style={({ pressed }) => [
                    styles.selectionRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.86 : 1,
                    },
                  ]}
                >
                  <View style={[styles.modeIcon, { backgroundColor: colors.secondary }]}>
                    <Feather name="home" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.selectionTitle, { color: colors.foreground }]}>{property.name}</Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              ))
            )}
          </View>
        )}

        {launchStep === "room" && (
          <View style={styles.section}>
            <View style={styles.stepHeader}>
              {!paramFileId && (
                <Pressable
                  onPress={() => {
                    clearCaptureState();
                    setSelectedFileId("");
                    setSelectedRoomId("");
                    setNewRoomName("");
                  }}
                  hitSlop={8}
                  style={styles.stepBackButton}
                >
                  <Feather name="chevron-left" size={18} color={colors.primary} />
                  <Text style={[styles.stepBackText, { color: colors.primary }]}>Property</Text>
                </Pressable>
              )}
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                ROOM IN {selectedPropertyName.toUpperCase()}
              </Text>
            </View>

            {roomsLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (rooms ?? []).length === 0 ? (
              <View style={[styles.emptyRoomCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                <EmptyState
                  icon="box"
                  title="Create a room before scanning"
                  subtitle="This scan will save items into the room you create."
                />
                <TextInput
                  ref={roomNameInputRef}
                  value={newRoomName}
                  onChangeText={setNewRoomName}
                  placeholder="e.g. Living Room, Kitchen"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  style={[
                    styles.roomInput,
                    {
                      borderColor: newRoomName.trim() ? colors.primary : colors.border,
                      borderRadius: colors.radius,
                      color: colors.foreground,
                      backgroundColor: colors.muted,
                    },
                  ]}
                />
                <Pressable
                  onPress={() => void createRoomBeforeScan()}
                  disabled={!newRoomName.trim()}
                  style={({ pressed }) => [
                    styles.scanBtn,
                    {
                      backgroundColor: !newRoomName.trim() ? colors.muted : colors.primary,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Feather name="plus" size={18} color={!newRoomName.trim() ? colors.mutedForeground : colors.primaryForeground} />
                  <Text style={[styles.scanBtnText, { color: !newRoomName.trim() ? colors.mutedForeground : colors.primaryForeground }]}>
                    Create room
                  </Text>
                </Pressable>
              </View>
            ) : (
              (rooms ?? []).map((room) => (
                <Pressable
                  key={room.id}
                  onPress={() => {
                    clearCaptureState();
                    setSelectedRoomId(room.id);
                    setNewRoomName("");
                  }}
                  style={({ pressed }) => [
                    styles.selectionRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.86 : 1,
                    },
                  ]}
                >
                  <View style={[styles.modeIcon, { backgroundColor: colors.secondary }]}>
                    <Feather name="box" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.selectionTitle, { color: colors.foreground }]}>{room.name}</Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              ))
            )}
          </View>
        )}

        {/* Scan mode cards */}
        {launchStep === "type" && !isActiveMultiPhotoSession && (
        <View style={styles.section}>
          <View style={styles.stepHeader}>
            {!paramRoomId && (
              <Pressable
                onPress={() => {
                  clearCaptureState();
                  setSelectedRoomId("");
                }}
                hitSlop={8}
                style={styles.stepBackButton}
              >
                <Feather name="chevron-left" size={18} color={colors.primary} />
                <Text style={[styles.stepBackText, { color: colors.primary }]}>Room</Text>
              </Pressable>
            )}
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              SCAN TYPE FOR {selectedRoomName.toUpperCase()}
            </Text>
          </View>
          {SCAN_MODES.map((m) => {
            const palette = SCAN_MODE_COLORS[m.mode];
            const active =
              selectedMode === m.mode &&
              (scanStatus === "scanning" || scanStatus === "saving");
            return (
              <Pressable
                key={m.mode}
                accessibilityRole="button"
                accessibilityState={{ busy: active, disabled: m.comingSoon }}
                onPress={() => chooseScanMode(m.mode, m.comingSoon)}
                style={({ pressed }) => [
                  styles.modeCard,
                  {
                    backgroundColor: palette.fill,
                    borderColor: active ? palette.icon : palette.border,
                    borderRadius: colors.radius,
                    opacity: m.comingSoon ? 0.5 : pressed ? 0.86 : 1,
                  },
                ]}
              >
                <View style={[styles.modeIcon, { backgroundColor: palette.chip }]}>
                  <Feather name={m.icon} size={20} color={palette.icon} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[styles.modeTitle, { color: colors.foreground }]}>
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
                  <Text style={[styles.modeSub, { color: colors.mutedForeground }]}>
                    {m.subtitle}
                  </Text>
                  <Text style={[styles.modeCredit, { color: colors.mutedForeground }]}>
                    {m.creditLabel}
                  </Text>
                </View>
                {!m.comingSoon ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={libraryLabelForMode(m.mode)}
                    hitSlop={6}
                    onPress={(event) => {
                      event.stopPropagation();
                      chooseScanMode(m.mode, m.comingSoon, "library");
                    }}
                    style={({ pressed }) => [
                      styles.modeLibraryButton,
                      {
                        backgroundColor: palette.chip,
                        opacity: pressed ? 0.65 : 1,
                      },
                    ]}
                  >
                    <Feather name="upload" size={17} color={palette.icon} />
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        )}

        {/* Location */}
        {false && selectedMode && selectedMode !== "video_room" && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>LOCATION</Text>

            {paramFileId ? (
              <View style={{ gap: 4 }}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Property</Text>
                <View style={[styles.chip, { backgroundColor: colors.primary, alignSelf: "flex-start" }]}>
                  <Text style={[styles.chipText, { color: colors.primaryForeground }]}>
                    {paramFileName ?? properties?.find((property) => property.id === paramFileId)?.name ?? "Loading property…"}
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

        {/* Inline error */}
        {scanError && (
          <View style={[styles.errorCard, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5", borderRadius: colors.radius }]}>
            <View style={styles.errorHeader}>
              <Feather name="alert-circle" size={15} color="#DC2626" />
              <Text style={[styles.errorText, { color: "#991B1B" }]}>{scanError}</Text>
            </View>
            {scanStatus === "error" && selectedMode && (images.length > 0 || selectedMode === "video_room") ? (
              <View style={styles.errorActions}>
                <Pressable
                  onPress={retryCurrentScan}
                  style={({ pressed }) => [
                    styles.errorActionButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: "#FCA5A5",
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.76 : 1,
                    },
                  ]}
                >
                  <Feather name="refresh-cw" size={14} color="#991B1B" />
                  <Text style={[styles.errorActionText, { color: "#991B1B" }]}>Retry</Text>
                </Pressable>
                {compatibilityPrompt ? (
                  <Pressable
                    onPress={retryCompatibilityScan}
                    style={({ pressed }) => [
                      styles.errorActionButton,
                      {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: pressed ? 0.82 : 1,
                      },
                    ]}
                  >
                    <Feather name="tool" size={14} color={colors.primaryForeground} />
                    <Text style={[styles.errorActionText, { color: colors.primaryForeground }]}>Compatibility mode</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={chooseGalleryFallback}
                  style={({ pressed }) => [
                    styles.errorActionButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: "#FCA5A5",
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.76 : 1,
                    },
                  ]}
                >
                  <Feather name="image" size={14} color="#991B1B" />
                  <Text style={[styles.errorActionText, { color: "#991B1B" }]}>Choose from gallery</Text>
                </Pressable>
                <Pressable
                  onPress={returnToScanTypeSelection}
                  style={({ pressed }) => [
                    styles.errorActionButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.76 : 1,
                    },
                  ]}
                >
                  <Feather name="x" size={14} color={colors.primary} />
                  <Text style={[styles.errorActionText, { color: colors.primary }]}>Choose another scan type</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}

        {false ? (
          <Pressable>
            {false ? (
              <>
                <ActivityIndicator color={colors.primaryForeground} />
                <Text style={[styles.scanBtnText, { color: colors.primaryForeground }]}>Scanning…</Text>
              </>
            ) : (
              <>
                <Feather name="zap" size={18} color={colors.mutedForeground} />
                <Text style={[styles.scanBtnText, { color: colors.mutedForeground }]}>
                  
                </Text>
              </>
            )}
          </Pressable>
        ) : null}

      </ScrollView>

      <Modal
        visible={multiPhotoPromptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMultiPhotoPromptVisible(false)}
      >
        <View style={styles.captureModalBackdrop}>
          <View
            style={[
              styles.captureModalCard,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <View style={[styles.captureModalIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="check" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.captureModalTitle, { color: colors.foreground }]}>Photo added</Text>
            <Text style={[styles.captureModalSubtitle, { color: colors.mutedForeground }]}>
              {images.length >= MAX_MULTI_PHOTO_IMAGES
                ? `All ${MAX_MULTI_PHOTO_IMAGES} photos are ready to scan.`
                : `${images.length} of ${MAX_MULTI_PHOTO_IMAGES} photos added. Capture another angle or scan this set now.`}
            </Text>

            {images.length < MAX_MULTI_PHOTO_IMAGES ? (
              <>
                <Pressable
                  onPress={takeAnotherMultiPhoto}
                  style={({ pressed }) => [
                    styles.captureModalButton,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Feather name="camera" size={18} color={colors.primaryForeground} />
                  <Text style={[styles.captureModalButtonText, { color: colors.primaryForeground }]}>Take another photo</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMultiPhotoPromptVisible(false);
                    void pickImages("multi_photo_room");
                  }}
                  style={({ pressed }) => [
                    styles.captureModalButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Feather name="image" size={18} color={colors.primary} />
                  <Text style={[styles.captureModalButtonText, { color: colors.primary }]}>
                    Select up to {MAX_MULTI_PHOTO_IMAGES - images.length} from Library
                  </Text>
                </Pressable>
              </>
            ) : null}

            <Pressable
              onPress={() => {
                setMultiPhotoPromptVisible(false);
                void handleStartScan("multi_photo_room");
              }}
              style={({ pressed }) => [
                styles.captureModalButton,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Feather name="check-circle" size={18} color={colors.primary} />
              <Text style={[styles.captureModalButtonText, { color: colors.primary }]}>Done</Text>
            </Pressable>
            <Pressable
              onPress={returnToScanTypeSelection}
              style={({ pressed }) => [styles.captureModalCancel, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.captureModalCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <LimitReachedModal
        visible={!!limitModal}
        content={limitModal}
        onPrimary={() => {
          returnToScanTypeSelection();
          router.push({ pathname: "/upgrade", params: { feature: "ai_scan" } } as Href);
        }}
        onSecondary={() => {
          returnToScanTypeSelection();
          router.push({
            pathname: "/(tabs)/add-item",
            params: {
              fileId: selectedFileId,
              roomId: selectedRoomId,
              fileName: selectedPropertyName,
              roomName: selectedRoomName,
            },
          } as Href);
        }}
        onDismiss={returnToScanTypeSelection}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 20 },
  section: { gap: 12 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  stepHeader: { gap: 8 },
  stepBackButton: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 2 },
  stepBackText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  selectionRow: { borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  selectionTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyRoomCard: { borderWidth: 1, padding: 16, gap: 12 },
  roomInput: {
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  modeCard: { borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  modeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeLibraryButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
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
  preparingScreen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  preparingCancelButton: {
    position: "absolute",
    top: 52,
    right: 18,
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  preparingCancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  preparingTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  preparingText: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center" },
  videoHelper: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  errorCard: { borderWidth: 1, padding: 12, gap: 10 },
  errorHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, flex: 1 },
  errorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  errorActionButton: {
    minHeight: 38,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  errorActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, marginTop: 4 },
  scanBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  captureModalBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(15, 23, 42, 0.48)",
  },
  captureModalCard: {
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
    alignItems: "center",
    borderWidth: 1,
    padding: 24,
    gap: 12,
  },
  captureModalIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  captureModalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  captureModalSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 6,
  },
  captureModalButton: {
    width: "100%",
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  captureModalButtonText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  captureModalCancel: { paddingHorizontal: 14, paddingVertical: 8 },
  captureModalCancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

const revStyles = StyleSheet.create({
  headerNote: { fontSize: 13, fontFamily: "Inter_400Regular" },
  failureBanner: { borderWidth: 1, borderRadius: 8, padding: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  card: { borderWidth: 1, flexDirection: "row", alignItems: "stretch", overflow: "hidden" },
  thumbWrap: { position: "relative", width: 76, height: 110, overflow: "hidden" },
  thumb: { width: 76, height: 110 },
  thumbPlaceholder: { width: 76, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, padding: 10, gap: 4 },
  itemName: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  reviewEditHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  reviewEditKicker: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.7 },
  reviewEditHint: { flex: 1, fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "right" },
  reviewNameInput: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
    justifyContent: "center",
  },
  reviewNameText: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: "Inter_600SemiBold",
  },
  reviewEditGrid: { flexDirection: "row", gap: 8, alignItems: "flex-end", marginTop: 2 },
  reviewEditField: { flex: 1, gap: 4 },
  reviewEditLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  reviewSmallInput: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  reviewNameModalRoot: { flex: 1 },
  reviewNameModalBackdrop: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.46)",
  },
  reviewNameModalCard: {
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
  reviewNameModalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  reviewNameModalInput: {
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  reviewNameModalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 9 },
  reviewNameModalButton: {
    minWidth: 92,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  reviewNameModalButtonText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
  cardPin: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 1.5,
  },
  cardPinLabel: {
    fontSize: 7,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: 9,
  },
});
