import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

export type AccountPlan = "Free" | "Plus" | "Family" | "Tester";

export interface AccountProfile {
  id: string | null;
  email: string | null;
  fullName: string | null;
  appRole: string | null;
  plan: AccountPlan | null;
}

type ProfileRpcRow = {
  id?: string | null;
  email?: string | null;
  full_name?: string | null;
  app_role?: string | null;
  plan?: string | null;
  subscription_plan?: string | null;
  effective_plan?: string | null;
  // Legacy UI Bakery profiles used `tier`; accept it without changing schema.
  tier?: string | null;
};

function safeProfileDiagnostic(row: ProfileRpcRow | null) {
  if (!__DEV__) return;
  console.info("[accountProfile] load_my_profile success", {
    rowReturned: !!row,
    fields: row
      ? {
          idPresent: !!row.id,
          emailPresent: !!row.email,
          fullNamePresent: !!row.full_name,
          app_role: row.app_role ?? null,
          effective_plan: row.effective_plan ?? null,
          subscription_plan: row.subscription_plan ?? null,
          plan: row.plan ?? null,
          tier: row.tier ?? null,
        }
      : null,
  });
}

function normalisePlan(value: string | null | undefined): AccountPlan | null {
  if (!value) return null;
  const plan = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  if (plan === "free") return "Free";
  if (plan === "tester") return "Tester";
  if (plan === "family" || plan === "coverly_family") return "Family";
  if (plan === "plus" || plan === "coverly_plus") return "Plus";
  return null;
}

export function useAccountProfile() {
  const { session } = useAuth();

  const query = useQuery({
    // Version the key so hot reload cannot retain a `null` result produced by
    // the older profile parser.
    queryKey: ["account-profile", "v2", session?.user.id],
    queryFn: async (): Promise<AccountProfile | null> => {
      const { data, error } = await supabase.rpc("load_my_profile");
      if (error) {
        if (__DEV__) {
          console.warn("[accountProfile] load_my_profile failed", {
            code: error.code ?? null,
            message: error.message,
            details: error.details ?? null,
            hint: error.hint ?? null,
          });
        }
        throw error;
      }

      const row = (Array.isArray(data) ? data[0] : data) as ProfileRpcRow | null;
      safeProfileDiagnostic(row ?? null);

      // The RPC itself succeeded, but this account has no explicit profile row.
      // With no billing entitlement connected, authenticated access is Free.
      // Admin remains false because app_role is not inferred from the session.
      if (!row) {
        return {
          id: session?.user.id ?? null,
          email: session?.user.email ?? null,
          fullName: null,
          appRole: null,
          plan: "Free",
        };
      }

      const rawPlan = [row.effective_plan, row.subscription_plan, row.plan, row.tier].find(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      );

      return {
        id: row.id ?? session?.user.id ?? null,
        email: row.email ?? session?.user.email ?? null,
        fullName: row.full_name?.trim() || null,
        appRole: row.app_role ?? null,
        // app_role is deliberately not considered when resolving billing plan.
        // A loaded profile with no paid entitlement is truthfully on Free.
        // An unknown non-empty plan remains indeterminate rather than being guessed.
        plan: rawPlan ? normalisePlan(rawPlan) : "Free",
      };
    },
    enabled: !!session,
    staleTime: 60_000,
    retry: 1,
  });

  return {
    ...query,
    profile: query.data ?? null,
    isAdmin: query.data?.appRole === "admin",
  };
}
