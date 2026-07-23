import { Feather } from "@expo/vector-icons";
import * as Network from "expo-network";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { callVoiceDescribe } from "@/lib/voice-input";
import { formatMoneyInputValue, moneyDisplayToken } from "@/lib/money";
import { improveReplacementRefinementWithAi } from "@/lib/replacement-refinement-ai";
import {
  cloneReplacementRefinementDraft,
  applyAiTextUpdate,
  createAiRefinementChip,
  deterministicRefinementChips,
  normalizeRefinementText,
  toggleRefinementChip,
  validateReplacementPriceRange,
  type ParsedReplacementPriceRange,
  type ReplacementRefinementDraft,
  type ReplacementRefinementTextField,
} from "@/lib/replacement-refinement-model";
import type { InventoryItem } from "@/types";
import type { VoiceExtractionResult, VoiceItemField } from "@/types/voice";

type VoiceTarget = "combined" | ReplacementRefinementTextField;

interface VoiceProposal {
  target: VoiceTarget;
  transcript: string;
  draft?: ReplacementRefinementDraft;
  value?: string;
}

const TEXT_FIELD_LABELS: Record<ReplacementRefinementTextField, string> = {
  searchTerm: "Search Term",
  brand: "Brand",
  model: "Model",
  additionalDetails: "Additional Details",
};

const VOICE_TARGET_FIELDS: Partial<Record<VoiceTarget, VoiceItemField>> = {
  searchTerm: "name",
  brand: "brand_maker",
  model: "model_series",
  additionalDetails: "description",
};

function mappedVoiceValue(
  target: ReplacementRefinementTextField,
  extraction: VoiceExtractionResult | null,
  transcript: string,
): string {
  if (target === "searchTerm") return normalizeRefinementText(extraction?.name || extraction?.display_name || transcript);
  if (target === "brand") {
    return normalizeRefinementText(extraction?.brand || extraction?.make || extraction?.maker_artist_brand || transcript);
  }
  if (target === "model") return normalizeRefinementText(extraction?.model || extraction?.model_title || transcript);
  return normalizeRefinementText(extraction?.description || transcript);
}

function combinedVoiceDraft(
  current: ReplacementRefinementDraft,
  extraction: VoiceExtractionResult | null,
  transcript: string,
): ReplacementRefinementDraft {
  if (!extraction) return { ...current, searchTerm: normalizeRefinementText(transcript) };
  return {
    ...current,
    searchTerm: normalizeRefinementText(extraction.name || extraction.display_name || transcript) || current.searchTerm,
    brand: normalizeRefinementText(extraction.brand || extraction.make || extraction.maker_artist_brand) || current.brand,
    model: normalizeRefinementText(extraction.model || extraction.model_title) || current.model,
    additionalDetails: normalizeRefinementText(extraction.description) || current.additionalDetails,
  };
}

export function ReplacementSearchRefinementSheet({
  visible,
  item,
  marketName,
  currencyCode,
  locale,
  supportLabel,
  aiEnabled,
  draft,
  originalDraft,
  lastSuccessfulDraft,
  submitting,
  onDraftChange,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  item: InventoryItem;
  marketName: string;
  currencyCode: string;
  locale?: string;
  supportLabel?: string | null;
  aiEnabled: boolean;
  draft: ReplacementRefinementDraft;
  originalDraft: ReplacementRefinementDraft;
  lastSuccessfulDraft: ReplacementRefinementDraft;
  submitting: boolean;
  onDraftChange: (draft: ReplacementRefinementDraft) => void;
  onClose: () => void;
  onSubmit: (draft: ReplacementRefinementDraft, range: ParsedReplacementPriceRange) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const voice = useVoiceRecording(30, "replacement_price_voice_search");
  const [voiceTarget, setVoiceTarget] = React.useState<VoiceTarget | null>(null);
  const [voiceProcessing, setVoiceProcessing] = React.useState(false);
  const [voiceProposal, setVoiceProposal] = React.useState<VoiceProposal | null>(null);
  const [voiceError, setVoiceError] = React.useState<string | null>(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [aiUndoDraft, setAiUndoDraft] = React.useState<ReplacementRefinementDraft | null>(null);
  const [aiChangedFields, setAiChangedFields] = React.useState<Set<ReplacementRefinementTextField>>(new Set());
  const [aiChipValues, setAiChipValues] = React.useState<string[]>([]);
  const [aiFeedback, setAiFeedback] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const draftRef = React.useRef(draft);
  const mountedRef = React.useRef(true);
  const visibleRef = React.useRef(visible);
  const aiRequestSequence = React.useRef(0);
  const voiceRequestSequence = React.useRef(0);
  const aiFeedbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  draftRef.current = draft;
  visibleRef.current = visible;

  const changeDraft = (nextDraft: ReplacementRefinementDraft) => {
    draftRef.current = nextDraft;
    onDraftChange(nextDraft);
  };

  const clearAiFeedbackTimer = () => {
    if (aiFeedbackTimer.current) {
      clearTimeout(aiFeedbackTimer.current);
      aiFeedbackTimer.current = null;
    }
  };

  const aiRequestIsCurrent = (requestId: number) => (
    mountedRef.current && visibleRef.current && requestId === aiRequestSequence.current
  );

  const voiceRequestIsCurrent = (requestId: number) => (
    mountedRef.current && visibleRef.current && requestId === voiceRequestSequence.current
  );

  const rangeValidation = React.useMemo(
    () => validateReplacementPriceRange(draft.minimumPrice, draft.maximumPrice, currencyCode, locale),
    [currencyCode, draft.maximumPrice, draft.minimumPrice, locale],
  );
  const chips = React.useMemo(() => {
    const deterministic = deterministicRefinementChips(draft);
    const ai = aiChipValues.map((value) => createAiRefinementChip(
      value,
      draft.brand.toLowerCase() === value.toLowerCase() || draft.model.toLowerCase() === value.toLowerCase()
        ? "searchTerm"
        : "additionalDetails",
    ));
    return [...deterministic, ...ai]
      .filter((chip, index, values) => values.findIndex((candidate) => candidate.label.toLowerCase() === chip.label.toLowerCase()) === index)
      .slice(0, 6);
  }, [aiChipValues, draft]);

  React.useEffect(() => {
    if (!visible) return;
    let mounted = true;
    void Network.getNetworkStateAsync().then((state) => {
      if (mounted) setOffline(state.isConnected === false || state.isInternetReachable === false);
    }).catch(() => undefined);
    const subscription = Network.addNetworkStateListener((state) => {
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [visible]);

  React.useEffect(() => {
    if (!visible) {
      aiRequestSequence.current += 1;
      voiceRequestSequence.current += 1;
      clearAiFeedbackTimer();
      setVoiceTarget(null);
      setVoiceProposal(null);
      setVoiceError(null);
      setVoiceProcessing(false);
      setAiLoading(false);
      setAiFeedback(false);
      setSubmitAttempted(false);
      void voice.reset();
    }
  }, [visible, voice.reset]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      aiRequestSequence.current += 1;
      voiceRequestSequence.current += 1;
      clearAiFeedbackTimer();
      void voice.reset();
    };
  }, [voice.reset]);

  React.useEffect(() => {
    if (voice.maxDurationReached && voice.isRecording) void finishVoiceRecording();
  // finishVoiceRecording intentionally reads the latest draft after the duration event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.maxDurationReached]);

  const updateTextField = (field: ReplacementRefinementTextField, value: string) => {
    changeDraft({ ...draftRef.current, [field]: value });
    setAiChangedFields((current) => {
      if (!current.has(field)) return current;
      const next = new Set(current);
      next.delete(field);
      return next;
    });
  };

  const startVoice = async (target: VoiceTarget) => {
    if (submitting || voiceProcessing || aiLoading) return;
    const requestId = voiceRequestSequence.current + 1;
    voiceRequestSequence.current = requestId;
    setVoiceError(null);
    setVoiceProposal(null);
    setVoiceTarget(target);
    let granted = voice.permission === "granted";
    if (!granted) granted = await voice.requestPermission();
    if (!voiceRequestIsCurrent(requestId)) return;
    if (!granted) {
      setVoiceTarget(null);
      setVoiceError("Microphone access is unavailable. You can continue by typing.");
      return;
    }
    const started = await voice.startRecording();
    if (!voiceRequestIsCurrent(requestId)) {
      if (started) await voice.reset();
      return;
    }
    if (!started) {
      setVoiceTarget(null);
      setVoiceError("Voice input could not start. Please try again or type manually.");
    }
  };

  const finishVoiceRecording = async () => {
    const target = voiceTarget;
    if (!target) return;
    const requestId = voiceRequestSequence.current;
    setVoiceProcessing(true);
    setVoiceError(null);
    const recording = await voice.stopRecording();
    if (!voiceRequestIsCurrent(requestId)) {
      await voice.reset();
      return;
    }
    if (!recording) {
      setVoiceProcessing(false);
      setVoiceTarget(null);
      setVoiceError("Voice input could not be processed. Please try again or type manually.");
      return;
    }
    try {
      const response = await callVoiceDescribe(recording, {
        mode: "item_edit",
        targetField: VOICE_TARGET_FIELDS[target],
        currentValues: {
          name: draft.searchTerm,
          brand_maker: draft.brand,
          model_series: draft.model,
          description: draft.additionalDetails,
        },
      });
      if (!response.response?.success || !response.response.transcript.trim()) {
        throw new Error(response.networkError || "Voice transcription was empty.");
      }
      if (!voiceRequestIsCurrent(requestId)) return;
      const transcript = normalizeRefinementText(response.response.transcript);
      if (target === "combined") {
        setVoiceProposal({
          target,
          transcript,
          draft: combinedVoiceDraft(draftRef.current, response.response.extraction, transcript),
        });
      } else {
        setVoiceProposal({
          target,
          transcript,
          value: mappedVoiceValue(target, response.response.extraction, transcript),
        });
      }
    } catch {
      if (voiceRequestIsCurrent(requestId)) {
        setVoiceTarget(null);
        setVoiceError("Voice input could not be processed. Your draft is unchanged.");
      }
    } finally {
      if (voiceRequestIsCurrent(requestId)) setVoiceProcessing(false);
      await voice.reset();
    }
  };

  const dismissVoice = async () => {
    const requestId = voiceRequestSequence.current + 1;
    voiceRequestSequence.current = requestId;
    await voice.reset();
    if (!voiceRequestIsCurrent(requestId)) return;
    setVoiceTarget(null);
    setVoiceProposal(null);
    setVoiceError(null);
  };

  const applyVoiceProposal = (mode: "replace" | "append" = "replace") => {
    if (!voiceProposal) return;
    if (voiceProposal.target === "combined" && voiceProposal.draft) {
      changeDraft({
        ...draftRef.current,
        searchTerm: voiceProposal.draft.searchTerm,
        brand: voiceProposal.draft.brand,
        model: voiceProposal.draft.model,
        additionalDetails: voiceProposal.draft.additionalDetails,
      });
    } else if (voiceProposal.target !== "combined" && voiceProposal.value) {
      const field = voiceProposal.target;
      const currentDraft = draftRef.current;
      const nextValue = mode === "append" && currentDraft[field].trim()
        ? `${currentDraft[field].trim()} ${voiceProposal.value}`
        : voiceProposal.value;
      updateTextField(field, normalizeRefinementText(nextValue));
    }
    setVoiceProposal(null);
    setVoiceTarget(null);
  };

  const runAiImprovement = async () => {
    if (!draft.searchTerm.trim() || aiLoading || offline || !aiEnabled) return;
    const requestId = aiRequestSequence.current + 1;
    aiRequestSequence.current = requestId;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await improveReplacementRefinementWithAi(item.id, cloneReplacementRefinementDraft(draftRef.current));
      if (!aiRequestIsCurrent(requestId)) return;
      const applied = applyAiTextUpdate(draftRef.current, result.draft);
      setAiUndoDraft(applied.undoDraft);
      setAiChangedFields(new Set(result.changedFields));
      setAiChipValues(result.suggestedChips);
      changeDraft(applied.draft);
      setAiFeedback(true);
      clearAiFeedbackTimer();
      aiFeedbackTimer.current = setTimeout(() => {
        if (aiRequestIsCurrent(requestId)) setAiFeedback(false);
        aiFeedbackTimer.current = null;
      }, 1400);
    } catch (error) {
      if (aiRequestIsCurrent(requestId)) {
        setAiError(error instanceof Error ? error.message : "AI could not improve the search right now.");
      }
    } finally {
      if (aiRequestIsCurrent(requestId)) setAiLoading(false);
    }
  };

  const undoAi = () => {
    if (!aiUndoDraft) return;
    changeDraft(cloneReplacementRefinementDraft(aiUndoDraft));
    setAiUndoDraft(null);
    setAiChangedFields(new Set());
    setAiChipValues([]);
    setAiFeedback(false);
  };

  const restoreDraft = (next: ReplacementRefinementDraft) => {
    changeDraft(cloneReplacementRefinementDraft(next));
    setAiUndoDraft(null);
    setAiChangedFields(new Set());
    setAiChipValues([]);
    setAiFeedback(false);
    setAiError(null);
  };

  const submit = async () => {
    setSubmitAttempted(true);
    if (!draft.searchTerm.trim() || !rangeValidation.valid || submitting || aiLoading || voiceBusy) return;
    const state = await Network.getNetworkStateAsync().catch(() => null);
    if (state && (state.isConnected === false || state.isInternetReachable === false)) {
      setOffline(true);
      return;
    }
    onSubmit(cloneReplacementRefinementDraft(draftRef.current), rangeValidation.parsed);
  };

  const closeSheet = () => {
    aiRequestSequence.current += 1;
    voiceRequestSequence.current += 1;
    clearAiFeedbackTimer();
    void voice.reset();
    onClose();
  };

  const renderTextField = (
    field: ReplacementRefinementTextField,
    options: { multiline?: boolean; primary?: boolean; maxLength: number },
  ) => {
    const aiChanged = aiChangedFields.has(field);
    const busy = submitting || aiLoading || voiceProcessing || voice.isRecording;
    return (
      <View style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Text style={[options.primary ? styles.primaryLabel : styles.label, { color: colors.foreground }]}>
            {options.primary ? "What are you looking for?" : TEXT_FIELD_LABELS[field]}
          </Text>
          {aiChanged ? <Text accessibilityLabel={`${TEXT_FIELD_LABELS[field]} AI suggested`} style={[styles.aiSuggested, { color: colors.primary }]}>AI suggested</Text> : null}
        </View>
        <View style={[
          styles.inputWrap,
          options.primary && styles.primaryInputWrap,
          aiChanged && styles.aiChanged,
          { borderColor: aiChanged ? colors.primary : colors.input, backgroundColor: colors.card },
        ]}>
          <TextInput
            accessibilityLabel={TEXT_FIELD_LABELS[field]}
            value={draft[field]}
            onChangeText={(value) => updateTextField(field, value)}
            editable={!busy}
            maxLength={options.maxLength}
            multiline={options.multiline}
            placeholder={field === "searchTerm" ? "Sony OLED television" : field === "additionalDetails" ? "Size, material, colour, capacity or features" : TEXT_FIELD_LABELS[field]}
            placeholderTextColor={colors.mutedForeground}
            style={[
              options.primary ? styles.primaryInput : styles.input,
              options.multiline && styles.multilineInput,
              { color: colors.foreground },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dictate ${TEXT_FIELD_LABELS[field]}`}
            disabled={busy}
            onPress={() => void startVoice(field)}
            style={({ pressed }) => [styles.micButton, { backgroundColor: colors.secondary, opacity: busy ? 0.45 : pressed ? 0.72 : 1 }]}
          >
            <Feather name="mic" size={17} color={colors.primary} />
          </Pressable>
        </View>
        {field === "searchTerm" && submitAttempted && !draft.searchTerm.trim() ? (
          <Text style={[styles.errorText, { color: colors.destructive }]}>Add a Search Term before searching.</Text>
        ) : null}
      </View>
    );
  };

  const voiceBusy = voice.isRecording || voiceProcessing || voice.isRequestingPermission || voice.isStartingRecording;
  const selectedChipIds = new Set(draft.chipContributions.map((chip) => chip.id));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeSheet}>
      <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Math.max(insets.top, 12) }]}>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Refine replacement search</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Improve what you’re looking for, then run a new retailer search.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close refinement sheet" onPress={closeSheet} style={styles.closeButton}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={[styles.marketContext, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="map-pin" size={15} color={colors.primary} />
            <Text style={[styles.marketText, { color: colors.foreground }]}>Searching in {marketName} · {currencyCode}{supportLabel ? ` · ${supportLabel}` : ""}</Text>
          </View>

          {renderTextField("searchTerm", { primary: true, maxLength: 120 })}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Improve Search with AI"
            disabled={aiLoading || voiceBusy || submitting || offline || !aiEnabled || !draft.searchTerm.trim()}
            onPress={() => void runAiImprovement()}
            style={({ pressed }) => [
              styles.aiButton,
              { borderColor: colors.primary, backgroundColor: colors.secondary, opacity: aiLoading || voiceBusy || submitting || offline || !aiEnabled || !draft.searchTerm.trim() ? 0.48 : pressed ? 0.76 : 1 },
            ]}
          >
            {aiLoading ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="star" size={17} color={colors.primary} />}
            <Text style={[styles.aiButtonText, { color: colors.primary }]}>{aiLoading ? "Improving…" : "Improve Search with AI"}</Text>
          </Pressable>
          {!aiEnabled ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>AI assistance is unavailable for this property market.</Text> : null}
          {offline ? <Text style={[styles.hint, { color: colors.destructive }]}>You’re offline. Your changes are saved on this screen.</Text> : null}
          {aiFeedback ? <Text accessibilityLiveRegion="polite" style={[styles.aiFeedback, { color: colors.primary }]}>Improved with AI</Text> : null}
          {aiUndoDraft ? <Pressable accessibilityRole="button" onPress={undoAi}><Text style={[styles.linkText, { color: colors.primary }]}>Undo AI changes</Text></Pressable> : null}
          {aiError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{aiError}</Text> : null}

          <View style={[styles.voicePanel, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.voiceCopy}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Describe item by voice</Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>Record, transcribe, then review the draft before searching.</Text>
            </View>
            {!voiceTarget && !voiceProposal ? (
              <Pressable
                accessibilityRole="button"
                disabled={submitting || aiLoading}
                onPress={() => void startVoice("combined")}
                style={({ pressed }) => [styles.voiceAction, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="mic" size={17} color={colors.primaryForeground} />
                <Text style={[styles.voiceActionText, { color: colors.primaryForeground }]}>Start recording</Text>
              </Pressable>
            ) : null}
            {voice.isRecording ? (
              <View style={styles.voiceActive}>
                <View style={[styles.recordingDot, { backgroundColor: colors.destructive }]} />
                <Text accessibilityLiveRegion="polite" style={[styles.voiceStatus, { color: colors.foreground }]}>Listening… {voice.durationSeconds}s</Text>
                <Pressable accessibilityRole="button" onPress={() => void finishVoiceRecording()} style={[styles.stopButton, { borderColor: colors.border }]}>
                  <Feather name="square" size={15} color={colors.foreground} />
                  <Text style={[styles.stopText, { color: colors.foreground }]}>Stop</Text>
                </Pressable>
              </View>
            ) : null}
            {voiceProcessing ? <View style={styles.inlineBusy}><ActivityIndicator size="small" color={colors.primary} /><Text style={[styles.hint, { color: colors.mutedForeground }]}>Transcribing and preparing your draft…</Text></View> : null}
            {voiceProposal ? (
              <View style={[styles.voiceReview, { backgroundColor: colors.muted }]}>
                <Text style={[styles.voiceReviewLabel, { color: colors.mutedForeground }]}>HEARD</Text>
                <Text style={[styles.voiceTranscript, { color: colors.foreground }]}>{voiceProposal.transcript}</Text>
                <View style={styles.reviewActions}>
                  <Pressable accessibilityRole="button" onPress={() => void dismissVoice()} style={[styles.reviewSecondary, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>Discard</Text></Pressable>
                  {voiceProposal.target !== "combined" && draft[voiceProposal.target].trim() ? (
                    <Pressable accessibilityRole="button" onPress={() => applyVoiceProposal("append")} style={[styles.reviewSecondary, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>Append</Text></Pressable>
                  ) : null}
                  <Pressable accessibilityRole="button" onPress={() => applyVoiceProposal("replace")} style={[styles.reviewPrimary, { backgroundColor: colors.primary }]}><Text style={{ color: colors.primaryForeground }}>{voiceProposal.target === "combined" ? "Use draft" : "Replace"}</Text></Pressable>
                </View>
              </View>
            ) : null}
            {voiceError ? (
              <View style={styles.voiceErrorRow}>
                <Text style={[styles.errorText, { color: colors.destructive, flex: 1 }]}>{voiceError}</Text>
                {voice.permission === "blocked" ? (
                  <Pressable accessibilityRole="button" onPress={() => void voice.openSettings()}>
                    <Text style={[styles.linkText, { color: colors.primary }]}>Open Settings</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.supportingSection}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Supporting details</Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>These details help narrow the main Search Term.</Text>
            <View style={styles.twoColumnFields}>
              <View style={styles.flexField}>{renderTextField("brand", { maxLength: 80 })}</View>
              <View style={styles.flexField}>{renderTextField("model", { maxLength: 100 })}</View>
            </View>
            {renderTextField("additionalDetails", { multiline: true, maxLength: 500 })}
          </View>

          {chips.length ? (
            <View style={styles.chipSection}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Helpful details</Text>
              <View style={styles.chips}>
                {chips.map((chip) => {
                  const selected = selectedChipIds.has(chip.id);
                  return (
                    <Pressable
                      key={chip.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${chip.label}${selected ? ", selected, tap to remove" : ", tap to add"}`}
                      onPress={() => changeDraft(toggleRefinementChip(draftRef.current, chip))}
                      style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                    >
                      <Text style={[styles.chipText, { color: selected ? colors.primaryForeground : colors.foreground }]}>{chip.label}</Text>
                      {selected ? <Feather name="x" size={13} color={colors.primaryForeground} /> : <Feather name="plus" size={13} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={[styles.priceSection, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Price range — optional</Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>Limit results to products within this range. Prices use {currencyCode}.</Text>
            <View style={styles.twoColumnFields}>
              {(["minimumPrice", "maximumPrice"] as const).map((field) => {
                const label = field === "minimumPrice" ? "Minimum Price" : "Maximum Price";
                const error = field === "minimumPrice" ? rangeValidation.minimumError : rangeValidation.maximumError;
                return (
                  <View key={field} style={[styles.fieldGroup, styles.flexField]}>
                    <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
                    <View style={[styles.priceInputWrap, { borderColor: error ? colors.destructive : colors.input, backgroundColor: colors.card }]}>
                      <Text style={[styles.currencyToken, { color: colors.mutedForeground }]}>{moneyDisplayToken(currencyCode)}</Text>
                      <TextInput
                        accessibilityLabel={`${label} in ${currencyCode}`}
                        value={draft[field]}
                        onChangeText={(value) => changeDraft({ ...draftRef.current, [field]: value })}
                        onBlur={() => {
                          const value = field === "minimumPrice" ? rangeValidation.parsed.minimumPrice : rangeValidation.parsed.maximumPrice;
                          if (value != null) changeDraft({ ...draftRef.current, [field]: formatMoneyInputValue(value, currencyCode, locale) });
                        }}
                        editable={!submitting}
                        keyboardType="decimal-pad"
                        placeholder="Optional"
                        placeholderTextColor={colors.mutedForeground}
                        style={[styles.priceInput, { color: colors.foreground }]}
                      />
                    </View>
                    {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
                  </View>
                );
              })}
            </View>
            {rangeValidation.rangeError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{rangeValidation.rangeError}</Text> : null}
          </View>

          <View style={styles.recoveryActions}>
            <Pressable accessibilityRole="button" onPress={() => restoreDraft(lastSuccessfulDraft)}><Text style={[styles.linkText, { color: colors.primary }]}>Restore last search</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => restoreDraft(originalDraft)}><Text style={[styles.linkText, { color: colors.primary }]}>Clear refinements</Text></Pressable>
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable accessibilityRole="button" onPress={closeSheet} disabled={submitting} style={[styles.cancelButton, { borderColor: colors.border }]}><Text style={[styles.cancelText, { color: colors.foreground }]}>Cancel</Text></Pressable>
          <View style={styles.submitColumn}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Run Refined Search"
              disabled={submitting || aiLoading || voiceBusy || offline || !draft.searchTerm.trim() || !rangeValidation.valid}
              onPress={() => void submit()}
              style={({ pressed }) => [styles.submitButton, { backgroundColor: colors.primary, opacity: submitting || aiLoading || voiceBusy || offline || !draft.searchTerm.trim() || !rangeValidation.valid ? 0.45 : pressed ? 0.8 : 1 }]}
            >
              {submitting ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="search" size={17} color={colors.primaryForeground} />}
              <Text style={[styles.submitText, { color: colors.primaryForeground }]}>{submitting ? "Starting search…" : "Run Refined Search"}</Text>
            </Pressable>
            <Text style={[styles.submitHint, { color: colors.mutedForeground }]}>Searches retailers again using your refined criteria</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", gap: 12, paddingHorizontal: 18, paddingBottom: 14, borderBottomWidth: 1 },
  headerCopy: { flex: 1, gap: 4 },
  title: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  closeButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  content: { padding: 18, paddingBottom: 32, gap: 20 },
  marketContext: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  marketText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium" },
  fieldGroup: { gap: 7 },
  fieldLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  primaryLabel: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  label: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  aiSuggested: { fontSize: 10, letterSpacing: 0.3, fontFamily: "Inter_600SemiBold" },
  inputWrap: { minHeight: 48, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", paddingLeft: 12 },
  primaryInputWrap: { minHeight: 62, borderWidth: 2 },
  aiChanged: { shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  input: { flex: 1, minHeight: 46, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  primaryInput: { flex: 1, minHeight: 58, paddingVertical: 12, fontSize: 17, fontFamily: "Inter_500Medium" },
  multilineInput: { minHeight: 92, textAlignVertical: "top" },
  micButton: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, margin: 4 },
  aiButton: { minHeight: 50, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14 },
  aiButtonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  aiFeedback: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  hint: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  linkText: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  errorText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  voicePanel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  voiceCopy: { gap: 3 },
  sectionTitle: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_700Bold" },
  voiceAction: { minHeight: 48, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  voiceActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  voiceActive: { flexDirection: "row", alignItems: "center", gap: 9 },
  recordingDot: { width: 10, height: 10, borderRadius: 5 },
  voiceStatus: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  stopButton: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  stopText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  inlineBusy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48 },
  voiceReview: { borderRadius: 12, padding: 12, gap: 8 },
  voiceErrorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  voiceReviewLabel: { fontSize: 9, letterSpacing: 0.7, fontFamily: "Inter_600SemiBold" },
  voiceTranscript: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  reviewActions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 },
  reviewSecondary: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  reviewPrimary: { minHeight: 44, borderRadius: 10, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  supportingSection: { gap: 14 },
  twoColumnFields: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  flexField: { flexGrow: 1, flexBasis: 150 },
  chipSection: { gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  priceSection: { borderTopWidth: 1, paddingTop: 24, gap: 14 },
  priceInputWrap: { minHeight: 48, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 7 },
  currencyToken: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  priceInput: { flex: 1, minHeight: 46, fontSize: 14, fontFamily: "Inter_400Regular" },
  recoveryActions: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 14, paddingTop: 4 },
  footer: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 12, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cancelButton: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  submitColumn: { flex: 1, gap: 5 },
  submitButton: { minHeight: 48, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  submitText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  submitHint: { fontSize: 10, lineHeight: 14, textAlign: "center", fontFamily: "Inter_400Regular" },
});
