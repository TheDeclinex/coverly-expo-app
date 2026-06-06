import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useCallback, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SCREEN_WIDTH = Dimensions.get("window").width;

interface ImageViewerModalProps {
  uris: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
}

/**
 * Full-screen lightbox modal for viewing one or more images.
 * When multiple URIs are provided the user can swipe left/right or tap the
 * arrow buttons to navigate. Dot indicators show position in the set.
 * Single-photo usage hides all navigation UI.
 */
export function ImageViewerModal({
  uris,
  initialIndex = 0,
  visible,
  onClose,
}: ImageViewerModalProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const flatListRef = useRef<FlatList<string>>(null);

  const safeInitial = Math.max(0, Math.min(initialIndex, uris.length - 1));
  const multi = uris.length > 1;

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
      transparent
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
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={({ item: uri }) => (
            <Pressable
              style={styles.page}
              onPress={onClose}
            >
              <Image
                source={{ uri }}
                style={styles.image}
                contentFit="contain"
                pointerEvents="none"
              />
            </Pressable>
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
                color={currentIndex === 0 ? "rgba(255,255,255,0.25)" : "#FFFFFF"}
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
    backgroundColor: "rgba(0,0,0,0.93)",
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
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
