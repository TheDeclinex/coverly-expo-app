import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  refinementFailureCode,
  replacementRefinementFailureMessage,
} from "../replacement-refinement-errors.ts";
import {
  postRefinementWithCurrentSession,
  RefinementSessionError,
} from "../replacement-refinement-transport.ts";

const successResponse = () => new Response(JSON.stringify({ success: true }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

test("AI transport reads the current session and sends the working authenticated header set", async () => {
  let sessionReads = 0;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  const result = await postRefinementWithCurrentSession<{ success: boolean }>({
    getSession: async () => {
      sessionReads += 1;
      return { data: { session: { access_token: "current-token" } }, error: null };
    },
    fetcher: async (url, init) => {
      captured.push({ url: String(url), init });
      return successResponse();
    },
    functionUrl: "https://project.supabase.co/functions/v1/replacement-refinement-v2",
    anonKey: "anon-key",
    body: { itemId: "item-1" },
  });
  assert.equal(sessionReads, 1);
  assert.equal(result.ok, true);
  assert.equal(captured[0].url, "https://project.supabase.co/functions/v1/replacement-refinement-v2");
  assert.equal((captured[0].init?.headers as Record<string, string>).Authorization, "Bearer current-token");
  assert.equal((captured[0].init?.headers as Record<string, string>).apikey, "anon-key");
  assert.equal((captured[0].init?.headers as Record<string, string>)["Content-Type"], "application/json");
});

test("missing or unreadable current sessions stop before invocation", async () => {
  let fetchCalls = 0;
  const invoke = (error: unknown, accessToken?: string | null) => postRefinementWithCurrentSession({
    getSession: async () => ({ data: { session: accessToken === undefined ? null : { access_token: accessToken } }, error }),
    fetcher: async () => { fetchCalls += 1; return successResponse(); },
    functionUrl: "https://project.supabase.co/functions/v1/replacement-refinement-v2",
    anonKey: "anon-key",
    body: {},
  });
  await assert.rejects(invoke(null), (error: unknown) => error instanceof RefinementSessionError && error.code === "MISSING_SESSION");
  await assert.rejects(invoke(new Error("storage unavailable"), "stale-token"), (error: unknown) => error instanceof RefinementSessionError && error.code === "SESSION_UNAVAILABLE");
  assert.equal(fetchCalls, 0);
});

test("a refreshed session is used and a previous token is never retained across AI actions", async () => {
  const tokens = ["refreshed-token", "newer-token"];
  const sent: string[] = [];
  const options = {
    getSession: async () => ({ data: { session: { access_token: tokens.shift() ?? null } }, error: null }),
    fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push((init?.headers as Record<string, string>).Authorization);
      return successResponse();
    },
    functionUrl: "https://project.supabase.co/functions/v1/replacement-refinement-v2",
    anonKey: "anon-key",
    body: {},
  };
  await postRefinementWithCurrentSession(options);
  await postRefinementWithCurrentSession(options);
  assert.deepEqual(sent, ["Bearer refreshed-token", "Bearer newer-token"]);
  assert.equal(sent.includes("Bearer stale-token"), false);
});

test("only genuine auth failures use session-expired copy", () => {
  assert.equal(refinementFailureCode(401, { code: "INVALID_AUTH_TOKEN" }), "INVALID_AUTH_TOKEN");
  assert.equal(refinementFailureCode(401, { code: 401, message: "Invalid JWT" }), "INVALID_JWT");
  assert.match(replacementRefinementFailureMessage(401, "INVALID_AUTH_TOKEN"), /session has expired/i);
  assert.match(replacementRefinementFailureMessage(undefined, "MISSING_SESSION"), /^Sign in/i);
  assert.match(replacementRefinementFailureMessage(404, "ITEM_NOT_FOUND"), /item could not be accessed/i);
  assert.match(replacementRefinementFailureMessage(500, "FUNCTION_CONFIGURATION_ERROR"), /not configured/i);
  assert.doesNotMatch(replacementRefinementFailureMessage(500, "AI_REQUEST_FAILED"), /session has expired/i);
  assert.doesNotMatch(replacementRefinementFailureMessage(401, "ITEM_NOT_FOUND"), /session has expired/i);
});

test("AI client and Edge entrypoint match the working explicit bearer-token contract", () => {
  const client = readFileSync(fileURLToPath(new URL("../replacement-refinement-ai.ts", import.meta.url).href), "utf8");
  const transport = readFileSync(fileURLToPath(new URL("../replacement-refinement-transport.ts", import.meta.url).href), "utf8");
  const edge = readFileSync(fileURLToPath(new URL("../../../../supabase/functions/replacement-refinement-v2/index.ts", import.meta.url).href), "utf8");
  assert.match(client, /getSession: \(\) => supabase\.auth\.getSession\(\)/);
  assert.doesNotMatch(client, /supabase\.functions\.invoke/);
  assert.match(transport, /apikey: options\.anonKey/);
  assert.match(transport, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(edge, /const jwt = authHeader\.slice\(7\)\.trim\(\)/);
  assert.match(edge, /auth\.getUser\(jwt\)/);
  assert.doesNotMatch(edge, /auth\.getUser\(\)/);
  assert.match(edge, /"ITEM_NOT_FOUND"/);
  assert.match(edge, /"FUNCTION_CONFIGURATION_ERROR"/);
});
