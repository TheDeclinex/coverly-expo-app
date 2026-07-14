import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INITIAL_REFINEMENT_VOICE_STATE,
  VOICE_PRESENTATION_ERROR,
  VOICE_PRESENTATION_TIMEOUT_MS,
  refinedSearchSubmitDisabled,
  refinementCloseDisabled,
  refinementVoicePresentationReducer,
  voiceControlDisabled,
} from "../replacement-refinement-voice-state.ts";

test("voice presentation opens, confirms mount, and cancellation restores idle state", () => {
  const opening = refinementVoicePresentationReducer(
    INITIAL_REFINEMENT_VOICE_STATE,
    { type: "open", target: "combined" },
  );
  assert.equal(opening.status, "opening");
  assert.equal(opening.target, "combined");

  const open = refinementVoicePresentationReducer(opening, {
    type: "presented",
    requestId: opening.requestId,
  });
  assert.equal(open.status, "open");
  assert.deepEqual(
    refinementVoicePresentationReducer(open, { type: "close" }),
    {
      status: "idle",
      target: null,
      requestId: open.requestId,
      error: null,
    },
  );
});

test("permission, recorder, transcription, and presentation failures recover without losing escape", () => {
  for (const message of [
    "Permission denied",
    "Recorder setup failed",
    "Transcription failed",
    VOICE_PRESENTATION_ERROR,
  ]) {
    const opening = refinementVoicePresentationReducer(
      INITIAL_REFINEMENT_VOICE_STATE,
      { type: "open", target: "searchTerm" },
    );
    const recovered = refinementVoicePresentationReducer(opening, {
      type: "failed",
      requestId: opening.requestId,
      message,
    });
    assert.equal(recovered.status, "idle");
    assert.equal(recovered.target, null);
    assert.equal(recovered.error, message);
    assert.equal(refinementCloseDisabled(false), false);
  }
  assert.ok(VOICE_PRESENTATION_TIMEOUT_MS > 0);
  assert.ok(VOICE_PRESENTATION_TIMEOUT_MS <= 5_000);
});

test("stale callbacks cannot reopen or fail a newer voice request", () => {
  const first = refinementVoicePresentationReducer(
    INITIAL_REFINEMENT_VOICE_STATE,
    { type: "open", target: "brand" },
  );
  const closed = refinementVoicePresentationReducer(first, { type: "close" });
  const second = refinementVoicePresentationReducer(closed, {
    type: "open",
    target: "model",
  });
  assert.equal(
    refinementVoicePresentationReducer(second, {
      type: "failed",
      requestId: first.requestId,
    }),
    second,
  );
});

test("voice and AI disable only conflicting actions, never the close route", () => {
  assert.equal(
    voiceControlDisabled({
      submitting: false,
      aiLoading: true,
      voiceStatus: "idle",
    }),
    true,
  );
  assert.equal(
    refinedSearchSubmitDisabled({
      submitting: false,
      aiLoading: false,
      voiceStatus: "open",
    }),
    true,
  );
  assert.equal(refinementCloseDisabled(false), false);
  assert.equal(refinementCloseDisabled(true), true);
});

test("refinement embeds the shared voice sheet and keeps listing search behind submit", () => {
  const modalPath = new URL(
    "../../components/ReplacementSearchRefinementModal.tsx",
    import.meta.url,
  ).pathname.replace(/^\/(?=[A-Za-z]:)/, "");
  const source = readFileSync(modalPath, "utf8");
  assert.match(source, /presentation="embedded"/);
  assert.match(source, /onPresented=/);
  assert.match(source, /VOICE_PRESENTATION_TIMEOUT_MS/);
  assert.doesNotMatch(source, /disabled=\{submitting \|\| voiceActive\}/);
  assert.equal(source.includes("searchReplacementPrices"), false);
  assert.equal(source.includes("Run refined search"), true);
});

test("voice sheet confirms layout, cleans hidden recordings, and bounds transcription time", () => {
  const sheetPath = new URL(
    "../../components/voice/VoiceInputSheet.tsx",
    import.meta.url,
  ).pathname.replace(/^\/(?=[A-Za-z]:)/, "");
  const voiceInputPath = new URL(
    "../voice-input.ts",
    import.meta.url,
  ).pathname.replace(/^\/(?=[A-Za-z]:)/, "");
  const recordingHookPath = new URL(
    "../../hooks/useVoiceRecording.ts",
    import.meta.url,
  ).pathname.replace(/^\/(?=[A-Za-z]:)/, "");
  const sheetSource = readFileSync(sheetPath, "utf8");
  const voiceInputSource = readFileSync(voiceInputPath, "utf8");
  const recordingHookSource = readFileSync(recordingHookPath, "utf8");

  assert.match(sheetSource, /onLayout=.*reportPresented/);
  assert.match(sheetSource, /onShow=\{reportPresented\}/);
  assert.match(sheetSource, /onFailure\?: \(message: string\) => void/);
  assert.match(sheetSource, /const reportFailure =/);
  assert.match(sheetSource, /wasVisibleRef\.current && !closingRef\.current/);
  assert.match(sheetSource, /void voice\.reset\(\)/);
  assert.match(voiceInputSource, /VOICE_DESCRIBE_TIMEOUT_MS = 45_000/);
  assert.match(voiceInputSource, /timeout: VOICE_DESCRIBE_TIMEOUT_MS/);
  assert.match(recordingHookSource, /void recorder\.stop\(\)/);
  assert.match(
    recordingHookSource,
    /setAudioModeAsync\(\{ allowsRecording: false \}\)/,
  );
});
