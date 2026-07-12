import { Feather } from "@expo/vector-icons";
import { Stack, router, usePathname } from "expo-router";
import React from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useColors } from "@/hooks/useColors";
import {
  accountDeletionDataTypes,
  canSubmitAccountDeletion,
  createAccountDeletionFeedbackForm,
} from "@/lib/account-deletion-model";
import { serializeError } from "@/lib/feedback-model";
import { submitFeedbackReport } from "@/lib/feedback-service";

export default function AccountDeletionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { session } = useAuth();
  const { customerInfo, isPaid } = useEntitlements();
  const [confirmed, setConfirmed] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const submissionLockRef = React.useRef(false);
  const managementUrl = isPaid && (Platform.OS === "ios" || Platform.OS === "android")
    ? customerInfo?.managementURL ?? null
    : null;
  const canSubmit = canSubmitAccountDeletion(confirmed, isSubmitting);

  const submit = async () => {
    if (!canSubmit || submissionLockRef.current) return;
    if (!session?.user.id) {
      setInlineError("Please sign in again before submitting this request.");
      return;
    }

    submissionLockRef.current = true;
    setInlineError(null);
    setIsSubmitting(true);
    try {
      await submitFeedbackReport({
        userId: session.user.id,
        userEmail: session.user.email ?? null,
        form: createAccountDeletionFeedbackForm(),
        currentRoute: pathname,
        screenshot: null,
      });
      setSubmitted(true);
    } catch (error) {
      if (__DEV__) console.warn("[accountDeletion] request failed", { error: serializeError(error) });
      setInlineError("We couldn't submit your deletion request. Please try again.");
    } finally {
      submissionLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const manageSubscription = async () => {
    if (!managementUrl) return;
    try {
      const supported = await Linking.canOpenURL(managementUrl);
      if (!supported) throw new Error("Store subscription settings are unavailable.");
      await Linking.openURL(managementUrl);
    } catch {
      setInlineError("We couldn't open your store subscription settings. Please open them directly in the App Store or Google Play.");
    }
  };

  if (submitted) {
    return <>
      <Stack.Screen options={{ title: "Account deletion" }} />
      <ScrollView contentContainerStyle={[styles.successContent, { paddingBottom: insets.bottom + 28 }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.accent }]}>
          <Feather name="check" size={30} color={colors.primary} />
        </View>
        <Text accessibilityRole="header" style={[styles.successTitle, { color: colors.foreground }]}>Deletion request submitted</Text>
        <Text style={[styles.successBody, { color: colors.mutedForeground }]}>We've received your request and will contact you to confirm the next steps.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Account"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Back to Account</Text>
        </Pressable>
      </ScrollView>
    </>;
  }

  return <>
    <Stack.Screen options={{ title: "Account deletion" }} />
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <View style={[styles.warningIcon, { backgroundColor: `${colors.destructive}0D` }]}>
          <Feather name="trash-2" size={23} color={colors.destructive} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Request account deletion</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>This starts a request to permanently delete your Coverly account and associated inventory data. You may need to verify the request, and our support team will contact you to confirm the next steps.</Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text accessibilityRole="header" style={[styles.cardTitle, { color: colors.foreground }]}>Data covered by your request</Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>Your request covers the following Coverly data, subject to the Privacy Policy and any records Coverly is required to retain:</Text>
        <View style={styles.dataList}>
          {accountDeletionDataTypes.map((item) => <View key={item} style={styles.dataRow}>
            <Feather name="minus-circle" size={16} color={colors.destructive} />
            <Text style={[styles.dataText, { color: colors.foreground }]}>{item}</Text>
          </View>)}
        </View>
      </View>

      <View style={[styles.subscriptionCard, { backgroundColor: `${colors.warning}0D`, borderColor: `${colors.warning}55`, borderRadius: colors.radius }]}>
        <Feather name="alert-triangle" size={20} color={colors.warning} />
        <View style={styles.subscriptionCopy}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Store subscriptions are separate</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Submitting this request does not cancel an Apple App Store or Google Play subscription. If you have one, cancel it separately through your store subscription settings.</Text>
          {managementUrl ? <Pressable
            accessibilityRole="link"
            accessibilityLabel="Manage store subscription"
            onPress={() => void manageSubscription()}
            style={({ pressed }) => [styles.manageLink, { opacity: pressed ? 0.72 : 1 }]}
          >
            <Text style={[styles.manageLinkText, { color: colors.primary }]}>Manage store subscription</Text>
            <Feather name="external-link" size={14} color={colors.primary} />
          </Pressable> : null}
        </View>
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="I understand that this request is for permanent account and data deletion"
        accessibilityState={{ checked: confirmed, disabled: isSubmitting }}
        disabled={isSubmitting}
        onPress={() => { setConfirmed((value) => !value); setInlineError(null); }}
        style={({ pressed }) => [styles.confirmRow, { backgroundColor: colors.card, borderColor: confirmed ? colors.destructive : colors.border, borderRadius: colors.radius, opacity: pressed ? 0.78 : 1 }]}
      >
        <View style={[styles.checkbox, { borderColor: confirmed ? colors.destructive : colors.input, backgroundColor: confirmed ? colors.destructive : colors.card }]}>
          {confirmed ? <Feather name="check" size={15} color={colors.destructiveForeground} /> : null}
        </View>
        <Text style={[styles.confirmText, { color: colors.foreground }]}>I understand that this request is for permanent account and data deletion.</Text>
      </Pressable>

      {inlineError ? <View accessibilityLiveRegion="polite" style={[styles.errorBox, { backgroundColor: `${colors.destructive}0D` }]}>
        <Feather name="alert-circle" size={17} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.destructive }]}>{inlineError}</Text>
      </View> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Submit deletion request"
        accessibilityHint={confirmed ? "Submits the request to Coverly support." : "Confirm your understanding before submitting."}
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.destructiveButton, { backgroundColor: colors.destructive, opacity: !canSubmit ? 0.45 : pressed ? 0.82 : 1 }]}
      >
        {isSubmitting ? <ActivityIndicator color={colors.destructiveForeground} /> : <Feather name="trash-2" size={17} color={colors.destructiveForeground} />}
        <Text style={[styles.destructiveButtonText, { color: colors.destructiveForeground }]}>{isSubmitting ? "Submitting request..." : "Submit deletion request"}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel account deletion request"
        disabled={isSubmitting}
        onPress={() => router.back()}
        style={({ pressed }) => [styles.cancelButton, { opacity: isSubmitting ? 0.45 : pressed ? 0.72 : 1 }]}
      >
        <Text style={[styles.cancelText, { color: colors.primary }]}>Cancel</Text>
      </Pressable>
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  hero: { padding: 18, gap: 10, borderWidth: 1 },
  warningIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 23, lineHeight: 30, fontFamily: "Inter_700Bold" },
  body: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" },
  card: { padding: 16, gap: 10, borderWidth: 1 },
  cardTitle: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  dataList: { gap: 9, marginTop: 2 },
  dataRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  dataText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium" },
  subscriptionCard: { padding: 15, flexDirection: "row", alignItems: "flex-start", gap: 11, borderWidth: 1 },
  subscriptionCopy: { flex: 1, gap: 6 },
  manageLink: { alignSelf: "flex-start", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6 },
  manageLinkText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  confirmRow: { minHeight: 66, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 11, borderWidth: 1 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  confirmText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  errorBox: { padding: 12, borderRadius: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  destructiveButton: { minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14 },
  destructiveButtonText: { fontSize: 14, textAlign: "center", fontFamily: "Inter_700Bold" },
  cancelButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  successContent: { flexGrow: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 },
  successIcon: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center", marginBottom: 3 },
  successTitle: { fontSize: 23, lineHeight: 30, textAlign: "center", fontFamily: "Inter_700Bold" },
  successBody: { maxWidth: 340, fontSize: 14, lineHeight: 21, textAlign: "center", fontFamily: "Inter_400Regular" },
  primaryButton: { alignSelf: "stretch", minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
