import { Feather } from "@expo/vector-icons";
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

import { VoiceInputSheet } from "@/components/voice/VoiceInputSheet";
import { useColors } from "@/hooks/useColors";
import { improveReplacementRefinementWithAi } from "@/lib/replacement-refinement-ai";
import {
  applyReplacementRefinementChip,
  applyVoiceRefinement,
  shouldApplyReplacementAssistResult,
  suggestedReplacementRefinementChips,
  validateAndApplyAiRefinement,
  type ReplacementRefinementItemContext,
  type ReplacementRefinementVoiceTarget,
} from "@/lib/replacement-refinement-assist";
import {
  REPLACEMENT_SEARCH_LIMITS,
  validateReplacementRefinement,
  type ReplacementRefinementErrors,
  type ReplacementSearchCriteria,
  type ReplacementSearchRefinementDraft,
} from "@/lib/replacement-pricing-model";
import {
  INITIAL_REFINEMENT_VOICE_STATE,
  refinementCloseDisabled,
  refinedSearchSubmitDisabled,
  refinementVoicePresentationReducer,
  VOICE_PRESENTATION_TIMEOUT_MS,
  voiceControlDisabled,
} from "@/lib/replacement-refinement-voice-state";
import type { VoiceItemField, VoiceItemPatch } from "@/types/voice";

interface ReplacementSearchRefinementModalProps {
  visible: boolean;
  initialDraft: ReplacementSearchRefinementDraft;
  itemContext: ReplacementRefinementItemContext;
  submitting: boolean;
  onDismiss: () => void;
  onSubmit: (criteria: ReplacementSearchCriteria) => void;
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onVoice?: () => void;
  voiceDisabled?: boolean;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  keyboardType?: "default" | "decimal-pad";
};

const VOICE_FIELD: Partial<
  Record<ReplacementRefinementVoiceTarget, VoiceItemField>
> = {
  searchTerm: "name",
  brand: "brand_maker",
  model: "model_series",
  additionalDetails: "description",
};

const VOICE_TITLE: Record<ReplacementRefinementVoiceTarget, string> = {
  searchTerm: "Speak search term",
  brand: "Speak brand or maker",
  model: "Speak model or series",
  additionalDetails: "Speak additional details",
  combined: "Describe item by voice",
};

function RefinementField({
  label,
  value,
  onChangeText,
  onVoice,
  voiceDisabled,
  disabled,
  placeholder,
  error,
  required,
  maxLength,
  multiline,
  keyboardType = "default",
}: FieldProps) {
  const colors = useColors();
  return (
    <View style={styles.fieldGroup}>
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.label, { color: colors.foreground }]}>
          {label}
          {required ? " *" : ""}
        </Text>
        {onVoice ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Speak ${label.toLowerCase()}`}
            disabled={voiceDisabled}
            onPress={onVoice}
            style={({ pressed }) => [
              styles.fieldVoiceButton,
              {
                backgroundColor: colors.secondary,
                opacity: voiceDisabled ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="mic" size={14} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        maxLength={maxLength}
        multiline={multiline}
        keyboardType={keyboardType}
        editable={!disabled}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          {
            color: colors.foreground,
            backgroundColor: colors.background,
            borderColor: error ? colors.destructive : colors.input,
            opacity: disabled ? 0.68 : 1,
          },
        ]}
      />
      {error ? (
        <Text style={[styles.fieldError, { color: colors.destructive }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function ReplacementSearchRefinementModal({
  visible,
  initialDraft,
  itemContext,
  submitting,
  onDismiss,
  onSubmit,
}: ReplacementSearchRefinementModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = React.useState(initialDraft);
  const [errors, setErrors] = React.useState<ReplacementRefinementErrors>({});
  const [voicePresentation, dispatchVoice] = React.useReducer(
    refinementVoicePresentationReducer,
    INITIAL_REFINEMENT_VOICE_STATE,
  );
  const [lastVoiceTranscript, setLastVoiceTranscript] = React.useState("");
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [aiRationale, setAiRationale] = React.useState<string | null>(null);
  const visibleRef = React.useRef(visible);
  const aiAbortRef = React.useRef<AbortController | null>(null);
  const aiInFlightRef = React.useRef(false);
  const aiRequestIdRef = React.useRef(0);
  const draftRevisionRef = React.useRef(0);

  React.useEffect(() => {
    visibleRef.current = visible;
    if (!visible) {
      aiRequestIdRef.current += 1;
      aiAbortRef.current?.abort();
      aiAbortRef.current = null;
      aiInFlightRef.current = false;
      setAiLoading(false);
      dispatchVoice({ type: "close" });
      return;
    }
    setDraft(initialDraft);
    draftRevisionRef.current += 1;
    setErrors({});
    dispatchVoice({ type: "close" });
    setLastVoiceTranscript("");
    setAiError(null);
    setAiRationale(null);
  }, [initialDraft, visible]);

  React.useEffect(
    () => () => {
      visibleRef.current = false;
      aiRequestIdRef.current += 1;
      aiAbortRef.current?.abort();
    },
    [],
  );

  React.useEffect(() => {
    if (voicePresentation.status !== "opening") return;
    const requestId = voicePresentation.requestId;
    const timeout = setTimeout(
      () => dispatchVoice({ type: "failed", requestId }),
      VOICE_PRESENTATION_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [voicePresentation.requestId, voicePresentation.status]);

  const voiceTarget = voicePresentation.target;
  const voiceDisabled = voiceControlDisabled({
    submitting,
    aiLoading,
    voiceStatus: voicePresentation.status,
  });
  const aiDisabled =
    submitting || aiLoading || voicePresentation.status !== "idle";
  const submitDisabled = refinedSearchSubmitDisabled({
    submitting,
    aiLoading,
    voiceStatus: voicePresentation.status,
  });
  const chips = React.useMemo(
    () => suggestedReplacementRefinementChips(draft, itemContext),
    [draft, itemContext],
  );

  const update = (
    field: keyof ReplacementSearchRefinementDraft,
    value: string,
  ) => {
    draftRevisionRef.current += 1;
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setAiError(null);
  };

  const closeModal = () => {
    if (refinementCloseDisabled(submitting)) return;
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    aiInFlightRef.current = false;
    dispatchVoice({ type: "close" });
    onDismiss();
  };

  const submit = () => {
    if (submitDisabled) return;
    const validation = validateReplacementRefinement(draft);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    onSubmit(validation.criteria);
  };

  const openVoice = (target: ReplacementRefinementVoiceTarget) => {
    if (voiceDisabled || aiInFlightRef.current) return;
    setAiError(null);
    dispatchVoice({ type: "open", target });
  };

  const applyVoice = (patch: VoiceItemPatch, transcript: string) => {
    if (!visibleRef.current || !voiceTarget) return;
    draftRevisionRef.current += 1;
    setDraft((current) =>
      applyVoiceRefinement(current, voiceTarget, patch, transcript),
    );
    setLastVoiceTranscript(transcript.slice(0, 1_500));
    setErrors({});
    setAiError(null);
    setAiRationale(null);
  };

  const improveWithAi = async () => {
    if (aiDisabled || aiInFlightRef.current) return;
    const draftValidation = validateReplacementRefinement(draft);
    if (!draftValidation.ok) {
      setErrors(draftValidation.errors);
      return;
    }
    const normalizedCriteria = draftValidation.criteria;
    const assistDraft: ReplacementSearchRefinementDraft = {
      ...draft,
      searchTerm: normalizedCriteria.searchTerm,
      brand: normalizedCriteria.brand ?? "",
      model: normalizedCriteria.model ?? "",
      additionalDetails: normalizedCriteria.additionalDetails ?? "",
      ...(normalizedCriteria.preferredRetailer
        ? { preferredRetailer: normalizedCriteria.preferredRetailer }
        : {}),
    };

    aiInFlightRef.current = true;
    const requestId = aiRequestIdRef.current + 1;
    const draftRevision = draftRevisionRef.current;
    aiRequestIdRef.current = requestId;
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiLoading(true);
    setAiError(null);
    setAiRationale(null);
    try {
      const suggestion = await improveReplacementRefinementWithAi(
        itemContext,
        assistDraft,
        { voiceTranscript: lastVoiceTranscript, signal: controller.signal },
      );
      if (
        !shouldApplyReplacementAssistResult(
          visibleRef.current,
          requestId,
          aiRequestIdRef.current,
        )
      )
        return;
      if (draftRevision !== draftRevisionRef.current) {
        setAiError(
          "Your draft changed while AI was working. Run AI improvement again if needed.",
        );
        return;
      }
      const validated = validateAndApplyAiRefinement(
        suggestion,
        assistDraft,
        itemContext,
        lastVoiceTranscript,
      );
      if (!validated.ok) {
        setAiError(
          "AI refinement is temporarily unavailable. You can continue manually.",
        );
        return;
      }
      setDraft(validated.draft);
      draftRevisionRef.current += 1;
      setAiRationale(validated.rationale);
      setErrors({});
    } catch (error) {
      if (
        !shouldApplyReplacementAssistResult(
          visibleRef.current,
          requestId,
          aiRequestIdRef.current,
        )
      )
        return;
      const message =
        error instanceof Error
          ? error.message
          : "AI refinement is temporarily unavailable. You can continue manually.";
      if (!/cancelled/i.test(message)) setAiError(message);
    } finally {
      if (requestId === aiRequestIdRef.current) {
        aiInFlightRef.current = false;
        aiAbortRef.current = null;
        if (visibleRef.current) setAiLoading(false);
      }
    }
  };

  const applyChip = (
    chip: Parameters<typeof applyReplacementRefinementChip>[2],
  ) => {
    if (submitting) return;
    draftRevisionRef.current += 1;
    setDraft((current) =>
      applyReplacementRefinementChip(current, itemContext, chip),
    );
    setErrors({});
    setAiError(null);
    setAiRationale(null);
  };

  const voiceField = voiceTarget ? VOICE_FIELD[voiceTarget] : undefined;
  const activeVoiceRequestId = voicePresentation.requestId;
  const handleVoicePresented = React.useCallback(
    () =>
      dispatchVoice({
        type: "presented",
        requestId: activeVoiceRequestId,
      }),
    [activeVoiceRequestId],
  );
  const handleVoicePresentationError = React.useCallback(
    () => dispatchVoice({ type: "failed", requestId: activeVoiceRequestId }),
    [activeVoiceRequestId],
  );
  const handleVoiceFailure = React.useCallback(
    (message: string) =>
      dispatchVoice({
        type: "failed",
        requestId: activeVoiceRequestId,
        message,
      }),
    [activeVoiceRequestId],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={submitting ? undefined : closeModal}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close refine search"
          disabled={submitting}
          onPress={closeModal}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Refine search
              </Text>
              <Text
                style={[styles.subtitle, { color: colors.mutedForeground }]}
              >
                Review the criteria before running a new listing search.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel refine search"
              disabled={submitting}
              onPress={closeModal}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: colors.muted,
                  opacity: submitting ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="x" size={19} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.form}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.assistCard,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.assistLabel, { color: colors.mutedForeground }]}
              >
                REFINEMENT ASSIST
              </Text>
              <View style={styles.assistActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={voiceDisabled}
                  onPress={() => openVoice("combined")}
                  style={({ pressed }) => [
                    styles.assistButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: voiceDisabled ? 0.45 : pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <Feather name="mic" size={15} color={colors.primary} />
                  <Text
                    style={[
                      styles.assistButtonText,
                      { color: colors.foreground },
                    ]}
                  >
                    Describe item by voice
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={aiDisabled}
                  onPress={() => void improveWithAi()}
                  style={({ pressed }) => [
                    styles.assistButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: aiDisabled ? 0.45 : pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  {aiLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Feather name="star" size={15} color={colors.primary} />
                  )}
                  <Text
                    style={[
                      styles.assistButtonText,
                      { color: colors.foreground },
                    ]}
                  >
                    {aiLoading ? "Improving search…" : "Improve search with AI"}
                  </Text>
                </Pressable>
              </View>
              {aiError ? (
                <Text
                  style={[styles.assistError, { color: colors.destructive }]}
                >
                  {aiError}
                </Text>
              ) : null}
              {voicePresentation.error ? (
                <Text
                  style={[styles.assistError, { color: colors.destructive }]}
                >
                  {voicePresentation.error}
                </Text>
              ) : null}
              {aiRationale ? (
                <Text
                  style={[
                    styles.assistRationale,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {aiRationale}
                </Text>
              ) : null}
            </View>

            {chips.length ? (
              <View style={styles.chipSection}>
                <Text
                  style={[
                    styles.assistLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  SUGGESTED REFINEMENTS
                </Text>
                <View style={styles.chips}>
                  {chips.map((chip) => (
                    <Pressable
                      key={chip.id}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: chip.selected,
                        disabled: submitting,
                      }}
                      disabled={submitting}
                      onPress={() => applyChip(chip.id)}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor: chip.selected
                            ? colors.primary
                            : colors.card,
                          borderColor: chip.selected
                            ? colors.primary
                            : colors.border,
                          opacity: submitting ? 0.45 : pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      {chip.selected ? (
                        <Feather
                          name="check"
                          size={12}
                          color={colors.primaryForeground}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: chip.selected
                              ? colors.primaryForeground
                              : colors.foreground,
                          },
                        ]}
                      >
                        {chip.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <RefinementField
              label="Search term"
              required
              value={draft.searchTerm}
              onChangeText={(value) => update("searchTerm", value)}
              onVoice={() => openVoice("searchTerm")}
              voiceDisabled={voiceDisabled}
              disabled={submitting}
              placeholder="Item, brand, or model"
              error={errors.searchTerm}
              maxLength={REPLACEMENT_SEARCH_LIMITS.searchTerm}
            />
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <RefinementField
                  label="Brand / maker"
                  value={draft.brand}
                  onChangeText={(value) => update("brand", value)}
                  onVoice={() => openVoice("brand")}
                  voiceDisabled={voiceDisabled}
                  disabled={submitting}
                  placeholder="e.g. Samsung"
                  error={errors.brand}
                  maxLength={REPLACEMENT_SEARCH_LIMITS.brand}
                />
              </View>
              <View style={styles.column}>
                <RefinementField
                  label="Model / series"
                  value={draft.model}
                  onChangeText={(value) => update("model", value)}
                  onVoice={() => openVoice("model")}
                  voiceDisabled={voiceDisabled}
                  disabled={submitting}
                  placeholder="e.g. QN90C"
                  error={errors.model}
                  maxLength={REPLACEMENT_SEARCH_LIMITS.model}
                />
              </View>
            </View>
            <RefinementField
              label="Additional details"
              value={draft.additionalDetails}
              onChangeText={(value) => update("additionalDetails", value)}
              onVoice={() => openVoice("additionalDetails")}
              voiceDisabled={voiceDisabled}
              disabled={submitting}
              placeholder="Size, colour, material, or other identifiers"
              error={errors.additionalDetails}
              maxLength={REPLACEMENT_SEARCH_LIMITS.additionalDetails}
              multiline
            />
            <View style={styles.twoColumns}>
              <View style={styles.column}>
                <RefinementField
                  label="Minimum price"
                  value={draft.minPrice}
                  onChangeText={(value) => update("minPrice", value)}
                  disabled={submitting}
                  placeholder="$0"
                  error={errors.minPrice}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.column}>
                <RefinementField
                  label="Maximum price"
                  value={draft.maxPrice}
                  onChangeText={(value) => update("maxPrice", value)}
                  disabled={submitting}
                  placeholder="$2,000"
                  error={errors.maxPrice}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Text
              style={[styles.newSearchNote, { color: colors.mutedForeground }]}
            >
              Voice, AI, and chips only edit these fields. This button runs the
              new price search.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={submitDisabled}
              onPress={submit}
              style={({ pressed }) => [
                styles.submitButton,
                {
                  backgroundColor: colors.primary,
                  opacity: submitDisabled ? 0.55 : pressed ? 0.82 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator
                  size="small"
                  color={colors.primaryForeground}
                />
              ) : (
                <Feather
                  name="search"
                  size={17}
                  color={colors.primaryForeground}
                />
              )}
              <Text
                style={[styles.submitText, { color: colors.primaryForeground }]}
              >
                Run refined search
              </Text>
            </Pressable>
          </View>
        </View>

        <VoiceInputSheet
          visible={visible && voiceTarget !== null}
          presentation="embedded"
          title={voiceTarget ? VOICE_TITLE[voiceTarget] : "Voice refinement"}
          targetField={voiceField}
          currentValues={{
            name: draft.searchTerm,
            category: itemContext.category,
            brand_maker: draft.brand,
            model_series: draft.model,
            description: draft.additionalDetails,
          }}
          context={{
            currentName: itemContext.itemName,
            currentCategory: itemContext.category ?? undefined,
            currentDescription: itemContext.description ?? undefined,
          }}
          onPresented={handleVoicePresented}
          onPresentationError={handleVoicePresentationError}
          onFailure={handleVoiceFailure}
          onClose={() => dispatchVoice({ type: "close" })}
          onApply={applyVoice}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.42)",
  },
  sheet: {
    maxHeight: "94%",
    borderTopWidth: 1,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 9,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerCopy: { flex: 1, gap: 3 },
  title: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  form: { paddingHorizontal: 18, paddingVertical: 8, gap: 14 },
  assistCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 9 },
  assistLabel: {
    fontSize: 10,
    letterSpacing: 0.7,
    fontFamily: "Inter_600SemiBold",
  },
  assistActions: { gap: 8 },
  assistButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  assistButtonText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  assistError: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  assistRationale: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
  },
  chipSection: { gap: 7 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  chipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  fieldGroup: { gap: 6 },
  fieldLabelRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  fieldVoiceButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    minHeight: 45,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  multilineInput: { minHeight: 80, textAlignVertical: "top" },
  fieldError: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_400Regular" },
  twoColumns: { flexDirection: "row", gap: 10 },
  column: { flex: 1 },
  footer: { borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12, gap: 9 },
  newSearchNote: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  submitButton: {
    minHeight: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  submitText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
