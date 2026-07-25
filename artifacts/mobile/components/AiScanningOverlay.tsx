/**
 * Full-screen scan-processing experience shown while scan-room-photo runs.
 *
 * Evidence Stack presents the submitted local images as physical photo cards.
 * Multi-photo and video scans work down through a calm four-card stack, while
 * honest single-image scans use one card with a soft analysis sweep.
 */

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { ReliableImage } from "@/components/ReliableImage";
import {
  advanceEvidenceDeck,
  createEvidenceDeck,
  evidenceFrameLabel,
  isSingleImageScan,
  SCAN_PROCESSING_MESSAGES,
  SINGLE_SCAN_STATUS_MESSAGES,
} from "@/lib/scan-animation-model";
import type { ScanEncodedImage, ScanMode } from "@/types/scan";

const COVERLY_HEADER_ICON = require("../assets/brand/coverly-header-icon.png");

const CARD_INTERVAL_MS = 3_500;
const CARD_PROMOTION_MS = 170;
const CARD_EXIT_MS = 780;
const PROCESSING_MESSAGE_INTERVAL_MS = 4_100;
const SINGLE_STATUS_INTERVAL_MS = 3_200;
const SINGLE_SWEEP_MS = 3_200;
const SINGLE_DRIFT_HALF_MS = 3_400;

interface EvidenceCard {
  key: number;
  imageIndex: number;
  entering: boolean;
}

interface AiScanningOverlayProps {
  images: ScanEncodedImage[];
  mode: ScanMode;
  onCancel: () => void;
}

export function AiScanningOverlay({ images, mode, onCancel }: AiScanningOverlayProps) {
  const { width, height } = useWindowDimensions();
  const imageUris = useMemo(() => images.map((image) => image.uri), [images]);
  const imageIdentity = imageUris.join("|");
  const imageCount = Math.max(1, imageUris.length);
  const singleImage = isSingleImageScan(mode, imageCount);
  const frameWidth = Math.min(width - 78, 300);
  const frameHeight = Math.min(frameWidth * 1.22, height * 0.44);
  const stageWidth = frameWidth + 34;
  const stageHeight = frameHeight + 58;

  const nextCardKeyRef = useRef(20);
  const deckRef = useRef<EvidenceCard[]>([]);
  const transitionActiveRef = useRef(false);
  const promotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [reduceMotion, setReduceMotion] = useState(false);
  const [deck, setDeck] = useState<EvidenceCard[]>([]);
  const [leavingUri, setLeavingUri] = useState<string | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
  const [singleStatusIndex, setSingleStatusIndex] = useState(0);

  const leavingProgress = useSharedValue(0);
  const processingMessageOpacity = useSharedValue(1);
  const singleStatusOpacity = useSharedValue(1);

  const clearTransitionTimers = () => {
    if (promotionTimerRef.current) {
      clearTimeout(promotionTimerRef.current);
      promotionTimerRef.current = null;
    }
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  };

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    clearTransitionTimers();
    transitionActiveRef.current = false;
    setLeavingUri(null);
    setCurrentFrameIndex(0);
    setSingleStatusIndex(0);

    const initialDeck = createEvidenceDeck(imageCount).map((imageIndex) => ({
      key: nextCardKeyRef.current++,
      imageIndex,
      entering: false,
    }));
    deckRef.current = initialDeck;
    setDeck(initialDeck);

    return clearTransitionTimers;
    // imageIdentity intentionally resets the physical deck when submitted URIs change.
  }, [imageCount, imageIdentity, mode]);

  useEffect(() => {
    if (singleImage || imageCount <= 1) return;

    const advanceDeck = () => {
      if (transitionActiveRef.current || deckRef.current.length === 0) return;
      transitionActiveRef.current = true;

      const currentDeck = deckRef.current;
      const next = advanceEvidenceDeck(
        currentDeck.map((card) => card.imageIndex),
        imageCount,
      );
      const leavingCard = currentDeck[0];
      setLeavingUri(imageUris[leavingCard.imageIndex] ?? null);
      leavingProgress.value = 0;
      requestAnimationFrame(() => {
        leavingProgress.value = withTiming(1, {
          duration: reduceMotion ? 520 : CARD_EXIT_MS,
          easing: Easing.out(Easing.cubic),
        });
      });

      promotionTimerRef.current = setTimeout(() => {
        const remaining = deckRef.current.slice(1).map((card) => ({
          ...card,
          entering: false,
        }));
        const rearImageIndex = next.deck[next.deck.length - 1] ?? next.currentFrameIndex;
        const nextDeck = [
          ...remaining,
          {
            key: nextCardKeyRef.current++,
            imageIndex: rearImageIndex,
            entering: true,
          },
        ];
        deckRef.current = nextDeck;
        setDeck(nextDeck);
        setCurrentFrameIndex(next.currentFrameIndex);
        promotionTimerRef.current = null;
      }, reduceMotion ? 80 : CARD_PROMOTION_MS);

      exitTimerRef.current = setTimeout(() => {
        setLeavingUri(null);
        transitionActiveRef.current = false;
        exitTimerRef.current = null;
      }, reduceMotion ? 560 : CARD_EXIT_MS);
    };

    const interval = setInterval(advanceDeck, CARD_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      clearTransitionTimers();
      transitionActiveRef.current = false;
    };
  }, [imageCount, imageIdentity, imageUris, leavingProgress, reduceMotion, singleImage]);

  useEffect(() => {
    let swapTimer: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      processingMessageOpacity.value = withTiming(0, { duration: reduceMotion ? 1 : 220 });
      swapTimer = setTimeout(() => {
        setProcessingMessageIndex((index) => (index + 1) % SCAN_PROCESSING_MESSAGES.length);
        processingMessageOpacity.value = withTiming(1, { duration: reduceMotion ? 1 : 280 });
      }, reduceMotion ? 1 : 220);
    }, PROCESSING_MESSAGE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (swapTimer) clearTimeout(swapTimer);
    };
  }, [processingMessageOpacity, reduceMotion]);

  useEffect(() => {
    if (!singleImage) return;
    let swapTimer: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      singleStatusOpacity.value = withTiming(0, { duration: reduceMotion ? 1 : 180 });
      swapTimer = setTimeout(() => {
        setSingleStatusIndex((index) => (index + 1) % SINGLE_SCAN_STATUS_MESSAGES.length);
        singleStatusOpacity.value = withTiming(1, { duration: reduceMotion ? 1 : 180 });
      }, reduceMotion ? 1 : 180);
    }, SINGLE_STATUS_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (swapTimer) clearTimeout(swapTimer);
    };
  }, [reduceMotion, singleImage, singleStatusOpacity]);

  const processingMessageStyle = useAnimatedStyle(() => ({
    opacity: processingMessageOpacity.value,
    transform: [{ translateY: interpolate(processingMessageOpacity.value, [0, 1], [3, 0]) }],
  }));

  const singleStatusStyle = useAnimatedStyle(() => ({
    opacity: singleStatusOpacity.value,
    transform: [{ translateY: interpolate(singleStatusOpacity.value, [0, 1], [3, 0]) }],
  }));

  const leavingStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return {
        opacity: interpolate(leavingProgress.value, [0, 1], [1, 0]),
        transform: [{ translateX: 0 }, { translateY: 0 }, { rotateZ: "0deg" }, { scale: 1 }],
      };
    }
    return {
      opacity: interpolate(leavingProgress.value, [0, 0.7, 1], [1, 0.62, 0]),
      transform: [
        { translateX: interpolate(leavingProgress.value, [0, 1], [0, 92]) },
        { translateY: interpolate(leavingProgress.value, [0, 1], [0, -48]) },
        { rotateZ: `${interpolate(leavingProgress.value, [0, 1], [0, 7])}deg` },
        { scale: interpolate(leavingProgress.value, [0, 1], [1, 0.94]) },
      ],
    };
  });

  const statusLabel = singleImage
    ? SINGLE_SCAN_STATUS_MESSAGES[singleStatusIndex]
    : evidenceFrameLabel(mode, currentFrameIndex, imageCount);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#FFFEFA", "#F6FBF8", "#F3F1E9"]}
        locations={[0, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.backgroundGlow} />

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.brandLockup}>
            <Image source={COVERLY_HEADER_ICON} style={styles.brandIcon} />
            <View>
              <Text style={styles.brandName}>Coverly</Text>
              <Text style={styles.brandTagline}>Know what you own</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel scan"
            onPress={onCancel}
            hitSlop={10}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
          >
            <Feather name="x" size={17} color="#47615C" />
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        <View style={styles.headingBlock}>
          <Text style={styles.heading}>Analysing your scan</Text>
          <Animated.Text style={[styles.processingMessage, processingMessageStyle]}>
            {SCAN_PROCESSING_MESSAGES[processingMessageIndex]}
          </Animated.Text>
        </View>

        <View style={[styles.stage, { width: stageWidth, height: stageHeight }]}>
          {singleImage ? (
            <SingleEvidenceCard
              uri={imageUris[0] ?? null}
              width={frameWidth}
              height={frameHeight}
              reduceMotion={reduceMotion}
            />
          ) : (
            <>
              {deck.map((card, role) => (
                <EvidenceStackCard
                  key={card.key}
                  uri={imageUris[card.imageIndex] ?? null}
                  role={role}
                  entering={card.entering}
                  width={frameWidth}
                  height={frameHeight}
                  reduceMotion={reduceMotion}
                />
              ))}
              {leavingUri ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.absoluteCard,
                    {
                      left: (stageWidth - frameWidth) / 2,
                      width: frameWidth,
                      height: frameHeight,
                      zIndex: 10,
                    },
                    leavingStyle,
                  ]}
                >
                  <PhotoCard uri={leavingUri} />
                </Animated.View>
              ) : null}
            </>
          )}

          <View style={[styles.frameBadge, singleImage && styles.singleFrameBadge]}>
            {singleImage ? (
              <View style={styles.singleBadgeHalo}>
                <View style={styles.singleBadgeDot} />
              </View>
            ) : (
              <Feather name="layers" size={14} color="#0B8B7A" />
            )}
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.frameBadgeText,
                singleImage && styles.singleFrameBadgeText,
                singleImage ? singleStatusStyle : undefined,
              ]}
            >
              {statusLabel}
            </Animated.Text>
          </View>
        </View>

        {singleImage ? (
          <SingleProgressTrack width={Math.min(frameWidth, 278)} reduceMotion={reduceMotion} />
        ) : (
          <View style={[styles.segmentRail, { width: Math.min(frameWidth, 278) }]}>
            {Array.from({ length: imageCount }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.segment,
                  index <= currentFrameIndex && styles.segmentSeen,
                  index === currentFrameIndex && styles.segmentCurrent,
                ]}
              />
            ))}
          </View>
        )}

        <View style={styles.footerMessage}>
          <View style={styles.footerDot} />
          <Text style={styles.footerText}>Building your inventory</Text>
        </View>
      </View>
    </View>
  );
}

function EvidenceStackCard({
  uri,
  role,
  entering,
  width,
  height,
  reduceMotion,
}: {
  uri: string | null;
  role: number;
  entering: boolean;
  width: number;
  height: number;
  reduceMotion: boolean;
}) {
  const roleProgress = useSharedValue(role);
  const entryProgress = useSharedValue(entering && !reduceMotion ? 0 : 1);

  useEffect(() => {
    if (reduceMotion) {
      roleProgress.value = role;
      return;
    }
    roleProgress.value = withTiming(role, {
      duration: 720,
      easing: Easing.out(Easing.cubic),
    });
  }, [reduceMotion, role, roleProgress]);

  useEffect(() => {
    if (!entering || reduceMotion) {
      entryProgress.value = 1;
      return;
    }
    entryProgress.value = 0;
    entryProgress.value = withTiming(1, {
      duration: 620,
      easing: Easing.out(Easing.cubic),
    });
  }, [entering, entryProgress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const roleOpacity = interpolate(roleProgress.value, [0, 1, 2, 3], [1, 0.9, 0.72, 0.45]);
    return {
      opacity: roleOpacity * entryProgress.value,
      transform: [
        {
          translateX:
            interpolate(roleProgress.value, [0, 1, 2, 3], [0, -14, 14, -3])
            + interpolate(entryProgress.value, [0, 1], [-30, 0]),
        },
        { translateY: interpolate(roleProgress.value, [0, 1, 2, 3], [0, 15, 26, 35]) },
        {
          rotateZ: `${interpolate(roleProgress.value, [0, 1, 2, 3], [0, -4.2, 4.5, -1.2])}deg`,
        },
        { scale: interpolate(roleProgress.value, [0, 1, 2, 3], [1, 0.985, 0.965, 0.945]) },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.absoluteCard,
        {
          left: 17,
          width,
          height,
          zIndex: 6 - role,
        },
        animatedStyle,
      ]}
    >
      <PhotoCard uri={uri} />
    </Animated.View>
  );
}

function SingleEvidenceCard({
  uri,
  width,
  height,
  reduceMotion,
}: {
  uri: string | null;
  width: number;
  height: number;
  reduceMotion: boolean;
}) {
  const driftProgress = useSharedValue(0);
  const sweepProgress = useSharedValue(0);
  const reducedGlow = useSharedValue(0.28);
  const sweepHeight = height * 0.48;

  useEffect(() => {
    cancelAnimation(driftProgress);
    cancelAnimation(sweepProgress);
    cancelAnimation(reducedGlow);
    driftProgress.value = 0;
    sweepProgress.value = 0;

    if (reduceMotion) {
      reducedGlow.value = withRepeat(
        withSequence(
          withTiming(0.62, { duration: 2_300, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.28, { duration: 2_300, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      );
      return;
    }

    reducedGlow.value = 0;
    driftProgress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: SINGLE_DRIFT_HALF_MS, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: SINGLE_DRIFT_HALF_MS, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    sweepProgress.value = withRepeat(
      withTiming(1, { duration: SINGLE_SWEEP_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(driftProgress);
      cancelAnimation(sweepProgress);
      cancelAnimation(reducedGlow);
    };
  }, [driftProgress, reduceMotion, reducedGlow, sweepProgress]);

  const driftStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(driftProgress.value, [0, 1], [1.01, 1.045]) },
      { translateX: interpolate(driftProgress.value, [0, 1], [-1, 2]) },
      { translateY: interpolate(driftProgress.value, [0, 1], [0, -1]) },
    ],
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sweepProgress.value, [0, 0.06, 0.88, 1], [0, 1, 1, 0]),
    transform: [{ translateY: interpolate(sweepProgress.value, [0, 1], [0, height + sweepHeight]) }],
  }));

  const reducedGlowStyle = useAnimatedStyle(() => ({
    opacity: reducedGlow.value,
  }));

  return (
    <View
      pointerEvents="none"
      style={[
        styles.absoluteCard,
        {
          left: 17,
          width,
          height,
          zIndex: 6,
          transform: [{ scale: 1.015 }],
        },
      ]}
    >
      <View style={styles.photoCard}>
        <View style={styles.photoInner}>
          <Animated.View style={[StyleSheet.absoluteFill, driftStyle]}>
            <ReliableImage
              uri={uri}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={180}
              fallback={<View style={[StyleSheet.absoluteFill, styles.photoPlaceholder]} />}
            />
          </Animated.View>
          <View style={[StyleSheet.absoluteFill, styles.photoVignette]} />
          {reduceMotion ? (
            <Animated.View style={[StyleSheet.absoluteFill, styles.reducedGlow, reducedGlowStyle]} />
          ) : (
            <Animated.View
              style={[
                styles.singleSweep,
                {
                  top: -sweepHeight,
                  height: sweepHeight,
                },
                sweepStyle,
              ]}
            >
              <LinearGradient
                colors={[
                  "rgba(84,213,193,0)",
                  "rgba(84,213,193,0.035)",
                  "rgba(101,225,205,0.22)",
                ]}
                locations={[0, 0.35, 1]}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}

function PhotoCard({ uri }: { uri: string | null }) {
  return (
    <View style={styles.photoCard}>
      <View style={styles.photoInner}>
        <ReliableImage
          uri={uri}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
          fallback={<View style={[StyleSheet.absoluteFill, styles.photoPlaceholder]} />}
        />
        <View style={[StyleSheet.absoluteFill, styles.photoVignette]} />
      </View>
    </View>
  );
}

function SingleProgressTrack({
  width,
  reduceMotion,
}: {
  width: number;
  reduceMotion: boolean;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (reduceMotion) return;
    progress.value = withRepeat(
      withTiming(1, { duration: 3_000, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0 : 1,
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-width * 0.34, width]) }],
  }));

  return (
    <View style={[styles.singleProgressTrack, { width }]}>
      <Animated.View style={[styles.singleProgressHighlight, { width: width * 0.34 }, highlightStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAF6",
  },
  backgroundGlow: {
    position: "absolute",
    top: "30%",
    left: "13%",
    width: "74%",
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: "rgba(101, 211, 193, 0.12)",
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingTop: 52,
    paddingHorizontal: 24,
    paddingBottom: 25,
  },
  headerRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandLockup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandIcon: {
    width: 30,
    height: 30,
    borderRadius: 7,
  },
  brandName: {
    color: "#17312F",
    fontSize: 15,
    lineHeight: 17,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.2,
  },
  brandTagline: {
    color: "#8BA09B",
    fontSize: 8,
    lineHeight: 10,
    fontFamily: "Inter_400Regular",
  },
  cancelButton: {
    minHeight: 38,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: "rgba(18, 79, 71, 0.12)",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,252,0.74)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  cancelButtonPressed: {
    opacity: 0.7,
  },
  cancelText: {
    color: "#47615C",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  headingBlock: {
    width: "100%",
    marginTop: 28,
  },
  heading: {
    color: "#12332F",
    fontSize: 27,
    lineHeight: 31,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
  },
  processingMessage: {
    minHeight: 40,
    marginTop: 8,
    color: "#5F7370",
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  stage: {
    position: "relative",
    marginTop: 18,
  },
  absoluteCard: {
    position: "absolute",
    top: 0,
  },
  photoCard: {
    flex: 1,
    padding: 7,
    borderRadius: 27,
    backgroundColor: "#FFFEFA",
    shadowColor: "#1E4A42",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 23,
    elevation: 10,
  },
  photoInner: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "#D9E7E2",
  },
  photoPlaceholder: {
    backgroundColor: "#D9E7E2",
  },
  photoVignette: {
    backgroundColor: "rgba(7, 48, 42, 0.08)",
  },
  singleSweep: {
    position: "absolute",
    left: "-8%",
    width: "116%",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(223,255,248,0.62)",
    shadowColor: "#2FBAA5",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
  },
  reducedGlow: {
    backgroundColor: "rgba(41,187,164,0.12)",
  },
  frameBadge: {
    position: "absolute",
    zIndex: 12,
    right: 0,
    bottom: 17,
    minHeight: 36,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(18,115,100,0.12)",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,252,0.96)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#214C44",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.13,
    shadowRadius: 12,
    elevation: 5,
  },
  singleFrameBadge: {
    minWidth: 146,
  },
  frameBadgeText: {
    color: "#34554F",
    fontSize: 10,
    lineHeight: 13,
    fontFamily: "Inter_600SemiBold",
  },
  singleFrameBadgeText: {
    minWidth: 105,
  },
  singleBadgeHalo: {
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: "rgba(39,179,160,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  singleBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#27B3A0",
  },
  segmentRail: {
    height: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  segment: {
    height: 4,
    flex: 1,
    borderRadius: 99,
    backgroundColor: "rgba(15,104,91,0.12)",
  },
  segmentSeen: {
    backgroundColor: "rgba(11,139,122,0.64)",
  },
  segmentCurrent: {
    height: 6,
    backgroundColor: "#0B8B7A",
  },
  singleProgressTrack: {
    height: 3,
    overflow: "hidden",
    borderRadius: 99,
    backgroundColor: "rgba(10,112,98,0.11)",
  },
  singleProgressHighlight: {
    height: 3,
    borderRadius: 99,
    backgroundColor: "#27B3A0",
  },
  footerMessage: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#27B3A0",
    shadowColor: "#27B3A0",
    shadowOpacity: 0.24,
    shadowRadius: 5,
  },
  footerText: {
    color: "#728782",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
});
