import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams, usePathname } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
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
  feedbackCategoryLabel,
  feedbackPriorityLabel,
  feedbackTypeLabel,
  serializeError,
  validateFeedbackScreenshotFile,
  validateFeedbackForm,
  type FeedbackCategory,
  type FeedbackPriority,
  type FeedbackType,
} from "@/lib/feedback-model";
import {
  submitFeedbackReport,
  type FeedbackScreenshotInput,
} from "@/lib/feedback-service";

const typeOptions: FeedbackType[] = ["issue", "feedback", "enhancement"];
const categoryOptions: FeedbackCategory[] = ["general", "scan", "pricing", "claim_pack", "billing", "account"];
const priorityOptions: FeedbackPriority[] = ["normal", "low", "blocking"];

export default function FeedbackScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const pathname = usePathname();
  const params = useLocalSearchParams<{
    type?: FeedbackType;
    category?: FeedbackCategory;
    priority?: FeedbackPriority;
    message?: string;
  }>();
  const [type, setType] = React.useState<FeedbackType>(typeOptions.includes(params.type as FeedbackType) ? params.type as FeedbackType : "issue");
  const [category, setCategory] = React.useState<FeedbackCategory>(categoryOptions.includes(params.category as FeedbackCategory) ? params.category as FeedbackCategory : "general");
  const [priority, setPriority] = React.useState<FeedbackPriority>(priorityOptions.includes(params.priority as FeedbackPriority) ? params.priority as FeedbackPriority : "normal");
  const [message, setMessage] = React.useState(typeof params.message === "string" ? params.message : "");
  const [screenshot, setScreenshot] = React.useState<FeedbackScreenshotInput | null>(null);
  const [isPicking, setIsPicking] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  const pickScreenshot = async () => {
    setInlineError(null);
    setIsPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setInlineError("Photo access is needed to attach a screenshot.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const screenshotFile = {
        uri: asset.uri,
        filename: asset.fileName ?? null,
        mimeType: asset.mimeType ?? null,
        fileSize: asset.fileSize ?? null,
      };
      const screenshotValidation = validateFeedbackScreenshotFile(screenshotFile);
      if (!screenshotValidation.ok) {
        setInlineError(screenshotValidation.message ?? "Only PNG or JPG screenshots are supported for now.");
        return;
      }
      setScreenshot({
        ...screenshotFile,
        filename: screenshotFile.filename ?? "Screenshot",
        mimeType: screenshotValidation.mimeType ?? screenshotFile.mimeType,
      });
    } catch (error) {
      if (__DEV__) {
        if (__DEV__) console.warn("[feedback] screenshot picker failed", { error: serializeError(error) });
      }
      setInlineError("Could not attach that screenshot. Try again or send without it.");
    } finally {
      setIsPicking(false);
    }
  };

  const submit = async () => {
    if (!session?.user.id) {
      Alert.alert("Sign in required", "Please sign in again before sending feedback.");
      return;
    }

    const form = { type, category, priority, message };
    const validation = validateFeedbackForm(form);
    if (!validation.ok) {
      setInlineError(validation.message ?? "Please check your feedback and try again.");
      return;
    }

    setInlineError(null);
    setIsSubmitting(true);
    try {
      const result = await submitFeedbackReport({
        userId: session.user.id,
        userEmail: session.user.email ?? null,
        form,
        currentRoute: pathname,
        screenshot,
      });

      Alert.alert(
        "Thanks - feedback sent",
        result.screenshotWarning ?? "We have received your report and will use it to improve Coverly.",
        [{ text: "Done", onPress: () => router.back() }],
      );
    } catch (error) {
      if (__DEV__) {
        if (__DEV__) console.warn("[feedback] submit failed", { error: serializeError(error) });
      }
      setInlineError("Could not send feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Feedback & Support" }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Send feedback</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            Tell us what happened, what you expected, or what would make Coverly better.
          </Text>
        </View>

        <OptionSection title="What is it about?">
          <ChipGroup
            values={typeOptions}
            selected={type}
            labelFor={feedbackTypeLabel}
            onSelect={setType}
          />
        </OptionSection>

        <OptionSection title="Area">
          <ChipGroup
            values={categoryOptions}
            selected={category}
            labelFor={feedbackCategoryLabel}
            onSelect={setCategory}
          />
        </OptionSection>

        <OptionSection title="Priority">
          <ChipGroup
            values={priorityOptions}
            selected={priority}
            labelFor={feedbackPriorityLabel}
            onSelect={setPriority}
          />
        </OptionSection>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.label, { color: colors.foreground }]}>Message</Text>
          <TextInput
            multiline
            value={message}
            onChangeText={setMessage}
            placeholder="Describe the issue or suggestion..."
            placeholderTextColor={colors.mutedForeground}
            textAlignVertical="top"
            style={[styles.input, { borderColor: colors.input, color: colors.foreground, backgroundColor: colors.background }]}
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <View style={styles.screenshotHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Screenshot</Text>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                Optional. Please avoid screenshots with sensitive personal information.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={screenshot ? "Change screenshot" : "Attach screenshot"}
              disabled={isPicking || isSubmitting}
              onPress={() => void pickScreenshot()}
              style={({ pressed }) => [
                styles.attachButton,
                { backgroundColor: colors.secondary, opacity: pressed ? 0.72 : 1 },
              ]}
            >
              {isPicking ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="paperclip" size={16} color={colors.primary} />
              )}
              <Text style={[styles.attachText, { color: colors.primary }]}>{screenshot ? "Change" : "Attach"}</Text>
            </Pressable>
          </View>

          {screenshot ? (
            <View style={[styles.preview, { borderColor: colors.border }]}>
              <Image source={{ uri: screenshot.uri }} style={styles.previewImage} contentFit="cover" />
              <View style={styles.previewCopy}>
                <Text style={[styles.previewTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {screenshot.filename ?? "Screenshot"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove screenshot"
                  onPress={() => setScreenshot(null)}
                  disabled={isSubmitting}
                >
                  <Text style={[styles.removeText, { color: colors.destructive }]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {inlineError ? (
          <Text style={[styles.error, { color: colors.destructive }]}>{inlineError}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send feedback"
          disabled={isSubmitting}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.submitButton,
            { backgroundColor: colors.primary, opacity: isSubmitting ? 0.7 : pressed ? 0.82 : 1 },
          ]}
        >
          {isSubmitting ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="send" size={17} color={colors.primaryForeground} />}
          <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
            {isSubmitting ? "Sending..." : "Send feedback"}
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

function OptionSection({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Text style={[styles.label, { color: colors.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

function ChipGroup<T extends string>({
  values,
  selected,
  labelFor,
  onSelect,
}: {
  values: T[];
  selected: T;
  labelFor: (value: T) => string;
  onSelect: (value: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.chips}>
      {values.map((value) => {
        const active = value === selected;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(value)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: active ? colors.accent : colors.background,
                borderColor: active ? colors.primary : colors.border,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: active ? colors.primary : colors.foreground }]}>{labelFor(value)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, padding: 15, gap: 10 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  label: { fontSize: 13, fontFamily: "Inter_700Bold" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  input: { minHeight: 138, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  screenshotHeader: { flexDirection: "row", gap: 12, alignItems: "center" },
  attachButton: { minHeight: 38, borderRadius: 999, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  attachText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  preview: { borderWidth: 1, borderRadius: 10, padding: 8, flexDirection: "row", gap: 10, alignItems: "center" },
  previewImage: { width: 58, height: 58, borderRadius: 8 },
  previewCopy: { flex: 1, gap: 5 },
  previewTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  removeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  error: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  submitButton: { minHeight: 50, borderRadius: 999, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 },
  submitText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
