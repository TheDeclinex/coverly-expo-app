import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createVideoRecordingSessionGate } from "../video-recording-session.ts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("manual stop before the limit wins over the automatic cutoff", () => {
  const gate = createVideoRecordingSessionGate();
  const sessionId = gate.begin();

  assert.equal(gate.requestStop(sessionId, "manual"), true);
  assert.equal(gate.requestStop(sessionId, "maximum-duration"), false);
  assert.equal(gate.complete(sessionId), true);
});

test("automatic cutoff racing a manual stop produces one stop and one completion", () => {
  const gate = createVideoRecordingSessionGate();
  const sessionId = gate.begin();

  assert.equal(gate.requestStop(sessionId, "maximum-duration"), true);
  assert.equal(gate.requestStop(sessionId, "manual"), false);
  assert.equal(gate.complete(sessionId), true);
  assert.equal(gate.complete(sessionId), false);
});

test("cancelled and superseded sessions cannot deliver late recordings", () => {
  const gate = createVideoRecordingSessionGate();
  const cancelledSession = gate.begin();

  assert.equal(gate.requestStop(cancelledSession, "cancel"), true);
  assert.equal(gate.cancel(cancelledSession), true);
  assert.equal(gate.complete(cancelledSession), false);

  const repeatedSession = gate.begin();
  assert.notEqual(repeatedSession, cancelledSession);
  assert.equal(gate.complete(cancelledSession), false);
  assert.equal(gate.requestStop(repeatedSession, "manual"), true);
  assert.equal(gate.complete(repeatedSession), true);
});

test("the in-app recorder has native and watchdog 10-second cutoffs with visible guidance", () => {
  const recorder = read("components/VideoScanRecorder.tsx");
  const scan = read("app/(tabs)/scan.tsx");

  assert.match(recorder, /VIDEO_SCAN_MAX_DURATION_SECONDS = 10/);
  assert.match(recorder, /recordAsync\(\{\s*maxDuration: VIDEO_SCAN_MAX_DURATION_SECONDS/);
  assert.match(recorder, /setTimeout\(\(\) => \{\s*requestStop\("maximum-duration"\)/);
  assert.match(recorder, /Record up to \$\{VIDEO_SCAN_MAX_DURATION_SECONDS\} seconds/);
  assert.match(recorder, /Recording · \$\{secondsRemaining\}s left/);
  assert.match(recorder, /clearRecordingTimers\(\);\s*cancelActiveSession\(\)/);
  assert.doesNotMatch(scan, /videoMaxDuration:/);
});

test("recorded video continues directly into the existing frame extraction and scan workflow", () => {
  const scan = read("app/(tabs)/scan.tsx");

  assert.match(scan, /handleRecordedVideo[\s\S]*scanVideoAsset\(\{ uri, duration: durationMs \}\)/);
  assert.match(scan, /const effectiveDuration = Math\.min\(sourceDuration, VIDEO_SCAN_USED_DURATION_MS\)/);
  assert.match(scan, /await handleStartScan\("video_room", frames\)/);
});
