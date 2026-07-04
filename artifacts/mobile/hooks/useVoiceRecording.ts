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
import { Platform } from "react-native";

import type { VoiceRecordingInput } from "@/lib/voice-input";

const DEFAULT_MAX_DURATION_SECONDS = 45;
type VoicePermission = "unknown" | "granted" | "denied";
type VoiceEntryPoint = "edit_item_full_voice" | "inline_voice_field" | "replacement_price_voice_search" | "unknown_voice";
type VoiceDiagnosticStage =
  | "voice_permission_button_pressed"
  | "permission_request_start"
  | "permission_granted"
  | "permission_denied"
  | "audio_mode_start"
  | "audio_mode_success"
  | "recording_start"
  | "recording_success"
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
  const [recording, setRecording] = useState<VoiceRecordingInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const recordingRef = useRef<VoiceRecordingInput | null>(null);
  const mountedRef = useRef(true);
  const requestingPermissionRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const stoppingRecordingRef = useRef(false);
  const recordingActiveRef = useRef(false);

  const logDiagnostic = useCallback((stage: VoiceDiagnosticStage) => {
    console.info("[voice]", { stage, platform: Platform.OS, entryPoint });
  }, [entryPoint]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      recordingActiveRef.current = false;
      void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      void removeLocalRecording(recordingRef.current?.uri ?? null);
    };
  }, [recorder]);

  const setPermissionIfMounted = useCallback((nextPermission: VoicePermission) => {
    if (mountedRef.current) setPermission(nextPermission);
  }, []);

  const setErrorIfMounted = useCallback((nextError: string | null) => {
    if (mountedRef.current) setError(nextError);
  }, []);

  const checkPermission = useCallback(async () => {
    try {
      const result = await getRecordingPermissionsAsync();
      const granted = result.granted === true;
      setPermissionIfMounted(granted ? "granted" : result.canAskAgain === false ? "denied" : "unknown");
      return granted;
    } catch {
      return permission === "granted";
    }
  }, [permission, setPermissionIfMounted]);

  const requestPermission = useCallback(async () => {
    if (requestingPermissionRef.current) return permission === "granted";
    requestingPermissionRef.current = true;
    if (mountedRef.current) {
      setIsRequestingPermission(true);
      setError(null);
    }

    logDiagnostic("permission_request_start");
    try {
      const result = await requestRecordingPermissionsAsync();
      const granted = result.granted === true;
      setPermissionIfMounted(granted ? "granted" : "denied");
      logDiagnostic(granted ? "permission_granted" : "permission_denied");
      return granted;
    } catch {
      setPermissionIfMounted("denied");
      setErrorIfMounted("Microphone permission could not be requested. Please try again from device settings.");
      logDiagnostic("permission_denied");
      return false;
    } finally {
      requestingPermissionRef.current = false;
      if (mountedRef.current) setIsRequestingPermission(false);
    }
  }, [logDiagnostic, permission, setErrorIfMounted, setPermissionIfMounted]);

  const startRecording = useCallback(async () => {
    if (recordingActiveRef.current || recorderState.isRecording) return true;
    if (startingRecordingRef.current) return false;

    setErrorIfMounted(null);
    const granted = permission === "granted" || await checkPermission();
    if (!granted) {
      setErrorIfMounted("Microphone permission is required before recording voice input.");
      return false;
    }

    startingRecordingRef.current = true;
    if (mountedRef.current) setIsStartingRecording(true);
    try {
      await removeLocalRecording(recordingRef.current?.uri ?? null);
      if (mountedRef.current) setRecording(null);
      if (recorderState.isRecording) {
        try { await recorder.stop(); } catch { /* already stopped */ }
      }
      logDiagnostic("audio_mode_start");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      logDiagnostic("audio_mode_success");
      logDiagnostic("recording_start");
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingActiveRef.current = true;
      logDiagnostic("recording_success");
      return true;
    } catch (recordingError) {
      recordingActiveRef.current = false;
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      setErrorIfMounted(recordingError instanceof Error ? recordingError.message : "Could not start recording.");
      logDiagnostic("recording_failed");
      return false;
    } finally {
      startingRecordingRef.current = false;
      if (mountedRef.current) setIsStartingRecording(false);
    }
  }, [checkPermission, logDiagnostic, permission, recorder, recorderState.isRecording, setErrorIfMounted]);

  const stopRecording = useCallback(async (): Promise<VoiceRecordingInput | null> => {
    if (stoppingRecordingRef.current) return null;
    stoppingRecordingRef.current = true;
    try {
      await recorder.stop();
      recordingActiveRef.current = false;
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("The recording did not produce an audio file.");
      const asset = { uri, ...recordingMetadata(uri) };
      if (mountedRef.current) setRecording(asset);
      return asset;
    } catch (recordingError) {
      recordingActiveRef.current = false;
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      setErrorIfMounted(recordingError instanceof Error ? recordingError.message : "Could not stop recording.");
      return null;
    } finally {
      stoppingRecordingRef.current = false;
    }
  }, [recorder, setErrorIfMounted]);

  const reset = useCallback(async () => {
    if (recordingActiveRef.current || recorderState.isRecording) {
      try { await recorder.stop(); } catch { /* already stopped */ }
    }
    recordingActiveRef.current = false;
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    await removeLocalRecording(recordingRef.current?.uri ?? null);
    if (mountedRef.current) {
      setRecording(null);
      setError(null);
    }
  }, [recorder, recorderState.isRecording]);

  const durationSeconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  return {
    permission,
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
    logDiagnostic,
  };
}
