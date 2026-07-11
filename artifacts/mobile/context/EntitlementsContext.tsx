import { useQueryClient } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import {
  addCustomerInfoListener, billingGatesEnabled, buyPackage, clearBillingUser, configureBilling, hasActiveCustomerEntitlement,
  loadCustomerInfo, loadOffering, resolveCustomerPlan, restoreBilling,
  type CustomerInfo, type PurchasesOffering, type PurchasesPackage,
} from "@/lib/billing";
import type { CoverlyBillingPlan } from "@/lib/billing-entitlements";

export type GatedFeature = "property" | "ai_scan" | "replacement_pricing" | "claim_pack";

type EntitlementsValue = {
  effectivePlan: CoverlyBillingPlan;
  subscriptionStatus: string | null; subscriptionPeriodEnd: string | null;
  isFree: boolean; isPlus: boolean; isFamily: boolean; isPaid: boolean;
  gatesEnabled: boolean; isLoading: boolean; isRefreshing: boolean; purchaseLoading: boolean;
  offering: PurchasesOffering | null; customerInfo: CustomerInfo | null; error: string | null;
  isSubscriptionSyncPending: boolean;
  canCreateProperty: (currentCount: number) => boolean;
  canUseAiScan: boolean; canUseReplacementPricing: boolean; canExportClaimPack: boolean;
  shouldShowUpgradeFor: (feature: GatedFeature, currentPropertyCount?: number) => boolean;
  enforce: (feature: GatedFeature, currentPropertyCount?: number) => boolean;
  refreshEntitlements: () => Promise<void>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<{ ok: boolean; cancelled?: boolean; message: string }>;
  restorePurchases: () => Promise<{ ok: boolean; message: string }>;
};

const Context = createContext<EntitlementsValue | null>(null);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const profilePlanToCode = (plan: string | null | undefined): CoverlyBillingPlan => (
  plan === "Family" ? "coverly_family" : plan === "Plus" || plan === "Tester" ? "coverly_plus" : "free"
);

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const profileQuery = useAccountProfile();
  const queryClient = useQueryClient();
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeUserIdRef = useRef(session?.user.id ?? null);
  activeUserIdRef.current = session?.user.id ?? null;
  const profilePlan = profilePlanToCode(profileQuery.profile?.plan);
  const revenueCatPlan = resolveCustomerPlan(customerInfo);
  const plan = profilePlan !== "free" ? profilePlan : revenueCatPlan.plan ?? "free";
  const isSubscriptionSyncPending = revenueCatPlan.plan !== null && profileQuery.isSuccess && profilePlan === "free";
  const subscriptionStatus = isSubscriptionSyncPending
    ? revenueCatPlan.subscriptionStatus ?? profileQuery.profile?.subscriptionStatus ?? null
    : profileQuery.profile?.subscriptionStatus ?? revenueCatPlan.subscriptionStatus;
  const subscriptionPeriodEnd = isSubscriptionSyncPending
    ? revenueCatPlan.subscriptionPeriodEnd ?? profileQuery.profile?.subscriptionPeriodEnd ?? null
    : profileQuery.profile?.subscriptionPeriodEnd ?? revenueCatPlan.subscriptionPeriodEnd;
  const isPaid = plan !== "free";

  const refreshEntitlements = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId) return;
    setRefreshing(true);
    try {
      const customer = await loadCustomerInfo();
      if (activeUserIdRef.current !== userId) return;
      if (customer.ok) setCustomerInfo(customer.value);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await queryClient.invalidateQueries({ queryKey: ["account-profile"] });
        const refreshed = await profileQuery.refetch();
        if (activeUserIdRef.current !== userId) return;
        if (refreshed.data?.plan && refreshed.data.plan !== "Free") break;
        if (attempt < 3) await wait(1000 * (attempt + 1));
      }
    } finally {
      if (activeUserIdRef.current === userId) setRefreshing(false);
    }
  }, [profileQuery.refetch, queryClient, session?.user.id]);

  useEffect(() => {
    let cancelled = false;
    let removeCustomerInfoListener: (() => void) | null = null;
    if (!session?.user.id) {
      void clearBillingUser();
      setOffering(null); setCustomerInfo(null); setError(null);
      setPurchaseLoading(false); setRefreshing(false);
      return;
    }
    setOffering(null); setCustomerInfo(null); setError(null);
    void (async () => {
      const configured = await configureBilling(session.user.id);
      if (!configured.ok) { if (!cancelled) setError(configured.error); return; }
      const listener = await addCustomerInfoListener((info) => {
        if (!cancelled && activeUserIdRef.current === session.user.id) setCustomerInfo(info);
      });
      if (listener.ok) {
        if (cancelled) listener.value();
        else removeCustomerInfoListener = listener.value;
      }
      const [offer, info] = await Promise.all([loadOffering(), loadCustomerInfo()]);
      if (cancelled) return;
      if (offer.ok) setOffering(offer.value); else setError(offer.error);
      if (info.ok) setCustomerInfo(info.value); else setError((current) => current ?? info.error);
    })();
    return () => { cancelled = true; removeCustomerInfoListener?.(); };
  }, [session?.user.id]);

  const purchasePackage = useCallback(async (pkg: PurchasesPackage) => {
    setPurchaseLoading(true); setError(null);
    const result = await buyPackage(pkg);
    if (!result.ok) { setPurchaseLoading(false); if (!result.cancelled) setError(result.error); return { ok: false, cancelled: result.cancelled, message: result.cancelled ? "Purchase cancelled." : result.error }; }
    // RevenueCat returns confirmed CustomerInfo from the completed store
    // purchase. Make that access available now while Supabase catches up.
    setCustomerInfo(result.value);
    void refreshEntitlements().catch(() => undefined);
    setPurchaseLoading(false);
    return { ok: true, message: "Purchase received. Your access has been refreshed." };
  }, [refreshEntitlements]);

  const restorePurchases = useCallback(async () => {
    setPurchaseLoading(true); setError(null);
    const result = await restoreBilling();
    if (!result.ok) { setPurchaseLoading(false); setError(result.error); return { ok: false, message: result.error }; }
    setCustomerInfo(result.value);
    void refreshEntitlements().catch(() => undefined);
    setPurchaseLoading(false);
    const active = hasActiveCustomerEntitlement(result.value);
    return { ok: active, message: active ? "Purchases restored and access refreshed." : "No active Coverly subscription was found." };
  }, [refreshEntitlements]);

  const canCreateProperty = useCallback((count: number) => isPaid || count < 1, [isPaid]);
  const canUseMeteredAiFeatures = true;
  const canExportClaimPack = isPaid;
  const shouldShowUpgradeFor = useCallback((feature: GatedFeature, count = 0) => {
    if (feature === "property") return !canCreateProperty(count);
    // AI scans and replacement pricing are usage-metered. Free users should be
    // allowed to attempt their included allowance; the server remains the source
    // of truth for monthly limit enforcement.
    if (feature === "ai_scan" || feature === "replacement_pricing") return false;
    return !isPaid;
  }, [canCreateProperty, isPaid]);
  const enforce = useCallback((feature: GatedFeature, count = 0) => {
    const blocked = shouldShowUpgradeFor(feature, count);
    if (!blocked) return true;
    if (!billingGatesEnabled) { if (__DEV__) console.info(`[billing dry-run] would block ${feature}`); return true; }
    router.push({ pathname: "/upgrade", params: { feature } } as Href); return false;
  }, [shouldShowUpgradeFor]);

  const value = useMemo<EntitlementsValue>(() => ({
    effectivePlan: plan, subscriptionStatus, subscriptionPeriodEnd,
    isFree: !isPaid, isPlus: plan === "coverly_plus", isFamily: plan === "coverly_family", isPaid,
    gatesEnabled: billingGatesEnabled, isLoading: profileQuery.isLoading, isRefreshing, purchaseLoading,
    offering, customerInfo, error, isSubscriptionSyncPending, canCreateProperty, canUseAiScan: canUseMeteredAiFeatures,
    canUseReplacementPricing: canUseMeteredAiFeatures, canExportClaimPack, shouldShowUpgradeFor, enforce,
    refreshEntitlements, purchasePackage, restorePurchases,
  }), [plan, subscriptionStatus, subscriptionPeriodEnd, profileQuery.profile, profileQuery.isLoading, isRefreshing, purchaseLoading, offering, customerInfo, error, isSubscriptionSyncPending, canCreateProperty, canExportClaimPack, shouldShowUpgradeFor, enforce, refreshEntitlements, purchasePackage, restorePurchases]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useEntitlements() { const value = useContext(Context); if (!value) throw new Error("useEntitlements must be used within EntitlementsProvider"); return value; }
