import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

import {
  resolveAppEnvironment,
  supabaseProjectRefFromUrl,
  validateBackendRuntimeConfig,
} from "@/lib/runtime-config";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const expectedSupabaseProjectRef =
  process.env.EXPO_PUBLIC_EXPECTED_SUPABASE_PROJECT_REF?.trim().toLowerCase() || null;
export const runtimeAppEnvironment = resolveAppEnvironment(
  process.env.EXPO_PUBLIC_APP_ENV,
  __DEV__,
);

const runtimeConfigurationIssues = validateBackendRuntimeConfig({
  appEnvironment: runtimeAppEnvironment,
  supabaseUrl,
  supabaseAnonKey,
  expectedSupabaseProjectRef,
});

if (runtimeConfigurationIssues.length > 0) {
  throw new Error(
    `Invalid Coverly backend configuration: ${runtimeConfigurationIssues.join(" ")}`
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    // Force React Native's native fetch — the bundled XHR polyfill fails on iOS
    fetch: fetch.bind(globalThis),
  },
});

// Diagnostics only — never log or display the full key
export const debugSupabaseUrl: string = supabaseUrl;
export const debugAnonKeyExists: boolean = supabaseAnonKey.length > 0;
export const debugAnonKeyPrefix: string = supabaseAnonKey.slice(0, 8);
export const debugSupabaseHost: string | null = (() => {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return null;
  }
})();
export const debugSupabaseProjectRef: string | null = debugSupabaseHost?.endsWith(".supabase.co")
  ? supabaseProjectRefFromUrl(supabaseUrl)
  : null;
export const debugExpectedSupabaseProjectRef: string | null = expectedSupabaseProjectRef;
export const debugSupabaseProjectRefMatchesExpected: boolean | null = expectedSupabaseProjectRef
  ? debugSupabaseProjectRef === expectedSupabaseProjectRef
  : null;
// Exported for use in authenticated fetch calls (e.g. test button)
export const anonKey: string = supabaseAnonKey;
