import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalState,
  lookup,
  readConfig,
  reconciliationHandler,
  webhookHandler,
  type Config,
  type Store,
} from "./revenuecat-reconciliation.ts";

// Every network call must be supplied by a test. Accidental live calls fail.
globalThis.fetch = async () => {
  throw new Error("Live network forbidden in these tests");
};
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const config: Config = {
  secret: "fixture-secret",
  projectId: "fixture-project",
  appIds: ["fixture-app"],
  environment: "production",
  ownedProductIds: ["lifetime"],
  plusEntitlementIds: ["Coverly Plus"],
  familyEntitlementIds: ["Coverly Family"],
  plusProductIds: ["plus"],
  familyProductIds: ["family"],
};
const purchaseDate = "2026-01-01T00:00:00Z";
function payload(
  id = a,
  entitlement: string | null = "coverly_owned",
  product = "lifetime",
) {
  return {
    request_date_ms: Date.now(),
    subscriber: {
      original_app_user_id: id,
      entitlements: entitlement
        ? {
            [entitlement]: {
              product_identifier: product,
              purchase_date: purchaseDate,
              expires_date: null,
            },
          }
        : {},
      subscriptions: {},
      non_subscriptions: {
        [product]: [{ purchase_date: purchaseDate, is_sandbox: false }],
      },
    },
  };
}
function fixture() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const applied: any[] = [];
  let authId: string | null = a;
  let status = "new";
  let busy = false;
  const store: Store = {
    authenticate: async (token) => (token === "valid" ? authId : null),
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "revenuecat_claim_event") {
        if (status === "processed" || status === "processing")
          return { token: null, status };
        status = "processing";
        return { token: "event-lease", status };
      }
      if (name === "revenuecat_begin_sync") {
        if (busy) throw new Error("busy");
        return "sync-lease";
      }
      if (name === "revenuecat_apply_sync") {
        applied.push(args);
        status = "processed";
        return { owns_coverly: (args.p_states as any[])[0].owned };
      }
      if (name === "revenuecat_finish_event") status = String(args.p_status);
      return null;
    },
  };
  return {
    calls,
    applied,
    store,
    setStatus(v: string) {
      status = v;
    },
    setBusy() {
      busy = true;
    },
    setAuth(v: string | null) {
      authId = v;
    },
  };
}
const mockFetch =
  (data: unknown): typeof fetch =>
  async () =>
    Response.json(data);
const request = (body = "{}", token = "valid") =>
  new Request("https://fixture/reconcile", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
  });
const auth = { bearerSecret: "webhook", signingSecret: "" };
function event(overrides: Record<string, unknown> = {}, secret = "webhook") {
  return new Request("https://fixture/webhook", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      event: {
        id: "event-1",
        type: "NON_RENEWING_PURCHASE",
        app_user_id: a,
        app_id: "fixture-app",
        environment: "PRODUCTION",
        ...overrides,
      },
    }),
  });
}

test("lifetime ownership needs no renewal or subscription fields", () => {
  const state = canonicalState(payload(), a, config);
  assert.equal(state.owned, true);
  assert.equal(state.expires_at, null);
  assert.equal(state.acquired_at, "2026-01-01T00:00:00.000Z");
});
test("absent and unrecognized entitlements never grant ownership", () => {
  assert.equal(canonicalState(payload(a, null), a, config).owned, false);
  assert.equal(canonicalState(payload(a, "unrelated"), a, config).owned, false);
});
test("expiry and refund remove ownership; cancellation/renewal flags do not", () => {
  const p: any = payload();
  p.subscriber.entitlements.coverly_owned.expires_date = purchaseDate;
  assert.equal(canonicalState(p, a, config).reason, "entitlement_expired");
  p.subscriber.entitlements.coverly_owned.expires_date = null;
  p.subscriber.non_subscriptions.lifetime[0].refunded_at = purchaseDate;
  assert.equal(canonicalState(p, a, config).reason, "refunded");
});
test("malformed expiry, missing dictionaries and unrecognized product fail closed", () => {
  const p: any = payload();
  delete p.subscriber.entitlements.coverly_owned.expires_date;
  assert.throws(
    () => canonicalState(p, a, config),
    /invalid_canonical_entitlement/,
  );
  assert.throws(
    () => canonicalState({ subscriber: {} }, a, config),
    /invalid_canonical_state/,
  );
  assert.throws(
    () => canonicalState(payload(a, "coverly_owned", "unexpected"), a, config),
    /unrecognized_product/,
  );
});
test("canonical identity mismatch is rejected; server lookup can resolve anonymous original", () => {
  assert.throws(
    () => canonicalState(payload(b), a, config),
    /identity_mismatch/,
  );
  assert.equal(
    canonicalState(payload("$RCAnonymousID:abc123"), a, config).owned,
    true,
  );
});
test("canonical environment and app/project fields are verified", () => {
  const p: any = payload();
  p.subscriber.non_subscriptions.lifetime[0].is_sandbox = true;
  assert.throws(() => canonicalState(p, a, config), /wrong_environment/);
  assert.equal(
    canonicalState(p, a, { ...config, environment: "sandbox" }).owned,
    true,
  );
  p.subscriber.non_subscriptions.lifetime[0].is_sandbox = false;
  p.subscriber.app_id = "unrelated";
  assert.throws(() => canonicalState(p, a, config), /wrong_app/);
  delete p.subscriber.app_id;
  p.project_id = "wrong";
  assert.throws(() => canonicalState(p, a, config), /wrong_project/);
});
test("ambiguous mixed-environment receipts cannot borrow a production transaction", () => {
  const p: any = payload();
  p.subscriber.non_subscriptions.lifetime.push({
    purchase_date: purchaseDate,
    is_sandbox: true,
  });
  assert.throws(() => canonicalState(p, a, config), /ambiguous_purchase/);
});
test("canonical freshness prevents stale snapshots", () => {
  const p = payload();
  p.request_date_ms -= 300_000;
  assert.throws(() => canonicalState(p, a, config), /stale_canonical_state/);
});
test("required deployment settings fail closed and retain legacy mappings", () => {
  assert.throws(() => readConfig(() => undefined), /server_not_configured/);
  const env: Record<string, string> = {
    REVENUECAT_SECRET_API_KEY: "fixture",
    REVENUECAT_EXPECTED_ENVIRONMENT: "production",
    REVENUECAT_PROJECT_ID: "project",
    REVENUECAT_ALLOWED_APP_IDS: "app",
    REVENUECAT_OWNED_PRODUCT_IDS: "owner",
    REVENUECAT_PLUS_ENTITLEMENT_IDS: "Coverly Plus",
  };
  Object.assign(env, {
    REVENUECAT_FAMILY_ENTITLEMENT_IDS: "Coverly Family",
    REVENUECAT_PLUS_PRODUCT_IDS: "plus",
    REVENUECAT_FAMILY_PRODUCT_IDS: "family",
  });
  assert.deepEqual(readConfig((n) => env[n]).plusEntitlementIds, [
    "Coverly Plus",
  ]);
  for (const key of [
    "REVENUECAT_PROJECT_ID",
    "REVENUECAT_ALLOWED_APP_IDS",
    "REVENUECAT_OWNED_PRODUCT_IDS",
    "REVENUECAT_SECRET_API_KEY",
    "REVENUECAT_EXPECTED_ENVIRONMENT",
  ]) {
    const copy = { ...env };
    delete copy[key];
    assert.throws(() => readConfig((n) => copy[n]), /server_not_configured/);
  }
});
test("authenticated reconciliation derives UUID and returns canonical access", async () => {
  const f = fixture();
  let url = "";
  const response = await reconciliationHandler(
    request(),
    config,
    f.store,
    async (input, init) => {
      url = String(input);
      assert.equal(
        (init!.headers as Record<string, string>).Authorization,
        "Bearer fixture-secret",
      );
      return Response.json(payload());
    },
  );
  assert.equal(response.status, 200);
  assert.ok(url.endsWith(a));
  assert.deepEqual(await response.json(), {
    ok: true,
    access: { owns_coverly: true },
  });
});
test("authenticated nonowner returns no ownership", async () => {
  const f = fixture();
  const r = await reconciliationHandler(
    request(),
    config,
    f.store,
    mockFetch(payload(a, null)),
  );
  assert.equal((await r.json()).access.owns_coverly, false);
});
test("invalid auth never begins reconciliation", async () => {
  const f = fixture();
  assert.equal(
    (await reconciliationHandler(request("{}", "bad"), config, f.store)).status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
test("another user ID and forged CustomerInfo/owns_coverly are rejected", async () => {
  for (const body of [
    { user_id: b },
    { owns_coverly: true },
    { customerInfo: payload() },
    { appUserID: b },
    [],
  ]) {
    const f = fixture();
    assert.equal(
      (
        await reconciliationHandler(
          request(JSON.stringify(body)),
          config,
          f.store,
        )
      ).status,
      400,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("lookup failure and 404 preserve projection, release lease and return retryable status", async () => {
  for (const status of [404, 429, 500]) {
    const f = fixture();
    const r = await reconciliationHandler(
      request(),
      config,
      f.store,
      async () => new Response("", { status }),
    );
    assert.equal(r.status, 503);
    assert.equal(f.applied.length, 0);
    assert.equal(f.calls.at(-1)!.name, "revenuecat_release_sync");
  }
});
test("network exception cannot fall back to webhook purchase assertion; failure retries", async () => {
  const f = fixture();
  const first = await webhookHandler(
    event(),
    config,
    f.store,
    auth,
    async () => {
      throw new Error("offline");
    },
  );
  assert.equal(first.status, 503);
  assert.equal(f.applied.length, 0);
  assert.equal(f.calls.at(-1)!.args.p_status, "failed");
  assert.equal(
    (await webhookHandler(event(), config, f.store, auth, mockFetch(payload())))
      .status,
    200,
  );
  assert.equal(f.applied.length, 1);
});
test("processed duplicate does not query or apply; active processing duplicate is retryable", async () => {
  const f = fixture();
  f.setStatus("processed");
  assert.equal(
    (await webhookHandler(event(), config, f.store, auth)).status,
    200,
  );
  f.setStatus("processing");
  assert.equal(
    (await webhookHandler(event(), config, f.store, auth)).status,
    503,
  );
  assert.equal(f.applied.length, 0);
});
test("transfer independently fetches source and destination then applies together", async () => {
  const f = fixture();
  const ids: string[] = [];
  const r = await webhookHandler(
    event({
      type: "TRANSFER",
      transferred_from: [a, "$RCAnonymousID:abc"],
      transferred_to: [b, "not-a-uuid"],
    }),
    config,
    f.store,
    auth,
    async (input) => {
      const id = String(input).split("/").at(-1)!;
      ids.push(id);
      return Response.json(payload(id, id === a ? null : "coverly_owned"));
    },
  );
  assert.equal(r.status, 200);
  assert.deepEqual(ids, [a, b]);
  assert.deepEqual(
    f.applied[0].p_states.map((s: any) => [s.user_id, s.owned]),
    [
      [a, false],
      [b, true],
    ],
  );
});
test("transfer with one failed lookup applies neither account", async () => {
  const f = fixture();
  const r = await webhookHandler(
    event({ type: "TRANSFER", transferred_from: [a], transferred_to: [b] }),
    config,
    f.store,
    auth,
    async (input) =>
      String(input).endsWith(a)
        ? Response.json(payload(a, null))
        : new Response("", { status: 500 }),
  );
  assert.equal(r.status, 503);
  assert.equal(f.applied.length, 0);
});
test("malformed identities, environment, app/project and authorization cannot mutate users", async () => {
  for (const overrides of [
    { app_user_id: "bad" },
    { environment: "SANDBOX" },
    { app_id: "wrong" },
    { project_id: "wrong" },
    {
      type: "TRANSFER",
      transferred_from: ["bad"],
      transferred_to: ["also-bad"],
    },
  ]) {
    const f = fixture();
    assert.equal(
      (await webhookHandler(event(overrides), config, f.store, auth)).status,
      400,
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal(
    (await webhookHandler(event({}, "wrong"), config, f.store, auth)).status,
    401,
  );
  assert.equal(
    (
      await webhookHandler(event(), config, f.store, {
        bearerSecret: "",
        signingSecret: "",
      })
    ).status,
    500,
  );
  assert.equal(f.calls.length, 0);
});
test("TEST and unknown events are logged without canonical lookup or projection", async () => {
  for (const type of ["TEST", "NEW_UNKNOWN_TYPE"]) {
    const f = fixture();
    assert.equal(
      (await webhookHandler(event({ type }), config, f.store, auth)).status,
      200,
    );
    assert.equal(f.calls.at(-1)!.args.p_status, "ignored");
    assert.equal(f.applied.length, 0);
  }
});
test("busy or missing profile fails before lookup and stays retryable", async () => {
  const f = fixture();
  f.setBusy();
  assert.equal(
    (await webhookHandler(event(), config, f.store, auth)).status,
    503,
  );
  assert.equal(f.applied.length, 0);
  assert.equal(f.calls.at(-1)!.args.p_status, "failed");
});
test("Plus/Family remain legacy and do not confer permanent ownership", () => {
  for (const [id, product, plan] of [
    ["Coverly Plus", "plus", "coverly_plus"],
    ["Coverly Family", "family", "coverly_family"],
  ]) {
    const s = canonicalState(payload(a, id, product), a, config);
    assert.equal(s.owned, false);
    assert.equal(s.legacy.subscription_plan, plan);
  }
});
test("lookup abort signal is set and response parsing failures are recoverable", async () => {
  await assert.rejects(
    lookup(a, config, async (_input, init) => {
      assert.ok(init?.signal);
      return new Response("invalid-json");
    }),
    /canonical_unavailable/,
  );
});

test("log-only events can retain anonymous test identities without a database target", async () => {
  const f = fixture();
  assert.equal(
    (
      await webhookHandler(
        event({ type: "TEST", app_user_id: "$RCAnonymousID:fixture" }),
        config,
        f.store,
        auth,
      )
    ).status,
    200,
  );
  assert.equal(f.applied.length, 0);
});

test("malformed JSON, absent event type and non-POST requests are rejected", async () => {
  const f = fixture();
  const malformed = new Request("https://fixture", {
    method: "POST",
    headers: { authorization: "Bearer webhook" },
    body: "{",
  });
  assert.equal(
    (await webhookHandler(malformed, config, f.store, auth)).status,
    400,
  );
  assert.equal(
    (await webhookHandler(event({ type: null }), config, f.store, auth)).status,
    400,
  );
  assert.equal(
    (
      await webhookHandler(
        new Request("https://fixture"),
        config,
        f.store,
        auth,
      )
    ).status,
    405,
  );
  assert.equal(
    (
      await reconciliationHandler(
        new Request("https://fixture"),
        config,
        f.store,
      )
    ).status,
    405,
  );
  assert.equal(
    (await reconciliationHandler(request("{"), config, f.store)).status,
    400,
  );
  assert.equal(f.applied.length, 0);
});

test("canonical legacy cancellation and billing issue preserve unexpired access", () => {
  const p: any = payload(a, "Coverly Plus", "plus");
  p.subscriber.non_subscriptions = {};
  p.subscriber.subscriptions = {
    plus: {
      purchase_date: purchaseDate,
      is_sandbox: false,
      period_type: "normal",
      unsubscribe_detected_at: purchaseDate,
    },
  };
  const cancelled = canonicalState(p, a, config);
  assert.equal(cancelled.legacy.revenuecat_status, "active");
  assert.equal(cancelled.legacy.subscription_status, "cancelled");
  p.subscriber.subscriptions.plus.billing_issues_detected_at = purchaseDate;
  assert.equal(
    canonicalState(p, a, config).legacy.subscription_status,
    "billing_issue",
  );
  p.subscriber.entitlements["Coverly Plus"].grace_period_expires_date =
    "invalid";
  assert.throws(() => canonicalState(p, a, config), /invalid_canonical_date/);
});
