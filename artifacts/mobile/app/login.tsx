import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  ImageBackground,
  Keyboard,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { coverlyBrand } from "@/constants/brand";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  supabase,
  debugSupabaseUrl,
  debugAnonKeyExists,
  debugAnonKeyPrefix,
  anonKey,
} from "@/lib/supabase";

// ─── Design tokens ────────────────────────────────────────────────────────────
const HERO_TEXT   = coverlyBrand.navy;
const BTN_TOP     = coverlyBrand.teal;
const BTN_BOT     = coverlyBrand.tealDark;
const RADIUS      = 12;
const COVERLY_MARK = require("../assets/brand/coverly-login-mark-tight.png");
const AUTH_BACKGROUND = require("../assets/brand/coverly-login-background.png");

// Set true only to debug Supabase connectivity in dev builds.
const SHOW_CONNECTION_DEBUG = false;

// ─── Screen ───────────────────────────────────────────────────────────────────
type Mode = "signin" | "signup" | "forgot";

export default function LoginScreen() {
  const { session, hasSeenOnboarding } = useAuth();
  const colors      = useColors();
  const insets      = useSafeAreaInsets();
  const { height }  = useWindowDimensions();
  const compact     = height < 760;

  const [mode, setMode]                 = useState<Mode>("signin");
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [confirmPw, setConfirmPw]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [awaitConfirm, setAwaitConfirm] = useState(false);
  const [resetSent, setResetSent]       = useState(false);

  const [emailFocused,   setEmailFocused]   = useState(false);
  const [pwFocused,      setPwFocused]      = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // dev-only
  const [testResult,  setTestResult]  = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoTranslate = useRef(new Animated.Value(8)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslate = useRef(new Animated.Value(14)).current;
  const ambient = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const arrowShift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const entrance = Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(logoTranslate, {
        toValue: 0,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(titleOpacity, {
        toValue: 1,
        duration: 340,
        delay: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 380,
        delay: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslate, {
        toValue: 0,
        duration: 380,
        delay: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    const ambientLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ambient, {
          toValue: 1,
          duration: 5200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ambient, {
          toValue: 0,
          duration: 5200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    entrance.start();
    ambientLoop.start();
    return () => {
      entrance.stop();
      ambientLoop.stop();
    };
  }, [
    ambient,
    cardOpacity,
    cardTranslate,
    logoOpacity,
    logoTranslate,
    titleOpacity,
  ]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Route based on onboarding state:
  //   null  = still resolving AsyncStorage — keep showing splash (handled by _layout.tsx)
  //   false = new user, hasn't finished onboarding
  //   true  = returning user, go straight to the app
  if (session && hasSeenOnboarding === true) return <Redirect href="/(tabs)" />;
  if (session && hasSeenOnboarding === false) return <Redirect href="/onboarding" />;
  if (session && hasSeenOnboarding === null) return null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setAwaitConfirm(false);
    setResetSent(false);
    setPassword("");
    setConfirmPw("");
    setShowPassword(false);
    setShowConfirm(false);
  };

  const HEALTH_URL = `${debugSupabaseUrl}/auth/v1/health`;

  const handleTestConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    const keyDebug = `key set: ${debugAnonKeyExists}, prefix: ${debugAnonKeyPrefix}...`;
    try {
      const res  = await fetch(HEALTH_URL, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      const text = await res.text();
      setTestResult(
        `platform: ${Platform.OS}\nurl: ${debugSupabaseUrl}\n${keyDebug}\n\n✅ ${res.status} ${res.statusText}\n${text}`
      );
    } catch (e: unknown) {
      setTestResult(
        `platform: ${Platform.OS}\nurl: ${debugSupabaseUrl}\n${keyDebug}\n\n❌ ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      setTestLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (authError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(authError.message);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    // Post-verification landing page. Keep this Coverly-owned URL allowlisted in
    // Supabase Auth redirect settings; native deep-link callback can replace it
    // once app links are fully configured.
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: "https://www.coverly.nz/auth/verified" },
    });
    setLoading(false);
    if (authError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(authError.message);
    } else if (data.session) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAwaitConfirm(true);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    setError(null);
    // TODO(auth): Wire a confirmed Coverly-owned password recovery completion
    // route here (web reset page or native deep link) via redirectTo once it is
    // allowlisted in Supabase Auth redirect settings. Until then, keep mobile
    // copy explicit that the reset is completed from the email link.
    const { error: authError } = await supabase.auth.resetPasswordForEmail(
      email.trim()
    );
    setLoading(false);
    if (authError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(authError.message);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResetSent(true);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────
  const isSignUp  = mode === "signup";
  const isForgot  = mode === "forgot";
  const isSignIn  = mode === "signin";

  const animatePrimaryPress = (pressed: boolean) => {
    Animated.parallel([
      Animated.timing(buttonScale, {
        toValue: pressed ? 0.985 : 1,
        duration: pressed ? 90 : 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(arrowShift, {
        toValue: pressed ? 3 : 0,
        duration: pressed ? 90 : 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const PrimaryButton = ({
    label,
    onPress,
  }: {
    label: string;
    onPress: () => void;
  }) => (
    <Pressable
      style={({ pressed }) => [styles.signInBtn, loading && { opacity: 0.78 }, pressed && { opacity: 0.92 }]}
      onPress={onPress}
      onPressIn={() => animatePrimaryPress(true)}
      onPressOut={() => animatePrimaryPress(false)}
      disabled={loading}
    >
      <Animated.View
        style={[
          styles.signInAnimated,
          {
            transform: [{ scale: buttonScale }],
          },
        ]}
      >
        <LinearGradient
          colors={[BTN_TOP, BTN_BOT]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.signInGradient}
        >
          {loading ? (
            <ActivityIndicator color={coverlyBrand.white} />
          ) : (
            <>
              <Text style={styles.signInText}>{label}</Text>
              <Animated.View style={{ transform: [{ translateX: arrowShift }] }}>
                <Feather
                  name="arrow-right"
                  size={16}
                  color="rgba(255,255,255,0.72)"
                  style={{ marginLeft: 8 }}
                />
              </Animated.View>
            </>
          )}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <ImageBackground
        source={AUTH_BACKGROUND}
        resizeMode="contain"
        style={StyleSheet.absoluteFill}
        imageStyle={styles.backgroundImage}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.22)", "rgba(255,255,255,0.05)"]}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              minHeight: height,
              paddingTop: insets.top + (compact ? 12 : 20),
              paddingBottom: insets.bottom + (compact ? 8 : 14),
              gap: compact ? 14 : 20,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={keyboardVisible || isSignUp}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero ── */}
          <View style={styles.hero}>
            <Animated.View
              style={[
                styles.iconMark,
                {
                  backgroundColor: "transparent",
                  borderColor: "transparent",
                  opacity: logoOpacity,
                  transform: [{ translateY: logoTranslate }],
                },
              ]}
            >
              <Image
                source={COVERLY_MARK}
                style={styles.iconImage}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </Animated.View>
            <Animated.View style={[styles.heroTextWrap, { opacity: titleOpacity }]}>
              <Text style={styles.appName}>Coverly</Text>
              <Text style={styles.tagline}>Know what you own</Text>
            </Animated.View>
          </View>

          {/* ── Card ── */}
          <Animated.View
            style={[
              styles.card,
              {
                padding: compact ? 18 : 22,
                opacity: cardOpacity,
                transform: [{ translateY: cardTranslate }],
              },
            ]}
          >

            {/* ── Awaiting email confirmation (sign-up) ── */}
            {awaitConfirm ? (
              <InboxState
                title="Check your inbox"
                body={`We sent a confirmation link to\n${email.trim()}\n\nTap the link in your email to verify your account, then return to Coverly and sign in.`}
                onBack={() => switchMode("signin")}
                backLabel="Back to Sign In"
                colors={colors}
              />

            /* ── Password reset sent ── */
            ) : resetSent ? (
              <InboxState
                title="Reset link sent"
                body={`We sent a password reset link to\n${email.trim()}\n\nOpen the link from your email to set a new password, then return to Coverly and sign in.`}
                onBack={() => switchMode("signin")}
                backLabel="Back to Sign In"
                colors={colors}
              />

            /* ── Normal form ── */
            ) : (
              <>
                <Text style={[styles.cardTitle, { color: coverlyBrand.slate }]}>
                  {isSignUp ? "Create your account" : isForgot ? "Reset your password" : "Welcome back"}
                </Text>
                <Text style={[styles.cardSub, { color: coverlyBrand.mutedText }]}>
                  {isSignUp
                    ? "Start building your home inventory"
                    : isForgot
                    ? "We'll email you a reset link. Complete the reset from that link, then return here to sign in."
                    : "Access your home contents inventory"}
                </Text>

                {/* Email */}
                <Text style={[styles.label, { color: coverlyBrand.slate }]}>Email</Text>
                <View style={[styles.inputRow, { backgroundColor: coverlyBrand.inputBackground, borderColor: emailFocused ? coverlyBrand.teal : coverlyBrand.border }]}>
                  <Feather name="mail" size={15} color={coverlyBrand.mutedText} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: coverlyBrand.slate }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={coverlyBrand.mutedText}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    returnKeyType={isForgot ? "go" : "next"}
                    onSubmitEditing={isForgot ? handleForgotPassword : undefined}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                  />
                </View>

                {/* Password — hidden in forgot mode */}
                {!isForgot && (
                  <>
                    {/* Label row with inline Forgot link for sign-in */}
                    <View style={styles.labelRow}>
                      <Text style={[styles.label, { color: coverlyBrand.slate, marginTop: 0, marginBottom: 0 }]}>
                        Password
                      </Text>
                      {isSignIn && (
                        <Pressable
                          onPress={() => switchMode("forgot")}
                          hitSlop={8}
                        >
                          <Text style={[styles.forgotLink, { color: coverlyBrand.teal }]}>
                            Forgot password?
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    <View style={[styles.inputRow, { backgroundColor: coverlyBrand.inputBackground, borderColor: pwFocused ? coverlyBrand.teal : coverlyBrand.border }]}>
                      <Feather name="lock" size={15} color={coverlyBrand.mutedText} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: coverlyBrand.slate }]}
                        value={password}
                        onChangeText={setPassword}
                        placeholder={isSignUp ? "Min. 8 characters" : "••••••••"}
                        placeholderTextColor={coverlyBrand.mutedText}
                        secureTextEntry={!showPassword}
                        autoComplete={isSignUp ? "new-password" : "password"}
                        returnKeyType={isSignUp ? "next" : "go"}
                        onSubmitEditing={isSignUp ? undefined : handleLogin}
                        onFocus={() => setPwFocused(true)}
                        onBlur={() => setPwFocused(false)}
                      />
                      <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
                        <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={coverlyBrand.mutedText} />
                      </Pressable>
                    </View>
                  </>
                )}

                {/* Confirm password — sign-up only */}
                {isSignUp && (
                  <>
                    <Text style={[styles.label, { color: coverlyBrand.slate }]}>Confirm password</Text>
                    <View style={[styles.inputRow, { backgroundColor: coverlyBrand.inputBackground, borderColor: confirmFocused ? coverlyBrand.teal : coverlyBrand.border }]}>
                      <Feather name="lock" size={15} color={coverlyBrand.mutedText} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: coverlyBrand.slate }]}
                        value={confirmPw}
                        onChangeText={setConfirmPw}
                        placeholder="Repeat password"
                        placeholderTextColor={coverlyBrand.mutedText}
                        secureTextEntry={!showConfirm}
                        autoComplete="new-password"
                        returnKeyType="go"
                        onSubmitEditing={handleSignUp}
                        onFocus={() => setConfirmFocused(true)}
                        onBlur={() => setConfirmFocused(false)}
                      />
                      <Pressable style={styles.eyeBtn} onPress={() => setShowConfirm((v) => !v)}>
                        <Feather name={showConfirm ? "eye-off" : "eye"} size={18} color={coverlyBrand.mutedText} />
                      </Pressable>
                    </View>
                  </>
                )}

                {/* Error */}
                {error ? (
                  <View style={styles.errorBox}>
                    <Feather name="alert-circle" size={15} color="#DC2626" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {/* Primary action */}
                <PrimaryButton
                  label={isSignUp ? "Create Account" : isForgot ? "Send Reset Link" : "Sign In"}
                  onPress={isSignUp ? handleSignUp : isForgot ? handleForgotPassword : handleLogin}
                />

                {/* Security reassurance — sign-in and sign-up only */}
                {!isForgot && (
                  <View style={styles.reassurance}>
                    <Feather name="lock" size={11} color={coverlyBrand.mutedText} />
                    <Text style={[styles.reassuranceText, { color: coverlyBrand.mutedText }]}>
                      Your data is encrypted and securely stored.
                    </Text>
                  </View>
                )}

                {/* Divider */}
                <View style={[styles.divider, { backgroundColor: coverlyBrand.border }]} />

                {/* Mode CTA — outlined secondary button, clearly tappable */}
                {isSignIn && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.signUpCta,
                      { borderColor: coverlyBrand.border, borderRadius: RADIUS, opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => switchMode("signup")}
                  >
                    <Text style={[styles.signUpCtaMuted, { color: coverlyBrand.navy }]}>
                      New to Coverly?
                    </Text>
                    <View style={styles.signUpCtaLinkRow}>
                      <Text style={[styles.signUpCtaLink, { color: coverlyBrand.teal }]}>
                        Create your free inventory
                      </Text>
                      <Feather name="arrow-right" size={17} color={coverlyBrand.teal} />
                    </View>
                  </Pressable>
                )}

                {/* Back to sign-in for sign-up and forgot modes */}
                {(isSignUp || isForgot) && (
                  <Pressable
                    style={({ pressed }) => [styles.modeToggleBtn, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => switchMode("signin")}
                  >
                    <Text style={[styles.modeToggleText, { color: coverlyBrand.mutedText }]}>
                      {isSignUp ? "Already have an account?  " : "Remember your password?  "}
                      <Text style={[styles.modeToggleLink, { color: coverlyBrand.teal }]}>Sign in</Text>
                    </Text>
                  </Pressable>
                )}

                {/* Dev-only */}
                {__DEV__ && SHOW_CONNECTION_DEBUG ? (
                  <>
                    <Pressable
                      style={({ pressed }) => [
                        styles.devBtn,
                        { borderColor: colors.border, borderRadius: RADIUS },
                        (testLoading || pressed) && { opacity: 0.6 },
                      ]}
                      onPress={handleTestConnection}
                      disabled={testLoading}
                    >
                      {testLoading ? (
                        <ActivityIndicator color={colors.mutedForeground} size="small" />
                      ) : (
                        <Text style={[styles.devBtnText, { color: colors.mutedForeground }]}>
                          Test Supabase Connection
                        </Text>
                      )}
                    </Pressable>
                    {testResult ? (
                      <View style={[styles.testResult, { backgroundColor: colors.muted, borderRadius: RADIUS }]}>
                        <Text style={[styles.testResultText, { color: colors.foreground }]}>
                          {testResult}
                        </Text>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Shared "inbox" success state ─────────────────────────────────────────────
function InboxState({
  title,
  body,
  onBack,
  backLabel,
  colors,
}: {
  title: string;
  body: string;
  onBack: () => void;
  backLabel: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={styles.confirmBox}>
      <View style={[styles.confirmIconWrap, { backgroundColor: colors.secondary }]}>
        <Feather name="mail" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.confirmTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.confirmBody, { color: colors.mutedForeground }]}>{body}</Text>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [
          styles.backToSignIn,
          { borderColor: colors.border, borderRadius: RADIUS, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.backToSignInText, { color: colors.primary }]}>{backLabel}</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8FEFF" },
  backgroundImage: { opacity: 1 },

  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24 },

  // Hero
  hero: { alignItems: "center", gap: 8 },
  heroTextWrap: { alignItems: "center", gap: 5 },
  iconMark: {
    width: 84,
    height: 84,
    borderRadius: 0,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  iconImage: { width: 84, height: 84 },
  appName: { fontSize: 41, fontFamily: "Inter_700Bold", color: HERO_TEXT, letterSpacing: 0 },
  tagline: { fontSize: 17, fontFamily: "Inter_500Medium", color: "#0A8F86", letterSpacing: 0 },

  // Card
  card: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(224, 234, 240, 0.95)",
    padding: 24,
    shadowColor: "#0F2A3C",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 8,
  },
  cardTitle: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 3 },
  cardSub:   { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 10, lineHeight: 20 },

  // Inbox success state
  confirmBox:     { alignItems: "center", paddingVertical: 8, gap: 12 },
  confirmIconWrap:{ width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  confirmTitle:   { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  confirmBody:    { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  backToSignIn:   { borderWidth: 1, height: 44, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", marginTop: 4 },
  backToSignInText:{ fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Form
  labelRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, marginBottom: 5 },
  label:     { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 5, marginTop: 10 },
  forgotLink:{ fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow:  { flexDirection: "row", alignItems: "center", borderWidth: 1.4, borderRadius: 12, paddingHorizontal: 13, height: 46 },
  inputIcon: { marginRight: 10 },
  input:     { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", paddingVertical: 0 },
  eyeBtn:    { padding: 4 },

  errorBox:  { backgroundColor: "#FEF2F2", borderRadius: 8, padding: 12, marginTop: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" },

  // Primary button
  signInBtn: {
    marginTop: 15,
    borderRadius: RADIUS,
    overflow: "hidden",
    shadowColor: "#0B7468",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 13,
    elevation: 6,
  },
  signInAnimated: { borderRadius: RADIUS, overflow: "hidden" },
  signInGradient: { height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  signInText:     { fontSize: 16, fontFamily: "Inter_700Bold", color: coverlyBrand.white, letterSpacing: 0 },

  // Security reassurance
  reassurance:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 },
  reassuranceText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  // Divider between reassurance and mode CTA
  divider: { height: 1, marginVertical: 13 },

  // Sign-up CTA — outlined secondary button
  signUpCta:     { alignItems: "center", justifyContent: "center", paddingVertical: 2, gap: 8 },
  signUpCtaLinkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  signUpCtaMuted:{ fontSize: 14, fontFamily: "Inter_400Regular" },
  signUpCtaLink: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // Back / mode toggle link (sign-up → sign-in, forgot → sign-in)
  modeToggleBtn:  { alignItems: "center", paddingVertical: 10 },
  modeToggleText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  modeToggleLink: { fontFamily: "Inter_600SemiBold" },

  // Dev-only
  devBtn:         { borderWidth: 1, height: 40, alignItems: "center", justifyContent: "center", marginTop: 10 },
  devBtnText:     { fontSize: 12, fontFamily: "Inter_400Regular" },
  testResult:     { marginTop: 10, padding: 12 },
  testResultText: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
