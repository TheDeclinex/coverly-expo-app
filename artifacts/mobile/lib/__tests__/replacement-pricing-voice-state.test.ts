import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mainReplacementVoiceDisabled,
  shouldApplyMainReplacementVoiceResult,
} from "../replacement-pricing-voice-state.ts";

test("main-screen voice is disabled while refinement is visible", () => {
  assert.equal(
    mainReplacementVoiceDisabled({
      searching: false,
      processing: false,
      requestingPermission: false,
      startingRecording: false,
      refinementVisible: true,
    }),
    true,
  );
  assert.equal(
    mainReplacementVoiceDisabled({
      searching: false,
      processing: false,
      requestingPermission: false,
      startingRecording: false,
      refinementVisible: false,
    }),
    false,
  );
});

test("an invalidated or hidden main voice result cannot mutate search state", () => {
  assert.equal(
    shouldApplyMainReplacementVoiceResult({
      requestId: 4,
      activeRequestId: 5,
      refinementVisible: false,
      mounted: true,
    }),
    false,
  );
  assert.equal(
    shouldApplyMainReplacementVoiceResult({
      requestId: 5,
      activeRequestId: 5,
      refinementVisible: true,
      mounted: true,
    }),
    false,
  );
  assert.equal(
    shouldApplyMainReplacementVoiceResult({
      requestId: 5,
      activeRequestId: 5,
      refinementVisible: false,
      mounted: true,
    }),
    true,
  );
});

test("screen invalidates main voice when opening refinement and explains unavailable filters", () => {
  const screenPath = new URL(
    "../../app/(tabs)/replacement-pricing/[id].tsx",
    import.meta.url,
  ).pathname.replace(/^\/(?=[A-Za-z]:)/, "");
  const source = readFileSync(screenPath, "utf8");
  assert.match(source, /mainVoiceRequestIdRef\.current \+= 1/);
  assert.match(source, /refinementVisibleRef\.current = true/);
  assert.match(source, /disabled=\{mainVoiceDisabled\}/);
  assert.match(source, /shouldApplyMainReplacementVoiceResult/);
  assert.match(
    source,
    /Add an estimated replacement value to enable Low, Similar and High filters\./,
  );
});
