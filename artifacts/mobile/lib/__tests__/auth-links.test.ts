import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  authLinkFingerprint,
  normalizeAuthEmail,
  parseAuthLink,
} from "../auth-link-model.ts";
import {
  NEW_PASSWORD_POLICY_ERROR,
  newPasswordAuthErrorMessage,
  newPasswordValidationError,
} from "../password-policy.ts";

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

test("rejects new passwords that do not meet every Coverly requirement", () => {
  assert.equal(newPasswordValidationError("abcdefgh"), "Password must include an uppercase letter.");
  assert.equal(newPasswordValidationError("Abcdefgh"), "Password must include a number.");
  assert.equal(newPasswordValidationError("Abcdefg1"), "Password must include a special character.");
  assert.equal(newPasswordValidationError("abcdef1!"), "Password must include an uppercase letter.");
  assert.equal(newPasswordValidationError("ABCDEFG1!"), "Password must include a lowercase letter.");
  assert.equal(newPasswordValidationError("Ab1!"), "Password must be at least 8 characters.");
});

test("accepts new passwords that meet every Coverly requirement", () => {
  for (const password of ["Abcdefg1!", "Coverly1!", "Secure123!", "MyHome26#"]) {
    assert.equal(newPasswordValidationError(password), null);
  }
});

test("maps Supabase weak-password failures to Coverly's policy guidance", () => {
  assert.equal(
    newPasswordAuthErrorMessage({ code: "weak_password", message: "Password should be stronger" }),
    NEW_PASSWORD_POLICY_ERROR,
  );
  assert.equal(newPasswordAuthErrorMessage({ code: "unexpected", message: "Network request failed" }), null);
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

test("auth submissions always release loading and do not render raw provider errors", () => {
  const loginSource = readFromTestDirectory("../../app/login.tsx");
  assert.match(loginSource, /const handleLogin = async \(\) => \{[\s\S]*finally \{[\s\S]*setLoading\(false\)/);
  assert.match(loginSource, /const handleSignUp = async \(\) => \{[\s\S]*finally \{[\s\S]*setLoading\(false\)/);
  assert.match(loginSource, /const handleForgotPassword = async \(\) => \{[\s\S]*finally \{[\s\S]*setLoading\(false\)/);
  assert.doesNotMatch(loginSource, /setError\(authError\.message\)/);
});

test("login sends existing passwords to Supabase without applying the new-password validator", () => {
  const loginSource = readFromTestDirectory("../../app/login.tsx");
  const loginHandler = loginSource.match(
    /const handleLogin = async \(\) => \{[\s\S]*?const handleSignUp = async \(\) => \{/,
  )?.[0];
  assert.ok(loginHandler);
  assert.match(loginHandler, /signInWithPassword\(\{[\s\S]*password/);
  assert.doesNotMatch(loginHandler, /newPasswordValidationError/);
  assert.notEqual(newPasswordValidationError("appletree"), null);
});

test("checked-in Supabase config enforces the native new-password policy", () => {
  const configSource = readFromTestDirectory("../../../../supabase/config.toml");
  assert.match(configSource, /minimum_password_length = 8/);
  assert.match(configSource, /password_requirements = "lower_upper_letters_digits_symbols"/);
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
