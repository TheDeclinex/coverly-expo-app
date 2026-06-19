/**
 * AiScanningOverlay
 * Full-screen AI scanning animation shown while scan-room-photo processes.
 * Uses React Native Reanimated for UI-thread animation (no JS-thread jank on Android).
 *
 * Design: "Neural Frame" — dark background, blue-white scan line, corner brackets,
 * rotating status messages. Deliberately avoids the app's green palette to give
 * the scan screen its own premium AI identity.
 */

import React, { useEffect, useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { ScanEncodedImage } from "@/types/scan";

const { width: SCREEN_W } = Dimensions.get("window");

const FRAME_W = SCREEN_W * 0.85;
const FRAME_H = FRAME_W * 0.72;       // ~4:3 ratio
const BRACKET = 26;                    // bracket arm length (px)
const THICK = 2.5;                     // bracket arm thickness (px)
const BRACKET_COLOR = "#93C5FD";       // blue-200
const SCAN_GLOW = "rgba(147,197,253,0.10)";
const SCAN_LINE_COLOR = "rgba(186,217,254,0.90)";
const SWEEP_MS = 1900;                 // scan line sweep duration
const PHOTO_CYCLE_MS = 2200;           // keep each batch photo visible for a full sweep

const STATUS_MESSAGES = [
  "Analysing photo…",
  "Detecting contents…",
  "Finding item details…",
  "Preparing results…",
] as const;

// The bracket is always drawn as a top-left L; rotation maps it to each corner.
const CORNERS = [
  { key: "tl", top: -1, left: -1,  rotate: "0deg"   },
  { key: "tr", top: -1, right: -1, rotate: "90deg"  },
  { key: "br", bottom: -1, right: -1, rotate: "180deg" },
  { key: "bl", bottom: -1, left: -1,  rotate: "270deg" },
] as const;

export function AiScanningOverlay({
  images,
}: {
  images: ScanEncodedImage[];
}) {
  const [statusIdx, setStatusIdx] = useState(0);
  const [photoIdx, setPhotoIdx] = useState(0);

  // ── Shared values ────────────────────────────────────────────────────────────
  const scanY         = useSharedValue(0);
  const bracketOpac   = useSharedValue(0.45);
  const textOpac      = useSharedValue(1);
  const d1Opac        = useSharedValue(0.2);
  const d2Opac        = useSharedValue(0.2);
  const d3Opac        = useSharedValue(0.2);

  // ── Start animations on mount ─────────────────────────────────────────────────
  useEffect(() => {
    // Scan line: ping-pong sweep across photo height
    scanY.value = withRepeat(
      withTiming(FRAME_H, { duration: SWEEP_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true, // reverse
    );

    // Bracket pulse — all four in sync (intentional: targeting-system feel)
    bracketOpac.value = withRepeat(
      withSequence(
        withTiming(1,    { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3,  { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );

    // Staggered dot pulse
    const startDot = (sv: typeof d1Opac, delayMs: number) => {
      setTimeout(() => {
        sv.value = withRepeat(
          withSequence(
            withTiming(1,   { duration: 380, easing: Easing.out(Easing.ease) }),
            withTiming(0.15, { duration: 500, easing: Easing.in(Easing.ease) }),
          ),
          -1,
        );
      }, delayMs);
    };
    startDot(d1Opac, 0);
    startDot(d2Opac, 240);
    startDot(d3Opac, 480);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cycle the faux scanner through the complete submitted batch. A single
  // photo remains static, preserving the existing single-scan experience.
  useEffect(() => {
    setPhotoIdx(0);
    if (images.length <= 1) return;

    const id = setInterval(() => {
      setPhotoIdx((current) => (current + 1) % images.length);
    }, PHOTO_CYCLE_MS);
    return () => clearInterval(id);
  }, [images.length]);

  // ── Status text cycling ───────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      // Fade out → update text → fade in
      textOpac.value = withSequence(
        withTiming(0, { duration: 220 }),
        withTiming(1, { duration: 280 }),
      );
      setTimeout(() => {
        setStatusIdx((i) => (i + 1) % STATUS_MESSAGES.length);
      }, 220);
    }, 2600);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Animated styles ──────────────────────────────────────────────────────────
  const scanLineStyle    = useAnimatedStyle(() => ({ transform: [{ translateY: scanY.value }] }));
  const bracketStyle     = useAnimatedStyle(() => ({ opacity: bracketOpac.value }));
  const textStyle        = useAnimatedStyle(() => ({ opacity: textOpac.value }));
  const d1Style          = useAnimatedStyle(() => ({ opacity: d1Opac.value }));
  const d2Style          = useAnimatedStyle(() => ({ opacity: d2Opac.value }));
  const d3Style          = useAnimatedStyle(() => ({ opacity: d3Opac.value }));

  const photoUri = images[photoIdx]?.uri ?? images[0]?.uri ?? null;

  return (
    <View style={styles.container}>

      {/* ── AI badge ────────────────────────────────────────────────────────── */}
      <View style={styles.badge}>
        <PulsingDot />
        <Text style={styles.badgeText}>COVERLY AI</Text>
      </View>

      {/* ── Photo frame ─────────────────────────────────────────────────────── */}
      <View style={styles.frameOuter}>
        {/* Soft ambient glow behind the frame */}
        <View style={styles.ambientGlow} />

        <View style={styles.frame}>
          {/* Photo (or dark placeholder) */}
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={300}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.photoPlaceholder]} />
          )}

          {/* Dark vignette overlay so brackets + scan line read clearly */}
          <View style={[StyleSheet.absoluteFill, styles.vignette]} />

          {/* Scan line assembly — positioned at top of frame, animated down */}
          <Animated.View
            style={[styles.scanWrap, scanLineStyle, { pointerEvents: "none" }]}
          >
            {/* Glow trail above the line */}
            <View style={styles.scanGlow} />
            {/* The hard bright line */}
            <View style={styles.scanLine} />
          </Animated.View>

          {/* Corner brackets — all animate together */}
          {CORNERS.map(({ key, rotate, ...pos }) => (
            <Animated.View
              key={key}
              style={[
                styles.bracketBase,
                pos as object,
                { transform: [{ rotate }], pointerEvents: "none" },
                bracketStyle,
              ]}
            >
              {/* Horizontal arm */}
              <View style={styles.bracketH} />
              {/* Vertical arm */}
              <View style={styles.bracketV} />
            </Animated.View>
          ))}

          {/* Frame border */}
          <View
            style={[StyleSheet.absoluteFill, styles.frameBorder, { pointerEvents: "none" }]}
          />
        </View>
      </View>

      {/* ── Status text ─────────────────────────────────────────────────────── */}
      <Animated.Text style={[styles.statusText, textStyle]}>
        {STATUS_MESSAGES[statusIdx]}
      </Animated.Text>

      {/* ── Pulsing dots ────────────────────────────────────────────────────── */}
      <View style={styles.dotsRow}>
        <Animated.View style={[styles.dot, d1Style]} />
        <Animated.View style={[styles.dot, d2Style]} />
        <Animated.View style={[styles.dot, d3Style]} />
      </View>

      {/* ── Multi-photo indicator ────────────────────────────────────────────── */}
      {images.length > 1 && (
        <Text style={styles.multiText}>
          Photo {photoIdx + 1} of {images.length} · Analysing full scan batch
        </Text>
      )}
    </View>
  );
}

/** Small dot that independently pulses — used in the AI badge */
function PulsingDot() {
  const opac = useSharedValue(0.5);
  useEffect(() => {
    opac.value = withRepeat(
      withSequence(
        withTiming(1,   { duration: 700 }),
        withTiming(0.3, { duration: 700 }),
      ),
      -1,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opac.value }));
  return <Animated.View style={[styles.badgeDot, style]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D1117",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingHorizontal: 20,
    paddingVertical: 40,
  },

  // AI badge
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.25)",
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 5,
    backgroundColor: "rgba(147,197,253,0.07)",
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#60A5FA",
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#93C5FD",
    letterSpacing: 1.4,
  },

  // Frame outer (holds ambient glow + frame)
  frameOuter: {
    alignItems: "center",
    justifyContent: "center",
  },
  ambientGlow: {
    position: "absolute",
    width: FRAME_W + 48,
    height: FRAME_H + 48,
    borderRadius: 20,
    backgroundColor: "rgba(59,130,246,0.055)",
  },

  // Photo frame
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#161B27",
  },
  photoPlaceholder: {
    backgroundColor: "#1A2035",
  },
  vignette: {
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  frameBorder: {
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.18)",
    borderRadius: 10,
  },

  // Scan line
  scanWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 30,
  },
  scanGlow: {
    height: 28,
    backgroundColor: SCAN_GLOW,
  },
  scanLine: {
    height: 2,
    backgroundColor: SCAN_LINE_COLOR,
  },

  // Corner brackets (drawn as TL; rotation handles other corners)
  bracketBase: {
    position: "absolute",
    width: BRACKET,
    height: BRACKET,
  },
  bracketH: {
    position: "absolute",
    top: 0,
    left: 0,
    width: BRACKET,
    height: THICK,
    backgroundColor: BRACKET_COLOR,
    borderRadius: 1,
  },
  bracketV: {
    position: "absolute",
    top: 0,
    left: 0,
    width: THICK,
    height: BRACKET,
    backgroundColor: BRACKET_COLOR,
    borderRadius: 1,
  },

  // Status text
  statusText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#CBD5E1",
    textAlign: "center",
    letterSpacing: 0.15,
  },

  // Dots
  dotsRow: {
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#60A5FA",
  },

  // Multi-photo label
  multiText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.55)",
    textAlign: "center",
    marginTop: -8,
  },
});
