import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { ImageContentFit } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { DraggablePinLayer } from "@/components/DraggablePinLayer";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { ItemPinMarker, PIN_MARKER_SIZE } from "@/components/ItemPinMarker";
import { isDisplayableUri } from "@/lib/storage-helpers";

const IMAGE_LOAD_RETRY_DELAYS_MS = [350, 900];

interface ExpandableImageProps {
  uri: string | null | undefined;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  placeholderIcon?: keyof typeof Feather.glyphMap;
  placeholderIconSize?: number;
  placeholderIconColor?: string;
  placeholderBackgroundColor?: string;
  allUris?: string[];
  initialPhotoIndex?: number;
  /**
   * Pin marker in 0–1 normalised coords (as stored in inventory_items.image_pin).
   * The TIP of the pin-drop marker aligns with this coordinate.
   */
  pin?: { x: number; y: number } | null;
  pinColor?: string;
  disabled?: boolean;
  /**
   * When provided, the pin becomes draggable (long-press → drag → release).
   * Called with the new normalised coords on drop; throw to signal failure
   * (the pin will revert to its previous position automatically).
   * Only pass this on editable screens — read-only contexts should omit it.
   */
  onReposition?: (x: number, y: number) => Promise<void>;
  onPermanentError?: () => void;
}

export function ExpandableImage({
  uri,
  style,
  contentFit = "cover",
  placeholderIcon = "image",
  placeholderIconSize = 22,
  placeholderIconColor = "#94a3b8",
  placeholderBackgroundColor = "#f1f5f9",
  allUris,
  initialPhotoIndex = 0,
  pin,
  pinColor = "#1D9E75",
  disabled = false,
  onReposition,
  onPermanentError,
}: ExpandableImageProps) {
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hasError, setHasError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const suppressNextPress = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimeout = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  };

  // Reset error state whenever the URI changes so a new valid URL gets a fresh load attempt.
  useEffect(() => {
    clearRetryTimeout();
    setHasError(false);
    setLoadAttempt(0);
    return clearRetryTimeout;
  }, [uri]);

  const lightboxUris: string[] =
    allUris && allUris.length > 0 ? allUris : uri ? [uri] : [];

  const { w: pinW, h: pinH } = PIN_MARKER_SIZE.sm;
  const hasPin =
    !!pin && isFinite(pin.x) && isFinite(pin.y) && dims.w > 0 && dims.h > 0;

  // Guard: only render <Image> for URIs that expo-image can actually load.
  // Raw Supabase storage paths (e.g. "userId/scan-xxx.jpg") are NOT displayable
  // and must never reach expo-image — it fails silently and may cache the failure.
  const canDisplay = isDisplayableUri(uri) && !hasError;

  if (!canDisplay) {
    if (uri && !isDisplayableUri(uri)) {
      if (__DEV__) console.warn(
        "[ExpandableImage] received non-displayable URI, showing placeholder",
        { hasUri: true },
      );
    }
    return (
      <View
        style={[
          style,
          {
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: placeholderBackgroundColor,
            overflow: "hidden",
          },
        ]}
      >
        <Feather
          name={placeholderIcon}
          size={placeholderIconSize}
          color={placeholderIconColor}
        />
      </View>
    );
  }

  // At this point canDisplay is true → isDisplayableUri(uri) passed → uri is a real string.
  // TypeScript can't infer this without a type guard, so we assert here.
  const safeUri = uri as string;
  const imageRenderKey = `${safeUri}:${loadAttempt}`;

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={(event) => {
          event.stopPropagation();
          if (suppressNextPress.current) {
            suppressNextPress.current = false;
            return;
          }
          setLightboxVisible(true);
        }}
        style={[style, { overflow: "hidden" }]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setDims({ w: width, h: height });
        }}
      >
        {/*
         * key={safeUri} forces expo-image to fully remount when the URI changes.
         * This prevents cached failure states from a previous (invalid) URI
         * from blocking the display of a newly resolved signed URL.
         */}
        <Image
          key={imageRenderKey}
          source={{ uri: safeUri }}
          recyclingKey={imageRenderKey}
          cachePolicy={loadAttempt > 0 ? "none" : "memory-disk"}
          style={{ width: "100%", height: "100%" }}
          contentFit={contentFit}
          onLoad={() => {
            clearRetryTimeout();
            if (__DEV__) console.info("[ExpandableImage] loaded", { attempt: loadAttempt });
          }}
          onError={(e) => {
            if (__DEV__) console.warn("[ExpandableImage] error loading", {
              attempt: loadAttempt,
              error: (e as { error?: unknown }).error,
            });
            const retryDelayMs = IMAGE_LOAD_RETRY_DELAYS_MS[loadAttempt];
            if (retryDelayMs != null) {
              clearRetryTimeout();
              retryTimeoutRef.current = setTimeout(() => {
                retryTimeoutRef.current = null;
                setLoadAttempt((attempt) => attempt + 1);
              }, retryDelayMs);
              return;
            }
            setHasError(true);
            onPermanentError?.();
          }}
        />
        {hasPin && onReposition ? (
          <DraggablePinLayer
            pin={pin!}
            dims={dims}
            onReposition={onReposition}
            onTap={() => setLightboxVisible(true)}
            pinColor={pinColor}
          />
        ) : hasPin ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: pin!.x * dims.w - pinW / 2,
              top: pin!.y * dims.h - pinH,
            }}
          >
            <ItemPinMarker size="sm" color={pinColor} />
          </View>
        ) : null}
      </Pressable>
      <ImageViewerModal
        uris={lightboxUris}
        initialIndex={initialPhotoIndex}
        visible={lightboxVisible}
        onClose={() => setLightboxVisible(false)}
        pin={pin}
        pinPhotoIndex={initialPhotoIndex}
        pinColor={pinColor}
        onPinReposition={onReposition}
        onPermanentError={onPermanentError}
      />
    </>
  );
}
