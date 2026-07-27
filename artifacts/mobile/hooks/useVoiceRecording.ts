import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform } from "react-native";

import type { VoiceRecordingInput } from "@/lib/voice-input";

const DEFAULT_MAX_DURATION_SECONDS = 45;
const VOICE_EDIT_FALLBACK_MESSAGE = "Voice edit could not start. Please try again or type your changes manually.";
type VoicePermission = "unknown" | "granted" | "denied" | "blocked";
type VoiceEntryPoint = "edit_item_full_voice" | "inline_voice_field" | "replacement_price_voice_search" | "unknown_voice";
export type VoiceResetReason =
  | "user_cancel"
  | "recording_complete"
  | "sheet_closed"
  | "component_unmount"
  | "stale_request_cleanup";
type VoiceDiagnosticStage =
  | "voice_permission_button_pressed"
  | "permission_check_start"
  | "permission_request_start"
  | "permission_granted"
  | "permission_denied"
  | "audio_mode_start"
  | "audio_mode_success"
  | "recording_prepare"
  | "recording_start"
  | "recording_success"
  | "recording_stop"
  | "recording_stopped"
  | "recording_failed";

function recordingMetadata(uri: string): Pick<VoiceRecordingInput, "mimeType" | "extension"> {
  const extension = uri.split("?")[0].match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  if (extension === "webm") return { mimeType: "audio/webm", extension };
  if (extension === "wav") return { mimeType: "audio/wav", extension };
  if (extension === "caf") return { mimeType: "audio/x-caf", extension };
  return { mimeType: "audio/mp4", extension: extension || "m4a" };
}

async function removeLocalRecording(uri: string | null) {
  if (!uri) return;
  try {
    if (Platform.OS === "web" && uri.startsWith("blob:")) {
      URL.revokeObjectURL(uri);
      return;
    }
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best-effort privacy cleanup. The OS may already have removed the temp file.
  }
}

export function useVoiceRecording(maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS, entryPoint: VoiceEntryPoint = "unknown_voice") {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [permission, setPermission] = useState<VoicePermission>("unknown");
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [recording, setRecording] = useState<VoiceRecordingInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const recordingRef = useRef<VoiceRecordingInput | null>(null);
  const mountedRef = useRef(true);
  const recorderRef = useRef(recorder);
  const permissionRef = useRef<VoicePermission>(permission);
  const entryPointRef = useRef(entryPoint);
  const requestingPermissionRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const stoppingRecordingRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const lifecycleSequenceRef = useRef(0);
  const audioOperationRef = useRef<Promise<void>>(Promise.resolve());

  recorderRef.current = recorder;
  permissionRef.current = permission;
  entryPointRef.current = entryPoint;

  const logDiagnostic = useCallback((stage: VoiceDiagnosticStage) => {
    if (!__DEV__) return;
    console.info("[voice]", { stage, platform: Platform.OS, entryPoint: entryPointRef.current });
  }, []);

  const enqueueAudioOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = audioOperationRef.current.then(operation, operation);
    audioOperationRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lifecycleSequenceRef.current += 1;
      recordingActiveRef.current = false;
      const recordingUri = recordingRef.current?.uri ?? null;
      recordingRef.current = null;
      if (__DEV__) {
        console.info("[voice]", {
          stage: "lifecycle_reset",
          reason: "component_unmount" satisfies VoiceResetReason,
          platform: Platform.OS,
          entryPoint: entryPointRef.current,
        });
      }
      void enqueueAudioOperation(async () => {
        const activeRecorder = recorderRef.current;
        if (activeRecorder.isRecording) {
          await activeRecorder.stop().catch(() => undefined);
        }
        await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
        await removeLocalRecording(recordingUri);
      });
    };
  }, [enqueueAudioOperation]);

  const setPermissionIfMounted = useCallback((nextPermission: VoicePermission) => {
    if (mountedRef.current) setPermission(nextPermission);
  }, []);

  const setErrorIfMounted = useCallback((nextError: string | null) => {
    if (mountedRef.current) setError(nextError);
  }, []);

  const checkPermission = useCallback(async () => {
    logDiagnostic("permission_check_start");
    try {
      const result = await getRecordingPermissionsAsync();
      const granted = result.granted === true;
      if (mountedRef.current) setCanAskAgain(result.canAskAgain !== false);
      setPermissionIfMounted(granted ? "granted" : result.canAskAgain === false ? "blocked" : "unknown");
      logDiagnostic(granted ? "permission_granted" : "permission_denied");
      return granted;
    } catch {
      if (__DEV__) console.info("[voice]", { stage: "permission_check_failed", platform: Platform.OS, entryPoint: entryPointRef.current });
      return permissionRef.current === "granted";
    }
  }, [logDiagnostic, setPermissionIfMounted]);

  const requestPermission = useCallback(async () => {
    if (requestingPermissionRef.current) return permissionRef.current === "granted";
    if (permissionRef.current === "blocked") {
      setErrorIfMounted("Microphone access is turned off for Coverly. Open Settings to allow access.");
      return false;
    }
    requestingPermissionRef.current = true;
    if (mountedRef.current) {
      setIsRequestingPermission(true);
      setError(null);
    }

    logDiagnostic("permission_request_start");
    try {
      const result = await requestRecordingPermissionsAsync();
      const granted = result.granted === true;
      if (mountedRef.current) setCanAskAgain(result.canAskAgain !== false);
      setPermissionIfMounted(granted ? "granted" : result.canAskAgain === false ? "blocked" : "denied");
      logDiagnostic(granted ? "permission_granted" : "permission_denied");
      return granted;
    } catch (permissionError) {
      setPermissionIfMounted("denied");
      setErrorIfMounted(VOICE_EDIT_FALLBACK_MESSAGE);
      if (__DEV__) console.warn("[voice]", { stage: "permission_request_failed", platform: Platform.OS, entryPoint: entryPointRef.current, error: String(permissionError) });
      logDiagnostic("permission_denied");
      return false;
    } finally {
      requestingPermissionRef.current = false;
      if (mountedRef.current) setIsRequestingPermission(false);
    }
  }, [logDiagnostic, setErrorIfMounted, setPermissionIfMounted]);

  const startRecording = useCallback(async () => {
    if (recordingActiveRef.current || recorderRef.current.isRecording) return true;
    if (startingRecordingRef.current) return false;

    setErrorIfMounted(null);
    const granted = permissionRef.current === "granted" || await checkPermission();
    if (!granted) {
      setErrorIfMounted(VOICE_EDIT_FALLBACK_MESSAGE);
      return false;
    }

    const requestSequence = lifecycleSequenceRef.current;
    startingRecordingRef.current = true;
    if (mountedRef.current) setIsStartingRecording(true);
    try {
      return await enqueueAudioOperation(async () => {
        if (!mountedRef.current || requestSequence !== lifecycleSequenceRef.current) {
          if (__DEV__) console.info("[voice]", { stage: "stale_request_cancelled", platform: Platform.OS, entryPoint: entryPointRef.current });
          return false;
        }
        const previousRecordingUri = recordingRef.current?.uri ?? null;
        recordingRef.current = null;
        await removeLocalRecording(previousRecordingUri);
        if (mountedRef.current) setRecording(null);

        const activeRecorder = recorderRef.current;
        if (activeRecorder.isRecording) {
          await activeRecorder.stop().catch(() => undefined);
        }
        logDiagnostic("audio_mode_start");
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        logDiagnostic("audio_mode_success");
        if (!mountedRef.current || requestSequence !== lifecycleSequenceRef.current) {
          await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
          if (__DEV__) console.info("[voice]", { stage: "stale_request_cancelled", platform: Platform.OS, entryPoint: entryPointRef.current });
          return false;
        }
        logDiagnostic("recording_prepare");
        await activeRecorder.prepareToRecordAsync();
        if (!mountedRef.current || requestSequence !== lifecycleSequenceRef.current) {
          await activeRecorder.stop().catch(() => undefined);
          await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
          if (__DEV__) console.info("[voice]", { stage: "stale_request_cancelled", platform: Platform.OS, entryPoint: entryPointRef.current });
          return false;
        }
        logDiagnostic("recording_start");
        activeRecorder.record();
        recordingActiveRef.current = true;
        logDiagnostic("recording_success");
        return true;
      });
    } catch (recordingError) {
      recordingActiveRef.current = false;
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      setErrorIfMounted(VOICE_EDIT_FALLBACK_MESSAGE);
      if (__DEV__) console.warn("[voice]", { stage: "recording_failed", platform: Platform.OS, entryPoint: entryPointRef.current, error: String(recordingError) });
      logDiagnostic("recording_failed");
      return false;
    } finally {
      startingRecordingRef.current = false;
      if (mountedRef.current) setIsStartingRecording(false);
    }
  }, [checkPermission, enqueueAudioOperation, logDiagnostic, setErrorIfMounted]);

  const stopRecording = useCallback(async (): Promise<VoiceRecordingInput | null> => {
    if (stoppingRecordingRef.current) return null;
    stoppingRecordingRef.current = true;
    const requestSequence = lifecycleSequenceRef.current;
    try {
      recordingActiveRef.current = false;
      logDiagnostic("recording_stop");
      return await enqueueAudioOperation(async () => {
        const activeRecorder = recorderRef.current;
        await activeRecorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
        const uri = activeRecorder.uri;
        if (!uri) throw new Error("The recording did not produce an audio file.");
        if (!mountedRef.current || requestSequence !== lifecycleSequenceRef.current) {
          await removeLocalRecording(uri);
          if (__DEV__) console.info("[voice]", { stage: "stale_request_cancelled", platform: Platform.OS, entryPoint: entryPointRef.current });
          return null;
        }
        const asset = { uri, ...recordingMetadata(uri) };
        recordingRef.current = asset;
        setRecording(asset);
        logDiagnostic("recording_stopped");
        return asset;
      });
    } catch (recordingError) {
      recordingActiveRef.current = false;
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      setErrorIfMounted(VOICE_EDIT_FALLBACK_MESSAGE);
      if (__DEV__) console.warn("[voice]", { stage: "recording_stop_failed", platform: Platform.OS, entryPoint: entryPointRef.current, error: String(recordingError) });
      return null;
    } finally {
      stoppingRecordingRef.current = false;
    }
  }, [enqueueAudioOperation, logDiagnostic, setErrorIfMounted]);

  const reset = useCallback(async (reason: VoiceResetReason = "user_cancel") => {
    lifecycleSequenceRef.current += 1;
    recordingActiveRef.current = false;
    const recordingUri = recordingRef.current?.uri ?? null;
    recordingRef.current = null;
    if (__DEV__) {
      console.info("[voice]", {
        stage: "lifecycle_reset",
        reason,
        platform: Platform.OS,
        entryPoint: entryPointRef.current,
      });
    }
    if (mountedRef.current) {
      setRecording(null);
      setError(null);
      setIsStartingRecording(false);
    }
    await enqueueAudioOperation(async () => {
      const activeRecorder = recorderRef.current;
      if (activeRecorder.isRecording) {
        await activeRecorder.stop().catch(() => undefined);
      }
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      await removeLocalRecording(recordingUri);
    });
  }, [enqueueAudioOperation]);

  const durationSeconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);
  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch (settingsError) {
      setErrorIfMounted("Open your device settings and allow microphone access for Coverly.");
      if (__DEV__) console.warn("[voice]", { stage: "open_settings_failed", platform: Platform.OS, entryPoint: entryPointRef.current, error: String(settingsError) });
    }
  }, [setErrorIfMounted]);

  return {
    permission,
    canAskAgain,
    checkPermission,
    requestPermission,
    isRequestingPermission,
    isStartingRecording,
    isRecording: recorderState.isRecording,
    durationSeconds,
    maxDurationSeconds,
    maxDurationReached: recorderState.isRecording && durationSeconds >= maxDurationSeconds,
    recording,
    error,
    startRecording,
    stopRecording,
    reset,
    openSettings,
    logDiagnostic,
  };
}
