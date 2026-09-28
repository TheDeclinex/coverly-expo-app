import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { createAccessClient } from "./access-client";

const verificationFetch: typeof fetch = async (input, init) => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20_000);
  try {
    return await fetch(input, { ...init, signal: abort.signal });
  } finally {
    clearTimeout(timeout);
  }
};

// Isolated request client binds the captured account token across asynchronous
// SDK work. It neither persists nor refreshes a second auth session.
function client(token: string) {
  return createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: verificationFetch,
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
export const ownershipAccess = createAccessClient({
  async session() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session
      ? { userId: data.session.user.id, token: data.session.access_token }
      : null;
  },
  async read(token) {
    return await client(token).rpc("get_my_access_capabilities");
  },
  async reconcile(token) {
    // No customer IDs, user IDs, receipts or ownership claims in the body.
    const { data, error } = await client(token).functions.invoke(
      "reconcile-revenuecat-purchases",
      { body: {} },
    );
    return { data, error, status: error?.context?.status };
  },
});
