import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { ImageContentFit } from "expo-image";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { ImageViewerModal } from "@/components/ImageViewerModal";
import { ItemPinMarker, PIN_MARKER_SIZE } from "@/components/ItemPinMarker";
import { isDisplayableUri } from "@/lib/storage-helpers";

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
}: ExpandableImageProps) {
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hasError, setHasError] = useState(false);

  // Reset error state whenever the URI changes so a new valid URL gets a fresh load attempt.
  useEffect(() => {
    setHasError(false);
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
      console.warn(
        "[ExpandableImage] received non-displayable URI (raw storage path?), showing placeholder:",
        uri.slice(0, 60),
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

  return (
    <>
      <Pressable
        onPress={() => setLightboxVisible(true)}
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
          key={safeUri}
          source={{ uri: safeUri }}
          style={{ width: "100%", height: "100%" }}
          contentFit={contentFit}
          onLoad={() => {
            console.log("[ExpandableImage] ✓ loaded:", safeUri.slice(0, 70));
          }}
          onError={(e) => {
            console.warn(
              "[ExpandableImage] ✗ error loading:",
              safeUri.slice(0, 70),
              (e as { error?: unknown }).error,
            );
            setHasError(true);
          }}
        />
        {hasPin && (
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
        )}
      </Pressable>
      <ImageViewerModal
        uris={lightboxUris}
        initialIndex={initialPhotoIndex}
        visible={lightboxVisible}
        onClose={() => setLightboxVisible(false)}
        pin={pin}
        pinPhotoIndex={initialPhotoIndex}
        pinColor={pinColor}
      />
    </>
  );
}
