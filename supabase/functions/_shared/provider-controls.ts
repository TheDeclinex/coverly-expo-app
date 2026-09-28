import {
  boundedJson,
  fingerprint,
  TrustedUsage,
  UsageError,
  usageFailure,
} from "./trusted-usage.ts";
import { classifyBarcodeKind } from "../barcode-verify/model.ts";
import type {
  createClient as ClientFactory,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.3";

export type Environment = (name: string) => string | undefined;
export type Client = SupabaseClient;
export type RouteContext = {
  job: RouteJob;
  userId: string;
  userClient: Client;
  item?: Record<string, any>;
};
export type InnerFactory = (
  createClient: typeof ClientFactory,
  env: Environment,
  fetcher: typeof fetch,
  context: RouteContext,
) => (req: Request) => Promise<Response>;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const invalid = () => {
  throw new UsageError("INVALID_WORKLOAD", 400);
};

function base64(value: unknown, max: number) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    value.length % 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    invalid();
  try {
    return atob(value as string);
  } catch {
    invalid();
  }
  return "";
}
export function validateRoute(route: string, body: any) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  for (const field of [
    "itemId",
    "propertyId",
    "usageIdempotencyKey",
    "clientDraftId",
  ]) {
    if (
      body[field] !== undefined &&
      (typeof body[field] !== "string" ||
        !body[field].trim() ||
        body[field].length > 200)
    )
      invalid();
  }
  if (route.startsWith("voice-")) {
    base64(body.audioBase64, 28_000_000);
    if (
      body.mimeType !== undefined &&
      ![
        "audio/webm",
        "audio/mp4",
        "audio/m4a",
        "audio/x-m4a",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/aac",
      ].includes(body.mimeType)
    )
      invalid();
    if (
      body.ext !== undefined &&
      !["webm", "mp4", "m4a", "mp3", "wav", "ogg", "aac"].includes(body.ext)
    )
      invalid();
    const { audioBase64: _audio, ...context } = body;
    if (JSON.stringify(context).length > 16000) invalid();
    for (const field of ["knownProperties", "knownRooms"])
      if (
        body[field] !== undefined &&
        (!Array.isArray(body[field]) ||
          body[field].length > 100 ||
          body[field].some(
            (v: unknown) => typeof v !== "string" || v.length > 200,
          ))
      )
        invalid();
  } else if (route === "barcode-verify") {
    if (
      body.barcode !== undefined &&
      (typeof body.barcode !== "string" ||
        classifyBarcodeKind(body.barcode.trim()) === "unsupported")
    )
      invalid();
    if (!body.barcode && !body.imageBase64) invalid();
    if (body.imageBase64 !== undefined) {
      const bytes = base64(body.imageBase64, 6_700_000);
      // Existing image protocol sends JPEG only.
      if (
        bytes.charCodeAt(0) !== 255 ||
        bytes.charCodeAt(1) !== 216 ||
        bytes.charCodeAt(2) !== 255
      )
        invalid();
    }
    const { imageBase64: _image, ...context } = body;
    if (JSON.stringify(context).length > 8000) invalid();
  } else if (route === "replacement-refinement-v2") {
    if (
      !body.itemId ||
      !body.draft ||
      typeof body.draft !== "object" ||
      Array.isArray(body.draft)
    )
      invalid();
    for (const [key, max] of Object.entries({
      searchTerm: 120,
      brand: 80,
      model: 100,
      additionalDetails: 500,
    })) {
      if (
        body.draft[key] !== undefined &&
        (typeof body.draft[key] !== "string" || body.draft[key].length > max)
      )
        invalid();
    }
    if (!body.draft.searchTerm?.trim()) invalid();
  } else if (route === "generate-claim-pack") {
    if (!body.propertyId || !body.clientDraftId) invalid();
    for (const key of ["selectedRoomIds", "selectedItemIds"])
      if (
        !Array.isArray(body[key]) ||
        body[key].length > 1000 ||
        body[key].some(
          (v: unknown) => typeof v !== "string" || !v || v.length > 120,
        )
      )
        invalid();
    if (
      !body.selectedItemIds.length ||
      !["whole_property", "selected_rooms"].includes(body.scope) ||
      (body.claimNote != null &&
        (typeof body.claimNote !== "string" || body.claimNote.length > 2000))
    )
      invalid();
  }
}

export class RouteJob {
  client: Client;
  userId: string;
  claim: any;
  completed = false;
  uncertain = false;
  constructor(client: Client, userId: string) {
    this.client = client;
    this.userId = userId;
  }
  async call(name: string, args: Record<string, unknown>) {
    let result;
    try {
      result = await this.client.rpc(name, { p_user_id: this.userId, ...args });
    } catch {
      throw new UsageError("USAGE_SERVICE_UNAVAILABLE");
    }
    if (result.error || !result.data)
      throw new UsageError("USAGE_SERVICE_UNAVAILABLE");
    return result.data;
  }
  async begin(
    route: string,
    key: string,
    hash: string,
    resource: string | null,
  ) {
    this.claim = await this.call("begin_provider_route", {
      p_route: route,
      p_key: key,
      p_fingerprint: hash,
      p_resource_id: resource,
    });
    return this.claim;
  }
  async step(action: string, args: Record<string, unknown> = {}) {
    const result = await this.call("provider_route_step", {
      p_job_id: this.claim.job_id,
      p_token: this.claim.token,
      p_action: action,
      ...args,
    });
    if (result.ok !== true) throw new UsageError("EXECUTION_CLAIM_LOST", 409);
  }
  async complete(result: Record<string, unknown>) {
    this.uncertain = true; // A lost acknowledgement must never trigger a retryable failure.
    await this.step("completed", { p_result: result });
    this.completed = true;
    this.uncertain = false;
  }
  async fail() {
    if (!this.completed && !this.uncertain) await this.step("failed");
  }
  async provider(attempt: string, execute: () => Promise<Response>) {
    await this.step("start_attempt", { p_attempt: attempt });
    let result: Response;
    try {
      result = await execute();
    } catch (error) {
      await this.step("finish_attempt", {
        p_attempt: attempt,
        p_http_status: 0,
      });
      throw error;
    }
    await this.step("finish_attempt", {
      p_attempt: attempt,
      p_http_status: result.status,
    });
    return result;
  }
}

// All dependencies are injected for offline route tests. Every request has its
// own closure; no worker-global mutable Auth identity or provider execution token.
export function protectedRoute(
  route: string,
  inner: InnerFactory,
  createClient: typeof ClientFactory,
  env: Environment,
  fetcher: typeof fetch = globalThis.fetch,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST")
      return json({ success: false, errorCode: "METHOD_NOT_ALLOWED" }, 405);
    let job: RouteJob | undefined;
    let usage: TrustedUsage | undefined;
    try {
      const authorization = req.headers.get("authorization") ?? "";
      if (!/^Bearer\s+\S+$/i.test(authorization))
        throw new UsageError("UNAUTHORIZED", 401);
      const userClient = createClient(
        env("SUPABASE_URL") ?? "",
        env("SUPABASE_ANON_KEY") ?? "",
        {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const { data, error } = await userClient.auth.getUser(
        authorization.replace(/^Bearer\s+/i, ""),
      );
      if (error || !data.user) throw new UsageError("UNAUTHORIZED", 401);
      const userId = data.user.id;
      if (route === "replacement-search-refine")
        return json(
          {
            success: false,
            errorCode: "LEGACY_ROUTE_DISABLED",
            error:
              "Use replacement-refinement-v2. Manual editing remains available.",
          },
          410,
        );
      const maximum = route.startsWith("voice-")
        ? 29_000_000
        : route === "barcode-verify"
          ? 6_720_000
          : 65536;
      const body = await boundedJson(req, maximum);
      validateRoute(route, body);
      const resource =
        route === "generate-claim-pack"
          ? body.propertyId
          : (body.itemId ?? null);
      let itemContext: unknown = null;
      let validatedItem: Record<string, any> | undefined;
      if (resource && route !== "generate-claim-pack") {
        const { data: item, error: itemError } = await userClient
          .from("inventory_items")
          .select("*")
          .eq("id", resource)
          .single();
        if (itemError || !item) throw new UsageError("RESOURCE_NOT_OWNED", 403);
        const { data: file, error: fileError } = await userClient
          .from("inventory_files")
          .select("id,user_id")
          .eq("id", item.file_id)
          .eq("user_id", userId)
          .single();
        if (fileError || !file) throw new UsageError("RESOURCE_NOT_OWNED", 403);
        validatedItem = item;
        if (route === "replacement-refinement-v2")
          itemContext = {
            name: item.name,
            brand: item.brand_maker,
            model: item.model_series,
            description: item.description,
            category: item.category,
          };
      }
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceKey) throw new UsageError("USAGE_SERVICE_UNAVAILABLE");
      const service = createClient(env("SUPABASE_URL") ?? "", serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { usageIdempotencyKey: _key, ...input } = body;
      const hash = await fingerprint({ input, itemContext });
      // Older clients have no key. Identical legacy refinement is suppressed
      // indefinitely; voice/barcode suppress repeats within a minute, plus rates.
      const key =
        body.usageIdempotencyKey ??
        (route === "generate-claim-pack"
          ? body.clientDraftId
          : route === "replacement-refinement-v2"
            ? `legacy:${hash}`
            : `${Math.floor(Date.now() / 60000)}:${hash}`);
      job = new RouteJob(service, userId);
      const claim = await job.begin(route, key, hash, resource);
      if (claim.execute !== true) {
        if (
          claim.code === "OPERATION_COMPLETED" &&
          route === "generate-claim-pack" &&
          claim.result?.storagePath
        ) {
          const { data: signed, error: signError } = await service.storage
            .from("claim-packs")
            .createSignedUrl(claim.result.storagePath, 600);
          if (signError || !signed?.signedUrl)
            throw new UsageError("USAGE_SERVICE_UNAVAILABLE");
          return json({
            ...claim.result,
            signedUrl: signed.signedUrl,
            reused: true,
          });
        }
        throw new UsageError(
          claim.code ?? "USAGE_SERVICE_UNAVAILABLE",
          claim.code === "RATE_LIMITED"
            ? 429
            : ["CLAIM_EXPORT_ACCESS_REQUIRED", "RESOURCE_NOT_OWNED"].includes(
                  claim.code,
                )
              ? 403
              : 409,
        );
      }
      if (route === "replacement-refinement-v2") {
        usage = new TrustedUsage(service, userId);
        await usage.reserve(
          "replacement_refinement",
          "refine",
          key,
          { input, itemContext },
          resource,
          { route },
        );
      }
      let attemptIndex = 0;
      let controlFailure: unknown;
      const guardedFetch: typeof fetch = async (url, init) => {
        const attempt =
          String(url).includes("/emails") ||
          String(url).includes("postmarkapp.com")
            ? "email"
            : `provider_${++attemptIndex}`;
        const execute = () =>
          fetcher(url, { ...init, signal: AbortSignal.timeout(45000) });
        try {
          return await job!.provider(attempt, () =>
            usage ? usage.provider(attempt, execute) : execute(),
          );
        } catch (error) {
          if (error instanceof UsageError) controlFailure = error;
          throw error;
        }
      };
      const response = await inner(createClient, env, guardedFetch, {
        job,
        userId,
        userClient,
        item: validatedItem,
      })(
        new Request(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(body),
        }),
      );
      if (controlFailure) throw controlFailure;
      const result = await response.clone().json();
      if (usage)
        await usage.settle(
          response.ok && result.success === true ? "committed" : "refunded",
          response.ok && result.success === true ? null : "refinement_failed",
        );
      if (response.ok && result.success === true) {
        await job.complete(
          route === "generate-claim-pack"
            ? { ...result, signedUrl: undefined }
            : { success: true },
        );
      } else await job.fail();
      return response;
    } catch (error) {
      // Never compensate an uncertain monthly commit or a completed claim.
      try {
        if (job?.claim?.execute === true) await job.fail();
      } catch {
        return json(
          usageFailure(new UsageError("USAGE_SETTLEMENT_FAILED")),
          503,
        );
      }
      const status = error instanceof UsageError ? error.status : 503;
      const messages: Record<string, string> = {
        CLAIM_EXPORT_ACCESS_REQUIRED:
          "Claim pack export requires Coverly ownership or eligible access. Your saved inventory remains available.",
        RESOURCE_NOT_OWNED: "This inventory resource could not be accessed.",
        RATE_LIMITED:
          "Too many requests right now. Please wait before trying again.",
        UNAUTHORIZED: "Please sign in again to continue.",
      };
      const failure = usageFailure(error);
      const message = messages[failure.errorCode] ?? failure.message;
      return json(
        {
          ...failure,
          error: message,
          message,
          ...(error instanceof UsageError && error.code === "RATE_LIMITED"
            ? { retryAfterSeconds: 60 }
            : {}),
        },
        status,
      );
    }
  };
}
