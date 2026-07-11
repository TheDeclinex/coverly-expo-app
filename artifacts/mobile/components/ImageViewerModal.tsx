import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import type { ImageLoadEventData } from "expo-image";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DraggablePinLayer } from "@/components/DraggablePinLayer";
import { ItemPinMarker, PIN_MARKER_SIZE } from "@/components/ItemPinMarker";
import { ReliableImage } from "@/components/ReliableImage";
import { useColors } from "@/hooks/useColors";
import { pinBelongsToPhoto, viewerAllowsPinEditing } from "@/lib/image-viewer-config";
import { pinMarkerPosition, renderedImageRect, type NormalizedPin } from "@/lib/pin-position";
import {
  beginViewerPinEdit,
  cancelViewerPinEdit,
  commitViewerPinDraft,
  createViewerPinState,
  syncIncomingViewerPin,
  updateViewerPinDraft,
} from "@/lib/viewer-pin-state";

interface ImageViewerModalProps {
  uris: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
  title?: string;
  pin?: NormalizedPin | null;
  pinPhotoIndex?: number;
  pinColor?: string;
  onPinReposition?: (x: number, y: number) => Promise<void>;
  onPermanentError?: () => void;
}

function ImagePage({
  uri,
  pageWidth,
  cardHeight,
  pin,
  draftPin,
  pinColor,
  editingPin,
  onDraftPin,
  onBackdropPress,
  onPermanentError,
}: {
  uri: string;
  pageWidth: number;
  cardHeight: number;
  pin?: NormalizedPin | null;
  draftPin: NormalizedPin;
  pinColor: string;
  editingPin: boolean;
  onDraftPin: (pin: NormalizedPin) => void;
  onBackdropPress: () => void;
  onPermanentError?: () => void;
}) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const cardWidth = Math.max(1, pageWidth - 32);
  const activePin = editingPin ? draftPin : pin;
  const marker = PIN_MARKER_SIZE.lg;
  const rect = useMemo(
    () => imgSize ? renderedImageRect({ container: { w: cardWidth, h: cardHeight }, image: imgSize, fit: "contain" }) : null,
    [cardHeight, cardWidth, imgSize],
  );
  const pinPosition = useMemo(
    () => activePin && imgSize
      ? pinMarkerPosition({
          pin: activePin,
          container: { w: cardWidth, h: cardHeight },
          image: imgSize,
          fit: "contain",
          marker,
        })
      : null,
    [activePin, cardHeight, cardWidth, imgSize, marker],
  );

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close image viewer" onPress={onBackdropPress} style={[styles.page, { width: pageWidth }]}>
      <Pressable onPress={(event) => event.stopPropagation()} style={[styles.imageCard, { width: cardWidth, height: cardHeight }]}>
        {error ? (
          <View style={styles.errorState}>
            <Feather name="image" size={44} color="#94A3B8" />
            <Text style={styles.errorText}>Image unavailable</Text>
          </View>
        ) : (
          <>
            <ReliableImage
              uri={uri}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              onLoad={(event: ImageLoadEventData) => {
                setLoading(false);
                if (event.source.width > 0 && event.source.height > 0) {
                  setImgSize({ w: event.source.width, h: event.source.height });
                }
              }}
              onPermanentError={() => {
                setLoading(false);
                setError(true);
                onPermanentError?.();
              }}
            />
            {loading ? <View style={styles.loading}><ActivityIndicator size="large" color="#64748B" /></View> : null}
          </>
        )}

        {editingPin && rect && !error ? (
          <View style={[styles.pinFrame, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]}>
            <DraggablePinLayer
              pin={draftPin}
              dims={{ w: rect.w, h: rect.h }}
              onReposition={async (x, y) => onDraftPin({ x, y })}
              onTap={() => undefined}
              pinColor={pinColor}
              markerSize="lg"
              activationDelayMs={0}
            />
          </View>
        ) : pinPosition && !error ? (
          <View pointerEvents="none" style={[styles.pinMarker, { left: pinPosition.left, top: pinPosition.top }]}>
            <ItemPinMarker size="lg" color={pinColor} />
          </View>
        ) : null}
      </Pressable>
    </Pressable>
  );
}

export function ImageViewerModal({
  uris,
  initialIndex = 0,
  visible,
  onClose,
  title = "Image preview",
  pin,
  pinPhotoIndex,
  pinColor = "#1D9E75",
  onPinReposition,
  onPermanentError,
}: ImageViewerModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const safeInitial = Math.max(0, Math.min(initialIndex, Math.max(0, uris.length - 1)));
  const [currentIndex, setCurrentIndex] = useState(safeInitial);
  const [pinState, setPinState] = useState(() => createViewerPinState(pin));
  const [savingPin, setSavingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList<string>>(null);
  const wasVisibleRef = useRef(false);
  const viewerPin = pinState.committedPin;
  const draftPin = pinState.draftPin;
  const editingPin = pinState.editing;
  const pinIndex = pinPhotoIndex ?? initialIndex;
  const canEditPin = viewerAllowsPinEditing({ pin: viewerPin, hasSaveHandler: Boolean(onPinReposition), currentIndex, pinPhotoIndex: pinIndex });
  const cardHeight = Math.max(220, height - insets.top - insets.bottom - 170);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return;
    }
    if (wasVisibleRef.current) return;
    wasVisibleRef.current = true;
    setCurrentIndex(safeInitial);
    setPinState(createViewerPinState(pin));
    setPinError(null);
    progress.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [pin?.x, pin?.y, progress, reduceMotion, safeInitial, visible]);

  useEffect(() => {
    if (!visible) return;
    setPinState((current) => syncIncomingViewerPin(current, pin));
  }, [editingPin, pin?.x, pin?.y, visible]);

  const close = useCallback(() => {
    if (editingPin) {
      setPinState((current) => cancelViewerPinEdit(current));
      setPinError(null);
      return;
    }
    if (reduceMotion) {
      onClose();
      return;
    }
    Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [editingPin, onClose, progress, reduceMotion]);

  const savePin = async () => {
    if (!onPinReposition || savingPin) return;
    setSavingPin(true);
    setPinError(null);
    try {
      await onPinReposition(draftPin.x, draftPin.y);
      setPinState((current) => commitViewerPinDraft(current));
    } catch (error) {
      setPinError(error instanceof Error ? error.message : "Could not save pin position.");
    } finally {
      setSavingPin(false);
    }
  };

  const scrollToIndex = (index: number) => {
    if (editingPin) return;
    const target = Math.max(0, Math.min(index, uris.length - 1));
    flatListRef.current?.scrollToIndex({ index: target, animated: true });
    setCurrentIndex(target);
  };

  if (uris.length === 0) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent accessibilityViewIsModal>
      <View style={styles.modalRoot} accessibilityLabel={title}>
        <BlurView intensity={35} tint="default" style={StyleSheet.absoluteFill} />
        <Animated.View style={[styles.dim, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.58] }) }]} />
        <Animated.View
          style={[
            styles.viewer,
            {
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
              opacity: progress,
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
            },
          ]}
        >
          <View style={styles.topBar}>
            <View style={[styles.titlePill, { backgroundColor: colors.card }]}>
              <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
              {uris.length > 1 ? <Text style={[styles.count, { color: colors.mutedForeground }]}>{currentIndex + 1} / {uris.length}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={editingPin ? "Cancel pin movement" : "Close image viewer"} onPress={close} hitSlop={10} style={[styles.close, { backgroundColor: colors.card }]}>
              <Feather name="x" size={21} color={colors.foreground} />
            </Pressable>
          </View>

          <FlatList
            ref={flatListRef}
            style={styles.gallery}
            data={uris}
            horizontal
            pagingEnabled
            scrollEnabled={!editingPin && uris.length > 1}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={safeInitial}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(event) => setCurrentIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
            keyExtractor={(_, index) => String(index)}
            renderItem={({ item, index }) => (
              <ImagePage
                uri={item}
                pageWidth={width}
                cardHeight={cardHeight}
                pin={pinBelongsToPhoto(index, pinIndex) ? viewerPin : null}
                draftPin={draftPin}
                pinColor={pinColor}
                editingPin={editingPin && index === pinIndex}
                onDraftPin={(nextPin) => setPinState((current) => updateViewerPinDraft(current, nextPin))}
                onBackdropPress={close}
                onPermanentError={onPermanentError}
              />
            )}
          />

          <View style={styles.actions}>
            {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
            {editingPin ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel pin movement" onPress={close} style={[styles.actionSecondary, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.actionText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Save pin position" disabled={savingPin} onPress={() => void savePin()} style={[styles.actionPrimary, { backgroundColor: colors.primary, opacity: savingPin ? 0.65 : 1 }]}>
                  {savingPin ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Done</Text>}
                </Pressable>
              </>
            ) : canEditPin ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Move item pin" onPress={() => setPinState((current) => beginViewerPinEdit(current))} style={[styles.movePin, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="move" size={16} color={colors.primary} />
                <Text style={[styles.actionText, { color: colors.primary }]}>Move pin</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "#0F172A" },
  viewer: { flex: 1 },
  topBar: { minHeight: 48, paddingHorizontal: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  titlePill: { minHeight: 40, maxWidth: "78%", paddingHorizontal: 14, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 10, shadowColor: "#0F172A", shadowOpacity: 0.12, shadowRadius: 12, elevation: 3 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  count: { fontSize: 12, fontFamily: "Inter_500Medium" },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#0F172A", shadowOpacity: 0.12, shadowRadius: 12, elevation: 3 },
  page: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  gallery: { flex: 1 },
  imageCard: { borderRadius: 22, overflow: "hidden", backgroundColor: "rgba(248,250,252,0.96)", shadowColor: "#0F172A", shadowOpacity: 0.24, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  errorState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  errorText: { color: "#64748B", fontSize: 14, fontFamily: "Inter_500Medium" },
  pinFrame: { position: "absolute" },
  pinMarker: { position: "absolute" },
  actions: { minHeight: 54, paddingHorizontal: 16, paddingTop: 8, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, flexWrap: "wrap" },
  movePin: { minHeight: 42, borderWidth: 1, borderRadius: 21, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 7 },
  actionSecondary: { minWidth: 110, minHeight: 44, borderWidth: 1, borderRadius: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  actionPrimary: { minWidth: 110, minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  actionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pinError: { width: "100%", textAlign: "center", color: "#B91C1C", fontSize: 12, fontFamily: "Inter_500Medium" },
});
