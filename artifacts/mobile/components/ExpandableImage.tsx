import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { ImageContentFit } from "expo-image";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { ImageViewerModal } from "@/components/ImageViewerModal";

const THUMB_PIN_SIZE = 22;

interface ExpandableImageProps {
  uri: string | null | undefined;
  /** Size/layout style applied to both the image container and the placeholder. */
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  /** Feather icon name to show when uri is null/empty. Defaults to "image". */
  placeholderIcon?: keyof typeof Feather.glyphMap;
  /** Icon size for placeholder. Defaults to 22. */
  placeholderIconSize?: number;
  /** Icon color for placeholder. */
  placeholderIconColor?: string;
  /** Background color for placeholder container. */
  placeholderBackgroundColor?: string;
  /**
   * Full list of image URIs to show in the lightbox. When provided the
   * lightbox opens at `initialPhotoIndex` and the user can swipe through all
   * photos. When omitted only `uri` is shown.
   */
  allUris?: string[];
  /**
   * Index within `allUris` that this image corresponds to. Defaults to 0.
   * Only used when `allUris` is provided.
   */
  initialPhotoIndex?: number;
  /**
   * Optional pin marker to show over the image. Coordinates must be
   * normalized 0–1 (as stored in inventory_items.image_pin).
   * Shown on both the thumbnail and the expanded lightbox view.
   */
  pin?: { x: number; y: number } | null;
  pinColor?: string;
}

/**
 * Drop-in replacement for expo-image's <Image> that adds a tap-to-fullscreen
 * lightbox when a URI is present.
 *
 * Pass `allUris` to enable swipe-through of multiple photos in the lightbox.
 * Pass `pin` (normalized 0–1 coords) to show an AI-location pin marker on
 * both the thumbnail and in the expanded lightbox.
 * When uri is null/undefined the component renders a non-interactive placeholder
 * icon — no tap target is added.
 */
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
  pinColor = "#085041",
}: ExpandableImageProps) {
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const lightboxUris: string[] =
    allUris && allUris.length > 0 ? allUris : uri ? [uri] : [];

  const hasPin =
    !!pin && isFinite(pin.x) && isFinite(pin.y) && dims.w > 0 && dims.h > 0;

  if (!uri) {
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
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit={contentFit}
        />
        {hasPin && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: pin!.x * dims.w - THUMB_PIN_SIZE / 2,
              top: pin!.y * dims.h - THUMB_PIN_SIZE,
            }}
          >
            <Feather
              name="map-pin"
              size={THUMB_PIN_SIZE}
              color={pinColor ?? "#1D9E75"}
              style={{
                textShadowColor: "rgba(0,0,0,0.55)",
                textShadowRadius: 3,
                textShadowOffset: { width: 0, height: 1 },
              }}
            />
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
