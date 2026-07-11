import type { NormalizedPin } from "@/lib/pin-position";

export interface ViewerPinState {
  committedPin: NormalizedPin | null;
  draftPin: NormalizedPin;
  editing: boolean;
  incomingKey: string;
}

function pinKey(pin: NormalizedPin | null | undefined): string {
  return pin ? `${pin.x}:${pin.y}` : "none";
}

export function createViewerPinState(pin: NormalizedPin | null | undefined): ViewerPinState {
  return {
    committedPin: pin ?? null,
    draftPin: pin ?? { x: 0.5, y: 0.5 },
    editing: false,
    incomingKey: pinKey(pin),
  };
}

export function beginViewerPinEdit(state: ViewerPinState): ViewerPinState {
  return {
    ...state,
    draftPin: state.committedPin ?? { x: 0.5, y: 0.5 },
    editing: true,
  };
}

export function updateViewerPinDraft(state: ViewerPinState, draftPin: NormalizedPin): ViewerPinState {
  return { ...state, draftPin };
}

export function cancelViewerPinEdit(state: ViewerPinState): ViewerPinState {
  return {
    ...state,
    draftPin: state.committedPin ?? { x: 0.5, y: 0.5 },
    editing: false,
  };
}

export function commitViewerPinDraft(state: ViewerPinState): ViewerPinState {
  return { ...state, committedPin: state.draftPin, editing: false };
}

export function syncIncomingViewerPin(
  state: ViewerPinState,
  incomingPin: NormalizedPin | null | undefined,
): ViewerPinState {
  if (state.editing) return state;
  const nextKey = pinKey(incomingPin);
  if (nextKey === state.incomingKey) return state;
  return {
    committedPin: incomingPin ?? null,
    draftPin: incomingPin ?? { x: 0.5, y: 0.5 },
    editing: false,
    incomingKey: nextKey,
  };
}
