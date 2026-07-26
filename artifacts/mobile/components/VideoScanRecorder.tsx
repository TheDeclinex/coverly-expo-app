import { Feather } from "@expo/vector-icons";
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { coverlyBrand } from "@/constants/brand";
import {
  createVideoRecordingSessionGate,
  type VideoRecordingStopReason,
} from "@/lib/video-recording-session";

export const VIDEO_SCAN_MAX_DURATION_SECONDS = 10;
const VIDEO_SCAN_MAX_DURATION_MS = VIDEO_SCAN_MAX_DURATION_SECONDS * 1000;

export interface VideoScanRecording {
  uri: string;
  durationMs: number;
}

interface VideoScanRecorderProps {
  visible: boolean;
  onCancel: () => void;
  onRecorded: (recording: VideoScanRecording) => void | Promise<void>;
  onError: (message: string) => void;
}

type RecorderPhase = "ready" | "recording" | "stopping";

export function VideoScanRecorder({
  visible,
  onCancel,
  onRecorded,
  onError,
}: VideoScanRecorderProps) {
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const cameraRef = React.useRef<CameraView | null>(null);
  const sessionGateRef = React.useRef(createVideoRecordingSessionGate());
  const activeSessionIdRef = React.useRef<number | null>(null);
  const recordingStartedAtRef = React.useRef<number | null>(null);
  const watchdogRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = React.useRef(true);
  const closingRef = React.useRef(false);
  const [cameraReady, setCameraReady] = React.useState(false);
  const [requestingPermission, setRequestingPermission] = React.useState(false);
  const [phase, setPhase] = React.useState<RecorderPhase>("ready");
  const [secondsRemaining, setSecondsRemaining] = React.useState(VIDEO_SCAN_MAX_DURATION_SECONDS);

  const clearRecordingTimers = React.useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const requestStop = React.useCallback((reason: VideoRecordingStopReason) => {
    const sessionId = activeSessionIdRef.current;
    if (sessionId === null || !sessionGateRef.current.requestStop(sessionId, reason)) return false;

    clearRecordingTimers();
    if (reason !== "cancel" && mountedRef.current) setPhase("stopping");
    cameraRef.current?.stopRecording();
    return true;
  }, [clearRecordingTimers]);

  const cancelActiveSession = React.useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (sessionId === null) return;
    requestStop("cancel");
    sessionGateRef.current.cancel(sessionId);
    activeSessionIdRef.current = null;
  }, [requestStop]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRecordingTimers();
      cancelActiveSession();
    };
  }, [cancelActiveSession, clearRecordingTimers]);

  React.useEffect(() => {
    if (visible) {
      closingRef.current = false;
      setCameraReady(false);
      setPhase("ready");
      setSecondsRemaining(VIDEO_SCAN_MAX_DURATION_SECONDS);
      return;
    }

    clearRecordingTimers();
    cancelActiveSession();
  }, [cancelActiveSession, clearRecordingTimers, visible]);

  const startRecording = React.useCallback(async () => {
    if (!cameraReady || phase !== "ready" || activeSessionIdRef.current !== null) return;

    const sessionId = sessionGateRef.current.begin();
    const startedAt = Date.now();
    activeSessionIdRef.current = sessionId;
    recordingStartedAtRef.current = startedAt;
    setPhase("recording");
    setSecondsRemaining(VIDEO_SCAN_MAX_DURATION_SECONDS);

    countdownRef.current = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      setSecondsRemaining(Math.max(0, Math.ceil((VIDEO_SCAN_MAX_DURATION_MS - elapsedMs) / 1000)));
    }, 200);
    watchdogRef.current = setTimeout(() => {
      requestStop("maximum-duration");
    }, VIDEO_SCAN_MAX_DURATION_MS);

    try {
      const result = await cameraRef.current?.recordAsync({
        maxDuration: VIDEO_SCAN_MAX_DURATION_SECONDS,
      });
      clearRecordingTimers();

      if (!sessionGateRef.current.complete(sessionId)) return;
      activeSessionIdRef.current = null;
      const durationMs = Math.min(
        VIDEO_SCAN_MAX_DURATION_MS,
        Math.max(1, Date.now() - startedAt),
      );

      if (!result?.uri) {
        if (mountedRef.current) {
          setPhase("ready");
          setSecondsRemaining(VIDEO_SCAN_MAX_DURATION_SECONDS);
          onError("Video scan could not finish recording. Please try again.");
        }
        return;
      }

      await onRecorded({ uri: result.uri, durationMs });
    } catch (recordingError) {
      clearRecordingTimers();
      const shouldReport = sessionGateRef.current.complete(sessionId);
      activeSessionIdRef.current = null;
      if (shouldReport && mountedRef.current) {
        if (__DEV__) console.warn("[video-scan] recording failed", recordingError);
        setPhase("ready");
        setSecondsRemaining(VIDEO_SCAN_MAX_DURATION_SECONDS);
        onError("Video scan could not finish recording. Please try again.");
      }
    }
  }, [cameraReady, clearRecordingTimers, onError, onRecorded, phase, requestStop]);

  const handleCancel = React.useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    clearRecordingTimers();
    cancelActiveSession();
    onCancel();
  }, [cancelActiveSession, clearRecordingTimers, onCancel]);

  const requestPermissions = React.useCallback(async () => {
    if (requestingPermission) return;
    setRequestingPermission(true);
    try {
      const camera = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission();
      if (!camera.granted) return;
      if (!microphonePermission?.granted) await requestMicrophonePermission();
    } finally {
      setRequestingPermission(false);
    }
  }, [
    cameraPermission,
    microphonePermission,
    requestCameraPermission,
    requestMicrophonePermission,
    requestingPermission,
  ]);

  const openSettings = () => {
    void Linking.openSettings().catch(() => {
      Alert.alert(
        "Could not open Settings",
        "Open your device settings and allow camera and microphone access for Coverly.",
      );
    });
  };

  const permissionsLoaded = cameraPermission !== null && microphonePermission !== null;
  const permissionsGranted = cameraPermission?.granted === true && microphonePermission?.granted === true;
  const permissionBlocked =
    cameraPermission?.canAskAgain === false || microphonePermission?.canAskAgain === false;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        {visible && permissionsGranted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="video"
            onCameraReady={() => setCameraReady(true)}
            onMountError={() => onError("Video camera could not start. Please try again.")}
          />
        ) : (
          <View style={styles.permissionPanel}>
            {!permissionsLoaded ? (
              <ActivityIndicator size="large" color={coverlyBrand.teal} />
            ) : (
              <>
                <View style={styles.permissionIcon}>
                  <Feather name="video" size={28} color={coverlyBrand.teal} />
                </View>
                <Text style={styles.permissionTitle}>Camera and microphone access needed</Text>
                <Text style={styles.permissionBody}>
                  Coverly uses both to record a short room walkthrough for Video Scan.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={requestingPermission}
                  onPress={permissionBlocked ? openSettings : () => void requestPermissions()}
                  style={({ pressed }) => [
                    styles.permissionButton,
                    { opacity: requestingPermission || pressed ? 0.7 : 1 },
                  ]}
                >
                  {requestingPermission ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.permissionButtonText}>
                      {permissionBlocked ? "Open Settings" : "Allow access"}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        )}

        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel video recording"
            onPress={handleCancel}
            hitSlop={10}
            style={styles.closeButton}
          >
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.headerTitle}>Video Scan</Text>
          <View style={styles.closeButton} />
        </View>

        {visible && permissionsGranted ? (
          <View style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.limitCard}>
              <Text style={styles.limitTitle}>
                {phase === "recording"
                  ? `Recording · ${secondsRemaining}s left`
                  : phase === "stopping"
                    ? "Preparing your video…"
                    : `Record up to ${VIDEO_SCAN_MAX_DURATION_SECONDS} seconds`}
              </Text>
              <Text style={styles.limitBody}>
                Move slowly around one room. Recording stops automatically at 10 seconds.
              </Text>
            </View>

            {phase === "recording" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop video recording"
                onPress={() => requestStop("manual")}
                style={({ pressed }) => [styles.recordButton, styles.stopButton, { opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={styles.stopSquare} />
                <Text style={styles.recordButtonText}>Stop</Text>
              </Pressable>
            ) : phase === "stopping" ? (
              <View style={[styles.recordButton, styles.stoppingButton]}>
                <ActivityIndicator color="#FFFFFF" />
                <Text style={styles.recordButtonText}>Finishing</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start video recording"
                disabled={!cameraReady}
                onPress={() => void startRecording()}
                style={({ pressed }) => [
                  styles.recordButton,
                  { opacity: !cameraReady || pressed ? 0.68 : 1 },
                ]}
              >
                {!cameraReady ? <ActivityIndicator color="#FFFFFF" /> : <View style={styles.recordDot} />}
                <Text style={styles.recordButtonText}>{cameraReady ? "Start recording" : "Starting camera"}</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#071B1D",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(7,27,29,0.64)",
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  permissionPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 32,
    backgroundColor: "#F8FEFF",
  },
  permissionIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: coverlyBrand.inputBackground,
  },
  permissionTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: coverlyBrand.slate,
    textAlign: "center",
  },
  permissionBody: {
    maxWidth: 320,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    color: coverlyBrand.mutedText,
    textAlign: "center",
  },
  permissionButton: {
    minWidth: 180,
    minHeight: 48,
    marginTop: 4,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: coverlyBrand.teal,
  },
  permissionButtonText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    gap: 18,
    paddingTop: 26,
    paddingHorizontal: 20,
    backgroundColor: "rgba(7,27,29,0.78)",
  },
  limitCard: {
    alignItems: "center",
    gap: 5,
  },
  limitTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
  },
  limitBody: {
    maxWidth: 340,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.76)",
    textAlign: "center",
  },
  recordButton: {
    minWidth: 176,
    height: 52,
    paddingHorizontal: 22,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#C73535",
  },
  stopButton: {
    backgroundColor: "#A82727",
  },
  stoppingButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  recordDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
  },
  stopSquare: {
    width: 14,
    height: 14,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
  recordButtonText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
});
