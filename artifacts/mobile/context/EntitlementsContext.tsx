import { useQueryClient } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";

import { useAuth } from "@/context/AuthContext";
import {
  addCustomerInfoListener,
  billingGatesEnabled,
  buyPackage,
  clearBillingUser,
  configureBilling,
  loadCustomerInfo,
  loadOffering,
  resolveCustomerPlan,
  restoreBilling,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from "@/lib/billing";
import type {
  AccessCapabilities,
  AccessClass,
  AccessPlan,
} from "@/lib/access-capabilities";
import {
  EntitlementController,
  type RecoveryResult,
  type VerificationState,
} from "@/lib/entitlement-controller";
import { ownershipAccess } from "@/lib/ownership-access";

export type GatedFeature =
  | "property"
  | "ai_scan"
  | "replacement_pricing"
  | "claim_pack";
type EntitlementsValue = {
  effectivePlan: AccessPlan;
  accessClass: AccessClass | null;
  ownsCoverly: boolean;
  capabilities: AccessCapabilities | null;
  propertyLimit: number | null | undefined;
  aiPolicyClass: string | null;
  ownershipVerificationState: VerificationState | "pending";
  subscriptionStatus: string | null;
  subscriptionPeriodEnd: string | null;
  isFree: boolean;
  isPlus: boolean;
  isFamily: boolean;
  isPaid: boolean;
  gatesEnabled: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  purchaseLoading: boolean;
  offering: PurchasesOffering | null;
  customerInfo: CustomerInfo | null;
  error: string | null;
  isSubscriptionSyncPending: boolean;
  canUseAiScan: boolean;
  canUseReplacementPricing: boolean;
  canExportClaimPack: boolean;
  shouldShowUpgradeFor: (
    feature: GatedFeature,
    currentPropertyCount?: number,
  ) => boolean;
  enforce: (feature: GatedFeature, currentPropertyCount?: number) => boolean;
  refreshEntitlements: () => Promise<void>;
  retryReconciliation: () => Promise<RecoveryResult>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<RecoveryResult>;
  restorePurchases: () => Promise<RecoveryResult>;
};
const Context = createContext<EntitlementsValue | null>(null);
const accountQuery = (key: readonly unknown[], id: string) =>
  ["account-profile", "property-allowance", "usage-allowances"].includes(
    String(key[0]),
  ) && key.includes(id);

export function EntitlementsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const queryClient = useQueryClient();
  const active = useRef<EntitlementController | null>(null);
  const controller = useMemo(() => {
    const instance: EntitlementController = new EntitlementController(userId, {
      ...ownershipAccess,
      isCurrent: () => active.current === instance,
      changed: () => {
        void queryClient.invalidateQueries({
          predicate: (query) => accountQuery(query.queryKey, userId),
        });
      },
    });
    return instance;
  }, [userId, queryClient]);
  // Fence previous account immediately, before effects or promise continuations.
  active.current = controller;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [store, setStore] = useState<{
    owner: EntitlementController;
    offering: PurchasesOffering | null;
    customerInfo: CustomerInfo | null;
    error: string | null;
  } | null>(null);
  const currentStore = store?.owner === controller ? store : null;

  useEffect(() => {
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    const current = () => !cancelled && active.current === controller;
    if (!userId) {
      void clearBillingUser();
      return;
    }
    // Cheap canonical read works even when native store configuration is absent.
    void controller.refresh().then(() => {
      if (current()) void controller.automaticRefresh();
    });
    void (async () => {
      const configured = await configureBilling(userId);
      if (!current()) return;
      if (!configured.ok) {
        setStore({
          owner: controller,
          offering: null,
          customerInfo: null,
          error: configured.error,
        });
        return;
      }
      const listener = await addCustomerInfoListener((info) => {
        // A delayed SDK callback is only a hint to verify the CURRENT account.
        // Never install listener payloads as access or account-specific UI data.
        if (current()) controller.customerInfoChanged(info);
      });
      if (listener.ok) {
        if (!current()) listener.value();
        else removeListener = listener.value;
      }
      if (!current()) return;
      const [offer, info] = await Promise.all([
        loadOffering(),
        loadCustomerInfo(userId),
      ]);
      if (!current()) return;
      if (info.ok) controller.customerInfoChanged(info.value);
      setStore({
        owner: controller,
        offering: offer.ok ? offer.value : null,
        customerInfo: info.ok ? info.value : null,
        error: !offer.ok ? offer.error : !info.ok ? info.error : null,
      });
    })();
    const foreground = AppState.addEventListener("change", (next) => {
      if (next === "active" && current()) {
        void controller.refresh().then(() => {
          if (current()) void controller.automaticRefresh();
        });
      }
    });
    return () => {
      cancelled = true;
      removeListener?.();
      foreground.remove();
      void queryClient.cancelQueries({
        predicate: (query) => accountQuery(query.queryKey, userId),
      });
      queryClient.removeQueries({
        predicate: (query) => accountQuery(query.queryKey, userId),
      });
    };
  }, [controller, queryClient, userId]);

  const refreshEntitlements = useCallback(async () => {
    if (userId) await controller.refresh(true);
  }, [controller, userId]);
  const retryReconciliation = useCallback(
    () => controller.retry(),
    [controller],
  );
  const purchasePackage = useCallback(
    (pkg: PurchasesPackage) =>
      controller.transact("purchase", async () => {
        const result = await buyPackage(pkg, userId);
        if (result.ok && active.current === controller)
          setStore((previous) => ({
            owner: controller,
            offering: previous?.owner === controller ? previous.offering : null,
            customerInfo: result.value,
            error: null,
          }));
        return result;
      }),
    [controller, userId],
  );
  const restorePurchases = useCallback(
    () =>
      controller.transact("restore", async () => {
        const result = await restoreBilling(userId);
        if (result.ok && active.current === controller)
          setStore((previous) => ({
            owner: controller,
            offering: previous?.owner === controller ? previous.offering : null,
            customerInfo: result.value,
            error: null,
          }));
        return result;
      }),
    [controller, userId],
  );
  const access = state.access;
  const plan = access?.effectivePlan ?? "free";
  const canExportClaimPack = access?.canExportClaimPack === true;
  const shouldShowUpgradeFor = useCallback(
    (feature: GatedFeature, count = 0) => {
      if (feature === "property")
        return (
          !access ||
          (access.propertyLimit !== null &&
            Math.max(count, access.propertyCount) >= access.propertyLimit)
        );
      if (feature === "ai_scan" || feature === "replacement_pricing")
        return false;
      return !canExportClaimPack;
    },
    [access, canExportClaimPack],
  );
  const enforce = useCallback(
    (feature: GatedFeature, count = 0) => {
      if (!shouldShowUpgradeFor(feature, count)) return true;
      if (!billingGatesEnabled) return true;
      router.push({ pathname: "/upgrade", params: { feature } } as Href);
      return false;
    },
    [shouldShowUpgradeFor],
  );
  const legacy = resolveCustomerPlan(currentStore?.customerInfo ?? null);
  const legacyMatches =
    (access?.accessClass === "legacy_plus" ||
      access?.accessClass === "legacy_family") &&
    legacy.plan === plan;
  const value: EntitlementsValue = {
    effectivePlan: plan,
    capabilities: access,
    accessClass: access?.accessClass ?? null,
    ownsCoverly: access?.ownsCoverly ?? false,
    propertyLimit: access?.propertyLimit,
    aiPolicyClass: access?.aiPolicyClass ?? null,
    ownershipVerificationState:
      state.pending && state.verification === "verified"
        ? "pending"
        : state.verification,
    // Metadata only; subscription dates never decide feature access.
    subscriptionStatus: legacyMatches ? legacy.subscriptionStatus : null,
    subscriptionPeriodEnd: legacyMatches ? legacy.subscriptionPeriodEnd : null,
    isFree: plan === "free",
    isPlus: plan === "coverly_plus",
    isFamily: plan === "coverly_family",
    isPaid: plan !== "free",
    gatesEnabled: billingGatesEnabled,
    isLoading: !!userId && state.verification === "loading",
    isRefreshing: state.refreshing,
    purchaseLoading: state.purchasing,
    offering: currentStore?.offering ?? null,
    customerInfo: currentStore?.customerInfo ?? null,
    error: state.error
      ? state.verification === "auth_required"
        ? "Sign in again to verify access."
        : "Access verification is temporarily unavailable. Retry verification or restore purchases."
      : (currentStore?.error ?? null),
    // Legacy UI adapter includes durable ownership confirmation.
    isSubscriptionSyncPending: state.pending !== null,
    canUseAiScan: true,
    canUseReplacementPricing: true,
    canExportClaimPack,
    shouldShowUpgradeFor,
    enforce,
    refreshEntitlements,
    retryReconciliation,
    purchasePackage,
    restorePurchases,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useEntitlements() {
  const value = useContext(Context);
  if (!value)
    throw new Error("useEntitlements must be used within EntitlementsProvider");
  return value;
}
