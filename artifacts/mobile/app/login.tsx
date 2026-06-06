import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect } from "expo-router";
import * as Haptics from "expo-haptics";
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
import { supabase, debugSupabaseUrl, debugAnonKeyExists, debugAnonKeyPrefix, anonKey } from "@/lib/supabase";

export default function LoginScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  const HEALTH_URL = "https://krbrmskfvpjukcbkbegc.supabase.co/auth/v1/health";

  const handleTestConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    const keyDebug = `key set: ${debugAnonKeyExists}, prefix: ${debugAnonKeyPrefix}...`;
    try {
      const res = await fetch(HEALTH_URL, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });
      const text = await res.text();
      setTestResult(
        `platform: ${Platform.OS}\nurl: ${debugSupabaseUrl}\n${keyDebug}\n\n✅ ${res.status} ${res.statusText}\n${text}`
      );
    } catch (e: unknown) {
      setTestResult(
        `platform: ${Platform.OS}\nurl: ${debugSupabaseUrl}\n${keyDebug}\n\n❌ ${e instanceof Error ? e.message : String(e)}`
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

  const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { flexGrow: 1 },
    hero: {
      paddingTop: insets.top + 48,
      paddingBottom: 40,
      alignItems: "center",
    },
    shieldWrapper: {
      width: 72,
      height: 72,
      borderRadius: 20,
      backgroundColor: "rgba(255,255,255,0.15)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    appName: {
      fontSize: 32,
      fontFamily: "Inter_700Bold",
      color: "#FFFFFF",
      letterSpacing: -0.5,
    },
    tagline: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: "rgba(255,255,255,0.75)",
      marginTop: 4,
    },
    card: {
      flex: 1,
      backgroundColor: colors.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: 28,
      paddingBottom: insets.bottom + 24,
    },
    cardTitle: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 6,
    },
    cardSubtitle: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginBottom: 28,
    },
    label: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      marginBottom: 6,
      marginTop: 16,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      height: 50,
    },
    inputRowFocused: {
      borderColor: colors.primary,
    },
    input: {
      flex: 1,
      fontSize: 16,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      paddingVertical: 0,
    },
    eyeButton: {
      padding: 4,
    },
    errorBox: {
      backgroundColor: "#FEF2F2",
      borderRadius: colors.radius,
      padding: 12,
      marginTop: 20,
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
    loginButton: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 28,
    },
    loginButtonDisabled: {
      opacity: 0.6,
    },
    loginButtonText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    testButton: {
      borderWidth: 1,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 12,
    },
    testButtonText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
    },
    testResult: {
      marginTop: 12,
      padding: 12,
    },
    testResultText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      lineHeight: 18,
    },
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#0F2B5B", "#1B4FD8"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.shieldWrapper}>
              <Feather name="shield" size={36} color="#FFFFFF" />
            </View>
            <Text style={styles.appName}>Coverly</Text>
            <Text style={styles.tagline}>Home Contents Inventory</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome back</Text>
            <Text style={styles.cardSubtitle}>
              Sign in to view your inventory
            </Text>

            <Text style={styles.label}>Email</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
              />
            </View>

            <Text style={styles.label}>Password</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <Pressable
                style={styles.eyeButton}
                onPress={() => setShowPassword((v) => !v)}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={16} color="#DC2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.loginButton,
                (loading || pressed) && styles.loginButtonDisabled,
              ]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.loginButtonText}>Sign In</Text>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.testButton,
                { borderColor: colors.border, borderRadius: colors.radius },
                (testLoading || pressed) && { opacity: 0.6 },
              ]}
              onPress={handleTestConnection}
              disabled={testLoading}
            >
              {testLoading ? (
                <ActivityIndicator color={colors.mutedForeground} size="small" />
              ) : (
                <Text style={[styles.testButtonText, { color: colors.mutedForeground }]}>
                  Test Supabase Connection
                </Text>
              )}
            </Pressable>

            {testResult && (
              <View style={[styles.testResult, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
                <Text style={[styles.testResultText, { color: colors.foreground }]}>
                  {testResult}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
