import Constants from "expo-constants";
import { Platform } from "react-native";

import { selectInstalledAppBuild } from "@/lib/app-build-model";

export interface InstalledAppContext {
  appVersion: string | null;
  buildNumber: string | null;
  displayVersion: string | null;
  platform: string;
  osVersion: string;
  deviceModel: string | null;
}

export { selectInstalledAppBuild } from "@/lib/app-build-model";

function configuredBuildNumber(): string | number | null {
  if (Platform.OS === "ios") {
    return Constants.platform?.ios?.buildNumber
      ?? Constants.expoConfig?.ios?.buildNumber
      ?? null;
  }
  if (Platform.OS === "android") {
    return Constants.platform?.android?.versionCode
      ?? Constants.expoConfig?.android?.versionCode
      ?? null;
  }
  return null;
}

function nativeDeviceModel(): string | null {
  const constants = Platform.constants as Record<string, unknown>;
  const expoDeviceName = (Constants as unknown as { deviceName?: string | null }).deviceName;
  const candidate = expoDeviceName ?? (Platform.OS === "android" ? constants.Model : null);
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

export function getInstalledAppContext(): InstalledAppContext {
  const build = selectInstalledAppBuild({
    nativeAppVersion: Constants.nativeAppVersion,
    nativeBuildVersion: Constants.nativeBuildVersion,
    configuredAppVersion: Constants.expoConfig?.version,
    configuredBuildNumber: configuredBuildNumber(),
  });
  return {
    ...build,
    platform: Platform.OS,
    osVersion: `${Platform.OS} ${Platform.Version}`,
    deviceModel: nativeDeviceModel(),
  };
}
