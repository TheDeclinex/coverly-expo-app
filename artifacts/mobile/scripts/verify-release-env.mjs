const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV?.trim().toLowerCase();
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const expectedProjectRef = process.env.EXPO_PUBLIC_EXPECTED_SUPABASE_PROJECT_REF?.trim().toLowerCase() ?? "";
const revenueCatEnvironment = process.env.EXPO_PUBLIC_REVENUECAT_ENV?.trim().toLowerCase() ?? "";
const issues = [];

if (!["development", "preview", "production"].includes(appEnvironment)) {
  issues.push("EXPO_PUBLIC_APP_ENV must be development, preview, or production.");
}
if (!supabaseUrl) issues.push("EXPO_PUBLIC_SUPABASE_URL is missing.");
if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()) issues.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is missing.");

let supabaseHost = null;
let actualProjectRef = null;
try {
  const parsed = new URL(supabaseUrl);
  supabaseHost = parsed.host;
  actualProjectRef = parsed.host.endsWith(".supabase.co") ? parsed.host.split(".")[0] : null;
  if (appEnvironment === "production" && parsed.protocol !== "https:") {
    issues.push("Production Supabase URL must use HTTPS.");
  }
} catch {
  if (supabaseUrl) issues.push("EXPO_PUBLIC_SUPABASE_URL is invalid.");
}

if (appEnvironment === "preview" || appEnvironment === "production") {
  if (!expectedProjectRef) issues.push("EXPO_PUBLIC_EXPECTED_SUPABASE_PROJECT_REF is required.");
  if (expectedProjectRef && actualProjectRef !== expectedProjectRef) issues.push("Supabase project reference mismatch.");
  if (process.env.EXPO_PUBLIC_BILLING_GATES_ENABLED !== "true") issues.push("Release billing gates must be enabled.");
  if (!process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim()) issues.push("RevenueCat iOS public SDK key is missing.");
  if (!process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim()) issues.push("RevenueCat Android public SDK key is missing.");
}
if (appEnvironment === "preview" && revenueCatEnvironment !== "sandbox") {
  issues.push("Preview must use EXPO_PUBLIC_REVENUECAT_ENV=sandbox.");
}
if (appEnvironment === "production" && revenueCatEnvironment !== "production") {
  issues.push("Production must use EXPO_PUBLIC_REVENUECAT_ENV=production.");
}

console.info("[release-env]", {
  appEnvironment: appEnvironment ?? null,
  supabaseHost,
  actualProjectRef,
  expectedProjectRef: expectedProjectRef || null,
  revenueCatEnvironment: revenueCatEnvironment || null,
  billingGatesEnabled: process.env.EXPO_PUBLIC_BILLING_GATES_ENABLED === "true",
  hasSupabaseAnonKey: Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()),
  hasRevenueCatIosKey: Boolean(process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim()),
  hasRevenueCatAndroidKey: Boolean(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim()),
});

if (issues.length) {
  for (const issue of issues) console.error(`[release-env] ${issue}`);
  process.exitCode = 1;
} else {
  console.info("[release-env] configuration is internally consistent");
}
