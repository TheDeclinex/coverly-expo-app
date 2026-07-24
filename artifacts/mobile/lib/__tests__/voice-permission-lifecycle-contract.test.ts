import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "components/voice/VoiceInputSheet.tsx"), "utf8");

test("voice permission is refreshed when a visible sheet returns to foreground", () => {
  assert.match(source, /AppState\.addEventListener\("change"/);
  assert.match(source, /nextState === "active" && previousState !== "active"/);
  assert.match(source, /visibleRef\.current/);
  assert.match(source, /voice\.checkPermission\(\)/);
  assert.match(source, /setPhase\(granted \? "ready" : "permission"\)/);
});

test("foreground refresh is single-flight, does not start recording, and cleans up", () => {
  assert.match(source, /permissionRefreshInFlightRef\.current/);
  assert.match(source, /if \(permissionRefreshInFlightRef\.current\) return/);
  assert.match(source, /subscription\.remove\(\)/);
  const lifecycleEffect = source.match(
    /AppState\.addEventListener\("change"([\s\S]*?)subscription\.remove\(\)/,
  )?.[1] ?? "";
  assert.doesNotMatch(lifecycleEffect, /startRecording\(/);
  assert.match(lifecycleEffect, /currentPhase === "recording"/);
  assert.match(lifecycleEffect, /currentPhase === "processing"/);
});
