import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { ImageLoadEventData } from "expo-image";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ItemPinMarker, PIN_MARKER_RADIUS } from "@/components/ItemPinMarker";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

interface ImageViewerModalProps {
  uris: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
  /**
   * Optional pin to overlay on one photo. Coordinates are 0–1 (normalized),
   * matching what is stored in inventory_items.image_pin.
   * Position is computed accurately from the natural image dimensions using
   * the expo-image onLoad event so it accounts for contentFit="contain" letterboxing.
   */
  pin?: { x: number; y: number } | null;
  /** Which URI index the pin belongs to. Defaults to initialIndex. */
  pinPhotoIndex?: number;
  pinColor?: string;
}

function ImagePage({
  uri,
  onClose,
  pin,
  pinColor = "#1D9E75",
}: {
  uri: string;
  onClose: () => void;
  pin?: { x: number; y: number } | null;
  pinColor?: string;
}) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Radius of the "lg" marker for center-anchoring
  const r = PIN_MARKER_RADIUS.lg;

  /**
   * Compute the screen position of the pin for contentFit="contain".
   * The image is letterboxed — we calculate the actual rendered rect first,
   * then place the circular marker so its center aligns with the pin point.
   */
  const pinPos = useMemo(() => {
    if (!pin || !imgSize) return null;
    // Scale to fit the screen while keeping the full image visible
    const scale = Math.min(SCREEN_W / imgSize.w, SCREEN_H / imgSize.h);
    const rw = imgSize.w * scale;   // rendered image width
    const rh = imgSize.h * scale;   // rendered image height
    const ox = (SCREEN_W - rw) / 2; // horizontal letterbox offset
    const oy = (SCREEN_H - rh) / 2; // vertical letterbox offset
    return {
      // Center of circular marker at the pin point
      left: ox + pin.x * rw - r,
      top: oy + pin.y * rh - r,
    };
  }, [pin, imgSize, r]);

  return (
    <Pressable style={styles.page} onPress={onClose}>
      {error ? (
        <View style={styles.errorState}>
          <Feather name="image" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={styles.errorText}>Image unavailable</Text>
        </View>
      ) : (
        <>
          <Image
            source={{ uri }}
            style={styles.image}
            contentFit="contain"
            onLoad={(e: ImageLoadEventData) => {
              setLoading(false);
              const { width, height } = e.source;
              if (width > 0 && height > 0) setImgSize({ w: width, h: height });
            }}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
          {loading && (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="rgba(255,255,255,0.7)" />
            </View>
          )}
        </>
      )}
      {pinPos && !error && (
        <View
          pointerEvents="none"
          style={[styles.pinWrap, { left: pinPos.left, top: pinPos.top }]}
        >
          <ItemPinMarker size="lg" color={pinColor} />
        </View>
      )}
    </Pressable>
  );
}

/**
 * Full-screen lightbox modal for viewing one or more images.
 * When multiple URIs are provided the user can swipe left/right or tap the
 * arrow buttons to navigate. Dot indicators show position in the set.
 * Single-photo usage hides all navigation UI.
 *
 * Pass `pin` + `pinPhotoIndex` to show a position marker on a specific photo.
 * Pin coordinates must be normalized 0–1 (as stored in inventory_items.image_pin).
 */
export function ImageViewerModal({
  uris,
  initialIndex = 0,
  visible,
  onClose,
  pin,
  pinPhotoIndex,
  pinColor = "#1D9E75",
}: ImageViewerModalProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const flatListRef = useRef<FlatList<string>>(null);

  const safeInitial = Math.max(0, Math.min(initialIndex, uris.length - 1));
  const multi = uris.length > 1;
  const pinIdx = pinPhotoIndex ?? initialIndex;

  const scrollToIndex = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(index, uris.length - 1));
      flatListRef.current?.scrollToIndex({ index: target, animated: true });
      setCurrentIndex(target);
    },
    [uris.length],
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  if (uris.length === 0) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar hidden />
      <View style={styles.backdrop}>
        <FlatList
          ref={flatListRef}
          data={uris}
          keyExtractor={(_, i) => String(i)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={safeInitial}
          style={{ flex: 1 }}
          getItemLayout={(_, index) => ({
            length: SCREEN_W,
            offset: SCREEN_W * index,
            index,
          })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={({ item: uri, index }) => (
            <ImagePage
              uri={uri}
              onClose={onClose}
              pin={index === pinIdx ? pin : undefined}
              pinColor={pinColor}
            />
          )}
        />

        {multi && (
          <>
            <Pressable
              onPress={() => scrollToIndex(currentIndex - 1)}
              style={[styles.arrowBtn, styles.arrowLeft, { top: "50%" }]}
              hitSlop={12}
              disabled={currentIndex === 0}
            >
              <Feather
                name="chevron-left"
                size={26}
                color={
                  currentIndex === 0 ? "rgba(255,255,255,0.25)" : "#FFFFFF"
                }
              />
            </Pressable>
            <Pressable
              onPress={() => scrollToIndex(currentIndex + 1)}
              style={[styles.arrowBtn, styles.arrowRight, { top: "50%" }]}
              hitSlop={12}
              disabled={currentIndex === uris.length - 1}
            >
              <Feather
                name="chevron-right"
                size={26}
                color={
                  currentIndex === uris.length - 1
                    ? "rgba(255,255,255,0.25)"
                    : "#FFFFFF"
                }
              />
            </Pressable>

            <View style={[styles.dots, { bottom: insets.bottom + 20 }]}>
              {uris.map((_, i) => (
                <Pressable key={i} onPress={() => scrollToIndex(i)} hitSlop={6}>
                  <View
                    style={[
                      styles.dot,
                      i === currentIndex ? styles.dotActive : styles.dotInactive,
                    ]}
                  />
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Pressable
          onPress={onClose}
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          hitSlop={12}
        >
          <Feather name="x" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#000",
  },
  page: {
    width: SCREEN_W,
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  errorState: {
    alignItems: "center",
    gap: 12,
  },
  errorText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  pinWrap: {
    position: "absolute",
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  arrowBtn: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.40)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: -20,
  },
  arrowLeft: {
    left: 12,
  },
  arrowRight: {
    right: 12,
  },
  dots: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: "#FFFFFF",
  },
  dotInactive: {
    backgroundColor: "rgba(255,255,255,0.35)",
  },
});
