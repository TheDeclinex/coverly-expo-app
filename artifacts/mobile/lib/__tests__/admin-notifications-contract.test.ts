import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appConfig = JSON.parse(
  readFileSync(resolve(testDirectory, "../../app.json"), "utf8"),
);
const packageJson = JSON.parse(
  readFileSync(resolve(testDirectory, "../../package.json"), "utf8"),
);
const mobileRegistration = readFileSync(
  resolve(testDirectory, "../admin-notifications.ts"),
  "utf8",
);
const adminScreen = readFileSync(
  resolve(testDirectory, "../../app/(tabs)/admin.tsx"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    testDirectory,
    "../../../../supabase/migrations/20260816215401_admin_signup_notifications.sql",
  ),
  "utf8",
);
const edgeFunction = readFileSync(
  resolve(
    testDirectory,
    "../../../../supabase/functions/send-admin-notification/index.ts",
  ),
  "utf8",
);

test("uses the SDK 54-compatible native notification packages and existing EAS project", () => {
  assert.equal(packageJson.dependencies["expo-notifications"], "~0.32.17");
  assert.equal(packageJson.dependencies["expo-device"], "~8.0.10");
  assert.ok(appConfig.expo.plugins.includes("expo-notifications"));
  assert.equal(
    appConfig.expo.extra.eas.projectId,
    "e5e80314-7ccd-4981-97c4-5be844c2967a",
  );
});

test("permission and token registration are reachable only from the guarded admin screen", () => {
  assert.match(adminScreen, /if \(!isAdmin\) return <Redirect/);
  assert.match(adminScreen, /Founder notifications/);
  assert.match(mobileRegistration, /if \(!Device\.isDevice\)/);
  assert.match(
    mobileRegistration,
    /Notifications\.requestPermissionsAsync\(\)/,
  );
  assert.match(
    mobileRegistration,
    /getExpoPushTokenAsync\(\{ projectId: projectId\(\) \}\)/,
  );
  assert.doesNotMatch(mobileRegistration, /SERVICE_ROLE|service.role/i);
});

test("auth trigger only queues data and cannot fail signup", () => {
  assert.match(migration, /AFTER INSERT ON auth\.users/);
  assert.match(migration, /INSERT INTO public\.admin_notifications/);
  assert.match(migration, /EXCEPTION WHEN OTHERS[\s\S]*RAISE WARNING/);
  assert.doesNotMatch(migration, /http_post|net\.http|fetch\s*\(/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.admin_notifications FROM PUBLIC, anon, authenticated/,
  );
});

test("Edge Function separates webhook and admin authentication", () => {
  assert.match(edgeFunction, /x-coverly-webhook-secret/);
  assert.match(edgeFunction, /requireAdmin\(request, client\)/);
  assert.match(edgeFunction, /profile\?\.app_role !== "admin"/);
  assert.match(edgeFunction, /payload\.record\.id/);
  assert.match(edgeFunction, /\.in\("status", \["pending", "failed"\]\)/);
  assert.doesNotMatch(
    edgeFunction,
    /console\.(?:log|error)\([^\n]*(?:expoPushToken|claimed\.email)/,
  );
});
