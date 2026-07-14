import type { ReplacementRefinementVoiceTarget } from "./replacement-refinement-assist.ts";

export const VOICE_PRESENTATION_TIMEOUT_MS = 2_000;
export const VOICE_PRESENTATION_ERROR =
  "Voice input could not be opened. Please try again or enter the details manually.";

export type RefinementVoicePresentationState = {
  status: "idle" | "opening" | "open";
  target: ReplacementRefinementVoiceTarget | null;
  requestId: number;
  error: string | null;
};

export type RefinementVoicePresentationEvent =
  | { type: "open"; target: ReplacementRefinementVoiceTarget }
  | { type: "presented"; requestId: number }
  | { type: "close" }
  | { type: "failed"; requestId: number; message?: string }
  | { type: "clear_error" };

export const INITIAL_REFINEMENT_VOICE_STATE: RefinementVoicePresentationState =
  {
    status: "idle",
    target: null,
    requestId: 0,
    error: null,
  };

export function refinementVoicePresentationReducer(
  state: RefinementVoicePresentationState,
  event: RefinementVoicePresentationEvent,
): RefinementVoicePresentationState {
  if (event.type === "open") {
    return {
      status: "opening",
      target: event.target,
      requestId: state.requestId + 1,
      error: null,
    };
  }
  if (event.type === "presented") {
    return event.requestId === state.requestId && state.status === "opening"
      ? { ...state, status: "open" }
      : state;
  }
  if (event.type === "failed") {
    return event.requestId === state.requestId
      ? {
          status: "idle",
          target: null,
          requestId: state.requestId,
          error: event.message ?? VOICE_PRESENTATION_ERROR,
        }
      : state;
  }
  if (event.type === "clear_error") return { ...state, error: null };
  return {
    status: "idle",
    target: null,
    requestId: state.requestId,
    error: null,
  };
}

export function refinementCloseDisabled(submitting: boolean): boolean {
  return submitting;
}

export function voiceControlDisabled(input: {
  submitting: boolean;
  aiLoading: boolean;
  voiceStatus: RefinementVoicePresentationState["status"];
}): boolean {
  return input.submitting || input.aiLoading || input.voiceStatus !== "idle";
}

export function refinedSearchSubmitDisabled(input: {
  searchTerm: string;
  submitting: boolean;
  aiLoading: boolean;
  voiceStatus: RefinementVoicePresentationState["status"];
}): boolean {
  return (
    !input.searchTerm.trim() ||
    input.submitting ||
    input.aiLoading ||
    input.voiceStatus !== "idle"
  );
}
