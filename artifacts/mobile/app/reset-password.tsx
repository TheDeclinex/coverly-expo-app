import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
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

import { CoverlyAuthBackground, CoverlyAuthMark } from "@/components/auth/CoverlyAuthBrand";
import { coverlyBrand } from "@/constants/brand";
import {
  authLinkErrorMessage,
  authLinkFingerprint,
  establishAuthLinkSession,
  parseAuthLink,
  passwordValidationError,
} from "@/lib/auth-links";
import { supabase } from "@/lib/supabase";

const RECOVERY_LINK_KEY = "@coverly/active-recovery-link";

type RecoveryState = "loading" | "ready" | "invalid" | "success";

export default function ResetPasswordScreen() {
  const incomingUrl = Linking.useLinkingURL();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const handledUrl = React.useRef<string | null>(null);
  const [state, setState] = React.useState<RecoveryState>("loading");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmation, setShowConfirmation] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!incomingUrl || handledUrl.current === incomingUrl) return;
    handledUrl.current = incomingUrl;
    let active = true;

    const prepareRecovery = async () => {
      try {
        const parsed = parseAuthLink(incomingUrl);
        if (!parsed.hasCredentials) throw new Error("AUTH_LINK_INVALID");
        const fingerprint = authLinkFingerprint(incomingUrl);
        const storedFingerprint = await AsyncStorage.getItem(RECOVERY_LINK_KEY);
        const { data: before } = await supabase.auth.getSession();
        if (storedFingerprint !== fingerprint || !before.session) {
          await establishAuthLinkSession(incomingUrl, "recovery");
          await AsyncStorage.setItem(RECOVERY_LINK_KEY, fingerprint);
        }
        const { data: after } = await supabase.auth.getSession();
        if (!after.session) throw new Error("AUTH_LINK_NO_SESSION");
        if (active) setState("ready");
      } catch {
        await AsyncStorage.removeItem(RECOVERY_LINK_KEY);
        if (active) {
          setMessage(authLinkErrorMessage("recovery"));
          setState("invalid");
        }
      }
    };

    void prepareRecovery();
    return () => {
      active = false;
    };
  }, [incomingUrl]);

  const validationError = password || confirmation ? passwordValidationError(password, confirmation) : null;
  const canSubmit = state === "ready" && !submitting && password.length >= 8 && password === confirmation;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setMessage("We couldn't update your password. The reset link may have expired; request a new link and try again.");
      setSubmitting(false);
      return;
    }

    await AsyncStorage.removeItem(RECOVERY_LINK_KEY);
    await supabase.auth.signOut({ scope: "local" });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setState("success");
    setSubmitting(false);
  };

  const goToForgotPassword = () => {
    router.replace({ pathname: "/login", params: { mode: "forgot" } });
  };

  return (
    <CoverlyAuthBackground style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <CoverlyAuthMark style={styles.mark} />
            <Text style={styles.brandName}>Coverly</Text>
          </View>
          <View style={styles.card}>
            {state === "loading" ? (
              <View style={styles.centered}>
                <ActivityIndicator color={coverlyBrand.teal} size="large" />
                <Text style={styles.title}>Checking your reset link</Text>
                <Text style={styles.body}>This will only take a moment.</Text>
              </View>
            ) : state === "invalid" ? (
              <View style={styles.centered}>
                <Feather name="alert-circle" size={38} color="#DC2626" />
                <Text style={styles.title}>Reset link unavailable</Text>
                <Text style={styles.body}>{message}</Text>
                <SecondaryButton label="Request another reset link" onPress={goToForgotPassword} />
              </View>
            ) : state === "success" ? (
              <View style={styles.centered}>
                <Feather name="check-circle" size={42} color={coverlyBrand.teal} />
                <Text style={styles.title}>Password updated</Text>
                <Text style={styles.body}>Your new password is ready. Sign in to continue.</Text>
                <SecondaryButton
                  label="Sign in"
                  onPress={() => router.replace({ pathname: "/login", params: { notice: "password-updated" } })}
                />
              </View>
            ) : (
              <>
                <Text style={styles.title}>Set a new password</Text>
                <Text style={styles.body}>Choose a password with at least 8 characters.</Text>
                <PasswordField
                  label="New password"
                  value={password}
                  onChangeText={setPassword}
                  visible={showPassword}
                  onToggle={() => setShowPassword((value) => !value)}
                />
                <PasswordField
                  label="Confirm new password"
                  value={confirmation}
                  onChangeText={setConfirmation}
                  visible={showConfirmation}
                  onToggle={() => setShowConfirmation((value) => !value)}
                  onSubmit={submit}
                />
                {validationError ? <Text style={styles.error}>{validationError}</Text> : null}
                {message ? <Text style={styles.error}>{message}</Text> : null}
                <Pressable disabled={!canSubmit} onPress={submit} style={{ opacity: canSubmit ? 1 : 0.5 }}>
                  <LinearGradient colors={[coverlyBrand.teal, coverlyBrand.tealDark]} style={styles.primaryButton}>
                    {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Update password</Text>}
                  </LinearGradient>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </CoverlyAuthBackground>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggle,
  onSubmit,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  onSubmit?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <Feather name="lock" size={16} color={coverlyBrand.mutedText} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoComplete="new-password"
          textContentType="newPassword"
          placeholder="At least 8 characters"
          placeholderTextColor={coverlyBrand.mutedText}
          returnKeyType={onSubmit ? "go" : "next"}
          onSubmitEditing={onSubmit}
          style={styles.input}
        />
        <Pressable onPress={onToggle} hitSlop={8} accessibilityLabel={visible ? `Hide ${label}` : `Show ${label}`}>
          <Feather name={visible ? "eye-off" : "eye"} size={18} color={coverlyBrand.mutedText} />
        </Pressable>
      </View>
    </View>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.secondaryButton}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, gap: 18 },
  brand: { alignItems: "center", gap: 4 },
  mark: { width: 66, height: 66 },
  brandName: { color: coverlyBrand.navy, fontFamily: "Inter_700Bold", fontSize: 29 },
  card: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    gap: 18,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: coverlyBrand.border,
    backgroundColor: "rgba(255,255,255,0.97)",
  },
  centered: { alignItems: "center", gap: 14 },
  title: { color: coverlyBrand.slate, fontFamily: "Inter_700Bold", fontSize: 24, textAlign: "center" },
  body: { color: coverlyBrand.mutedText, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center" },
  field: { gap: 7 },
  label: { color: coverlyBrand.slate, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  inputRow: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderRadius: 12,
    borderColor: coverlyBrand.border,
    backgroundColor: coverlyBrand.inputBackground,
  },
  input: { flex: 1, color: coverlyBrand.slate, fontFamily: "Inter_400Regular", fontSize: 15 },
  error: { color: "#B91C1C", fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  primaryButton: { height: 52, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  primaryText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 16 },
  secondaryButton: {
    minHeight: 48,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: coverlyBrand.border,
    backgroundColor: coverlyBrand.inputBackground,
  },
  secondaryText: { color: coverlyBrand.teal, fontFamily: "Inter_600SemiBold", fontSize: 15, textAlign: "center" },
});
