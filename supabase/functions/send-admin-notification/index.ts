import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.107.0";

import {
  EXPO_PUSH_ENDPOINT,
  isExpoPushToken,
  newUserNotificationBody,
  parseWebhookPayload,
  safeErrorMessage,
} from "./model.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-coverly-webhook-secret",
};

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function bearerToken(request: Request): string | null {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

async function requireAdmin(
  request: Request,
  client: SupabaseClient,
): Promise<string> {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, "Authentication required.");
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user)
    throw new HttpError(401, "Invalid authentication token.");
  const { data: profile, error: profileError } = await client
    .from("user_profiles")
    .select("app_role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) throw new HttpError(500, "Could not verify admin access.");
  if (profile?.app_role !== "admin")
    throw new HttpError(403, "Admin access required.");
  return authData.user.id;
}

async function sendExpoMessages(
  tokens: string[],
  title: string,
  body: string,
  accessToken: string,
): Promise<string[]> {
  const response = await fetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(
      tokens.map((to) => ({ to, title, body, sound: "default" })),
    ),
  });
  const result = (await response.json().catch(() => null)) as {
    data?: ExpoTicket[];
    errors?: unknown;
  } | null;
  if (!response.ok || !Array.isArray(result?.data)) {
    throw new Error(`Expo Push API returned HTTP ${response.status}.`);
  }
  const failed = result.data.find((ticket) => ticket.status !== "ok");
  if (failed) {
    throw new Error(
      `Expo rejected a notification: ${failed.details?.error ?? failed.message ?? "unknown error"}.`,
    );
  }
  return result.data.flatMap((ticket) => (ticket.id ? [ticket.id] : []));
}

async function registeredTokens(
  client: SupabaseClient,
  adminUserId?: string,
): Promise<string[]> {
  let query = client
    .from("admin_notification_devices")
    .select("expo_push_token, user_profiles!inner(app_role)")
    .eq("user_profiles.app_role", "admin");
  if (adminUserId) query = query.eq("admin_user_id", adminUserId);
  const { data, error } = await query;
  if (error) throw new Error("Could not load registered admin devices.");
  return (data ?? []).map((row) => row.expo_push_token).filter(isExpoPushToken);
}

async function handleAdminAction(
  request: Request,
  body: Record<string, unknown>,
  client: SupabaseClient,
  expoAccessToken: string,
): Promise<Response> {
  const adminUserId = await requireAdmin(request, client);
  if (body.action === "register_device") {
    if (!isExpoPushToken(body.expoPushToken))
      throw new HttpError(400, "Invalid Expo push token.");
    if (body.platform !== "ios" && body.platform !== "android")
      throw new HttpError(400, "Invalid device platform.");
    const { error } = await client.from("admin_notification_devices").upsert(
      {
        admin_user_id: adminUserId,
        expo_push_token: body.expoPushToken,
        platform: body.platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "expo_push_token" },
    );
    if (error) throw new HttpError(500, "Could not register this device.");
    console.log("[send-admin-notification] registered admin device", {
      adminUserId,
      platform: body.platform,
    });
    return json({
      message: "This phone will receive new Coverly signup alerts.",
    });
  }
  if (body.action === "send_test") {
    const tokens = await registeredTokens(client, adminUserId);
    if (!tokens.length)
      throw new HttpError(409, "Register this phone before sending a test.");
    await sendExpoMessages(
      tokens,
      "Coverly notification test",
      "Admin signup notifications are working.",
      expoAccessToken,
    );
    console.log("[send-admin-notification] test sent", {
      adminUserId,
      deviceCount: tokens.length,
    });
    return json({
      message: "Check the registered phone for the test notification.",
    });
  }
  throw new HttpError(400, "Unsupported admin notification action.");
}

async function handleWebhook(
  body: unknown,
  client: SupabaseClient,
  expoAccessToken: string,
): Promise<Response> {
  const payload = parseWebhookPayload(body);
  if (!payload)
    throw new HttpError(400, "Unsupported or malformed webhook event.");
  const notificationId = payload.record.id;

  const { data: claimed, error: claimError } = await client
    .from("admin_notifications")
    .update({
      status: "processing",
      last_attempt_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", notificationId)
    .in("status", ["pending", "failed"])
    .select("attempts, email")
    .maybeSingle();
  if (claimError)
    throw new HttpError(500, "Could not claim notification for delivery.");
  if (!claimed) {
    console.log("[send-admin-notification] replay ignored", { notificationId });
    return json({ message: "Notification was already claimed or delivered." });
  }

  try {
    const tokens = await registeredTokens(client);
    if (!tokens.length)
      throw new Error("No admin notification devices are registered.");
    const ticketIds = await sendExpoMessages(
      tokens,
      "New Coverly signup",
      newUserNotificationBody(claimed.email),
      expoAccessToken,
    );
    const { error: updateError } = await client
      .from("admin_notifications")
      .update({
        status: "sent",
        attempts: claimed.attempts + 1,
        delivered_at: new Date().toISOString(),
        last_error: null,
        expo_ticket_ids: ticketIds,
      })
      .eq("id", notificationId);
    if (updateError)
      throw new Error(
        "Push was accepted but delivery status could not be saved.",
      );
    console.log("[send-admin-notification] signup push accepted", {
      notificationId,
      deviceCount: tokens.length,
    });
    return json({
      message: "Notification accepted by Expo Push API.",
      notificationId,
    });
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    await client
      .from("admin_notifications")
      .update({
        status: "failed",
        attempts: claimed.attempts + 1,
        last_error: errorMessage,
      })
      .eq("id", notificationId);
    console.error("[send-admin-notification] delivery failed", {
      notificationId,
      error: errorMessage,
    });
    throw new HttpError(502, "Admin notification delivery failed.");
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";
    const webhookSecret =
      Deno.env.get("ADMIN_NOTIFICATION_WEBHOOK_SECRET") ?? "";
    if (!supabaseUrl || !serviceRoleKey || !expoAccessToken || !webhookSecret) {
      throw new HttpError(500, "Admin notification service is not configured.");
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      throw new HttpError(400, "JSON body required.");
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const suppliedWebhookSecret =
      request.headers.get("x-coverly-webhook-secret") ?? "";
    if (suppliedWebhookSecret) {
      if (!constantTimeEqual(suppliedWebhookSecret, webhookSecret))
        throw new HttpError(401, "Invalid webhook secret.");
      return await handleWebhook(body, client, expoAccessToken);
    }
    return await handleAdminAction(
      request,
      body as Record<string, unknown>,
      client,
      expoAccessToken,
    );
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof HttpError
        ? error.message
        : "Unexpected admin notification error.";
    if (status >= 500)
      console.error("[send-admin-notification] request failed", {
        status,
        error: safeErrorMessage(error),
      });
    return json({ error: message }, status);
  }
});
