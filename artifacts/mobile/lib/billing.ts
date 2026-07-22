import Constants from "expo-constants";
import { Platform } from "react-native";
import type { CustomerInfo, CustomerInfoUpdateListener, PurchasesOffering, PurchasesPackage, PurchasesStoreProduct } from "react-native-purchases";

import {
  hasActiveRevenueCatEntitlement,
  resolveRevenueCatPlan,
  type CoverlyBillingPlan,
  type RevenueCatEntitlementConfig,
  type RevenueCatPlanState,
} from "@/lib/billing-entitlements";

export type BillingResult<T> =
  | { ok: true; value: T }
  | { ok: false; cancelled?: boolean; error: string };

const iosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const androidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

function envValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const revenueCatPlusEntitlementId = envValue(process.env.EXPO_PUBLIC_REVENUECAT_PLUS_ENTITLEMENT_ID);
export const revenueCatFamilyEntitlementId = envValue(process.env.EXPO_PUBLIC_REVENUECAT_FAMILY_ENTITLEMENT_ID);
export const billingGatesEnabled = process.env.EXPO_PUBLIC_BILLING_GATES_ENABLED === "true";
export const revenueCatEntitlementConfig: RevenueCatEntitlementConfig = {
  plusEntitlementId: revenueCatPlusEntitlementId,
  familyEntitlementId: revenueCatFamilyEntitlementId,
};

let configuredUserId: string | null = null;
let sdkConfigured = false;
let identityOperation: Promise<void> = Promise.resolve();

function apiKey() {
  return Platform.OS === "ios" ? iosKey : Platform.OS === "android" ? androidKey : undefined;
}

function billingDiagnostic(event: string, details: Record<string, unknown> = {}) {
  if (!__DEV__) return;
  console.info(`[billing] ${event}`, {
    platform: Platform.OS,
    hasApiKey: Boolean(apiKey()),
    plusEntitlementConfigured: Boolean(revenueCatEntitlementConfig.plusEntitlementId),
    familyEntitlementConfigured: Boolean(revenueCatEntitlementConfig.familyEntitlementId),
    ...details,
  });
}

type RevenueCatProductDiagnostic = PurchasesPackage["product"] & {
  locale?: unknown;
  localeIdentifier?: unknown;
};

function deviceLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

// Temporary release-visible diagnostics for the iOS paywall investigation.
// These contain product metadata only; no user or purchase identifiers are logged.
function pricingDiagnostic(
  event: "offering package loaded" | "purchase package selected",
  pkg: PurchasesPackage,
  details: Record<string, unknown> = {},
) {
  const product = pkg.product as RevenueCatProductDiagnostic;
  const productLocale = typeof product.locale === "string"
    ? product.locale
    : typeof product.localeIdentifier === "string"
      ? product.localeIdentifier
      : null;

  console.info(`[billing pricing diagnostic] ${event}`, {
    appVersion: Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? null,
    nativeBuildVersion: Constants.nativeBuildVersion ?? null,
    platform: Platform.OS,
    deviceLocale: deviceLocale(),
    productLocale,
    packageIdentifier: pkg.identifier,
    packageType: pkg.packageType,
    productIdentifier: product.identifier,
    productTitle: product.title ?? null,
    priceString: product.priceString ?? null,
    numericPrice: typeof product.price === "number" ? product.price : null,
    currencyCode: typeof product.currencyCode === "string" ? product.currencyCode : null,
    ...details,
  });
}

async function sdk() {
  if (Platform.OS !== "ios" && Platform.OS !== "android") throw new Error("Purchases are available in the iOS and Android apps.");
  const module = await import("react-native-purchases");
  // Metro and native builds expose the SDK as the default export. The fallback
  // keeps unsupported/test module interop failures inside the normal result path.
  const Purchases = module.default ?? (module as unknown as typeof module.default);
  if (!Purchases?.configure) throw new Error("Native purchases are unavailable in this build.");
  return { Purchases, LOG_LEVEL: module.LOG_LEVEL, PURCHASES_ERROR_CODE: module.PURCHASES_ERROR_CODE };
}

function serialiseIdentityOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = identityOperation.then(operation, operation);
  identityOperation = result.then(() => undefined, () => undefined);
  return result;
}

export const billingAvailability = {
  get isConfigured() { return Boolean(apiKey()); },
  get statusLabel() { return apiKey() ? "Available" : "Setup required"; },
};

export async function configureBilling(userId: string): Promise<BillingResult<void>> {
  const key = apiKey();
  if (!key) {
    billingDiagnostic("configure skipped");
    return { ok: false, error: "RevenueCat is not configured for this platform." };
  }
  return serialiseIdentityOperation(async () => {
    try {
      const { Purchases, LOG_LEVEL } = await sdk();
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      if (!sdkConfigured) {
        Purchases.configure({ apiKey: key, appUserID: userId });
        sdkConfigured = true;
      } else if (configuredUserId !== userId) {
        await Purchases.logIn(userId);
      }
      configuredUserId = userId;
      billingDiagnostic("configured", { userAttached: true });
      return { ok: true, value: undefined };
    } catch (error) {
      billingDiagnostic("configure failed", { message: error instanceof Error ? error.message : "unknown" });
      return { ok: false, error: error instanceof Error ? error.message : "Native purchases are unavailable in this build." };
    }
  });
}

export async function clearBillingUser() {
  return serialiseIdentityOperation(async () => {
    if (!configuredUserId) return;
    try { const { Purchases } = await sdk(); await Purchases.logOut(); } catch { /* unsupported build */ }
    configuredUserId = null;
    // Keep sdkConfigured true: RevenueCat must only be configured once per
    // process. A later authenticated user is attached with logIn().
  });
}

export async function loadOffering(): Promise<BillingResult<PurchasesOffering | null>> {
  try {
    const { Purchases } = await sdk();
    const offerings = await Purchases.getOfferings();
    const wanted = process.env.EXPO_PUBLIC_REVENUECAT_OFFERING_ID;
    const offering = (wanted ? offerings.all[wanted] : offerings.current) ?? null;
    for (const pkg of offering?.availablePackages ?? []) {
      pricingDiagnostic("offering package loaded", pkg, {
        offeringIdentifier: offering?.identifier ?? null,
        configuredOfferingIdentifier: wanted ?? null,
      });
    }
    return { ok: true, value: offering };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not load subscription options." }; }
}

export async function loadCustomerInfo(): Promise<BillingResult<CustomerInfo>> {
  try {
    const { Purchases } = await sdk();
    const info = await Purchases.getCustomerInfo();
    billingDiagnostic("customer info loaded", { hasActiveEntitlement: hasActiveRevenueCatEntitlement(info, revenueCatEntitlementConfig) });
    return { ok: true, value: info };
  }
  catch (error) {
    billingDiagnostic("customer info failed", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, error: error instanceof Error ? error.message : "Could not refresh purchases." };
  }
}

export async function addCustomerInfoListener(listener: CustomerInfoUpdateListener): Promise<BillingResult<() => void>> {
  try {
    const { Purchases } = await sdk();
    Purchases.addCustomerInfoUpdateListener(listener);
    return { ok: true, value: () => { Purchases.removeCustomerInfoUpdateListener(listener); } };
  } catch (error) {
    billingDiagnostic("customer info listener failed", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, error: error instanceof Error ? error.message : "Could not listen for purchase updates." };
  }
}

export async function buyPackage(pkg: PurchasesPackage): Promise<BillingResult<CustomerInfo>> {
  try {
    const { Purchases } = await sdk();
    pricingDiagnostic("purchase package selected", pkg);
    const result = await Purchases.purchasePackage(pkg);
    return { ok: true, value: result.customerInfo };
  }
  catch (error) {
    const value = error as { code?: string; userCancelled?: boolean | null; message?: string };
    const { PURCHASES_ERROR_CODE } = await sdk().catch(() => ({ PURCHASES_ERROR_CODE: null }));
    const cancelled = value.userCancelled === true || value.code === PURCHASES_ERROR_CODE?.PURCHASE_CANCELLED_ERROR;
    return { ok: false, cancelled, error: value.message ?? "Purchase could not be completed." };
  }
}

export async function restoreBilling(): Promise<BillingResult<CustomerInfo>> {
  try { const { Purchases } = await sdk(); return { ok: true, value: await Purchases.restorePurchases() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Purchases could not be restored." }; }
}

export function resolveCustomerPlan(customerInfo: CustomerInfo | null): RevenueCatPlanState {
  return resolveRevenueCatPlan(customerInfo, revenueCatEntitlementConfig);
}

export function hasActiveCustomerEntitlement(customerInfo: CustomerInfo | null) {
  return hasActiveRevenueCatEntitlement(customerInfo, revenueCatEntitlementConfig);
}

export type { CoverlyBillingPlan, CustomerInfo, PurchasesOffering, PurchasesPackage, PurchasesStoreProduct, RevenueCatPlanState };
