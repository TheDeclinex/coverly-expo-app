import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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

const BG = "#081410";
const BLOB_A = "rgba(29,158,117,0.16)";
const BLOB_B = "rgba(8,80,65,0.22)";
const HERO_TEXT = "#FFFFFF";
const HERO_SUB = "rgba(255,255,255,0.62)";
const ICON_BORDER = "rgba(29,158,117,0.5)";
const ICON_BG = "rgba(255,255,255,0.08)";

export default function LoginScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  if (session) return <Redirect href="/(tabs)" />;

  const HEALTH_URL = "https://krbrmskfvpjukcbkbegc.supabase.co/auth/v1/health";

  const handleTestConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    const keyDebug = `key set: ${debugAnonKeyExists}, prefix: ${debugAnonKeyPrefix}...`;
    try {
      const res = await fetch(HEALTH_URL, {
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

  return (
    <View style={styles.root}>
      {/* Background canvas */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BG }]} />

      {/* Ambient blob glows — upper-right teal, lower-left deep green */}
      <View
        style={[
          styles.blob,
          { top: -110, right: -110, backgroundColor: BLOB_A },
        ]}
      />
      <View
        style={[
          styles.blob,
          {
            bottom: 60,
            left: -130,
            width: 320,
            height: 320,
            borderRadius: 160,
            backgroundColor: BLOB_B,
          },
        ]}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingTop: insets.top + 52,
              paddingBottom: insets.bottom + 40,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero / brand mark ── */}
          <View style={styles.hero}>
            <View
              style={[
                styles.iconMark,
                { backgroundColor: ICON_BG, borderColor: ICON_BORDER },
              ]}
            >
              <Feather name="shield" size={32} color="#FFFFFF" />
            </View>

            <Text style={styles.appName}>Coverly</Text>
            <Text style={styles.tagline}>Know what you own</Text>
          </View>

          {/* ── Login card ── */}
          <View style={[styles.card, { borderRadius: 20 }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Welcome back
            </Text>
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
              Sign in to view your home inventory
            </Text>

            {/* Email */}
            <Text style={[styles.label, { color: colors.foreground }]}>
              Email
            </Text>
            <View
              style={[
                styles.inputRow,
                {
                  backgroundColor: colors.muted,
                  borderColor: emailFocused ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather
                name="mail"
                size={15}
                color={colors.mutedForeground}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
              />
            </View>

            {/* Password */}
            <Text style={[styles.label, { color: colors.foreground }]}>
              Password
            </Text>
            <View
              style={[
                styles.inputRow,
                {
                  backgroundColor: colors.muted,
                  borderColor: passwordFocused ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather
                name="lock"
                size={15}
                color={colors.mutedForeground}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
              />
              <Pressable
                style={styles.eyeBtn}
                onPress={() => setShowPassword((v) => !v)}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>

            {/* Error */}
            {error ? (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={15} color="#DC2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Sign in */}
            <Pressable
              style={({ pressed }) => [
                styles.signInBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                },
                (loading || pressed) && { opacity: 0.72 },
              ]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.signInText}>Sign In</Text>
              )}
            </Pressable>

            {/* Dev-only: Supabase connection tester — hidden in production */}
            {__DEV__ ? (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.devBtn,
                    {
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                    },
                    (testLoading || pressed) && { opacity: 0.6 },
                  ]}
                  onPress={handleTestConnection}
                  disabled={testLoading}
                >
                  {testLoading ? (
                    <ActivityIndicator
                      color={colors.mutedForeground}
                      size="small"
                    />
                  ) : (
                    <Text
                      style={[
                        styles.devBtnText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Test Supabase Connection
                    </Text>
                  )}
                </Pressable>

                {testResult ? (
                  <View
                    style={[
                      styles.testResult,
                      {
                        backgroundColor: colors.muted,
                        borderRadius: colors.radius,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.testResultText,
                        { color: colors.foreground },
                      ]}
                    >
                      {testResult}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  blob: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
  },

  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 32,
  },

  hero: {
    alignItems: "center",
    gap: 10,
  },

  iconMark: {
    width: 76,
    height: 76,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },

  appName: {
    fontSize: 38,
    fontFamily: "Inter_700Bold",
    color: HERO_TEXT,
    letterSpacing: -0.8,
  },

  tagline: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: HERO_SUB,
    letterSpacing: 0.1,
  },

  card: {
    backgroundColor: "#FFFFFF",
    padding: 28,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 14,
  },

  cardTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },

  cardSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 22,
    lineHeight: 20,
  },

  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 7,
    marginTop: 14,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 13,
    height: 52,
  },

  inputIcon: {
    marginRight: 10,
  },

  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    paddingVertical: 0,
  },

  eyeBtn: { padding: 4 },

  errorBox: {
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#DC2626",
  },

  signInBtn: {
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 26,
  },

  signInText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },

  devBtn: {
    borderWidth: 1,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },

  devBtnText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },

  testResult: {
    marginTop: 10,
    padding: 12,
  },

  testResultText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
});
