import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { coverlyBrand } from "@/constants/brand";
import type { ScanMode } from "@/types/scan";

export type PhotoScanMode = Extract<
  ScanMode,
  "single_photo_room" | "multi_photo_room" | "single_item"
>;

export interface PhotoScanCapture {
  uri: string;
  width: number;
  height: number;
}

interface PhotoScanCameraProps {
  visible: boolean;
  mode: PhotoScanMode | null;
  onCancel: () => void;
  onCaptured: (photo: PhotoScanCapture) => void | Promise<void>;
  onError: (message: string) => void;
}

const MODE_COPY: Record<PhotoScanMode, { title: string; instruction: string }> = {
  single_photo_room: {
    title: "Single Photo Scan",
    instruction: "Frame the room clearly and include as many visible items as you can.",
  },
  multi_photo_room: {
    title: "Multi Photo Scan",
    instruction: "Capture one clear room angle. You can choose whether to take more next.",
  },
  single_item: {
    title: "Single Item Scan",
    instruction: "Fill the frame with one item and keep its useful details in focus.",
  },
};

export function PhotoScanCamera({
  visible,
  mode,
  onCancel,
  onCaptured,
  onError,
}: PhotoScanCameraProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const cameraRef = React.useRef<CameraView | null>(null);
  const mountedRef = React.useRef(true);
  const visibleRef = React.useRef(visible);
  const captureSessionRef = React.useRef(0);
  const captureLockedRef = React.useRef(false);
  const closeRequestedRef = React.useRef(false);
  const appStateRef = React.useRef<AppStateStatus>(AppState.currentState);
  const [appActive, setAppActive] = React.useState(AppState.currentState === "active");
  const [cameraReady, setCameraReady] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const [requestingPermission, setRequestingPermission] = React.useState(false);

  const invalidateCapture = React.useCallback(() => {
    captureSessionRef.current += 1;
    captureLockedRef.current = true;
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateCapture();
    };
  }, [invalidateCapture]);

  React.useEffect(() => {
    visibleRef.current = visible;
    captureSessionRef.current += 1;
    captureLockedRef.current = false;
    closeRequestedRef.current = false;
    setCameraReady(false);
    setCapturing(false);
  }, [mode, visible]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const isActive = nextState === "active";
      setAppActive(isActive);

      if (!isActive && visibleRef.current) {
        invalidateCapture();
        setCameraReady(false);
        setCapturing(false);
      } else if (isActive && previousState !== "active" && visibleRef.current) {
        captureLockedRef.current = false;
        void getPermission();
      }
    });
    return () => subscription.remove();
  }, [getPermission, invalidateCapture]);

  const close = React.useCallback(() => {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    invalidateCapture();
    onCancel();
  }, [invalidateCapture, onCancel]);

  const capture = React.useCallback(async () => {
    if (
      !visible ||
      !mode ||
      !cameraReady ||
      capturing ||
      captureLockedRef.current ||
      !cameraRef.current
    ) return;

    captureLockedRef.current = true;
    const sessionId = captureSessionRef.current;
    setCapturing(true);

    try {
      const result = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
      });
      if (
        !mountedRef.current ||
        !visibleRef.current ||
        captureSessionRef.current !== sessionId ||
        !result?.uri
      ) return;

      await onCaptured({
        uri: result.uri,
        width: result.width,
        height: result.height,
      });
    } catch (captureError) {
      if (
        !mountedRef.current ||
        !visibleRef.current ||
        captureSessionRef.current !== sessionId
      ) return;
      if (__DEV__) console.warn("[photo-scan] capture failed", captureError);
      captureLockedRef.current = false;
      setCapturing(false);
      onError("Photo capture failed. Please try again.");
    }
  }, [cameraReady, capturing, mode, onCaptured, onError, visible]);

  const requestCameraPermission = React.useCallback(async () => {
    if (requestingPermission) return;
    setRequestingPermission(true);
    try {
      await requestPermission();
    } finally {
      setRequestingPermission(false);
    }
  }, [requestPermission, requestingPermission]);

  const openSettings = () => {
    void Linking.openSettings().catch(() => {
      Alert.alert(
        "Could not open Settings",
        "Open your device settings and allow camera access for Coverly.",
      );
    });
  };

  const copy = mode ? MODE_COPY[mode] : null;
  const permissionGranted = permission?.granted === true;
  const permissionBlocked = permission?.canAskAgain === false;
  const cameraVisible = visible && appActive && permissionGranted && mode !== null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <View style={styles.root}>
        {cameraVisible ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="picture"
            onCameraReady={() => {
              captureLockedRef.current = false;
              setCameraReady(true);
            }}
            onMountError={() => onError("Photo camera could not start. Please try again.")}
          />
        ) : (
          <View style={styles.permissionPanel}>
            {permission === null ? (
              <ActivityIndicator size="large" color={coverlyBrand.teal} />
            ) : !appActive ? (
              <>
                <ActivityIndicator size="large" color={coverlyBrand.teal} />
                <Text style={styles.permissionTitle}>Camera paused</Text>
                <Text style={styles.permissionBody}>Return to Coverly to continue taking a photo.</Text>
              </>
            ) : (
              <>
                <View style={styles.permissionIcon}>
                  <Feather name="camera" size={28} color={coverlyBrand.teal} />
                </View>
                <Text style={styles.permissionTitle}>Camera access needed</Text>
                <Text style={styles.permissionBody}>
                  Allow camera access to capture a photo for this scan.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={requestingPermission}
                  onPress={permissionBlocked ? openSettings : () => void requestCameraPermission()}
                  style={({ pressed }) => [
                    styles.permissionButton,
                    { opacity: requestingPermission || pressed ? 0.7 : 1 },
                  ]}
                >
                  {requestingPermission ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.permissionButtonText}>
                      {permissionBlocked ? "Open Settings" : "Allow camera"}
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
            accessibilityLabel="Cancel photo capture"
            onPress={close}
            hitSlop={10}
            style={styles.closeButton}
          >
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.headerTitle}>{copy?.title ?? "Photo Scan"}</Text>
          <View style={styles.closeButton} />
        </View>

        {cameraVisible ? (
          <View style={[styles.controls, { paddingBottom: insets.bottom + 10 }]}>
            <View style={styles.instructionCard}>
              <Text style={styles.instructionTitle}>Take a clear photo</Text>
              <Text style={styles.instructionBody}>{copy?.instruction}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              accessibilityState={{ busy: capturing, disabled: !cameraReady || capturing }}
              disabled={!cameraReady || capturing}
              onPress={() => void capture()}
              style={({ pressed }) => [
                styles.shutterOuter,
                { opacity: !cameraReady || capturing ? 0.62 : pressed ? 0.78 : 1 },
              ]}
            >
              {capturing ? (
                <ActivityIndicator color={coverlyBrand.teal} />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </Pressable>
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
    gap: 12,
    paddingTop: 10,
    paddingHorizontal: 20,
    backgroundColor: "rgba(7,27,29,0.78)",
  },
  instructionCard: {
    alignItems: "center",
    gap: 4,
  },
  instructionTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
  },
  instructionBody: {
    maxWidth: 350,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.76)",
    textAlign: "center",
  },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    borderWidth: 3,
    borderColor: coverlyBrand.teal,
  },
});
