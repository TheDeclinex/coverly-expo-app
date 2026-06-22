import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { VoiceChangeReview } from "@/components/voice/VoiceChangeReview";
import { useColors } from "@/hooks/useColors";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { callVoiceDescribe } from "@/lib/voice-input";
import {
  buildSelectedVoicePatch,
  mapVoiceItemExtraction,
  resolveAmbiguousPrice,
} from "@/lib/voice-item-mapper";
import type {
  VoiceDescribeRequest,
  VoiceInputPhase,
  VoiceItemField,
  VoiceItemPatch,
  VoiceItemValues,
  VoiceMappedChange,
} from "@/types/voice";

type VoiceContext = Omit<VoiceDescribeRequest, "audioBase64" | "mimeType" | "ext" | "targetField" | "currentValues">;

export function VoiceInputSheet({
  visible,
  title = "Voice input",
  targetField,
  currentValues = {},
  context = {},
  onClose,
  onApply,
}: {
  visible: boolean;
  title?: string;
  targetField?: VoiceItemField;
  currentValues?: Partial<VoiceItemValues>;
  context?: VoiceContext;
  onClose: () => void;
  onApply: (patch: VoiceItemPatch, transcript: string, changes: VoiceMappedChange[]) => void | Promise<void>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const voice = useVoiceRecording();
  const [phase, setPhase] = useState<VoiceInputPhase>("permission");
  const [transcript, setTranscript] = useState("");
  const [changes, setChanges] = useState<VoiceMappedChange[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setPhase(voice.permission === "granted" ? "ready" : "permission");
    setTranscript("");
    setChanges([]);
    setSelectedIds(new Set());
    setErrorMessage(null);
  }, [visible]);

  const closeAndClean = async () => {
    processingRef.current = false;
    await voice.reset();
    onClose();
  };

  const requestPermission = async () => {
    setErrorMessage(null);
    const granted = await voice.requestPermission();
    if (granted) setPhase("ready");
    else {
      setPhase("permission");
      setErrorMessage("Allow microphone access in your device settings to use voice input.");
    }
  };

  const startRecording = async () => {
    setErrorMessage(null);
    if (await voice.startRecording()) setPhase("recording");
    else {
      setPhase("error");
      setErrorMessage(voice.error ?? "Could not start recording.");
    }
  };

  const stopAndProcess = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setPhase("processing");
    setErrorMessage(null);
    const recording = await voice.stopRecording();
    if (!recording) {
      processingRef.current = false;
      setPhase("error");
      setErrorMessage(voice.error ?? "Could not finish recording.");
      return;
    }

    const result = await callVoiceDescribe(recording, {
      ...context,
      mode: "item_edit",
      targetField,
      currentValues,
    });
    processingRef.current = false;

    if (!result.response) {
      setPhase("error");
      setErrorMessage(result.networkError ?? "Voice input could not be processed.");
      return;
    }
    if (!result.response.success) {
      setPhase("error");
      setErrorMessage(result.response.error);
      return;
    }
    setTranscript(result.response.transcript);
    if (!result.response.extraction) {
      setPhase("error");
      setErrorMessage(result.response.extractionError ?? "No supported item details were found.");
      return;
    }

    const nextChanges = mapVoiceItemExtraction({
      transcript: result.response.transcript,
      extraction: result.response.extraction,
      currentValues,
      targetField,
    });
    if (nextChanges.length === 0) {
      setPhase("error");
      setErrorMessage("No supported item changes were found. Try saying the field and value clearly.");
      return;
    }
    setChanges(nextChanges);
    setSelectedIds(new Set(nextChanges.filter((change) => change.selectedByDefault).map((change) => change.id)));
    setPhase("review");
  };

  useEffect(() => {
    if (visible && phase === "recording" && voice.maxDurationReached) void stopAndProcess();
  }, [visible, phase, voice.maxDurationReached]);

  const toggleChange = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolvePrice = (id: string, destination: "replacement_price" | "original_purchase_price") => {
    setChanges((current) => current.map((change) => change.id === id ? resolveAmbiguousPrice(change, destination, currentValues) : change));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      next.add(destination);
      return next;
    });
  };

  const applyChanges = async () => {
    const patch = buildSelectedVoicePatch(changes, selectedIds);
    if (Object.keys(patch).length === 0) return;
    try {
      await onApply(patch, transcript, changes.filter((change) => selectedIds.has(change.id)));
      await closeAndClean();
    } catch (applyError) {
      setPhase("error");
      setErrorMessage(applyError instanceof Error ? applyError.message : "Could not apply voice changes.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => void closeAndClean()}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Close voice input" style={styles.backdrop} onPress={() => void closeAndClean()} />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Nothing changes until you review and apply it.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close voice input" onPress={() => void closeAndClean()} hitSlop={10}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {phase === "permission" && (
              <View style={styles.centerState}>
                <Feather name="mic" size={30} color={colors.primary} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>Microphone access</Text>
                <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Coverly needs microphone access only while you record voice input.</Text>
                {errorMessage && <Text style={[styles.errorText, { color: colors.destructive }]}>{errorMessage}</Text>}
                <PrimaryButton label="Allow microphone" onPress={() => void requestPermission()} />
              </View>
            )}

            {phase === "ready" && (
              <View style={styles.centerState}>
                <Feather name="mic" size={34} color={colors.primary} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>Ready to listen</Text>
                <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Speak naturally. You will review the transcript and suggested changes next.</Text>
                <PrimaryButton label="Start recording" onPress={() => void startRecording()} />
              </View>
            )}

            {phase === "recording" && (
              <View style={styles.centerState}>
                <View style={[styles.recordingDot, { backgroundColor: colors.destructive }]} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>Listening…</Text>
                <Text style={[styles.timer, { color: colors.mutedForeground }]}>{voice.durationSeconds}s / {voice.maxDurationSeconds}s</Text>
                <PrimaryButton label="Stop and review" icon="square" onPress={() => void stopAndProcess()} />
              </View>
            )}

            {phase === "processing" && (
              <View style={styles.centerState}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>Processing voice input</Text>
                <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Transcribing and finding supported item details…</Text>
              </View>
            )}

            {phase === "error" && (
              <View style={styles.centerState}>
                <Feather name="alert-circle" size={30} color={colors.destructive} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn’t process voice input</Text>
                <Text style={[styles.errorText, { color: colors.destructive }]}>{errorMessage ?? voice.error ?? "Please try again."}</Text>
                {transcript ? (
                  <View style={[styles.errorTranscript, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
                    <Text style={[styles.errorTranscriptLabel, { color: colors.mutedForeground }]}>HEARD</Text>
                    <Text style={[styles.errorTranscriptText, { color: colors.foreground }]}>{transcript}</Text>
                  </View>
                ) : null}
                <PrimaryButton label="Try again" onPress={() => { setPhase("ready"); setErrorMessage(null); }} />
              </View>
            )}

            {phase === "review" && (
              <VoiceChangeReview transcript={transcript} changes={changes} selectedIds={selectedIds} onToggle={toggleChange} onResolvePrice={resolvePrice} />
            )}
          </ScrollView>

          {phase === "review" && (
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              <Pressable onPress={() => void closeAndClean()} style={[styles.secondaryButton, { borderColor: colors.border }]}>
                <Text style={[styles.secondaryText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={selectedIds.size === 0}
                onPress={() => void applyChanges()}
                style={[styles.applyButton, { backgroundColor: colors.primary, opacity: selectedIds.size === 0 ? 0.45 : 1 }]}
              >
                <Text style={[styles.applyText, { color: colors.primaryForeground }]}>Apply changes</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function PrimaryButton({ label, icon = "mic", onPress }: { label: string; icon?: React.ComponentProps<typeof Feather>["name"]; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]}>
      <Feather name={icon} size={16} color={colors.primaryForeground} />
      <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.46)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 10 },
  header: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 18, gap: 12 },
  headerCopy: { flex: 1, gap: 3 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  scroll: { marginTop: 12 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 16 },
  centerState: { minHeight: 250, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 18 },
  stateTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  stateText: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center" },
  errorText: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center" },
  errorTranscript: { width: "100%", padding: 10, gap: 3 },
  errorTranscriptLabel: { fontSize: 10, letterSpacing: 0.7, fontFamily: "Inter_600SemiBold" },
  errorTranscriptText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  timer: { fontSize: 13, fontFamily: "Inter_500Medium" },
  recordingDot: { width: 18, height: 18, borderRadius: 9 },
  primaryButton: { minWidth: 170, marginTop: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  footer: { flexDirection: "row", gap: 10, borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12 },
  secondaryButton: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  secondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  applyButton: { flex: 2, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  applyText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
