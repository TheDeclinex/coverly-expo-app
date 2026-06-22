import { supabase } from "@/lib/supabase";
import {
  normaliseProfileSettings,
  type ProfileSettings,
  type ProfileSettingsInput,
  type ProfileSettingsRpcRow,
} from "@/lib/profile-settings-model";

function firstRow(data: unknown): ProfileSettingsRpcRow | null {
  if (Array.isArray(data)) return (data[0] as ProfileSettingsRpcRow | undefined) ?? null;
  return (data as ProfileSettingsRpcRow | null) ?? null;
}

export async function loadProfileSettings(): Promise<ProfileSettings> {
  const { data, error } = await supabase.rpc("load_my_settings");
  if (error) throw error;
  const row = firstRow(data);
  if (!row) throw new Error("Profile settings are unavailable for this account.");
  return normaliseProfileSettings(row);
}

export async function updateProfileSettings(input: ProfileSettingsInput): Promise<ProfileSettings> {
  const { data, error } = await supabase.rpc("update_my_profile", {
    p_full_name: input.fullName.trim() || null,
    p_country_code: input.countryCode.trim().toUpperCase(),
    p_reminder_notifications_enabled: input.reminderNotificationsEnabled,
    p_product_updates_enabled: input.productUpdatesEnabled,
  });
  if (error) throw error;
  const row = firstRow(data);
  if (!row) throw new Error("Your profile was saved, but the refreshed settings were unavailable.");
  return normaliseProfileSettings(row);
}

export async function markOnboardingCompleteOnServer(): Promise<void> {
  const { error } = await supabase.rpc("mark_my_onboarding_complete");
  if (error) throw error;
}
