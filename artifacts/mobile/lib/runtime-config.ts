export type AppEnvironment = "development" | "preview" | "production";

export interface BackendRuntimeConfigInput {
  appEnvironment: AppEnvironment;
  supabaseUrl: string;
  supabaseAnonKey: string;
  expectedSupabaseProjectRef: string | null;
}

export function resolveAppEnvironment(
  value: string | undefined,
  developmentBuild: boolean,
): AppEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "development" || normalized === "preview" || normalized === "production") {
    return normalized;
  }
  return developmentBuild ? "development" : "production";
}

export function supabaseProjectRefFromUrl(value: string): string | null {
  try {
    const host = new URL(value).host.toLowerCase();
    if (!host.endsWith(".supabase.co")) return null;
    return host.split(".")[0]?.trim() || null;
  } catch {
    return null;
  }
}

export function validateBackendRuntimeConfig(input: BackendRuntimeConfigInput): string[] {
  const issues: string[] = [];
  const actualProjectRef = supabaseProjectRefFromUrl(input.supabaseUrl);

  if (!input.supabaseUrl.trim()) issues.push("EXPO_PUBLIC_SUPABASE_URL is missing.");
  if (!input.supabaseAnonKey.trim()) issues.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is missing.");

  if (input.supabaseUrl.trim()) {
    try {
      const parsed = new URL(input.supabaseUrl);
      if (input.appEnvironment === "production" && parsed.protocol !== "https:") {
        issues.push("Production Supabase URL must use HTTPS.");
      }
    } catch {
      issues.push("EXPO_PUBLIC_SUPABASE_URL is invalid.");
    }
  }

  if (
    (input.appEnvironment === "preview" || input.appEnvironment === "production")
    && !input.expectedSupabaseProjectRef
  ) {
    issues.push("EXPO_PUBLIC_EXPECTED_SUPABASE_PROJECT_REF is required for preview and production.");
  }

  if (
    input.expectedSupabaseProjectRef
    && actualProjectRef !== input.expectedSupabaseProjectRef.trim().toLowerCase()
  ) {
    issues.push("Configured Supabase URL does not match EXPO_PUBLIC_EXPECTED_SUPABASE_PROJECT_REF.");
  }

  return issues;
}

export function revenueCatEnvironmentIssue(
  appEnvironment: AppEnvironment,
  revenueCatEnvironment: string | undefined,
): string | null {
  const configured = revenueCatEnvironment?.trim().toLowerCase() ?? "";
  if (appEnvironment === "production" && configured !== "production") {
    return "Production builds require EXPO_PUBLIC_REVENUECAT_ENV=production.";
  }
  if (appEnvironment === "preview" && configured !== "sandbox") {
    return "Preview builds require EXPO_PUBLIC_REVENUECAT_ENV=sandbox.";
  }
  return null;
}
