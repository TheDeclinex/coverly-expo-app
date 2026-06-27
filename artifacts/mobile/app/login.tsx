import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect } from "expo-router";
import React, { useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
// Deep slate blue-grey — premium, calm, trustworthy (not cyber-black)
const BG          = "#111C2A";
const BLOB_A      = "rgba(29,158,117,0.13)";   // restrained teal glow, upper-right
const BLOB_B      = "rgba(8,28,68,0.55)";       // deep navy, lower-left
const HERO_TEXT   = "#FFFFFF";
const HERO_SUB    = "rgba(255,255,255,0.88)";
const ICON_BORDER = "rgba(15,143,131,0.45)";
const ICON_BG     = "rgba(255,255,255,0.07)";
const DOT_COLOR   = "rgba(255,255,255,0.08)";
const BTN_TOP     = "#0F8F83";
const BTN_BOT     = "#0B7468";
const RADIUS      = 12;

// Set true only to debug Supabase connectivity in dev builds.
const SHOW_CONNECTION_DEBUG = false;

// ─── Dot grid ─────────────────────────────────────────────────────────────────
function DotGrid() {
  const COLS = 10, ROWS = 19, H = 38, V = 46;
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
            top: r * V + 10, left: c * H + 10,
          }}
        />
      );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {nodes}
    </View>
  );
}

// ─── Scan-frame corners — subtle home-inventory / scanning texture ─────────────
function ScanCorners() {
  const L = 26;   // arm length
  const T = 1.5;  // arm thickness
  const M = 36;   // margin from edges
  const C = "rgba(255,255,255,0.10)";
  const h = (top?: number, bottom?: number, left?: number, right?: number) =>
    ({ position: "absolute" as const, height: T, width: L, backgroundColor: C, top, bottom, left, right });
  const v = (top?: number, bottom?: number, left?: number, right?: number) =>
    ({ position: "absolute" as const, width: T, height: L, backgroundColor: C, top, bottom, left, right });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* top-left */}
      <View style={h(M, undefined, M, undefined)} />
      <View style={v(M, undefined, M, undefined)} />
      {/* top-right */}
      <View style={h(M, undefined, undefined, M)} />
      <View style={v(M, undefined, undefined, M)} />
      {/* bottom-left */}
      <View style={h(undefined, M, M, undefined)} />
      <View style={v(undefined, M, M, undefined)} />
      {/* bottom-right */}
      <View style={h(undefined, M, undefined, M)} />
      <View style={v(undefined, M, undefined, M)} />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
type Mode = "signin" | "signup" | "forgot";

export default function LoginScreen() {
  const { session, hasSeenOnboarding } = useAuth();
  const colors      = useColors();
  const insets      = useSafeAreaInsets();

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

  // dev-only
  const [testResult,  setTestResult]  = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

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

  const PrimaryButton = ({
    label,
    onPress,
  }: {
    label: string;
    onPress: () => void;
  }) => (
    <Pressable
      style={({ pressed }) => [styles.signInBtn, (loading || pressed) && { opacity: 0.78 }]}
      onPress={onPress}
      disabled={loading}
    >
      <LinearGradient
        colors={[BTN_TOP, BTN_BOT]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.signInGradient}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Text style={styles.signInText}>{label}</Text>
            <Feather name="arrow-right" size={16} color="rgba(255,255,255,0.65)" style={{ marginLeft: 8 }} />
          </>
        )}
      </LinearGradient>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      {/* Slate blue-grey canvas */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BG }]} />
      <DotGrid />
      <ScanCorners />

      {/* Ambient glows */}
      <View style={[styles.blob, { top: -110, right: -110, backgroundColor: BLOB_A }]} />
      <View style={[styles.blob, { bottom: 60, left: -130, width: 300, height: 300, borderRadius: 150, backgroundColor: BLOB_B }]} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero ── */}
          <View style={styles.hero}>
            <View style={[styles.iconMark, { backgroundColor: ICON_BG, borderColor: ICON_BORDER }]}>
              <Feather name="shield" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.appName}>Coverly</Text>
            <Text style={styles.tagline}>Know what you own</Text>
          </View>

          {/* ── Card ── */}
          <View style={styles.card}>

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
                body={`We sent a password reset link to\n${email.trim()}\n\nCheck your inbox and follow the link to set a new password.`}
                onBack={() => switchMode("signin")}
                backLabel="Back to Sign In"
                colors={colors}
              />

            /* ── Normal form ── */
            ) : (
              <>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  {isSignUp ? "Create your account" : isForgot ? "Reset your password" : "Welcome back"}
                </Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                  {isSignUp
                    ? "Start building your home inventory"
                    : isForgot
                    ? "Enter your email and we'll send a reset link"
                    : "Sign in to view your home inventory"}
                </Text>

                {/* Email */}
                <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
                <View style={[styles.inputRow, { backgroundColor: colors.muted, borderColor: emailFocused ? colors.primary : colors.border }]}>
                  <Feather name="mail" size={15} color={colors.mutedForeground} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.mutedForeground}
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
                      <Text style={[styles.label, { color: colors.foreground, marginTop: 0, marginBottom: 0 }]}>
                        Password
                      </Text>
                      {isSignIn && (
                        <Pressable
                          onPress={() => switchMode("forgot")}
                          hitSlop={8}
                        >
                          <Text style={[styles.forgotLink, { color: colors.primary }]}>
                            Forgot password?
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    <View style={[styles.inputRow, { backgroundColor: colors.muted, borderColor: pwFocused ? colors.primary : colors.border }]}>
                      <Feather name="lock" size={15} color={colors.mutedForeground} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: colors.foreground }]}
                        value={password}
                        onChangeText={setPassword}
                        placeholder={isSignUp ? "Min. 8 characters" : "••••••••"}
                        placeholderTextColor={colors.mutedForeground}
                        secureTextEntry={!showPassword}
                        autoComplete={isSignUp ? "new-password" : "password"}
                        returnKeyType={isSignUp ? "next" : "go"}
                        onSubmitEditing={isSignUp ? undefined : handleLogin}
                        onFocus={() => setPwFocused(true)}
                        onBlur={() => setPwFocused(false)}
                      />
                      <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
                        <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                      </Pressable>
                    </View>
                  </>
                )}

                {/* Confirm password — sign-up only */}
                {isSignUp && (
                  <>
                    <Text style={[styles.label, { color: colors.foreground }]}>Confirm password</Text>
                    <View style={[styles.inputRow, { backgroundColor: colors.muted, borderColor: confirmFocused ? colors.primary : colors.border }]}>
                      <Feather name="lock" size={15} color={colors.mutedForeground} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: colors.foreground }]}
                        value={confirmPw}
                        onChangeText={setConfirmPw}
                        placeholder="Repeat password"
                        placeholderTextColor={colors.mutedForeground}
                        secureTextEntry={!showConfirm}
                        autoComplete="new-password"
                        returnKeyType="go"
                        onSubmitEditing={handleSignUp}
                        onFocus={() => setConfirmFocused(true)}
                        onBlur={() => setConfirmFocused(false)}
                      />
                      <Pressable style={styles.eyeBtn} onPress={() => setShowConfirm((v) => !v)}>
                        <Feather name={showConfirm ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
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
                    <Feather name="lock" size={11} color={colors.mutedForeground} />
                    <Text style={[styles.reassuranceText, { color: colors.mutedForeground }]}>
                      Your data is encrypted and securely stored.
                    </Text>
                  </View>
                )}

                {/* Divider */}
                <View style={[styles.divider, { backgroundColor: colors.border }]} />

                {/* Mode CTA — outlined secondary button, clearly tappable */}
                {isSignIn && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.signUpCta,
                      { borderColor: colors.border, borderRadius: RADIUS, opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => switchMode("signup")}
                  >
                    <Text style={[styles.signUpCtaMuted, { color: colors.mutedForeground }]}>
                      New to Coverly?{"  "}
                    </Text>
                    <Text style={[styles.signUpCtaLink, { color: colors.primary }]}>
                      Create your free inventory
                    </Text>
                  </Pressable>
                )}

                {/* Back to sign-in for sign-up and forgot modes */}
                {(isSignUp || isForgot) && (
                  <Pressable
                    style={({ pressed }) => [styles.modeToggleBtn, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => switchMode("signin")}
                  >
                    <Text style={[styles.modeToggleText, { color: colors.mutedForeground }]}>
                      {isSignUp ? "Already have an account?  " : "Remember your password?  "}
                      <Text style={[styles.modeToggleLink, { color: colors.primary }]}>Sign in</Text>
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
          </View>
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
  root: { flex: 1 },

  blob: { position: "absolute", width: 360, height: 360, borderRadius: 180 },

  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, gap: 24 },

  // Hero
  hero:     { alignItems: "center", gap: 10 },
  iconMark: { width: 76, height: 76, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  appName:  { fontSize: 38, fontFamily: "Inter_700Bold", color: HERO_TEXT, letterSpacing: -0.8 },
  tagline:  { fontSize: 15, fontFamily: "Inter_500Medium", color: HERO_SUB, letterSpacing: 0.4 },

  // Card
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 14,
  },
  cardTitle: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 3 },
  cardSub:   { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 20 },

  // Inbox success state
  confirmBox:     { alignItems: "center", paddingVertical: 8, gap: 12 },
  confirmIconWrap:{ width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  confirmTitle:   { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  confirmBody:    { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  backToSignIn:   { borderWidth: 1, height: 44, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", marginTop: 4 },
  backToSignInText:{ fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Form
  labelRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 6 },
  label:     { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6, marginTop: 12 },
  forgotLink:{ fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow:  { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 13, height: 50 },
  inputIcon: { marginRight: 10 },
  input:     { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", paddingVertical: 0 },
  eyeBtn:    { padding: 4 },

  errorBox:  { backgroundColor: "#FEF2F2", borderRadius: 8, padding: 12, marginTop: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" },

  // Primary button
  signInBtn: {
    marginTop: 20,
    borderRadius: RADIUS,
    overflow: "hidden",
    shadowColor: "#0B7468",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  signInGradient: { height: 54, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  signInText:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF", letterSpacing: 0.6 },

  // Security reassurance
  reassurance:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 14 },
  reassuranceText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  // Divider between reassurance and mode CTA
  divider: { height: 1, marginVertical: 16 },

  // Sign-up CTA — outlined secondary button
  signUpCta:     { borderWidth: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, flexWrap: "wrap" },
  signUpCtaMuted:{ fontSize: 14, fontFamily: "Inter_400Regular" },
  signUpCtaLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

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
