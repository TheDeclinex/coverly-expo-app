export const COMPLETED_ONBOARDING_STATUS = "completed";
export const DEFAULT_COUNTRY_CODE = "NZ";

export const COUNTRY_OPTIONS = [
  { code: "NZ", label: "New Zealand" },
  { code: "AU", label: "Australia" },
  { code: "GB", label: "United Kingdom" },
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
] as const;

export interface ProfileSettings {
  id: string;
  email: string;
  fullName: string;
  countryCode: string;
  reminderNotificationsEnabled: boolean;
  productUpdatesEnabled: boolean;
  onboardingStatus: string;
}

export interface ProfileSettingsInput {
  fullName: string;
  countryCode: string;
  reminderNotificationsEnabled: boolean;
  productUpdatesEnabled: boolean;
}

export type ProfileSettingsRpcRow = {
  id?: string | null;
  email?: string | null;
  full_name?: string | null;
  country_code?: string | null;
  reminder_notifications_enabled?: boolean | null;
  product_updates_enabled?: boolean | null;
  onboarding_status?: string | null;
};

export function normaliseProfileSettings(row: ProfileSettingsRpcRow): ProfileSettings {
  if (!row.id || !row.email) throw new Error("Profile settings are unavailable for this account.");
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name?.trim() ?? "",
    countryCode: row.country_code?.trim().toUpperCase() || DEFAULT_COUNTRY_CODE,
    reminderNotificationsEnabled: row.reminder_notifications_enabled ?? false,
    productUpdatesEnabled: row.product_updates_enabled ?? false,
    onboardingStatus: row.onboarding_status ?? "new",
  };
}

export function validateProfileSettings(input: ProfileSettingsInput): string | null {
  if (input.fullName.trim().length > 100) return "Full name must be 100 characters or fewer.";
  if (!/^[A-Z]{2}$/.test(input.countryCode.trim().toUpperCase())) return "Choose a valid country or region.";
  return null;
}

export function isServerOnboardingComplete(status: string | null | undefined): boolean {
  return status === COMPLETED_ONBOARDING_STATUS;
}
