import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { authorizeRevenueCatWebhook } from "./auth.ts";
import {
  buildCanonicalSubscriberProfileUpdate,
  parseList,
  parseRevenueCatEvent,
  processRevenueCatWebhookEvent,
  safeEventMetadata,
  type RevenueCatEvent,
  type RevenueCatPlanConfig,
  type RevenueCatProfileUpdate,
  type RevenueCatWebhookStore,
} from "./model.ts";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function lifecycleLog(message: string, details: Record<string, unknown> = {}) {
  console.info(`[revenuecat-webhook] ${message}`, details);
}

function lifecycleWarn(message: string, details: Record<string, unknown> = {}) {
  console.warn(`[revenuecat-webhook] ${message}`, details);
}

function env(name: string) {
  return Deno.env.get(name) ?? "";
}

function subscriberSyncTimeoutMs() {
  const configured = Number(env("REVENUECAT_SUBSCRIBER_SYNC_TIMEOUT_MS") || "5000");
  return Number.isFinite(configured) && configured > 0 ? configured : 5000;
}

function planConfig(): RevenueCatPlanConfig {
  return {
    plusEntitlementIds: parseList(env("REVENUECAT_PLUS_ENTITLEMENT_IDS")),
    familyEntitlementIds: parseList(env("REVENUECAT_FAMILY_ENTITLEMENT_IDS")),
    plusProductIds: parseList(env("REVENUECAT_PLUS_PRODUCT_IDS")),
    familyProductIds: parseList(env("REVENUECAT_FAMILY_PRODUCT_IDS")),
  };
}

function eventInsert(event: RevenueCatEvent) {
  return {
    event_id: event.id,
    event_type: event.type,
    app_user_id: event.appUserId,
    original_app_user_id: event.originalAppUserId,
    environment: event.environment,
    store: event.store,
    product_id: event.newProductId ?? event.productId,
    entitlement_ids: event.entitlementIds,
    status: "processing",
    metadata: safeEventMetadata(event),
  };
}

async function syncCanonicalSubscriberState(
  event: RevenueCatEvent,
  _profileId: string,
  config: RevenueCatPlanConfig,
  fallback: RevenueCatProfileUpdate,
) {
  const apiKey = env("REVENUECAT_SECRET_API_KEY");
  const appUserId = fallback.targetAppUserId;
  lifecycleLog("canonical sync start", {
    eventId: event.id,
    eventType: event.type,
    hasSecretApiKey: Boolean(apiKey),
    hasAppUserId: Boolean(appUserId),
  });
  if (!apiKey || !appUserId) {
    lifecycleWarn("canonical sync skipped", {
      eventId: event.id,
      eventType: event.type,
      reason: !apiKey ? "missing_secret_api_key" : "missing_app_user_id",
    });
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), subscriberSyncTimeoutMs());
  try {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      lifecycleWarn("canonical sync failure", {
        eventId: event.id,
        eventType: event.type,
        reason: "subscriber_api_http_error",
        status: response.status,
      });
      throw new Error(`RevenueCat subscriber sync failed with ${response.status}`);
    }

    const payload: unknown = await response.json();
    const update = buildCanonicalSubscriberProfileUpdate(payload, event, config, fallback);
    lifecycleLog("canonical sync success", {
      eventId: event.id,
      eventType: event.type,
      mapped: Boolean(update),
      mappedPlan: update?.subscription_plan ?? null,
      mappedStatus: update?.subscription_status ?? null,
    });
    return update;
  } catch (error) {
    lifecycleWarn("canonical sync failure", {
      eventId: event.id,
      eventType: event.type,
      reason: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "request_failed",
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function supabaseStore(supabase: ReturnType<typeof createClient>): RevenueCatWebhookStore {
  return {
    async claimEvent(event) {
      const { error: insertError } = await supabase.from("revenuecat_webhook_events").insert(eventInsert(event));
      if (!insertError) return { claimed: true };
      if (insertError.code !== "23505") throw insertError;

      const { data: existing, error: existingError } = await supabase
        .from("revenuecat_webhook_events")
        .select("event_id,status")
        .eq("event_id", event.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.status !== "failed") return { claimed: false, status: existing?.status ?? "processing" };

      const { data: retryClaim, error: retryError } = await supabase
        .from("revenuecat_webhook_events")
        .update({
          status: "processing",
          error_code: null,
          processed_at: null,
          metadata: safeEventMetadata(event),
        })
        .eq("event_id", event.id)
        .eq("status", "failed")
        .select("event_id,status")
        .maybeSingle();
      if (retryError) throw retryError;
      return retryClaim ? { claimed: true } : { claimed: false, status: existing.status };
    },

    async markIgnored(eventId, errorCode, metadata) {
      const { error } = await supabase.from("revenuecat_webhook_events").update({
        status: "ignored",
        error_code: errorCode,
        processed_at: new Date().toISOString(),
        metadata,
      }).eq("event_id", eventId);
      if (error) throw error;
    },

    async findProfile(appUserId) {
      const { data, error } = await supabase.from("user_profiles").select("id").eq("id", appUserId).maybeSingle();
      if (error) throw error;
      return data ? { id: data.id } : null;
    },

    async updateProfile(profileId, values) {
      const { error } = await supabase.from("user_profiles").update(values).eq("id", profileId);
      if (error) throw error;
    },

    async markProcessed(eventId, profileId, metadata) {
      const { error } = await supabase.from("revenuecat_webhook_events").update({
        status: "processed",
        profile_id: profileId,
        processed_at: new Date().toISOString(),
        metadata,
      }).eq("event_id", eventId);
      if (error) throw error;
    },

    async markFailed(eventId, errorCode, metadata) {
      const { error } = await supabase.from("revenuecat_webhook_events").update({
        status: "failed",
        error_code: errorCode,
        metadata,
      }).eq("event_id", eventId);
      if (error) throw error;
    },

    async logAdminEvent(severity, message, event, userId, extra = {}) {
      const { error } = await supabase.from("admin_events").insert({
        source: "revenuecat-webhook",
        screen: "backend",
        severity,
        message,
        user_id: userId,
        metadata: {
          eventId: event.id,
          eventType: event.type,
          environment: event.environment,
          store: event.store,
          productId: event.newProductId ?? event.productId,
          entitlementIds: event.entitlementIds,
          ...extra,
        },
      });
      if (error) throw error;
    },

    syncSubscriberState: syncCanonicalSubscriberState,
  };
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const respond = (body: Record<string, unknown>, status = 200, reason = "ok") => {
    lifecycleLog("response", { requestId, status, reason });
    return json(body, status);
  };

  const authHeader = request.headers.get("authorization");
  const signatureHeader = request.headers.get("x-revenuecat-webhook-signature");
  const webhookSecret = env("REVENUECAT_WEBHOOK_AUTHORIZATION");
  const signingSecret = env("REVENUECAT_WEBHOOK_SIGNING_SECRET");
  const allowInsecure = env("REVENUECAT_ALLOW_INSECURE_WEBHOOK") === "true";
  lifecycleLog("request received", {
    requestId,
    method: request.method,
    hasAuthorizationHeader: Boolean(authHeader),
    hasSignatureHeader: Boolean(signatureHeader),
    bearerAuthConfigured: Boolean(webhookSecret),
    hmacEnabled: Boolean(signingSecret),
    allowInsecure,
  });

  if (request.method !== "POST") return respond({ error: "method_not_allowed" }, 405, "method_not_allowed");

  const rawBody = await request.text();
  const authorization = await authorizeRevenueCatWebhook(
    {
      authorization: authHeader,
      signature: signatureHeader,
    },
    rawBody,
    {
      bearerSecret: webhookSecret,
      signingSecret,
      allowInsecure,
    },
  );
  if (authorization === "server_not_configured") return respond({ error: "server_not_configured" }, 500, "server_not_configured");
  if (authorization !== true) return respond({ error: authorization }, 401, authorization);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return respond({ error: "invalid_json" }, 400, "invalid_json");
  }

  const event = parseRevenueCatEvent(payload);
  if (!event) return respond({ error: "missing_event_identity" }, 400, "missing_event_identity");
  lifecycleLog("event parsed", {
    requestId,
    eventId: event.id,
    eventType: event.type,
    isTestEvent: event.type === "TEST",
  });

  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return respond({ error: "server_not_configured" }, 500, "supabase_not_configured");

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const result = await processRevenueCatWebhookEvent(event, planConfig(), supabaseStore(supabase));
    return respond(result.body, result.httpStatus, String(result.body.reason ?? result.body.error ?? result.body.status ?? "processed"));
  } catch {
    return respond({ error: "webhook_processing_failed" }, 500, "webhook_processing_failed");
  }
});
