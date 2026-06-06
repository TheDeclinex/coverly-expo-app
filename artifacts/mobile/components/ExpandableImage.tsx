import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { ImageContentFit } from "expo-image";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { ImageViewerModal } from "@/components/ImageViewerModal";

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
}

/**
 * Drop-in replacement for expo-image's <Image> that adds a tap-to-fullscreen
 * lightbox when a URI is present.
 *
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
}: ExpandableImageProps) {
  const [lightboxVisible, setLightboxVisible] = useState(false);

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
      >
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit={contentFit}
        />
      </Pressable>
      <ImageViewerModal
        uri={uri}
        visible={lightboxVisible}
        onClose={() => setLightboxVisible(false)}
      />
    </>
  );
}
