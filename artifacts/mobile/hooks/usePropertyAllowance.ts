import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { AppState } from "react-native";

import { useAuth } from "@/context/AuthContext";
import {
  parsePropertyAllowance,
  unavailablePropertyAllowance,
  type PropertyAllowance,
  type PropertyAllowanceRpcRow,
} from "@/lib/property-allowance";
import { supabase } from "@/lib/supabase";

export const propertyAllowanceQueryKey = (userId: string | null | undefined) => ["property-allowance", userId] as const;

async function loadPropertyAllowance(): Promise<PropertyAllowance> {
  const { data, error } = await supabase.rpc("get_my_property_allowance");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as PropertyAllowanceRpcRow | null;
  return parsePropertyAllowance(row);
}

export function usePropertyAllowance() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const query = useQuery({
    queryKey: propertyAllowanceQueryKey(userId),
    queryFn: loadPropertyAllowance,
    enabled: !!userId,
    staleTime: 15_000,
    retry: 1,
  });

  React.useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void queryClient.invalidateQueries({ queryKey: propertyAllowanceQueryKey(userId) });
      }
    });
    return () => subscription.remove();
  }, [queryClient, userId]);

  const refreshAllowance = React.useCallback(async (): Promise<PropertyAllowance> => {
    if (!userId) return unavailablePropertyAllowance("unavailable");
    const result = await query.refetch();
    return result.data ?? unavailablePropertyAllowance("unavailable");
  }, [query.refetch, userId]);

  const allowance = query.data
    ?? unavailablePropertyAllowance(query.isLoading ? "loading" : "unavailable");

  return {
    allowance,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refreshAllowance,
  };
}
