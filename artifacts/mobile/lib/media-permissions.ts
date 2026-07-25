import * as ImagePicker from "expo-image-picker";
import { Alert, Linking, Platform } from "react-native";

export type ImagePermissionSource = "camera" | "photo-library";

export async function requestImagePermission(
  source: ImagePermissionSource,
  purpose: string,
): Promise<boolean> {
  if (Platform.OS === "web") return true;

  const permission = source === "camera"
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (permission.granted) return true;

  const sourceLabel = source === "camera" ? "Camera" : "Photo library";
  const message = permission.canAskAgain === false
    ? `${sourceLabel} access is turned off for Coverly. Open Settings to allow access, then return and try again.`
    : `${sourceLabel} access is needed to ${purpose}.`;

  Alert.alert(
    `${sourceLabel} permission needed`,
    message,
    permission.canAskAgain === false
      ? [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => void Linking.openSettings().catch(() => {
              Alert.alert("Could not open Settings", "Open your device settings and allow access for Coverly.");
            }),
          },
        ]
      : [{ text: "OK" }],
  );
  return false;
}
