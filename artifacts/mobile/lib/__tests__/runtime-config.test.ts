import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAppEnvironment,
  revenueCatEnvironmentIssue,
  supabaseProjectRefFromUrl,
  validateBackendRuntimeConfig,
} from "../runtime-config.ts";

test("release environments require and verify an explicit Supabase project reference", () => {
  const valid = validateBackendRuntimeConfig({
    appEnvironment: "production",
    supabaseUrl: "https://prodref.supabase.co",
    supabaseAnonKey: "public-anon-key",
    expectedSupabaseProjectRef: "prodref",
  });
  assert.deepEqual(valid, []);

  const mismatch = validateBackendRuntimeConfig({
    appEnvironment: "preview",
    supabaseUrl: "https://devref.supabase.co",
    supabaseAnonKey: "public-anon-key",
    expectedSupabaseProjectRef: "prodref",
  });
  assert.match(mismatch.join(" "), /does not match/);
});

test("production and preview RevenueCat environments fail closed when mixed", () => {
  assert.equal(revenueCatEnvironmentIssue("production", "sandbox"), "Production builds require EXPO_PUBLIC_REVENUECAT_ENV=production.");
  assert.equal(revenueCatEnvironmentIssue("preview", "production"), "Preview builds require EXPO_PUBLIC_REVENUECAT_ENV=sandbox.");
  assert.equal(revenueCatEnvironmentIssue("production", "production"), null);
  assert.equal(revenueCatEnvironmentIssue("preview", "sandbox"), null);
});

test("environment and Supabase project parsing are deterministic", () => {
  assert.equal(resolveAppEnvironment(undefined, true), "development");
  assert.equal(resolveAppEnvironment(undefined, false), "production");
  assert.equal(resolveAppEnvironment("preview", false), "preview");
  assert.equal(supabaseProjectRefFromUrl("https://abc123.supabase.co"), "abc123");
  assert.equal(supabaseProjectRefFromUrl("https://api.example.com"), null);
});
