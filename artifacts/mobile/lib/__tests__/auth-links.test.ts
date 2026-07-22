import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  authLinkFingerprint,
  normalizeAuthEmail,
  parseAuthLink,
  passwordValidationError,
} from "../auth-link-model.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const readFromTestDirectory = (relativePath: string) => readFileSync(resolve(testDirectory, relativePath), "utf8");

test("parses Supabase PKCE recovery query parameters", () => {
  const parsed = parseAuthLink("https://coverly.nz/reset-password?code=secret-code&type=recovery");
  assert.equal(parsed.code, "secret-code");
  assert.equal(parsed.type, "recovery");
  assert.equal(parsed.hasCredentials, true);
});

test("parses implicit recovery credentials from the URL fragment", () => {
  const parsed = parseAuthLink(
    "https://coverly.nz/reset-password#access_token=access-secret&refresh_token=refresh-secret&type=recovery",
  );
  assert.equal(parsed.accessToken, "access-secret");
  assert.equal(parsed.refreshToken, "refresh-secret");
  assert.equal(parsed.type, "recovery");
  assert.equal(parsed.hasCredentials, true);
});

test("recognises malformed links without exposing credentials in fingerprints", () => {
  const url = "https://coverly.nz/reset-password?error_description=Email+link+is+invalid";
  const parsed = parseAuthLink(url);
  assert.equal(parsed.errorDescription, "Email link is invalid");
  assert.equal(parsed.hasCredentials, false);
  assert.doesNotMatch(authLinkFingerprint(url), /invalid|email|token/i);
});

test("applies Coverly's existing eight-character password policy", () => {
  assert.equal(passwordValidationError("short", "short"), "Password must be at least 8 characters.");
  assert.equal(passwordValidationError("long-enough", "different"), "Passwords do not match.");
  assert.equal(passwordValidationError("long-enough", "long-enough"), null);
});

test("normalises auth email input before requests", () => {
  assert.equal(normalizeAuthEmail("  Jay@Example.COM  "), "jay@example.com");
});

test("Expo configuration claims only the required HTTPS auth/open routes", () => {
  const config = JSON.parse(readFromTestDirectory("../../app.json"));
  assert.equal(config.expo.scheme, "coverly");
  assert.deepEqual(config.expo.ios.associatedDomains, ["applinks:www.coverly.nz"]);
  const targets = config.expo.android.intentFilters[0].data.map(
    (entry: { host: string; pathPrefix: string }) => `${entry.host}${entry.pathPrefix}`,
  );
  const paths = config.expo.android.intentFilters[0].data.map((entry: { pathPrefix: string }) => entry.pathPrefix);
  assert.deepEqual([...new Set(paths)].sort(), ["/auth/verified", "/open", "/reset-password"]);
  assert.deepEqual(
    targets.sort(),
    [
      "www.coverly.nz/auth/verified",
      "www.coverly.nz/open",
      "www.coverly.nz/reset-password",
    ],
  );
  assert.equal(config.expo.android.intentFilters[0].autoVerify, true);
});

test("sign-up and forgot-password requests use explicit HTTPS redirects", () => {
  const authLinksSource = readFromTestDirectory("../auth-links.ts");
  const loginSource = readFromTestDirectory("../../app/login.tsx");
  assert.match(authLinksSource, /COVERLY_WEB_ORIGIN = "https:\/\/www\.coverly\.nz"/);
  assert.match(loginSource, /emailRedirectTo: EMAIL_VERIFIED_URL/);
  assert.match(loginSource, /redirectTo: PASSWORD_RESET_URL/);
  assert.match(loginSource, /normalizeAuthEmail\(email\)/);
  assert.doesNotMatch(loginSource, /resetPasswordForEmail\(\s*email\.trim\(\)\s*\)/);
});

test("auth routes keep recovery on its dedicated screen and wait for onboarding before entry", () => {
  const verifiedSource = readFromTestDirectory("../../app/auth/verified.tsx");
  const resetSource = readFromTestDirectory("../../app/reset-password.tsx");
  const openSource = readFromTestDirectory("../../app/open.tsx");
  assert.match(verifiedSource, /hasSeenOnboarding === null/);
  assert.match(verifiedSource, /pendingDestination/);
  assert.match(resetSource, /type RecoveryState = "loading" \| "ready" \| "invalid" \| "success"/);
  assert.doesNotMatch(resetSource, /<Redirect/);
  assert.match(openSource, /useLocalSearchParams<\{ notice\?: string \}>/);
  assert.match(openSource, /notice === "email-verified"/);
  assert.match(openSource, /pathname: "\/login", params: \{ notice: "email-verified" \}/);
});

test("reset screen updates the password and clears the recovery session", () => {
  const resetSource = readFromTestDirectory("../../app/reset-password.tsx");
  assert.match(resetSource, /updateUser\(\{ password \}\)/);
  assert.match(resetSource, /signOut\(\{ scope: "local" \}\)/);
  assert.match(resetSource, /Set a new password/);
  assert.match(resetSource, /Request another reset link/);
});
