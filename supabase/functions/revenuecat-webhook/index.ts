import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "content-type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const list = (name: string) => (Deno.env.get(name) ?? "").split(",").map((v) => v.trim()).filter(Boolean);

function planFor(productId: string | null) {
  if (!productId) return null;
  if (list("REVENUECAT_FAMILY_PRODUCT_IDS").includes(productId)) return "coverly_family";
  if (list("REVENUECAT_PLUS_PRODUCT_IDS").includes(productId)) return "coverly_plus";
  return null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_AUTHORIZATION");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);

  let payload: { event?: Record<string, unknown> };
  try { payload = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const event = payload.event;
  const eventId = typeof event?.id === "string" ? event.id : null;
  const transferredTo = Array.isArray(event?.transferred_to) ? event.transferred_to.find((v): v is string => typeof v === "string") : null;
  const appUserId = typeof event?.app_user_id === "string" ? event.app_user_id : transferredTo;
  if (!eventId || !appUserId) return json({ error: "missing_event_identity" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server_not_configured" }, 500);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: profile, error: loadError } = await supabase.from("user_profiles")
    .select("id,revenuecat_last_event_id").eq("id", appUserId).maybeSingle();
  if (loadError) return json({ error: "profile_lookup_failed" }, 500);
  if (!profile) return json({ error: "profile_not_found" }, 202);
  if (profile.revenuecat_last_event_id === eventId) return json({ ok: true, duplicate: true });

  const type = String(event.type ?? "UNKNOWN");
  const productId = typeof event.product_id === "string" ? event.product_id : null;
  const entitlementIds = Array.isArray(event.entitlement_ids) ? event.entitlement_ids.filter((v): v is string => typeof v === "string") : [];
  const expirationMs = typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : null;
  const expiration = expirationMs ? new Date(expirationMs).toISOString() : null;
  const inactive = type === "EXPIRATION";
  const billingIssue = type === "BILLING_ISSUE";
  const status = inactive ? "expired" : billingIssue ? "billing_issue" : type === "CANCELLATION" ? "cancelled" : "active";
  const mappedPlan = planFor(productId);

  const update: Record<string, unknown> = {
    revenuecat_customer_id: appUserId,
    revenuecat_product_id: productId,
    revenuecat_entitlement_id: entitlementIds[0] ?? null,
    revenuecat_expiration_at: expiration,
    revenuecat_status: status,
    revenuecat_last_event_id: eventId,
    revenuecat_updated_at: new Date().toISOString(),
    subscription_status: status,
    subscription_period_end: expiration,
    updated_at: new Date().toISOString(),
  };
  // Unknown store products never invent or erase a plan.
  if (mappedPlan) update.subscription_plan = mappedPlan;
  if (inactive) update.subscription_plan = "free";

  const { error: updateError } = await supabase.from("user_profiles").update(update).eq("id", profile.id);
  if (updateError) return json({ error: "profile_update_failed" }, 500);
  return json({ ok: true, event_id: eventId, status });
});
