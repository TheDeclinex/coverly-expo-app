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

export type Storefront = { countryCode: string };

export type BillingStorefrontDiagnostic = {
  stage: "offerings" | "products";
  platform: string;
  sdkConfigured: boolean;
  userAttached: boolean;
  storefrontBefore: string | null;
  storefrontAfter: string | null;
  trigger?: string;
};

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

async function sdk() {
  if (Platform.OS !== "ios" && Platform.OS !== "android") throw new Error("Purchases are available in the iOS and Android apps.");
  const module = await import("react-native-purchases");
  // Metro and native builds expose the SDK as the default export. The fallback
  // keeps unsupported/test module interop failures inside the normal result path.
  const Purchases = module.default ?? (module as unknown as typeof module.default);
  if (!Purchases?.configure) throw new Error("Native purchases are unavailable in this build.");
  return { Purchases, LOG_LEVEL: module.LOG_LEVEL, PURCHASES_ERROR_CODE: module.PURCHASES_ERROR_CODE };
}

async function storefrontCountryCode(Purchases: Awaited<ReturnType<typeof sdk>>["Purchases"]) {
  try {
    return (await Purchases.getStorefront())?.countryCode ?? null;
  } catch {
    return null;
  }
}

function storefrontDiagnostic(
  stage: BillingStorefrontDiagnostic["stage"],
  storefrontBefore: string | null,
  storefrontAfter: string | null,
): BillingStorefrontDiagnostic {
  return {
    stage,
    platform: Platform.OS,
    sdkConfigured,
    userAttached: configuredUserId !== null,
    storefrontBefore,
    storefrontAfter,
  };
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
    return { ok: true, value: (wanted ? offerings.all[wanted] : offerings.current) ?? null };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not load subscription options." }; }
}

export async function loadOfferingWithStorefrontDiagnostics(): Promise<BillingResult<{
  offering: PurchasesOffering | null;
  diagnostic: BillingStorefrontDiagnostic;
}>> {
  try {
    const { Purchases } = await sdk();
    const storefrontBefore = await storefrontCountryCode(Purchases);
    const offerings = await Purchases.getOfferings();
    const storefrontAfter = await storefrontCountryCode(Purchases);
    const wanted = process.env.EXPO_PUBLIC_REVENUECAT_OFFERING_ID;
    const diagnostic = storefrontDiagnostic("offerings", storefrontBefore, storefrontAfter);
    billingDiagnostic("offering loaded", diagnostic);
    return { ok: true, value: { offering: (wanted ? offerings.all[wanted] : offerings.current) ?? null, diagnostic } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load subscription options." };
  }
}

export async function loadStoreProducts(productIdentifiers: string[]): Promise<BillingResult<PurchasesStoreProduct[]>> {
  const uniqueIdentifiers = [...new Set(productIdentifiers.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIdentifiers.length === 0) return { ok: true, value: [] };

  try {
    const { Purchases } = await sdk();
    const products = await Purchases.getProducts(uniqueIdentifiers);
    billingDiagnostic("store products loaded", {
      requestedCount: uniqueIdentifiers.length,
      returnedCount: products.length,
      productIdentifiers: products.map((product) => product.identifier),
    });
    return { ok: true, value: products };
  } catch (error) {
    billingDiagnostic("store products failed", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, error: error instanceof Error ? error.message : "Could not refresh store product prices." };
  }
}

export async function loadStoreProductsWithStorefrontDiagnostics(productIdentifiers: string[]): Promise<BillingResult<{
  products: PurchasesStoreProduct[];
  diagnostic: BillingStorefrontDiagnostic;
}>> {
  const uniqueIdentifiers = [...new Set(productIdentifiers.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIdentifiers.length === 0) {
    return {
      ok: true,
      value: {
        products: [],
        diagnostic: storefrontDiagnostic("products", null, null),
      },
    };
  }

  try {
    const { Purchases } = await sdk();
    const storefrontBefore = await storefrontCountryCode(Purchases);
    const products = await Purchases.getProducts(uniqueIdentifiers, Purchases.PRODUCT_CATEGORY.SUBSCRIPTION);
    const storefrontAfter = await storefrontCountryCode(Purchases);
    const diagnostic = storefrontDiagnostic("products", storefrontBefore, storefrontAfter);
    billingDiagnostic("store products loaded", {
      ...diagnostic,
      requestedCount: uniqueIdentifiers.length,
      returnedCount: products.length,
      productIdentifiers: products.map((product) => product.identifier),
    });
    return { ok: true, value: { products, diagnostic } };
  } catch (error) {
    billingDiagnostic("store products failed", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, error: error instanceof Error ? error.message : "Could not refresh store product prices." };
  }
}

export async function loadStorefront(): Promise<BillingResult<Storefront | null>> {
  try {
    const { Purchases } = await sdk();
    const storefront = await Purchases.getStorefront();
    billingDiagnostic("storefront loaded", { countryCode: storefront?.countryCode ?? null });
    return { ok: true, value: storefront };
  } catch (error) {
    billingDiagnostic("storefront failed", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, error: error instanceof Error ? error.message : "Could not load store account region." };
  }
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
  try { const { Purchases } = await sdk(); const result = await Purchases.purchasePackage(pkg); return { ok: true, value: result.customerInfo }; }
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
