import {
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

export function useVoiceRecording(maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [recording, setRecording] = useState<VoiceRecordingInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<VoiceRecordingInput | null>(null);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => () => {
    void removeLocalRecording(recordingRef.current?.uri ?? null);
  }, []);

  const requestPermission = useCallback(async () => {
    const result = await requestRecordingPermissionsAsync();
    const granted = result.granted === true;
    setPermission(granted ? "granted" : "denied");
    return granted;
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    await removeLocalRecording(recordingRef.current?.uri ?? null);
    setRecording(null);
    let granted = permission === "granted";
    if (!granted) granted = await requestPermission();
    if (!granted) {
      setError("Microphone permission is required to record voice input.");
      return false;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      return true;
    } catch (recordingError) {
      setError(recordingError instanceof Error ? recordingError.message : "Could not start recording.");
      return false;
    }
  }, [permission, recorder, requestPermission]);

  const stopRecording = useCallback(async (): Promise<VoiceRecordingInput | null> => {
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("The recording did not produce an audio file.");
      const asset = { uri, ...recordingMetadata(uri) };
      setRecording(asset);
      return asset;
    } catch (recordingError) {
      setError(recordingError instanceof Error ? recordingError.message : "Could not stop recording.");
      return null;
    }
  }, [recorder]);

  const reset = useCallback(async () => {
    if (recorderState.isRecording) {
      try { await recorder.stop(); } catch { /* already stopped */ }
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    await removeLocalRecording(recordingRef.current?.uri ?? null);
    setRecording(null);
    setError(null);
  }, [recorder, recorderState.isRecording]);

  const durationSeconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  return {
    permission,
    requestPermission,
    isRecording: recorderState.isRecording,
    durationSeconds,
    maxDurationSeconds,
    maxDurationReached: recorderState.isRecording && durationSeconds >= maxDurationSeconds,
    recording,
    error,
    startRecording,
    stopRecording,
    reset,
  };
}
