import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Correct URL hardcoded as source of truth; env var may override in future
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "https://krbrmskfvpjukcbkbegc.supabase.co";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY environment variables."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Diagnostics only — never log or display the full key
export const debugSupabaseUrl: string = supabaseUrl;
export const debugAnonKeyExists: boolean = supabaseAnonKey.length > 0;
export const debugAnonKeyPrefix: string = supabaseAnonKey.slice(0, 8);
// Exported for use in authenticated fetch calls (e.g. test button)
export const anonKey: string = supabaseAnonKey;
