import assert from "node:assert/strict";
import test from "node:test";

import { selectInstalledAppBuild } from "../app-build-model.ts";

test("installed native version and build win over configuration values", () => {
  assert.deepEqual(selectInstalledAppBuild({
    nativeAppVersion: "1.0.0",
    nativeBuildVersion: "12",
    configuredAppVersion: "9.9.9",
    configuredBuildNumber: 999,
  }), {
    appVersion: "1.0.0",
    buildNumber: "12",
    displayVersion: "1.0.0 (12)",
  });
});

test("configuration is a safe fallback outside an installed native build", () => {
  assert.deepEqual(selectInstalledAppBuild({
    configuredAppVersion: "1.0.0",
    configuredBuildNumber: 7,
  }), {
    appVersion: "1.0.0",
    buildNumber: "7",
    displayVersion: "1.0.0 (7)",
  });
});
