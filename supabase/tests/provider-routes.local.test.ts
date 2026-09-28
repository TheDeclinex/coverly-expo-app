import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { createHandler as refinementHandler } from "../functions/replacement-refinement-v2/handler.ts";
import { createHandler as voiceHandler } from "../functions/voice-describe/handler.ts";
import { createHandler as commandHandler } from "../functions/voice-command/handler.ts";
import { createHandler as barcodeHandler } from "../functions/barcode-verify/handler.ts";
import { createHandler as claimHandler } from "../functions/generate-claim-pack/handler.ts";
import { protectedRoute } from "../functions/_shared/provider-controls.ts";

globalThis.fetch = async () => {
  throw new Error("Live network prohibited");
};

const modulePath = process.env.COVERLY_PGLITE_MODULE;
assert.ok(
  modulePath && isAbsolute(modulePath),
  "Set COVERLY_PGLITE_MODULE to a local PGlite dist/index.js; see billing docs.",
);
const { PGlite } = await import(pathToFileURL(modulePath).href);
let historicUser: string;
const db = new PGlite(); // In-memory only. Never accepts a connection string.
const readMigration = (name: string) =>
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const baseline = readMigration(
  "20260419000000_coverly_production_baseline.sql",
);
const markets = readMigration("20260717000000_global_market_foundation.sql");
const propertyMigration = readMigration(
  "20260717010000_property_limits_by_plan.sql",
);
const migration = readMigration(
  "20260927190405_durable_ownership_access_foundation.sql",
);

function originalFunction(sql: string, name: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, name);
  const body = sql.slice(start);
  const delimiter = body.match(/AS (\$[a-z_]*\$)/i)?.[1];
  assert.ok(delimiter, name);
  const end = body.indexOf(
    `${delimiter};`,
    body.indexOf(delimiter) + delimiter.length,
  );
  assert.notEqual(end, -1, name);
  return body.slice(0, end + delimiter.length + 1);
}

before(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT jsonb_build_object('sub', auth.uid(), 'email', 'fixture@example.test') $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
  `);
  // Actual existing table definitions and relevant migrations; minimal Auth fixture.
  for (const name of ["user_profiles", "inventory_files", "app_settings"]) {
    const sql = baseline.match(
      new RegExp(`CREATE TABLE "public"\\."${name}" \\([\\s\\S]*?\\n\\);`),
    )?.[0];
    assert.ok(sql, name);
    // Only the historical file-number sequence is needed by these definitions.
    if (name === "inventory_files")
      await db.exec("CREATE SEQUENCE public.inventory_files_file_number_seq");
    await db.exec(sql);
    await db.exec(`ALTER TABLE public.${name} ADD PRIMARY KEY (id)`);
  }
  await db.exec(
    "INSERT INTO public.app_settings(id, entitlement_mode) VALUES (1, 'enforced')",
  );
  await db.exec(originalFunction(baseline, "get_entitlement_mode"));
  await db.exec(
    readMigration("20260709000000_revenuecat_webhook_hardening.sql"),
  );
  await db.exec(propertyMigration);
  // Apply the real country table/validation trigger, not the unrelated item/claim migrations.
  await db.exec(
    markets.slice(0, markets.indexOf("ALTER TABLE public.inventory_items")) +
      "\nCOMMIT;",
  );
  await db.exec(originalFunction(markets, "create_my_property"));
  await db.exec(originalFunction(markets, "update_my_property"));
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.create_my_property(text,text,text,numeric,text,text,text) TO authenticated",
  );
  await db.exec(`
    ALTER TABLE public.inventory_files ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_inventory ON public.inventory_files TO authenticated
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_files TO authenticated;
    GRANT USAGE ON SEQUENCE public.inventory_files_file_number_seq TO authenticated;
    REVOKE ALL ON public.user_profiles FROM PUBLIC, anon, authenticated;
  `);
  const settings = readMigration("20260622010000_profile_settings_v1.sql");
  await db.exec(originalFunction(settings, "load_my_settings"));
  await db.exec(originalFunction(settings, "update_my_profile"));
  await db.exec(
    readMigration("20260623010000_feature_usage_monthly_accounting.sql"),
  );
  await db.exec(
    readMigration("20260623020000_fix_reserve_usage_feature_ambiguity.sql"),
  );
  // Hosted Supabase may grant tables broadly by default. The migration must
  // narrow those defaults, not assume a pristine PostgreSQL privilege setup.
  await db.exec(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role",
  );
  await db.exec(migration);
  await db.exec(
    readMigration("20260927232224_revenuecat_ownership_reconciliation.sql"),
  );
  await db.exec(
    "CREATE TABLE public.inventory_items(id text PRIMARY KEY, file_id text REFERENCES public.inventory_files(id))",
  );
  historicUser = await user();
  await asUser(historicUser, async () => {
    const old = (
      await db.query(
        "SELECT public.reserve_my_feature_usage('ai_scan','single_photo_scan','old-committed') AS r",
      )
    ).rows[0].r;
    await db.query("SELECT public.commit_my_feature_usage($1)", [
      old.reservation_id,
    ]);
    await db.query(
      "SELECT public.reserve_my_feature_usage('ai_scan','single_photo_scan','old-reserved')",
    );
  });
  await db.exec(
    "GRANT UPDATE, TRUNCATE ON public.app_settings TO authenticated",
  );
  await db.exec(
    readMigration("20260928073851_hardened_fair_use_accounting.sql"),
  );
  for (const name of ["claim_packs", "claim_pack_tokens"]) {
    const sql = baseline.match(
      new RegExp('CREATE TABLE "public"\\."' + name + '" \\([\\s\\S]*?\\n\\);'),
    )?.[0];
    assert.ok(sql, name);
    await db.exec(sql);
    await db.exec(
      `ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.${name} TO authenticated,anon,service_role`,
    );
  }
  await db.exec(
    readMigration("20260928180830_secure_provider_and_claim_routes.sql"),
  );
});
after(async () => {
  await db.close();
});

async function user(fields: Record<string, unknown> = {}) {
  const id = randomUUID();
  await db.query("INSERT INTO auth.users VALUES ($1, $2)", [
    id,
    `${id}@example.test`,
  ]);
  const values = { id, email: `${id}@example.test`, ...fields };
  const keys = Object.keys(values);
  await db.query(
    `INSERT INTO public.user_profiles (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(values),
  );
  return id;
}
async function owned(id: string, fields: Record<string, unknown> = {}) {
  const values = {
    user_id: id,
    ownership_status: "owned",
    revenuecat_entitlement_id: "coverly_owned",
    revenuecat_product_id: "test.ownership",
    revenuecat_customer_id: id,
    ownership_source: "revenuecat",
    ownership_environment: "production",
    acquired_at: "2026-01-01T00:00:00Z",
    last_verified_at: "2026-01-02T00:00:00Z",
    ...fields,
  };
  const keys = Object.keys(values);
  await db.query(
    `INSERT INTO public.user_ownership (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(values),
  );
}
async function access(id: string) {
  return (
    await db.query("SELECT private.resolve_coverly_access($1) AS access", [id])
  ).rows[0].access;
}
async function asUser(id: string, run: () => Promise<unknown>) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("SET ROLE authenticated");
  try {
    return await run();
  } finally {
    await db.exec("RESET ROLE");
    await db.exec("RESET request.jwt.claim.sub");
  }
}
async function createProperty() {
  return await db.query(
    "SELECT * FROM public.create_my_property(p_name => 'Home', p_country_code => 'AU', p_contents_sum_insured => 10000)",
  );
}

async function account(fields: Record<string, unknown> = {}) {
  const id = await user(fields);
  await asUser(id, createProperty);
  const file = (
    await db.query("SELECT id FROM public.inventory_files WHERE user_id=$1", [
      id,
    ])
  ).rows[0].id;
  const item = randomUUID();
  await db.query("INSERT INTO public.inventory_items VALUES($1,$2)", [
    item,
    file,
  ]);
  return { id, file, item };
}
async function rpc(name: string, args: Record<string, unknown>) {
  assert.match(name, /^[a-z_]+$/);
  const keys = Object.keys(args);
  const values = Object.values(args).map((v) =>
    v && typeof v === "object" ? JSON.stringify(v) : v,
  );
  return (
    await db.query(
      `SELECT public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) AS r`,
      values,
    )
  ).rows[0].r;
}
const hash = "a".repeat(64);
const reserve = (
  a: any,
  key = randomUUID(),
  extra: Record<string, unknown> = {},
) =>
  rpc("reserve_feature_usage", {
    p_user_id: a.id,
    p_feature: "ai_scan",
    p_operation: "single_photo_scan",
    p_key: key,
    p_fingerprint: hash,
    p_resource_id: a.file,
    p_metadata: { imageCount: 1 },
    ...extra,
  });
const start = (a: any, r: any, attempt = "openai_scan") =>
  rpc("start_feature_provider_attempt", {
    p_user_id: a.id,
    p_reservation_id: r.reservation_id,
    p_token: r.execution_token,
    p_attempt: attempt,
  });
const settle = (
  a: any,
  r: any,
  outcome = "committed",
  token = r.execution_token,
) =>
  rpc("settle_feature_usage", {
    p_user_id: a.id,
    p_reservation_id: r.reservation_id,
    p_token: token,
    p_outcome: outcome,
    p_reason: "fixture",
  });
async function allowances(id: string) {
  let rows: any[] = [];
  await asUser(id, async () => {
    rows = (await db.query("SELECT * FROM public.load_my_usage_allowances()"))
      .rows;
  });
  return rows;
}
async function settings(free = 10, owner = 10, mode = "enforced") {
  await db.query(
    "UPDATE public.app_settings SET free_ai_scan_monthly_limit=$1,entitlement_mode=$2,usage_feature_policies=jsonb_set(usage_feature_policies,'{ai_scan,owner_limit}',to_jsonb($3::int)) WHERE id=1",
    [free, mode, owner],
  );
}

type Route =
  | "replacement-refinement-v2"
  | "voice-describe"
  | "voice-command"
  | "barcode-verify"
  | "generate-claim-pack"
  | "replacement-search-refine";
async function fixture(
  route: Route,
  owner = false,
  fields: Record<string, unknown> = {},
) {
  const a = await account(fields);
  if (owner) await owned(a.id);
  const calls: any[] = [];
  const network: any[] = [];
  const writes: any[] = [];
  const state = {
    auth: true,
    own: true,
    provider: "success",
    rpcFailure: "",
    failSettlement: false,
    renderFails: false,
    renderCount: 0,
    gate: null as Promise<void> | null,
    signFails: false,
    loseCheckpoint: false,
  };
  const itemRow = {
    id: a.item,
    file_id: a.file,
    name: "Chair",
    category: "Furniture",
    room_id: null,
    quantity: 1,
    estimated_price: 100,
    estimated_currency: "NZD",
  };
  const fileRow = {
    id: a.file,
    user_id: a.id,
    name: "Home",
    country_code: "NZ",
    currency_code: "NZD",
  };
  const client = (url: string, key: string, options?: any) => ({
    auth: {
      getUser: async () => ({
        data: {
          user: state.auth ? { id: a.id, email: "owner@example.test" } : null,
        },
        error: null,
      }),
    },
    from(table: string) {
      let inserted: any = null;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        insert: (row: any) => {
          inserted = row;
          writes.push({ table, row });
          return chain;
        },
        update: () => chain,
        single: async () => ({
          data: inserted
            ? { id: "pack-1" }
            : !state.own
              ? null
              : table === "inventory_items"
                ? itemRow
                : fileRow,
          error: null,
        }),
        maybeSingle: async () => ({
          data: state.own ? fileRow : null,
          error: null,
        }),
        then: (resolve: any) =>
          Promise.resolve({
            data: table === "inventory_items" && state.own ? [itemRow] : [],
            error: null,
          }).then(resolve),
      };
      return chain;
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          writes.push({ bucket, path });
          return { error: null };
        },
        remove: async () => ({ error: null }),
        download: async () => ({ data: new Blob(), error: null }),
        createSignedUrl: async (path: string) => ({
          data: state.signFails
            ? null
            : { signedUrl: `https://fixture/${path}?fresh=${writes.length}` },
          error: state.signFails ? { message: "fixture" } : null,
        }),
      }),
    },
    async rpc(name: string, args: any) {
      assert.equal(key, "service");
      assert.equal(options?.global, undefined);
      assert.equal(args.p_user_id, a.id, "identity must be from Auth");
      calls.push({ name, args });
      if (
        name === state.rpcFailure ||
        (state.failSettlement && name === "settle_feature_usage")
      )
        return { data: null, error: { message: "fixture" } };
      try {
        const data = await rpc(name, args);
        if (
          state.loseCheckpoint &&
          name === "provider_route_step" &&
          args.p_action === "completed"
        )
          return { data: null, error: { message: "lost acknowledgement" } };
        return { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  });
  const env = (key: string) =>
    (
      ({
        SUPABASE_URL: "https://fixture",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        OPENAI_API_KEY: "mock",
        RESEND_API_KEY: "mock",
      }) as any
    )[key];
  const fetcher: typeof fetch = async (url, init) => {
    network.push({ url: String(url), init });
    if (state.gate) await state.gate;
    if (state.provider === "throw") throw new Error("mock timeout");
    if (state.provider === "error")
      return Response.json({ error: { message: "mock" } }, { status: 500 });
    if (state.provider === "invalid") return new Response("invalid");
    if (String(url).includes("transcriptions")) return new Response("A chair");
    if (String(url).includes("upcitemdb"))
      return Response.json({ code: "OK", items: [{ title: "Chair" }] });
    if (String(url).includes("emails")) return Response.json({ id: "mail-1" });
    if (route === "replacement-refinement-v2")
      return Response.json({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  searchTerm: "Chair",
                  brand: "",
                  model: "",
                  additionalDetails: "",
                  suggestedChips: [],
                }),
              },
            ],
          },
        ],
      });
    if (route === "voice-command")
      return Response.json({
        choices: [{ message: { content: '{"intent":"unknown"}' } }],
      });
    if (route === "barcode-verify")
      return Response.json({
        choices: [
          {
            message: {
              content:
                '{"found":true,"type":"barcode","value":"123456789012","confidence":0.9}',
            },
          },
        ],
      });
    return Response.json({
      output: [{ content: [{ text: '{"name":"Chair"}' }] }],
    });
  };
  const handlers: any = {
    "replacement-refinement-v2": refinementHandler,
    "voice-describe": voiceHandler,
    "voice-command": commandHandler,
    "barcode-verify": barcodeHandler,
  };
  const handler =
    route === "generate-claim-pack"
      ? claimHandler(client as any, env, {} as any, fetcher, async () => {
          state.renderCount++;
          if (state.renderFails) throw new Error("render failed");
          if (state.gate) await state.gate;
          return new Uint8Array([37, 80, 68, 70]);
        })
      : route === "replacement-search-refine"
        ? protectedRoute(
            route,
            () => async () => {
              throw new Error("legacy called");
            },
            client as any,
            env,
            fetcher,
          )
        : handlers[route](client, env, fetcher);
  const body = () =>
    route === "generate-claim-pack"
      ? {
          propertyId: a.file,
          clientDraftId: "draft-1",
          selectedItemIds: [a.item],
          selectedRoomIds: [],
          scope: "whole_property",
        }
      : route === "replacement-refinement-v2"
        ? {
            itemId: a.item,
            draft: {
              searchTerm: "Chair",
              brand: "",
              model: "",
              additionalDetails: "",
            },
            usageIdempotencyKey: "refine-1",
          }
        : route === "barcode-verify"
          ? { itemId: a.item, barcode: "123456789012" }
          : {
              audioBase64: btoa("audio"),
              mimeType: "audio/mp4",
              ext: "m4a",
              itemId: a.item,
            };
  const invoke = (input: any = body(), auth = true) =>
    handler(
      new Request("https://fixture/function", {
        method: "POST",
        headers: auth ? { authorization: "Bearer mock" } : {},
        body: JSON.stringify(input),
      }),
    );
  return { a, state, calls, network, writes, body, invoke };
}

for (const route of [
  "replacement-refinement-v2",
  "voice-describe",
  "voice-command",
  "barcode-verify",
  "generate-claim-pack",
] as Route[]) {
  test(`${route}: Auth and SQL attribution block invalid callers and cross-user context`, async () => {
    const f = await fixture(route, true);
    assert.equal((await f.invoke(f.body(), false)).status, 401);
    f.state.auth = false;
    assert.equal((await f.invoke()).status, 401);
    assert.equal(f.network.length, 0);
    f.state.auth = true;
    const other = await account();
    const body = {
      ...f.body(),
      ...(route === "generate-claim-pack"
        ? { propertyId: other.file }
        : { itemId: other.item }),
      userId: other.id,
    };
    const res = await f.invoke(body);
    assert.equal(res.status, 403);
    assert.equal(f.network.length, 0);
    assert.equal(f.state.renderCount, 0);
  });
  test(`${route}: bounds and unavailable accounting prevent all provider work`, async () => {
    const f = await fixture(route, true);
    const body =
      route === "generate-claim-pack"
        ? { ...f.body(), selectedItemIds: Array(1001).fill(f.a.item) }
        : route === "replacement-refinement-v2"
          ? { ...f.body(), draft: { searchTerm: "x".repeat(121) } }
          : route === "barcode-verify"
            ? { ...f.body(), barcode: "https://example.test" }
            : { ...f.body(), audioBase64: "%%%=", mimeType: "text/html" };
    assert.equal((await f.invoke(body)).status, 400);
    assert.equal(f.calls.length, 0);
    f.state.rpcFailure = "begin_provider_route";
    assert.equal((await f.invoke()).status, 503);
    assert.equal(f.network.length, 0);
    assert.equal(f.state.renderCount, 0);
  });
  test(`${route}: concurrent duplicate obtains one execution and rate counters count it`, async () => {
    const f = await fixture(route, true);
    let release!: () => void;
    f.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let early: Response | undefined;
    const first = f.invoke().then((response: Response) => {
      early = response;
      return response;
    });
    // Wait for the actual mocked provider or renderer, without network or timers.
    while (!f.network.length && !f.state.renderCount && !early)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      early,
      undefined,
      early ? await early.clone().text() : undefined,
    );
    const duplicate = await f.invoke();
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).errorCode, "OPERATION_IN_PROGRESS");
    release();
    const result = await first;
    assert.equal(result.status, 200, await result.clone().text());
    const count = f.network.length;
    const replay = await f.invoke();
    assert.equal(replay.status, route === "generate-claim-pack" ? 200 : 409);
    assert.equal(f.network.length, count);
    assert.equal(f.state.renderCount, route === "generate-claim-pack" ? 1 : 0);
  });
}

test("refinement: Free and owner configured quotas count and exhaust with distinct codes", async () => {
  for (const owner of [false, true]) {
    const f = await fixture("replacement-refinement-v2", owner);
    await db.exec(
      `UPDATE public.app_settings SET usage_feature_policies=jsonb_set(jsonb_set(usage_feature_policies,'{replacement_refinement,free_limit}','1'),'{replacement_refinement,owner_limit}','2')`,
    );
    const limit = owner ? 2 : 1;
    for (let i = 0; i < limit; i++)
      assert.equal(
        (await f.invoke({ ...f.body(), usageIdempotencyKey: `r-${i}` })).status,
        200,
      );
    const denied = await f.invoke({
      ...f.body(),
      usageIdempotencyKey: "denied",
    });
    assert.equal(denied.status, owner ? 429 : 402);
    assert.equal(
      (await denied.json()).errorCode,
      owner ? "OWNER_FAIR_USE_EXHAUSTED" : "FREE_ALLOWANCE_EXHAUSTED",
    );
    assert.equal(f.network.length, limit);
    const row = (await allowances(f.a.id)).find(
      (r) => r.feature === "replacement_refinement",
    );
    assert.equal(row.used_units, limit);
    assert.equal(row.remaining_units, 0);
  }
});
test("refinement: immutable key rejects changed draft; failure refunds and preserves attempts; settlement fails visibly", async () => {
  const f = await fixture("replacement-refinement-v2");
  f.state.provider = "error";
  assert.equal((await f.invoke()).status, 502);
  assert.equal(
    (await allowances(f.a.id)).find(
      (r) => r.feature === "replacement_refinement",
    ).used_units,
    0,
  );
  assert.equal((await f.invoke()).status, 409);
  const conflict = await f.invoke({
    ...f.body(),
    draft: { searchTerm: "Different" },
  });
  assert.equal((await conflict.json()).errorCode, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.network.length, 1);
  const attempt = await db.query(
    "SELECT a.status FROM private.feature_provider_attempts a JOIN public.feature_usage_reservations r ON r.id=a.reservation_id WHERE r.user_id=$1",
    [f.a.id],
  );
  assert.equal(attempt.rows[0].status, "failed");
  const g = await fixture("replacement-refinement-v2");
  g.state.failSettlement = true;
  const response = await g.invoke();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).errorCode, "USAGE_SETTLEMENT_FAILED");
  assert.equal(
    g.calls.filter((c) => c.name === "settle_feature_usage").length,
    1,
  );
});
test("refinement: open and dry_run count beyond limits, enforced prevents provider call", async () => {
  for (const mode of ["open", "dry_run", "enforced"]) {
    await db.query(
      "UPDATE public.app_settings SET entitlement_mode=$1, usage_feature_policies=jsonb_set(usage_feature_policies,'{replacement_refinement,free_limit}','0')",
      [mode],
    );
    const f = await fixture("replacement-refinement-v2");
    const r = await f.invoke();
    assert.equal(r.status, mode === "enforced" ? 402 : 200);
    assert.equal(f.network.length, mode === "enforced" ? 0 : 1);
  }
  await db.exec(
    `UPDATE public.app_settings SET entitlement_mode='enforced',usage_feature_policies=jsonb_set(usage_feature_policies,'{replacement_refinement,free_limit}','5')`,
  );
});
test("legacy refinement: authenticated compatibility error cannot call the provider", async () => {
  const f = await fixture("replacement-search-refine");
  const response = await f.invoke();
  assert.equal(response.status, 410);
  assert.equal(f.network.length, 0);
  assert.equal(f.calls.length, 0);
});

test("voice and barcode: shared concurrency, minute/hour/day throttles apply even in open mode", async () => {
  const f = await fixture("voice-describe");
  const begin = (route: string, key: string) =>
    rpc("begin_provider_route", {
      p_user_id: f.a.id,
      p_route: route,
      p_key: key,
      p_fingerprint: hash,
    });
  const one = await begin("voice-describe", "one");
  const two = await begin("voice-command", "two");
  assert.equal(one.execute, true);
  assert.equal(two.execute, true);
  assert.equal((await begin("voice-command", "three")).code, "RATE_LIMITED");
  for (const r of [one, two])
    await rpc("provider_route_step", {
      p_user_id: f.a.id,
      p_job_id: r.job_id,
      p_token: r.token,
      p_action: "failed",
    });
  for (const bucket of ["voice", "barcode"])
    for (const period of ["minute", "hour", "day"]) {
      const saved = (
        await db.query("SELECT provider_route_limits FROM public.app_settings")
      ).rows[0].provider_route_limits;
      const cfg = {
        ...saved,
        [bucket]: {
          minute: 100,
          hour: 100,
          day: 100,
          concurrent: 2,
          [period]: 1,
        },
      };
      await db.query(
        "UPDATE public.app_settings SET provider_route_limits=$1,entitlement_mode='open'",
        [JSON.stringify(cfg)],
      );
      const g = await fixture(
        bucket === "voice" ? "voice-describe" : "barcode-verify",
      );
      assert.equal((await g.invoke()).status, 200);
      const denied = await g.invoke({
        ...g.body(),
        usageIdempotencyKey: "another",
      });
      assert.equal(denied.status, 429);
      assert.equal((await denied.json()).errorCode, "RATE_LIMITED");
      assert.equal(g.network.length, bucket === "voice" ? 2 : 1);
      await db.query(
        "UPDATE public.app_settings SET provider_route_limits=$1,entitlement_mode='enforced'",
        [JSON.stringify(saved)],
      );
    }
});
test("barcode: invalid formats/signatures do not invoke providers; optional vision and lookup both audited", async () => {
  const f = await fixture("barcode-verify");
  for (const barcode of ["123", "abcd", "123456789012345", 42])
    assert.equal((await f.invoke({ ...f.body(), barcode })).status, 400);
  assert.equal(
    (await f.invoke({ itemId: f.a.item, imageBase64: btoa("not jpeg") }))
      .status,
    400,
  );
  assert.equal(f.network.length, 0);
  const response = await f.invoke({
    itemId: f.a.item,
    imageBase64: btoa(String.fromCharCode(255, 216, 255, 0)),
  });
  assert.equal(response.status, 200);
  assert.equal(f.network.length, 2);
  const rows = await db.query(
    "SELECT a.status FROM private.provider_route_attempts a JOIN private.provider_route_runs r ON r.id=a.run_id WHERE r.user_id=$1",
    [f.a.id],
  );
  assert.equal(rows.rows.length, 2);
  assert.ok(rows.rows.every((r) => r.status === "succeeded"));
});

test("claim: canonical Free/revoked denied; owner/legacy/admin/tester/support paid allowed; tokens never grant access", async () => {
  for (const kind of [
    "free",
    "revoked",
    "owner",
    "plus",
    "family",
    "admin",
    "tester",
    "support-paid",
    "support-free",
  ]) {
    const fields =
      kind === "admin"
        ? { app_role: "admin" }
        : kind === "tester"
          ? { plan: "tester" }
          : kind === "plus" || kind === "family"
            ? { plan: `coverly_${kind}`, subscription_status: "active" }
            : kind.startsWith("support")
              ? {
                  access_override_plan:
                    kind === "support-paid" ? "coverly_plus" : "free",
                  access_override_status: "active",
                  access_override_reason: "Support",
                }
              : {};
    const f = await fixture(
      "generate-claim-pack",
      kind === "owner" || kind === "revoked",
      fields,
    );
    if (kind === "revoked")
      await db.query(
        "UPDATE public.user_ownership SET ownership_status='revoked',revoked_at=now() WHERE user_id=$1",
        [f.a.id],
      );
    await db.query(
      "INSERT INTO public.claim_pack_tokens(user_id,user_email) VALUES($1,'fixture@example.test')",
      [f.a.id],
    );
    const denied = ["free", "revoked", "support-free"].includes(kind);
    const r = await f.invoke();
    assert.equal(
      r.status,
      denied ? 403 : 200,
      kind + ": " + (await r.clone().text()),
    );
    assert.equal(f.state.renderCount, denied ? 0 : 1);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM public.inventory_items WHERE file_id=$1",
          [f.a.file],
        )
      ).rows[0].n,
      1,
    );
  }
});
test("claim: failure retries, completed retry refreshes link without PDF/storage/email duplication", async () => {
  const f = await fixture("generate-claim-pack", true);
  f.state.renderFails = true;
  assert.equal((await f.invoke()).status, 500);
  f.state.renderFails = false;
  assert.equal((await f.invoke()).status, 200);
  const writes = f.writes.length;
  const emails = f.network.length;
  const replay = await f.invoke();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).reused, true);
  assert.equal(f.writes.length, writes);
  assert.equal(f.network.length, emails);
  const conflict = await f.invoke({ ...f.body(), claimNote: "changed" });
  assert.equal((await conflict.json()).errorCode, "IDEMPOTENCY_CONFLICT");
  await db.query(
    "UPDATE public.user_ownership SET ownership_status='revoked',revoked_at=now() WHERE user_id=$1",
    [f.a.id],
  );
  assert.equal((await f.invoke()).status, 403);
});
test("claim: signed URL failure after checkpoint remains reusable and does not mark ready pack failed", async () => {
  const f = await fixture("generate-claim-pack", true);
  f.state.signFails = true;
  assert.equal((await f.invoke()).status, 500);
  f.state.signFails = false;
  assert.equal((await f.invoke()).status, 200);
  assert.equal(f.state.renderCount, 1);
  assert.equal(f.network.length, 0);
});
test("lease expiry: stale worker cannot write, retry key cannot reclaim uncertain execution", async () => {
  const f = await fixture("voice-describe");
  const claim = await rpc("begin_provider_route", {
    p_user_id: f.a.id,
    p_route: "voice-describe",
    p_key: "expired",
    p_fingerprint: hash,
  });
  await db.query(
    "UPDATE private.provider_route_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",
    [claim.job_id],
  );
  assert.equal(
    (
      await rpc("provider_route_step", {
        p_user_id: f.a.id,
        p_job_id: claim.job_id,
        p_token: claim.token,
        p_action: "start_attempt",
        p_attempt: "late",
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await rpc("begin_provider_route", {
        p_user_id: f.a.id,
        p_route: "voice-describe",
        p_key: "expired",
        p_fingerprint: hash,
      })
    ).code,
    "OPERATION_EXPIRED",
  );
});
test("security: authenticated cannot self-grant tokens, forge packs, mutate usage or call new server RPCs", async () => {
  const f = await account();
  await asUser(f.id, async () => {
    for (const sql of [
      "INSERT INTO public.claim_pack_tokens(user_id,user_email) VALUES(auth.uid(),'x')",
      "UPDATE public.claim_pack_tokens SET status='available'",
      "TRUNCATE public.claim_pack_tokens",
      "INSERT INTO public.claim_packs(user_id,user_email,pack_ref) VALUES(auth.uid(),'x','x')",
      "UPDATE public.feature_usage_monthly SET used_units=0",
      "SELECT public.begin_provider_route(auth.uid(),'voice-describe','x',repeat('a',64))",
      "SELECT public.provider_route_step(auth.uid(),gen_random_uuid(),gen_random_uuid(),'completed')",
      "SELECT public.reserve_feature_usage(auth.uid(),'replacement_refinement','refine','x',repeat('a',64),'x')",
    ])
      await assert.rejects(db.exec(sql), /permission denied/);
    assert.ok(
      Array.isArray(
        (await db.query("SELECT * FROM public.load_my_usage_allowances()"))
          .rows,
      ),
    );
  });
});

test("claim storage references cannot escape user/property or fetch external URLs", async () => {
  const { ownedStoragePath } =
    await import("../functions/_shared/owned-storage.ts");
  const parse = (s: string) =>
    ownedStoragePath(
      s,
      "https://project.supabase.co",
      "inventory-photos",
      "user",
      "file",
    );
  assert.equal(parse("user/file/image.jpg"), "user/file/image.jpg");
  assert.equal(
    parse(
      "https://project.supabase.co/storage/v1/object/sign/inventory-photos/user/file/image.jpg?token=old",
    ),
    "user/file/image.jpg",
  );
  for (const s of [
    "other/file/image.jpg",
    "user/other/image.jpg",
    "user/file/../other.jpg",
    "user/file/\\other.jpg",
    "https://evil.test/image.jpg",
    "http://169.254.169.254/latest/meta-data",
    "https://project.supabase.co/storage/v1/object/sign/claim-packs/user/file/image.jpg",
    "https://project.supabase.co/storage/v1/object/sign/inventory-photos/user/file/%2e%2e/other.jpg",
  ])
    assert.equal(parse(s), null, s);
});
test("claim revocation while rendering prevents upload and email", async () => {
  const f = await fixture("generate-claim-pack", true);
  let release!: () => void;
  f.state.gate = new Promise<void>((resolve) => (release = resolve));
  const operation = f.invoke();
  while (!f.state.renderCount)
    await new Promise((resolve) => setImmediate(resolve));
  await db.query(
    "UPDATE public.user_ownership SET ownership_status='revoked',revoked_at=now() WHERE user_id=$1",
    [f.a.id],
  );
  release();
  assert.ok((await operation).status >= 400);
  assert.equal(f.writes.length, 0);
  assert.equal(f.network.length, 0);
});
test("claim uncertain checkpoint cannot release completed work or resend email", async () => {
  const f = await fixture("generate-claim-pack", true);
  f.state.loseCheckpoint = true;
  const denied = await f.invoke();
  assert.ok(denied.status >= 400);
  assert.equal(f.writes.length, 2);
  assert.equal(f.network.length, 0);
  f.state.loseCheckpoint = false;
  const replay = await f.invoke();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).reused, true);
  assert.equal(f.state.renderCount, 1);
  assert.equal(f.network.length, 0);
});
test("provider-attempt admission failure cannot be swallowed into success or call any provider", async () => {
  for (const route of [
    "voice-describe",
    "voice-command",
    "barcode-verify",
    "replacement-refinement-v2",
  ] as Route[]) {
    const f = await fixture(route);
    f.state.rpcFailure = "provider_route_step";
    const r = await f.invoke();
    assert.equal(r.status, 503);
    assert.equal(f.network.length, 0);
  }
});
test("voice/barcode provider errors count attempts; failed key does not invoke provider again", async () => {
  for (const route of [
    "voice-describe",
    "voice-command",
    "barcode-verify",
  ] as Route[]) {
    const f = await fixture(route);
    f.state.provider = "error";
    const r = await f.invoke();
    assert.equal((await r.json()).success, false);
    assert.equal(f.network.length, 1);
    assert.equal((await f.invoke()).status, 409);
    assert.equal(f.network.length, 1);
    const attempts = await db.query(
      "SELECT a.status FROM private.provider_route_attempts a JOIN private.provider_route_runs r ON r.id=a.run_id WHERE r.user_id=$1",
      [f.a.id],
    );
    assert.equal(attempts.rows[0].status, "failed");
  }
});
test("refinement: malformed/provider exception responses refund customer units and retain provider attempts", async () => {
  for (const provider of ["invalid", "throw"]) {
    const f = await fixture("replacement-refinement-v2");
    f.state.provider = provider;
    assert.equal((await f.invoke()).status, 502);
    const row = (await allowances(f.a.id)).find(
      (r) => r.feature === "replacement_refinement",
    );
    assert.equal(row.used_units, 0);
    assert.equal(row.reserved_units, 0);
    assert.equal(f.network.length, 1);
  }
});
test("claim retry fences the old token and every failure retry consumes rate capacity", async () => {
  const f = await fixture("generate-claim-pack", true);
  const args = {
    p_user_id: f.a.id,
    p_route: "generate-claim-pack",
    p_key: "retry",
    p_fingerprint: hash,
    p_resource_id: f.a.file,
  };
  const first = await rpc("begin_provider_route", args);
  await rpc("provider_route_step", {
    p_user_id: f.a.id,
    p_job_id: first.job_id,
    p_token: first.token,
    p_action: "failed",
  });
  const second = await rpc("begin_provider_route", args);
  assert.equal(second.execute, true);
  assert.notEqual(first.token, second.token);
  assert.equal(
    (
      await rpc("provider_route_step", {
        p_user_id: f.a.id,
        p_job_id: first.job_id,
        p_token: first.token,
        p_action: "completed",
        p_result: { success: true },
      })
    ).ok,
    false,
  );
  await rpc("provider_route_step", {
    p_user_id: f.a.id,
    p_job_id: second.job_id,
    p_token: second.token,
    p_action: "failed",
  });
  assert.equal((await rpc("begin_provider_route", args)).code, "RATE_LIMITED");
});
test("legacy refinement keys suppress identical input without requiring a mobile update", async () => {
  const f = await fixture("replacement-refinement-v2");
  const { usageIdempotencyKey, ...body } = f.body() as any;
  assert.equal((await f.invoke(body)).status, 200);
  assert.equal((await f.invoke(body)).status, 409);
  assert.equal(f.network.length, 1);
});
