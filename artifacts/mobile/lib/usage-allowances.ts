import { supabase } from "@/lib/supabase";
import {
  normaliseUsageAllowance,
  type UsageAllowance,
  type UsageAllowanceRpcRow,
} from "@/lib/usage-allowances-model";

export async function loadUsageAllowances(): Promise<UsageAllowance[]> {
  const { data, error } = await supabase.rpc("load_my_usage_allowances");
  if (error) throw error;

  return ((data ?? []) as UsageAllowanceRpcRow[])
    .map(normaliseUsageAllowance)
    .filter((row): row is UsageAllowance => row !== null);
}

export type { UsageAllowance };
