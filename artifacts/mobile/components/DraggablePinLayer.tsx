import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ItemPinMarker, PIN_MARKER_SIZE } from "@/components/ItemPinMarker";

const LONG_PRESS_DELAY_MS = 450;
const MOVE_CANCEL_PX = 8;
const HIT_PADDING = 14;

interface DraggablePinLayerProps {
  pin: { x: number; y: number };
  dims: { w: number; h: number };
  /**
   * Called on finger release with the new normalised coords (0–1).
   * Throw to signal failure — the pin will revert to its previous position.
   */
  onReposition: (x: number, y: number) => Promise<void>;
  /**
   * Forwarded to the parent when the user taps the pin without long-pressing
   * (so the lightbox still opens on a quick tap).
   */
  onTap?: () => void;
  pinColor?: string;
}

/**
 * Absolutely-positioned layer that renders an interactive pin marker over an
 * image. Activates on long-press → drag → release to move the pin.
 *
 * Placement: position this inside an image container that already knows its
 * pixel dimensions so normalised ↔ pixel conversion is correct.
 */
export function DraggablePinLayer({
  pin,
  dims,
  onReposition,
  onTap,
  pinColor = "#1D9E75",
}: DraggablePinLayerProps) {
  const { w: pinW, h: pinH } = PIN_MARKER_SIZE.sm;

  const [localPin, setLocalPin] = useState(pin);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Refs for stable access inside panResponder (avoids stale closures)
  const dragActive = useRef(false);
  const isSavingRef = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartPin = useRef({ x: pin.x, y: pin.y });
  const dimsRef = useRef(dims);
  const onRepositionRef = useRef(onReposition);
  const onTapRef = useRef(onTap);
  const localPinRef = useRef(localPin);

  useEffect(() => { dimsRef.current = dims; }, [dims]);
  useEffect(() => { onRepositionRef.current = onReposition; }, [onReposition]);
  useEffect(() => { onTapRef.current = onTap; }, [onTap]);
  useEffect(() => { localPinRef.current = localPin; }, [localPin]);

  // Sync with pin prop when it changes (e.g. after query refetch),
  // but never overwrite optimistic state during an active drag or save.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dragActive.current && !isSavingRef.current) {
      setLocalPin(pin);
      localPinRef.current = pin;
    }
  }, [pin.x, pin.y]);

  const panResponder = useRef(
    PanResponder.create({
      // Capture every touch that starts on this View.
      // This prevents the parent Pressable from firing onPress when the user
      // long-presses; quick taps are forwarded via onTap inside onPanResponderRelease.
      onStartShouldSetPanResponder: () => !isSavingRef.current,
      onMoveShouldSetPanResponder: () => dragActive.current,

      onPanResponderGrant: () => {
        dragStartPin.current = { ...localPinRef.current };
        longPressTimer.current = setTimeout(() => {
          dragActive.current = true;
          setIsDragging(true);
          Animated.spring(scaleAnim, {
            toValue: 1.35,
            useNativeDriver: true,
            speed: 40,
            bounciness: 6,
          }).start();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }, LONG_PRESS_DELAY_MS);
      },

      onPanResponderMove: (_, gestureState) => {
        if (!dragActive.current) {
          // Cancel long-press if finger drifts too far before activation
          if (
            Math.abs(gestureState.dx) > MOVE_CANCEL_PX ||
            Math.abs(gestureState.dy) > MOVE_CANCEL_PX
          ) {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }
          return;
        }
        const d = dimsRef.current;
        if (d.w === 0 || d.h === 0) return;
        const newX = Math.max(0, Math.min(1, dragStartPin.current.x + gestureState.dx / d.w));
        const newY = Math.max(0, Math.min(1, dragStartPin.current.y + gestureState.dy / d.h));
        setLocalPin({ x: newX, y: newY });
        localPinRef.current = { x: newX, y: newY };
      },

      onPanResponderRelease: (_, gestureState) => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }

        if (!dragActive.current) {
          // Short tap on pin → open lightbox (forward to parent)
          if (Math.abs(gestureState.dx) < 5 && Math.abs(gestureState.dy) < 5) {
            onTapRef.current?.();
          }
          return;
        }

        dragActive.current = false;
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          speed: 30,
        }).start();
        setIsDragging(false);

        const d = dimsRef.current;
        const finalX = d.w > 0
          ? Math.max(0, Math.min(1, dragStartPin.current.x + gestureState.dx / d.w))
          : dragStartPin.current.x;
        const finalY = d.h > 0
          ? Math.max(0, Math.min(1, dragStartPin.current.y + gestureState.dy / d.h))
          : dragStartPin.current.y;
        const prevPin = { ...dragStartPin.current };

        setLocalPin({ x: finalX, y: finalY });
        localPinRef.current = { x: finalX, y: finalY };

        isSavingRef.current = true;
        setIsSaving(true);

        onRepositionRef
          .current(finalX, finalY)
          .then(() => {
            setShowSuccess(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setTimeout(() => setShowSuccess(false), 1200);
          })
          .catch(() => {
            setLocalPin(prevPin);
            localPinRef.current = prevPin;
            Alert.alert(
              "Save failed",
              "Could not save the new pin position. Please try again.",
            );
          })
          .finally(() => {
            isSavingRef.current = false;
            setIsSaving(false);
          });
      },

      onPanResponderTerminate: () => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        if (dragActive.current) {
          dragActive.current = false;
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
          setIsDragging(false);
          const prev = dragStartPin.current;
          setLocalPin(prev);
          localPinRef.current = prev;
        }
      },
    })
  ).current;

  const pinLeft = localPin.x * dims.w - pinW / 2;
  const pinTop = localPin.y * dims.h - pinH;

  const markerColor = showSuccess ? "#22C55E" : isDragging ? "#0F8F83" : pinColor;
  const showTooltip = isDragging || isSaving || showSuccess;
  const tooltipText = showSuccess
    ? "Pin saved"
    : isSaving
      ? "Saving…"
      : "Release to drop";

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.hitArea,
        {
          left: pinLeft - HIT_PADDING,
          top: pinTop - HIT_PADDING,
          width: pinW + HIT_PADDING * 2,
          height: pinH + HIT_PADDING * 2,
        },
      ]}
    >
      {showTooltip && (
        <View
          style={[
            styles.tooltip,
            showSuccess && styles.tooltipSuccess,
          ]}
        >
          <Text style={styles.tooltipText}>{tooltipText}</Text>
        </View>
      )}

      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <ItemPinMarker size="sm" color={markerColor} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: HIT_PADDING,
  },
  tooltip: {
    position: "absolute",
    bottom: HIT_PADDING + PIN_MARKER_SIZE.sm.h + 6,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.70)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 80,
    alignItems: "center",
  },
  tooltipSuccess: {
    backgroundColor: "rgba(21,128,61,0.85)",
  },
  tooltipText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
});
