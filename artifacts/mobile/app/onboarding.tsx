import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { PROPERTY_TYPES } from "@/constants/propertyTypes";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const DARK_BG    = "#111C2A";
const DOT_COLOR  = "rgba(255,255,255,0.07)";
const BTN_TOP    = "#0F8F83";
const BTN_BOT    = "#0B7468";
const TEAL_TOP   = "#0D7A6F";
const TEAL_BOT   = "#064E46";

function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Dot grid — matches login aesthetic ───────────────────────────────────────
function DotGrid() {
  const COLS = 10, ROWS = 20, H = 38, V = 46;
  const nodes: React.ReactNode[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      nodes.push(
        <View
          key={`${r}-${c}`}
          style={{
            position: "absolute",
            width: 2, height: 2, borderRadius: 1,
            backgroundColor: DOT_COLOR,
            top: r * V, left: c * H,
          }}
        />
      );
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">{nodes}</View>;
}

// ─── Progress dots ─────────────────────────────────────────────────────────────
function ProgressDots({
  activeIndex,
  total,
  light,
}: {
  activeIndex: number;
  total: number;
  light?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6, justifyContent: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i === activeIndex ? 22 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor:
              i === activeIndex
                ? light ? "rgba(255,255,255,0.9)" : "#0F8F83"
                : light ? "rgba(255,255,255,0.28)" : "#E2E8F0",
          }}
        />
      ))}
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { session, markOnboardingComplete, hasSeenOnboarding } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  type Step = 0 | 1 | 2 | 3;
  const [step, setStep] = useState<Step>(0);

  const [propertyName, setPropertyName]     = useState("");
  const [propertyType, setPropertyType]     = useState<string | null>(null);
  const [coverAmount, setCoverAmount]       = useState("");
  const [creating, setCreating]             = useState(false);
  const [createError, setCreateError]       = useState<string | null>(null);
  const [newPropertyId, setNewPropertyId]   = useState<string | null>(null);
  const [newPropertyName, setNewPropertyName] = useState("");

  const nameInputRef = useRef<TextInput>(null);

  // ── Animated values ─────────────────────────────────────────────────────────
  // Step 0 — shield bounce
  const shieldScale   = useSharedValue(0);
  const shieldOpacity = useSharedValue(0);

  // Step 1 — staggered feature rows
  const row1Y       = useSharedValue(20);
  const row1Opacity = useSharedValue(0);
  const row2Y       = useSharedValue(20);
  const row2Opacity = useSharedValue(0);
  const row3Y       = useSharedValue(20);
  const row3Opacity = useSharedValue(0);

  // Step 3 — checkmark scale
  const checkScale   = useSharedValue(0);
  const checkOpacity = useSharedValue(0);

  useEffect(() => {
    if (step === 0) {
      shieldScale.value = 0;
      shieldOpacity.value = 0;
      shieldScale.value   = withDelay(180, withSpring(1, { damping: 11, stiffness: 140 }));
      shieldOpacity.value = withDelay(180, withTiming(1, { duration: 200 }));
    } else if (step === 1) {
      row1Y.value = 20; row1Opacity.value = 0;
      row2Y.value = 20; row2Opacity.value = 0;
      row3Y.value = 20; row3Opacity.value = 0;
      row1Y.value       = withDelay(60,  withSpring(0, { damping: 16 }));
      row1Opacity.value = withDelay(60,  withTiming(1, { duration: 270 }));
      row2Y.value       = withDelay(160, withSpring(0, { damping: 16 }));
      row2Opacity.value = withDelay(160, withTiming(1, { duration: 270 }));
      row3Y.value       = withDelay(260, withSpring(0, { damping: 16 }));
      row3Opacity.value = withDelay(260, withTiming(1, { duration: 270 }));
    } else if (step === 2) {
      setTimeout(() => nameInputRef.current?.focus(), 420);
    } else if (step === 3) {
      checkScale.value = 0;
      checkOpacity.value = 0;
      checkScale.value   = withDelay(220, withSpring(1, { damping: 10, stiffness: 140 }));
      checkOpacity.value = withDelay(220, withTiming(1, { duration: 200 }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const shieldStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shieldScale.value }],
    opacity: shieldOpacity.value,
  }));
  const row1Style = useAnimatedStyle(() => ({
    transform: [{ translateY: row1Y.value }],
    opacity: row1Opacity.value,
  }));
  const row2Style = useAnimatedStyle(() => ({
    transform: [{ translateY: row2Y.value }],
    opacity: row2Opacity.value,
  }));
  const row3Style = useAnimatedStyle(() => ({
    transform: [{ translateY: row3Y.value }],
    opacity: row3Opacity.value,
  }));
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkOpacity.value,
  }));

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!session) return <Redirect href="/login" />;
  if (hasSeenOnboarding === true) return <Redirect href="/(tabs)" />;

  // ── Handlers ────────────────────────────────────────────────────────────────
  const advanceTo = async (next: Step) => {
    await Haptics.selectionAsync();
    setStep(next);
  };

  const handleCreateProperty = async () => {
    if (!session.user || creating) return;
    const trimmedName = propertyName.trim();
    if (!trimmedName) return;

    setCreating(true);
    setCreateError(null);

    try {
      const { data: maxRow } = await supabase
        .from("inventory_files")
        .select("file_number")
        .order("file_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextFileNumber =
        ((maxRow as { file_number?: number } | null)?.file_number ?? 0) + 1;

      const newId = generateId();
      const now   = new Date().toISOString();

      const { data, error: dbError } = await supabase
        .from("inventory_files")
        .insert({
          id: newId,
          user_id: session.user.id,
          file_number: nextFileNumber,
          name: trimmedName,
          status: "active",
          property_type: propertyType ?? null,
          created_by_email: session.user.email ?? null,
          created_date: now,
          last_modified: now,
          contents_sum_insured: (() => {
            const n = parseFloat(coverAmount);
            return isFinite(n) && n > 0 ? n : null;
          })(),
        })
        .select()
        .single();

      if (dbError) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setCreateError(dbError.message);
        return;
      }

      const row = data as { id: string; name: string };
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNewPropertyId(row.id);
      setNewPropertyName(row.name);
      setStep(3);
    } finally {
      setCreating(false);
    }
  };

  const handleComplete = async () => {
    if (!newPropertyId) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await markOnboardingComplete();
    router.replace({
      pathname: "/(tabs)/property/[id]",
      params: { id: newPropertyId, name: newPropertyName },
    });
  };

  // ── Step renders ────────────────────────────────────────────────────────────

  const renderStep0 = () => (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: DARK_BG }]}>
      <DotGrid />
      {/* Ambient glows */}
      <View style={{ position: "absolute", top: -80, right: -80, width: 240, height: 240, borderRadius: 120, backgroundColor: "rgba(29,158,117,0.11)" }} />
      <View style={{ position: "absolute", bottom: 80, left: -100, width: 260, height: 260, borderRadius: 130, backgroundColor: "rgba(8,28,68,0.5)" }} />

      <View style={[styles.stepContainer, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Animated.View style={shieldStyle}>
            <View style={styles.shieldOuter}>
              <Feather name="shield" size={36} color="#FFFFFF" />
            </View>
          </Animated.View>

          <Text style={styles.heroAppName}>Coverly</Text>
          <Text style={styles.heroTagline}>Know what you own</Text>
          <Text style={styles.heroBody}>
            Build a complete home inventory so you're ready when it matters most — for insurance claims, moving, or peace of mind.
          </Text>
        </View>

        <View style={{ gap: 14 }}>
          <Pressable
            onPress={() => advanceTo(1)}
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.82 : 1 }]}
          >
            <LinearGradient colors={[BTN_TOP, BTN_BOT]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.primaryBtnInner}>
              <Text style={styles.primaryBtnText}>Get started</Text>
              <Feather name="arrow-right" size={16} color="rgba(255,255,255,0.7)" />
            </LinearGradient>
          </Pressable>
          <Pressable onPress={() => advanceTo(2)} style={({ pressed }) => [styles.skipLink, { opacity: pressed ? 0.5 : 1 }]}>
            <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, fontFamily: "Inter_400Regular" }}>
              Skip intro
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]}>
      <View style={[styles.stepContainer, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 28 }]}>
        <View>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>What Coverly does</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            Everything you need to protect what you own.
          </Text>
        </View>

        <View style={{ flex: 1, justifyContent: "center", gap: 10, marginTop: 12 }}>
          <Animated.View style={[styles.featureRow, { backgroundColor: colors.background, borderColor: colors.border, borderRadius: colors.radius }, row1Style]}>
            <View style={[styles.featureIcon, { backgroundColor: "#EEF9F6" }]}>
              <Feather name="zap" size={22} color="#0F766E" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.featureLabel, { color: colors.foreground }]}>AI Scanning</Text>
              <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>
                Scan a room photo and let Coverly identify items for you.
              </Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.featureRow, { backgroundColor: colors.background, borderColor: colors.border, borderRadius: colors.radius }, row2Style]}>
            <View style={[styles.featureIcon, { backgroundColor: "#EEF9F6" }]}>
              <Feather name="home" size={22} color="#0F766E" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.featureLabel, { color: colors.foreground }]}>Room by room</Text>
              <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>
                Organise your inventory by property, room, and item.
              </Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.featureRow, { backgroundColor: colors.background, borderColor: colors.border, borderRadius: colors.radius }, row3Style]}>
            <View style={[styles.featureIcon, { backgroundColor: "#FEF3C7" }]}>
              <Feather name="tag" size={22} color="#D97706" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text style={[styles.featureLabel, { color: colors.foreground }]}>Replacement pricing</Text>
                <View style={styles.comingSoon}>
                  <Text style={styles.comingSoonText}>COMING SOON</Text>
                </View>
              </View>
              <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>
                Estimate replacement values as your inventory grows.
              </Text>
            </View>
          </Animated.View>
        </View>

        <View style={{ gap: 16 }}>
          <ProgressDots activeIndex={0} total={3} />
          <Pressable
            onPress={() => advanceTo(2)}
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.82 : 1 }]}
          >
            <LinearGradient colors={[BTN_TOP, BTN_BOT]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.primaryBtnInner}>
              <Text style={styles.primaryBtnText}>Next</Text>
              <Feather name="arrow-right" size={16} color="rgba(255,255,255,0.7)" />
            </LinearGradient>
          </Pressable>
          <Pressable onPress={() => advanceTo(2)} style={({ pressed }) => [styles.skipLink, { opacity: pressed ? 0.5 : 1 }]}>
            <Text style={{ color: colors.mutedForeground, fontSize: 14, fontFamily: "Inter_400Regular" }}>
              Skip intro
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 28 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text style={[styles.stepHeading, { color: colors.foreground }]}>
              Set up your first property
            </Text>
            <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
              You can always add more later.
            </Text>
          </View>

          <View style={{ gap: 20, marginTop: 32 }}>
            <View style={{ gap: 8 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PROPERTY NAME</Text>
              <TextInput
                ref={nameInputRef}
                style={[styles.nameInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                value={propertyName}
                onChangeText={(v) => { setPropertyName(v); setCreateError(null); }}
                placeholder="e.g. My home, Beach house…"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>

            <View style={{ gap: 8 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PROPERTY TYPE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                {PROPERTY_TYPES.map((pt) => {
                  const sel = propertyType === pt.value;
                  return (
                    <Pressable
                      key={pt.value}
                      onPress={() => setPropertyType(sel ? null : pt.value)}
                      style={({ pressed }) => ({
                        paddingHorizontal: 14,
                        paddingVertical: 9,
                        borderRadius: colors.radius,
                        borderWidth: 1.5,
                        borderColor: sel ? colors.primary : colors.border,
                        backgroundColor: sel ? colors.primary : colors.card,
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <Text style={{ fontSize: 14, fontFamily: sel ? "Inter_600SemiBold" : "Inter_400Regular", color: sel ? colors.primaryForeground : colors.foreground }}>
                        {pt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>CONTENTS COVER AMOUNT</Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderWidth: 1.5,
                  borderRadius: colors.radius,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  overflow: "hidden",
                }}
              >
                <Text
                  style={{
                    paddingLeft: 14,
                    paddingRight: 2,
                    fontSize: 17,
                    fontFamily: "Inter_400Regular",
                    color: colors.mutedForeground,
                  }}
                >
                  $
                </Text>
                <TextInput
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    paddingRight: 14,
                    fontSize: 17,
                    fontFamily: "Inter_400Regular",
                    color: colors.foreground,
                  }}
                  value={coverAmount}
                  onChangeText={(v) => setCoverAmount(v.replace(/[^0-9.]/g, ""))}
                  placeholder="e.g. 75000"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  color: colors.mutedForeground,
                  lineHeight: 18,
                }}
              >
                Optional — add your current contents cover so Coverly can compare it with your documented inventory later.
              </Text>
            </View>

            {createError ? (
              <View style={[styles.errorBox, { backgroundColor: "#FEF2F2", borderRadius: colors.radius }]}>
                <Feather name="alert-circle" size={14} color="#DC2626" />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" }}>
                  {createError}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ flex: 1, minHeight: 32 }} />

          <View style={{ gap: 16 }}>
            <ProgressDots activeIndex={1} total={3} />
            <Pressable
              onPress={handleCreateProperty}
              disabled={!propertyName.trim() || creating}
              style={({ pressed }) => [
                styles.primaryBtn,
                { opacity: !propertyName.trim() || creating || pressed ? 0.52 : 1 },
              ]}
            >
              <LinearGradient colors={[BTN_TOP, BTN_BOT]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.primaryBtnInner}>
                {creating ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Create property</Text>
                    <Feather name="arrow-right" size={16} color="rgba(255,255,255,0.7)" />
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );

  const renderStep3 = () => (
    <LinearGradient colors={[TEAL_TOP, TEAL_BOT]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill}>
      <View style={[styles.stepContainer, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 0 }}>
          <Animated.View style={[styles.checkCircle, checkStyle]}>
            <Feather name="check" size={36} color="#FFFFFF" />
          </Animated.View>

          <Text style={[styles.celebHeading, { marginTop: 28 }]}>You're all set</Text>

          {newPropertyName ? (
            <View style={styles.propertyPill}>
              <Feather name="home" size={14} color={TEAL_TOP} />
              <Text style={styles.propertyPillText}>{newPropertyName}</Text>
            </View>
          ) : null}

          <Text style={[styles.celebBody, { marginTop: 14 }]}>
            You're ready to start building your inventory.
          </Text>
        </View>

        <View style={{ gap: 16 }}>
          <ProgressDots activeIndex={2} total={3} light />
          <Pressable
            onPress={handleComplete}
            style={({ pressed }) => [styles.lightBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.lightBtnText}>Let's go</Text>
            <Feather name="arrow-right" size={16} color={TEAL_TOP} />
          </Pressable>
        </View>
      </View>
    </LinearGradient>
  );

  // ── Root render ─────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: DARK_BG }}>
      <StatusBar style={step === 0 ? "light" : "dark"} />
      <Animated.View
        key={step}
        entering={FadeIn.duration(260)}
        exiting={FadeOut.duration(180)}
        style={StyleSheet.absoluteFill}
      >
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </Animated.View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  stepContainer: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
  },

  // Step 0 — hero
  shieldOuter: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(29,158,117,0.45)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  heroAppName: {
    fontSize: 40,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  heroTagline: {
    fontSize: 21,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.88)",
    marginBottom: 14,
  },
  heroBody: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.58)",
    textAlign: "center",
    lineHeight: 23,
    maxWidth: 300,
  },

  // Shared step headings
  stepHeading: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  stepSubheading: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },

  // Buttons
  primaryBtn: {
    borderRadius: 14,
    overflow: "hidden",
  },
  primaryBtnInner: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  skipLink: {
    alignItems: "center",
    paddingVertical: 4,
  },

  // Step 1 — feature rows
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    padding: 16,
    borderWidth: 1,
  },
  featureIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  featureLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  featureDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  comingSoon: {
    backgroundColor: "#FEF3C7",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  comingSoonText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: "#D97706",
    letterSpacing: 0.5,
  },

  // Step 2 — form
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.7,
  },
  nameInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    fontFamily: "Inter_400Regular",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
  },

  // Step 3 — celebration
  checkCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.38)",
    alignItems: "center",
    justifyContent: "center",
  },
  celebHeading: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  propertyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 14,
  },
  propertyPillText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#0F766E",
  },
  celebBody: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.72)",
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
  },
  lightBtn: {
    height: 54,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.65)",
    backgroundColor: "rgba(255,255,255,0.11)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  lightBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
});
