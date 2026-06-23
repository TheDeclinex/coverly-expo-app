import { Platform } from "react-native";
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from "react-native-purchases";

export type BillingResult<T> =
  | { ok: true; value: T }
  | { ok: false; cancelled?: boolean; error: string };

const iosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const androidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
export const revenueCatEntitlementId = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID ?? "coverly_access";
export const billingGatesEnabled = process.env.EXPO_PUBLIC_BILLING_GATES_ENABLED === "true";

let configuredUserId: string | null = null;
let sdkConfigured = false;
let identityOperation: Promise<void> = Promise.resolve();

function apiKey() {
  return Platform.OS === "ios" ? iosKey : Platform.OS === "android" ? androidKey : undefined;
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
  if (!key) return { ok: false, error: "RevenueCat is not configured for this platform." };
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
      return { ok: true, value: undefined };
    } catch (error) {
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

export async function loadCustomerInfo(): Promise<BillingResult<CustomerInfo>> {
  try { const { Purchases } = await sdk(); return { ok: true, value: await Purchases.getCustomerInfo() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not refresh purchases." }; }
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

export type { CustomerInfo, PurchasesOffering, PurchasesPackage };
