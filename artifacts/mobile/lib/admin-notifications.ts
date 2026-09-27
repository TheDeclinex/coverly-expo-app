import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

export type AdminNotificationActionResult = {
  message: string;
};

function projectId(): string {
  const value =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      "The EAS project ID is missing from the app configuration.",
    );
  }
  return value;
}

function supportedPlatform(): "ios" | "android" {
  if (Platform.OS === "ios" || Platform.OS === "android") return Platform.OS;
  throw new Error(
    "Admin push notifications can only be registered from iOS or Android.",
  );
}

async function invokeAdminNotificationAction(
  body: Record<string, unknown>,
): Promise<AdminNotificationActionResult> {
  const { data, error } =
    await supabase.functions.invoke<AdminNotificationActionResult>(
      "send-admin-notification",
      { body },
    );
  if (error) throw error;
  if (!data?.message)
    throw new Error(
      "The admin notification service returned an invalid response.",
    );
  return data;
}

export async function registerThisAdminDevice(): Promise<AdminNotificationActionResult> {
  if (!Device.isDevice) {
    throw new Error(
      "Use Jay's physical phone to register admin push notifications.",
    );
  }

  const platform = supportedPlatform();
  if (platform === "android") {
    await Notifications.setNotificationChannelAsync("admin-signups", {
      name: "Admin signups",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Notification permission was not granted on this device.");
  }

  const expoPushToken = (
    await Notifications.getExpoPushTokenAsync({ projectId: projectId() })
  ).data;

  return invokeAdminNotificationAction({
    action: "register_device",
    expoPushToken,
    platform,
  });
}

export function sendAdminNotificationTest(): Promise<AdminNotificationActionResult> {
  return invokeAdminNotificationAction({ action: "send_test" });
}
