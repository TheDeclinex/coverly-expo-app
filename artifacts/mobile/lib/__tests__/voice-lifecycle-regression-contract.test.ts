import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const hook = readFileSync(resolve(process.cwd(), "hooks/useVoiceRecording.ts"), "utf8");
const itemSheet = readFileSync(resolve(process.cwd(), "components/voice/VoiceInputSheet.tsx"), "utf8");
const itemForm = readFileSync(resolve(process.cwd(), "components/ItemMaintenanceForm.tsx"), "utf8");
const refinementSheet = readFileSync(resolve(process.cwd(), "components/ReplacementSearchRefinementSheet.tsx"), "utf8");
const roomScreen = readFileSync(resolve(process.cwd(), "app/(tabs)/room/[id].tsx"), "utf8");

test("voice hook callbacks and unmount teardown do not depend on recorder state changes", () => {
  const permissionCallback = hook.match(
    /const checkPermission = useCallback\(([\s\S]*?)\n  \}, \[([\s\S]*?)\]\);/,
  );
  assert.ok(permissionCallback, "permission callback contract was not found");
  assert.doesNotMatch(permissionCallback[2], /permission\b|recorderState|isRecording/);

  const resetCallback = hook.match(
    /const reset = useCallback\(([\s\S]*?)\n  \}, \[([\s\S]*?)\]\);/,
  );
  assert.ok(resetCallback, "reset callback contract was not found");
  assert.doesNotMatch(resetCallback[2], /recorderState|isRecording|recorder\b/);
  assert.match(resetCallback[2], /enqueueAudioOperation/);

  const unmountEffect = hook.match(
    /reason: "component_unmount"[\s\S]*?\n  \}, \[([\s\S]*?)\]\);/,
  );
  assert.ok(unmountEffect, "component-unmount cleanup contract was not found");
  assert.doesNotMatch(unmountEffect[1], /recorderState|isRecording|recorder\b/);
  assert.match(hook, /recorderRef\.current = recorder/);
  assert.match(hook, /audioOperationRef/);
});

test("normal start-to-recording updates cannot trigger refinement cleanup or invalidate its request", () => {
  assert.doesNotMatch(refinementSheet, /\[visible,\s*voice\.reset\]/);
  assert.doesNotMatch(refinementSheet, /\},\s*\[voice\.reset\]\);/);

  const startVoice = refinementSheet.match(
    /const startVoice = async[\s\S]*?\n  \};\n\n  const finishVoiceRecording/,
  )?.[0] ?? "";
  assert.match(startVoice, /voiceRequestSequence\.current = requestId/);
  assert.match(startVoice, /await voice\.startRecording\(\)/);
  assert.doesNotMatch(startVoice, /voiceRequestSequence\.current \+= 1/);
  assert.doesNotMatch(startVoice, /voice\.reset\("recording_complete"\)/);
});

test("refinement recording is reset only for explicit close, cancel, completion, stale work, or unmount", () => {
  assert.match(refinementSheet, /voiceResetRef\.current\("sheet_closed"\)/);
  assert.match(refinementSheet, /voiceResetRef\.current\("component_unmount"\)/);
  assert.match(refinementSheet, /voice\.reset\("user_cancel"\)/);
  assert.match(refinementSheet, /voice\.reset\("recording_complete"\)/);
  assert.match(refinementSheet, /voice\.reset\("stale_request_cleanup"\)/);
});

test("item voice startup has visible starting, recording, recoverable error, and synchronous close states", () => {
  assert.match(itemSheet, /setPhase\("starting"\)/);
  assert.match(itemSheet, /setPhase\("recording"\)/);
  assert.match(itemSheet, /phase === "starting"/);
  assert.match(itemSheet, /phase === "error"/);
  assert.match(itemSheet, />Close voice input</);

  const closeHandler = itemSheet.match(
    /const closeAndClean = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[onClose, voice\.reset\]\);/,
  )?.[1] ?? "";
  assert.ok(closeHandler.indexOf("onClose();") >= 0, "close handler must dismiss the parent modal");
  assert.ok(
    closeHandler.indexOf("onClose();") < closeHandler.indexOf('voice.reset("user_cancel")'),
    "the modal must dismiss without waiting for native recorder cleanup",
  );
});

test("item voice permission refresh cannot race permission requests or recording transitions", () => {
  assert.match(itemSheet, /permissionRequestActiveRef/);
  assert.match(itemSheet, /currentPhase === "starting"/);
  assert.match(itemSheet, /currentPhase === "stopping"/);
  assert.match(itemSheet, /\|\| permissionRequestActiveRef\.current/);
  assert.match(itemSheet, /requestId === sheetRequestSequenceRef\.current/);
});

test("item form closes the voice modal without replacing unsaved draft state", () => {
  assert.match(itemForm, /const \[voiceOpen, setVoiceOpen\] = React\.useState\(false\)/);
  assert.match(itemForm, /visible=\{voiceOpen\}/);
  assert.match(itemForm, /onClose=\{\(\) => setVoiceOpen\(false\)\}/);
  const openVoice = itemForm.match(/const openVoice = React\.useCallback\(([\s\S]*?)\n/)?.[0] ?? "";
  assert.match(openVoice, /setVoiceTarget\(target\)/);
  assert.match(openVoice, /setVoiceOpen\(true\)/);
  assert.doesNotMatch(openVoice, /setDraft|router|navigate/);
});

test("iOS room quick edit dismisses its native modal before presenting voice", () => {
  assert.match(roomScreen, /const \[quickEditSuspendedForVoice, setQuickEditSuspendedForVoice\] = useState\(false\)/);
  assert.match(roomScreen, /visible=\{editingTarget !== null && !quickEditSuspendedForVoice\}/);
  assert.match(roomScreen, /onDismiss=\{handleQuickEditModalDismissed\}/);
  assert.match(roomScreen, /onPress=\{openQuickEditVoice\}/);

  const openVoice = roomScreen.match(
    /const openQuickEditVoice = \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1] ?? "";
  assert.match(openVoice, /Platform\.OS !== "ios"/);
  assert.match(openVoice, /setVoiceEditOpen\(true\)/);
  assert.match(openVoice, /setQuickEditSuspendedForVoice\(true\)/);
  assert.doesNotMatch(openVoice, /setTimeout|onCloseEdit|setNameDraft|setQuantityDraft|setUnitPriceDraft/);

  const quickEditDismissed = roomScreen.match(
    /const handleQuickEditModalDismissed = \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1] ?? "";
  assert.match(quickEditDismissed, /quickEditSuspendedForVoice/);
  assert.match(quickEditDismissed, /editingTarget/);
  assert.match(quickEditDismissed, /setVoiceEditOpen\(true\)/);
});

test("iOS room quick edit resumes only after the voice modal is actually dismissed", () => {
  assert.match(itemSheet, /onDismiss\?: \(\) => void/);
  assert.match(itemSheet, /onDismiss=\{onDismiss\}/);
  assert.match(roomScreen, /onDismiss=\{handleQuickEditVoiceDismissed\}/);

  const voiceDismissed = roomScreen.match(
    /const handleQuickEditVoiceDismissed = \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1] ?? "";
  assert.match(voiceDismissed, /Platform\.OS !== "ios"/);
  assert.match(voiceDismissed, /setQuickEditSuspendedForVoice\(false\)/);
  assert.doesNotMatch(voiceDismissed, /setTimeout|setNameDraft|setQuantityDraft|setUnitPriceDraft/);
});
