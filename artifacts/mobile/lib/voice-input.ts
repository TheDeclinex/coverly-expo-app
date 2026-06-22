import { File } from "expo-file-system";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";
import type {
  VoiceCallResult,
  VoiceDescribeRequest,
  VoiceDescribeResponse,
} from "@/types/voice";

export interface VoiceRecordingInput {
  uri: string;
  mimeType: string;
  extension: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read audio recording."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Audio recording did not produce base64 data."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function recordingToBase64(recording: VoiceRecordingInput): Promise<string> {
  if (Platform.OS === "web") {
    const response = await fetch(recording.uri);
    if (!response.ok) throw new Error(`Could not read audio recording (${response.status}).`);
    return blobToBase64(await response.blob());
  }
  return new File(recording.uri).base64();
}

export async function callVoiceDescribe(
  recording: VoiceRecordingInput,
  context: Omit<VoiceDescribeRequest, "audioBase64" | "mimeType" | "ext"> = {},
): Promise<VoiceCallResult> {
  const startedAt = Date.now();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return {
      response: null,
      httpStatus: 401,
      networkError: "Authentication required.",
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const audioBase64 = await recordingToBase64(recording);
    const body: VoiceDescribeRequest = {
      ...context,
      audioBase64,
      mimeType: recording.mimeType,
      ext: recording.extension,
    };
    const { data, error } = await supabase.functions.invoke<VoiceDescribeResponse>("voice-describe", { body });
    if (error) {
      const contextResponse = (error as { context?: Response }).context;
      return {
        response: null,
        httpStatus: contextResponse?.status ?? null,
        networkError: error.message,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      response: data ?? null,
      httpStatus: 200,
      networkError: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      response: null,
      httpStatus: null,
      networkError: error instanceof Error ? error.message : "Voice request failed.",
      durationMs: Date.now() - startedAt,
    };
  }
}
