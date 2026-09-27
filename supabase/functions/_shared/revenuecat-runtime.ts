import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  readConfig,
  reconciliationHandler,
  webhookHandler,
  SyncError,
  type Store,
} from "./revenuecat-reconciliation.ts";

// Service credentials stay in the function. getUser verifies the caller's token
// with Supabase Auth; no decoding-only or client UUID authentication shortcut.
export function serveRevenueCat(kind: "webhook" | "reconcile") {
  Deno.serve(async (req: Request) => {
    try {
      const get = (name: string) => Deno.env.get(name);
      const config = readConfig(get);
      const url = get("SUPABASE_URL");
      const key = get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) throw new Error("server_not_configured");
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const store: Store = {
        async rpc(name, args) {
          const { data, error } = await client.rpc(name, args);
          if (error) {
            const safeCodes = [
              "profile_not_found",
              "reconciliation_busy",
              "event_lease_lost",
              "sync_lease_lost",
              "stale_canonical_state",
              "projection_environment_mismatch",
            ];
            throw new SyncError(
              safeCodes.includes(error.message)
                ? error.message
                : "database_operation_failed",
            );
          }
          return data;
        },
        async authenticate(token) {
          const { data, error } = await client.auth.getUser(token);
          return error ? null : (data.user?.id ?? null);
        },
      };
      return kind === "webhook"
        ? await webhookHandler(req, config, store, {
            bearerSecret: get("REVENUECAT_WEBHOOK_AUTHORIZATION") ?? "",
            signingSecret: get("REVENUECAT_WEBHOOK_SIGNING_SECRET") ?? "",
          })
        : await reconciliationHandler(req, config, store);
    } catch {
      return new Response(JSON.stringify({ error: "server_not_configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  });
}
