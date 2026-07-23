export function selectInstalledAppBuild(input: {
  nativeAppVersion?: string | null;
  nativeBuildVersion?: string | null;
  configuredAppVersion?: string | null;
  configuredBuildNumber?: string | number | null;
}) {
  const appVersion = input.nativeAppVersion?.trim()
    || input.configuredAppVersion?.trim()
    || null;
  const buildNumber = input.nativeBuildVersion?.trim()
    || (input.configuredBuildNumber == null ? null : String(input.configuredBuildNumber))
    || null;
  return {
    appVersion,
    buildNumber,
    displayVersion: appVersion
      ? `${appVersion}${buildNumber ? ` (${buildNumber})` : ""}`
      : buildNumber
        ? `Build ${buildNumber}`
        : null,
  };
}
