import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  useWindowDimensions,
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

import { CoverlyAuthBackground, CoverlyAuthMark } from "@/components/auth/CoverlyAuthBrand";
import { coverlyBrand } from "@/constants/brand";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { PROPERTY_TYPES } from "@/constants/propertyTypes";
import { useColors } from "@/hooks/useColors";
import { createProperty } from "@/lib/property-service";
import { supabase } from "@/lib/supabase";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const BTN_TOP = coverlyBrand.teal;
const BTN_BOT = coverlyBrand.tealDark;
const RADIUS = 12;

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
                ? light ? "rgba(255,255,255,0.9)" : coverlyBrand.teal
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
  const { enforce } = useEntitlements();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const userId = session?.user.id ?? null;

  type Step = 0 | 1 | 2 | 3;
  const [step, setStep] = useState<Step>(0);
  const [hasPassedPrivacyStep, setHasPassedPrivacyStep] = useState<boolean | null>(null);

  const [propertyName, setPropertyName]     = useState("");
  const [propertyType, setPropertyType]     = useState<string | null>(null);
  const [coverAmount, setCoverAmount]       = useState("");
  const [creating, setCreating]             = useState(false);
  const [createError, setCreateError]       = useState<string | null>(null);
  const [newPropertyId, setNewPropertyId]   = useState<string | null>(null);
  const [newPropertyName, setNewPropertyName] = useState("");

  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!userId) {
      setHasPassedPrivacyStep(null);
      return;
    }

    let cancelled = false;
    const storageKey = `onboarding-privacy:${userId}`;

    const loadPrivacyStep = async () => {
      try {
        const localValue = await AsyncStorage.getItem(storageKey);
        if (!cancelled) setHasPassedPrivacyStep(localValue !== null);
      } catch (error) {
        if (__DEV__) console.warn("[onboarding] privacy step load failed", error);
        if (!cancelled) setHasPassedPrivacyStep(false);
      }
    };

    setHasPassedPrivacyStep(null);
    void loadPrivacyStep();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ── Animated values ─────────────────────────────────────────────────────────
  // Step 0 brand mark bounce
  const markScale   = useSharedValue(0);
  const markOpacity = useSharedValue(0);

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
      markScale.value = 0;
      markOpacity.value = 0;
      markScale.value   = withDelay(180, withSpring(1, { damping: 11, stiffness: 140 }));
      markOpacity.value = withDelay(180, withTiming(1, { duration: 200 }));
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

  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: markScale.value }],
    opacity: markOpacity.value,
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
  if (hasPassedPrivacyStep === null) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={coverlyBrand.teal} />
      </View>
    );
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  const advanceTo = async (next: Step) => {
    await Haptics.selectionAsync();
    setStep(next);
  };

  const handlePrivacyContinue = async () => {
    if (!userId) return;
    await Haptics.selectionAsync();
    await AsyncStorage.setItem(`onboarding-privacy:${userId}`, "1");
    setHasPassedPrivacyStep(true);
  };

  const handleSkipOnboarding = async () => {
    await Haptics.selectionAsync();
    await markOnboardingComplete();
    router.replace("/(tabs)");
  };

  const handleCreateProperty = async () => {
    const { count } = await supabase.from("inventory_files").select("id", { count: "exact", head: true });
    if (!enforce("property", count ?? 0)) return;
    if (!session.user || creating) return;
    const trimmedName = propertyName.trim();
    if (!trimmedName) return;

    setCreating(true);
    setCreateError(null);

    try {
      const n = parseFloat(coverAmount);
      const row = await createProperty({
        name: trimmedName,
        propertyType,
        contentsSumInsured: isFinite(n) && n > 0 ? n : null,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNewPropertyId(row.id);
      setNewPropertyName(row.name);
      setStep(3);
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCreateError(err instanceof Error ? err.message : "Could not create property. Please try again.");
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

  const renderPrivacyStep = () => (
    <View style={StyleSheet.absoluteFill}>
      <View style={[styles.stepContainer, { paddingTop: insets.top + (compact ? 10 : 18), paddingBottom: insets.bottom + (compact ? 14 : 24) }]}>
        <ScrollView
          style={styles.privacyScroller}
          contentContainerStyle={styles.privacyScrollerContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.privacyCard, { padding: compact ? 18 : 22 }]}>
            <View style={styles.privacyIcon}>
              <Feather name="shield" size={24} color={coverlyBrand.teal} />
            </View>

            <Text style={styles.privacyHeading}>Private and secure</Text>

            <View style={styles.privacyCopyStack}>
              <Text style={styles.privacyBody}>
                Your inventory, photos, videos, receipts, and claim information are private to your account. Coverly uses account-based access controls and row-level security so other users cannot access your records or stored media.
              </Text>
              <Text style={styles.privacyBody}>
                Camera and photo access are used only for app features, including identifying items, building your inventory, storing evidence, and creating claim packs.
              </Text>
              <Text style={styles.privacyBody}>
                We do not sell your data or share it with insurers, assessors, advertisers, or other third parties unless you choose to export or send it.
              </Text>
              <Text style={styles.privacyBody}>
                Your data is protected in transit using secure connections, and stored data is encrypted at rest through Coverly’s database and storage infrastructure.
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.actionStack}>
          <Pressable
            onPress={() => void handlePrivacyContinue()}
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.82 : 1 }]}
          >
            <LinearGradient colors={[BTN_TOP, BTN_BOT]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.primaryBtnInner}>
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Feather name="arrow-right" size={16} color="rgba(255,255,255,0.7)" />
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderStep0 = () => (
    <View style={StyleSheet.absoluteFill}>
      <View style={[styles.stepContainer, { paddingTop: insets.top + (compact ? 10 : 18), paddingBottom: insets.bottom + (compact ? 14 : 24) }]}>
        <View style={[styles.heroCard, { padding: compact ? 18 : 22 }]}>
          <Animated.View style={markStyle}>
            <CoverlyAuthMark style={styles.heroMark} />
          </Animated.View>

          <Text style={styles.heroAppName}>Coverly</Text>
          <Text style={styles.heroTagline}>Know what you own</Text>
          <Text style={styles.heroBody}>
            Build a complete home inventory so you're ready when it matters most: insurance claims, moving, or peace of mind.
          </Text>
        </View>

        <View style={styles.actionStack}>
          <Pressable
            onPress={() => advanceTo(1)}
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.82 : 1 }]}
          >
            <LinearGradient colors={[BTN_TOP, BTN_BOT]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.primaryBtnInner}>
              <Text style={styles.primaryBtnText}>Get started</Text>
              <Feather name="arrow-right" size={16} color="rgba(255,255,255,0.7)" />
            </LinearGradient>
          </Pressable>
          <Pressable onPress={() => void handleSkipOnboarding()} style={({ pressed }) => [styles.skipLink, { opacity: pressed ? 0.5 : 1 }]}>
            <Text style={styles.skipLinkText}>
              Skip for now
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View style={StyleSheet.absoluteFill}>
      <View style={[styles.stepContainer, { paddingTop: insets.top + (compact ? 10 : 18), paddingBottom: insets.bottom + (compact ? 14 : 24) }]}>
        <View style={[styles.contentCard, { padding: compact ? 18 : 22 }]}>
          <Text style={styles.stepHeading}>What Coverly does</Text>
          <Text style={styles.stepSubheading}>
            Everything you need to protect what you own.
          </Text>

          <View style={styles.featureStack}>
            <Animated.View style={[styles.featureRow, row1Style]}>
              <View style={styles.featureIcon}>
                <Feather name="zap" size={19} color={coverlyBrand.teal} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.featureLabel}>AI Scanning</Text>
                <Text style={styles.featureDesc}>
                  Scan a room photo and let Coverly identify items for you.
                </Text>
              </View>
            </Animated.View>

            <Animated.View style={[styles.featureRow, row2Style]}>
              <View style={styles.featureIcon}>
                <Feather name="home" size={19} color={coverlyBrand.teal} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.featureLabel}>Room by room</Text>
                <Text style={styles.featureDesc}>
                  Organise your inventory by property, room, and item.
                </Text>
              </View>
            </Animated.View>

            <Animated.View style={[styles.featureRow, row3Style]}>
              <View style={styles.featureIcon}>
                <Feather name="tag" size={19} color={coverlyBrand.teal} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.featureLabel}>Replacement pricing</Text>
                <Text style={styles.featureDesc}>Find comparable NZ listings and keep your item values current.</Text>
              </View>
            </Animated.View>
          </View>
        </View>

        <View style={styles.actionStack}>
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
          <Pressable onPress={() => void handleSkipOnboarding()} style={({ pressed }) => [styles.skipLink, { opacity: pressed ? 0.5 : 1 }]}>
            <Text style={styles.skipLinkText}>
              Skip for now
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View style={StyleSheet.absoluteFill}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + (compact ? 10 : 18), paddingBottom: insets.bottom + (compact ? 14 : 24) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.contentCard, { padding: compact ? 18 : 22 }]}>
            <Text style={styles.stepHeading}>
              Set up your first property
            </Text>
            <Text style={styles.stepSubheading}>
              You can always add more later.
            </Text>

            <View style={styles.formStack}>
              <View style={{ gap: 8 }}>
                <Text style={styles.fieldLabel}>PROPERTY NAME</Text>
                <TextInput
                  ref={nameInputRef}
                  style={styles.nameInput}
                  value={propertyName}
                  onChangeText={(v) => { setPropertyName(v); setCreateError(null); }}
                  placeholder="e.g. My home, Beach house..."
                  placeholderTextColor={coverlyBrand.mutedText}
                  autoCapitalize="words"
                  returnKeyType="done"
                />
              </View>

            <View style={{ gap: 8 }}>
              <Text style={styles.fieldLabel}>PROPERTY TYPE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2, paddingRight: 12 }}>
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
                        borderColor: sel ? coverlyBrand.teal : coverlyBrand.border,
                        backgroundColor: sel ? coverlyBrand.teal : coverlyBrand.inputBackground,
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <Text style={{ fontSize: 14, fontFamily: sel ? "Inter_600SemiBold" : "Inter_400Regular", color: sel ? coverlyBrand.white : coverlyBrand.slate }}>
                        {pt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={styles.fieldLabel}>CONTENTS COVER AMOUNT</Text>
              <View style={styles.moneyInputRow}>
                <Text style={styles.moneyPrefix}>
                  $
                </Text>
                <TextInput
                  style={styles.moneyInput}
                  value={coverAmount}
                  onChangeText={(v) => setCoverAmount(v.replace(/[^0-9.]/g, ""))}
                  placeholder="e.g. 75000"
                  placeholderTextColor={coverlyBrand.mutedText}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>
              <Text style={styles.helperText}>
                Optional: add your current contents cover so Coverly can compare it with your documented inventory later.
              </Text>
            </View>

            {createError ? (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={14} color="#DC2626" />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" }}>
                  {createError}
                </Text>
              </View>
            ) : null}
            </View>
          </View>

          <View style={styles.actionStack}>
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
    <View style={StyleSheet.absoluteFill}>
      <View style={[styles.stepContainer, { paddingTop: insets.top + (compact ? 10 : 18), paddingBottom: insets.bottom + (compact ? 14 : 24) }]}>
        <View style={[styles.contentCard, styles.successCard, { padding: compact ? 18 : 22 }]}>
          <Animated.View style={[styles.checkCircle, checkStyle]}>
            <Feather name="check" size={32} color={coverlyBrand.teal} />
          </Animated.View>

          <Text style={[styles.celebHeading, { marginTop: 28 }]}>You're all set</Text>

          {newPropertyName ? (
            <View style={styles.propertyPill}>
              <Feather name="home" size={14} color={coverlyBrand.teal} />
              <Text style={styles.propertyPillText}>{newPropertyName}</Text>
            </View>
          ) : null}

          <Text style={[styles.celebBody, { marginTop: 14 }]}>
            You're ready to start building your inventory.
          </Text>
        </View>

        <View style={styles.actionStack}>
          <ProgressDots activeIndex={2} total={3} />
          <Pressable
            onPress={handleComplete}
            style={({ pressed }) => [styles.lightBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.lightBtnText}>Let's go</Text>
            <Feather name="arrow-right" size={16} color={coverlyBrand.teal} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  // ── Root render ─────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: "#F8FEFF" }}>
      <StatusBar style="dark" />
      <CoverlyAuthBackground style={StyleSheet.absoluteFill}>
        <Animated.View
          key={hasPassedPrivacyStep ? step : "privacy"}
          entering={FadeIn.duration(260)}
          exiting={FadeOut.duration(180)}
          style={StyleSheet.absoluteFill}
        >
          {!hasPassedPrivacyStep && renderPrivacyStep()}
          {hasPassedPrivacyStep && step === 0 && renderStep0()}
          {hasPassedPrivacyStep && step === 1 && renderStep1()}
          {hasPassedPrivacyStep && step === 2 && renderStep2()}
          {hasPassedPrivacyStep && step === 3 && renderStep3()}
        </Animated.View>
      </CoverlyAuthBackground>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  stepContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
    gap: 14,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 14,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FEFF",
  },
  privacyScroller: {
    flex: 1,
  },
  privacyScrollerContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  privacyCard: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(224, 234, 240, 0.95)",
    shadowColor: "#0F2A3C",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 8,
  },
  privacyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: coverlyBrand.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  privacyHeading: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: coverlyBrand.slate,
    letterSpacing: 0,
  },
  privacyCopyStack: {
    gap: 14,
    marginTop: 16,
  },
  privacyBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: coverlyBrand.mutedText,
    lineHeight: 21,
  },
  heroCard: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(224, 234, 240, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F2A3C",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 8,
  },
  contentCard: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(224, 234, 240, 0.95)",
    shadowColor: "#0F2A3C",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 8,
  },
  successCard: {
    alignItems: "center",
    justifyContent: "center",
  },
  heroMark: {
    width: 84,
    height: 84,
    marginBottom: 4,
  },
  heroAppName: {
    fontSize: 41,
    fontFamily: "Inter_700Bold",
    color: coverlyBrand.navy,
    letterSpacing: 0,
    marginBottom: 5,
  },
  heroTagline: {
    fontSize: 17,
    fontFamily: "Inter_500Medium",
    color: coverlyBrand.teal,
    letterSpacing: 0,
    marginBottom: 12,
  },
  heroBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: coverlyBrand.mutedText,
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 300,
  },
  stepHeading: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: coverlyBrand.slate,
    letterSpacing: 0,
    marginBottom: 4,
  },
  stepSubheading: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: coverlyBrand.mutedText,
    lineHeight: 20,
  },
  actionStack: {
    gap: 12,
  },
  primaryBtn: {
    borderRadius: RADIUS,
    overflow: "hidden",
    shadowColor: "#0B7468",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 13,
    elevation: 6,
  },
  primaryBtnInner: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: coverlyBrand.white,
    letterSpacing: 0,
  },
  skipLink: {
    alignItems: "center",
    paddingVertical: 6,
  },
  skipLinkText: {
    color: coverlyBrand.mutedText,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  featureStack: {
    gap: 10,
    marginTop: 18,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: coverlyBrand.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  featureLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: coverlyBrand.slate,
  },
  featureDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    color: coverlyBrand.mutedText,
  },
  formStack: {
    gap: 18,
    marginTop: 20,
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.7,
    color: coverlyBrand.mutedText,
  },
  nameInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    backgroundColor: coverlyBrand.inputBackground,
    borderColor: coverlyBrand.border,
    color: coverlyBrand.slate,
  },
  moneyInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 12,
    borderColor: coverlyBrand.border,
    backgroundColor: coverlyBrand.inputBackground,
    overflow: "hidden",
  },
  moneyPrefix: {
    paddingLeft: 14,
    paddingRight: 2,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: coverlyBrand.mutedText,
  },
  moneyInput: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 14,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: coverlyBrand.slate,
  },
  helperText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: coverlyBrand.mutedText,
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
  },
  checkCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: coverlyBrand.inputBackground,
    borderWidth: 1,
    borderColor: coverlyBrand.border,
    alignItems: "center",
    justifyContent: "center",
  },
  celebHeading: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: coverlyBrand.slate,
    textAlign: "center",
    letterSpacing: 0,
  },
  propertyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: coverlyBrand.white,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 14,
    borderWidth: 1,
    borderColor: coverlyBrand.border,
  },
  propertyPillText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: coverlyBrand.teal,
  },
  celebBody: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: coverlyBrand.mutedText,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
  },
  lightBtn: {
    height: 50,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: coverlyBrand.border,
    backgroundColor: "rgba(255,255,255,0.96)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  lightBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: coverlyBrand.teal,
  },
});
