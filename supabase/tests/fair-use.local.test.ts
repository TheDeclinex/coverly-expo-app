import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

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

test("Free limits and owner policy use canonical capabilities; owner usage is counted", async () => {
  await settings(1, 3);
  const free = await account(),
    owner = await account();
  await owned(owner.id);
  const f = await reserve(free);
  assert.equal(f.policy_class, "free");
  await start(free, f);
  await settle(free, f);
  assert.equal((await reserve(free)).code, "FREE_ALLOWANCE_EXHAUSTED");
  const r = await reserve(owner);
  assert.equal(r.policy_class, "owned");
  assert.equal(r.is_bypassed, false);
  assert.equal(r.limit_units, 3);
  await start(owner, r);
  assert.equal((await settle(owner, r)).ok, true);
  const row = (await allowances(owner.id)).find((r) => r.feature === "ai_scan");
  assert.equal(row.used_units, 1);
  assert.equal(row.remaining_units, 2);
  assert.equal(row.is_bypassed, false);
  await settings();
});

test("owner limit denial does not downgrade access or restrict manual inventory", async () => {
  await settings(0, 0);
  const a = await account();
  await owned(a.id);
  assert.equal((await reserve(a)).code, "OWNER_FAIR_USE_EXHAUSTED");
  assert.equal((await access(a.id)).owns_coverly, true);
  await asUser(a.id, () =>
    db.query(
      "UPDATE public.inventory_files SET name='Still editable' WHERE id=$1",
      [a.file],
    ),
  );
  assert.equal(
    (await allowances(a.id)).find((r) => r.feature === "ai_scan").blocked,
    true,
  );
  await settings();
});

test("legacy paid, tester, admin and paid support bypass are explicit but counted", async () => {
  await settings(0, 0);
  for (const fields of [
    { subscription_plan: "coverly_plus", revenuecat_status: "active" },
    { subscription_plan: "coverly_family", revenuecat_status: "active" },
    { plan: "tester" },
    { app_role: "admin" },
    { access_override_status: "active", access_override_plan: "coverly_plus" },
  ]) {
    const a = await account(fields);
    const r = await reserve(a);
    assert.equal(r.execute, true);
    assert.equal(r.is_bypassed, true);
    await start(a, r);
    await settle(a, r);
    const row = (await allowances(a.id)).find((r) => r.feature === "ai_scan");
    assert.equal(row.used_units, 1);
    assert.equal(row.remaining_units, null);
  }
  const supportFree = await account({
    access_override_status: "active",
    access_override_plan: "free",
  });
  assert.equal((await reserve(supportFree)).execute, false);
  await settings();
});

test("client reads its allowance but cannot mutate tables, old RPCs, new RPCs or another user", async () => {
  const a = await account(),
    b = await account();
  assert.equal((await allowances(a.id)).length, 2);
  await asUser(a.id, async () => {
    for (const sql of [
      "SELECT public.reserve_my_feature_usage('ai_scan','single_photo_scan','x')",
      "SELECT public.commit_my_feature_usage(gen_random_uuid())",
      "SELECT public.refund_my_feature_usage(gen_random_uuid(),'x')",
      `SELECT public.reserve_feature_usage('${b.id}','ai_scan','single_photo_scan','x','${hash}','${b.file}','{}')`,
      `SELECT public.start_feature_provider_attempt('${a.id}',gen_random_uuid(),gen_random_uuid(),'x')`,
      `SELECT public.settle_feature_usage('${a.id}',gen_random_uuid(),gen_random_uuid(),'committed',NULL)`,
      "UPDATE public.feature_usage_monthly SET used_units=0",
      "SELECT * FROM private.feature_provider_attempts",
    ])
      await assert.rejects(db.exec(sql), /permission denied/);
  });
  await assert.rejects(
    reserve(a, randomUUID(), { p_resource_id: b.file }),
    /resource_not_owned/,
  );
  await db.exec("SET ROLE service_role");
  try {
    assert.equal((await reserve(a)).execute, true);
  } finally {
    await db.exec("RESET ROLE");
  }
});

test("same key is immutable across fingerprints, operations and resources", async () => {
  const a = await account();
  const key = randomUUID();
  const r = await reserve(a, key);
  assert.equal(r.execute, true);
  assert.equal((await reserve(a, key)).code, "OPERATION_IN_PROGRESS");
  assert.equal(
    (await reserve(a, key, { p_fingerprint: "b".repeat(64) })).code,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    (await reserve(a, key, { p_operation: "multi_photo_scan" })).code,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal((await start(a, r)).execute, true);
  assert.equal((await start(a, r)).execute, false);
  const row = (
    await db.query(
      "SELECT duplicate_count,fingerprint_conflicts FROM public.feature_usage_reservations WHERE id=$1",
      [r.reservation_id],
    )
  ).rows[0];
  assert.equal(row.duplicate_count, 3);
  assert.equal(row.fingerprint_conflicts, 2);
});

test("committed and refunded replay cannot claim provider work or adjust counters twice", async () => {
  for (const outcome of ["committed", "refunded"]) {
    const a = await account();
    const key = randomUUID();
    const r = await reserve(a, key);
    await start(a, r);
    assert.equal((await settle(a, r, outcome)).ok, true);
    assert.equal((await settle(a, r, outcome)).duplicate, true);
    const replay = await reserve(a, key);
    assert.equal(replay.execute, false);
    assert.equal(
      replay.code,
      outcome === "committed" ? "OPERATION_COMPLETED" : "OPERATION_REFUNDED",
    );
    assert.equal((await start(a, r)).execute, false);
    assert.equal(
      (await settle(a, r, outcome === "committed" ? "refunded" : "committed"))
        .ok,
      false,
    );
    const row = (await allowances(a.id)).find((r) => r.feature === "ai_scan");
    assert.equal(row.used_units, outcome === "committed" ? 1 : 0);
    assert.equal(row.reserved_units, 0);
  }
});

test("last-slot reservations serialize and expiration releases capacity without reusing old operation", async () => {
  await settings(1, 1);
  const a = await account();
  const results = await Promise.all([reserve(a), reserve(a)]);
  assert.equal(results.filter((r) => r.execute).length, 1);
  const r = results.find((r) => r.execute);
  await start(a, r);
  await db.query(
    "UPDATE public.feature_usage_reservations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [r.reservation_id],
  );
  const next = await reserve(a);
  assert.equal(next.execute, true);
  assert.equal((await settle(a, r)).ok, false);
  assert.equal(
    (await settle(a, next, "committed", r.execution_token)).ok,
    false,
  );
  const row = (await allowances(a.id)).find((r) => r.feature === "ai_scan");
  assert.equal(row.reserved_units, 1);
  assert.equal(row.used_units, 0);
  await settings();
});

test("provider cost telemetry survives allowance refund and records each bounded provider call", async () => {
  const a = await account();
  const r = await reserve(a, randomUUID(), {
    p_feature: "replacement_pricing",
    p_operation: "search",
    p_resource_id: a.item,
  });
  await start(a, r, "serper_shopping");
  assert.equal(
    (
      await rpc("finish_feature_provider_attempt", {
        p_user_id: a.id,
        p_reservation_id: r.reservation_id,
        p_token: r.execution_token,
        p_attempt: "serper_shopping",
        p_success: false,
        p_http_status: 500,
      })
    ).ok,
    true,
  );
  await settle(a, r, "refunded");
  const attempts = (
    await db.query(
      "SELECT status,http_status FROM private.feature_provider_attempts WHERE reservation_id=$1",
      [r.reservation_id],
    )
  ).rows;
  assert.deepEqual(attempts, [{ status: "failed", http_status: 500 }]);
  assert.equal(
    (await allowances(a.id)).find((r) => r.feature === "replacement_pricing")
      .used_units,
    0,
  );
});

test("open and dry-run meter Free and owner requests without blocking; enforced denies", async () => {
  for (const mode of ["open", "dry_run", "enforced"])
    for (const isOwner of [false, true]) {
      await settings(0, 0, mode);
      const a = await account();
      if (isOwner) await owned(a.id);
      const r = await reserve(a);
      assert.equal(r.would_have_blocked, true);
      assert.equal(r.execute, mode !== "enforced");
      if (r.execute) {
        await start(a, r);
        await settle(a, r);
        assert.equal(
          (await allowances(a.id)).find((r) => r.feature === "ai_scan")
            .used_units,
          1,
        );
      }
    }
  await settings();
});

test("Auckland month and reset expressions cross midnight and DST correctly", async () => {
  for (const [name, expected] of [
    ["feature_usage_current_month_key", "2026-10"],
    ["feature_usage_current_month_reset_at", "2026-10-31T11:00:00.000Z"],
  ]) {
    const sql = (
      await db.query("SELECT prosrc FROM pg_proc WHERE proname=$1", [name])
    ).rows[0].prosrc.replaceAll("now()", "$1::timestamptz");
    const result = Object.values(
      (await db.query(sql, ["2026-09-30T11:00:00Z"])).rows[0],
    )[0];
    assert.equal(
      result instanceof Date ? result.toISOString() : result,
      expected,
    );
  }
  const sql = (
    await db.query(
      "SELECT prosrc FROM pg_proc WHERE proname='feature_usage_current_month_key'",
    )
  ).rows[0].prosrc.replaceAll("now()", "$1::timestamptz");
  assert.equal(
    Object.values((await db.query(sql, ["2026-09-30T10:59:59Z"])).rows[0])[0],
    "2026-09",
  );
});

test("previous-month reservations settle into their original month with no rollover", async () => {
  const a = await account();
  const r = await reserve(a);
  await start(a, r);
  await db.query(
    "UPDATE public.feature_usage_monthly SET month_key='2025-01',month_start_date='2025-01-01' WHERE user_id=$1",
    [a.id],
  );
  await db.query(
    "UPDATE public.feature_usage_reservations SET month_key='2025-01',month_start_date='2025-01-01' WHERE id=$1",
    [r.reservation_id],
  );
  await settle(a, r);
  const row = (await allowances(a.id)).find((r) => r.feature === "ai_scan");
  assert.equal(row.used_units, 0);
  assert.equal(row.remaining_units, 10);
  assert.equal(
    (
      await db.query(
        "SELECT used_units FROM public.feature_usage_monthly WHERE user_id=$1 AND month_key='2025-01'",
        [a.id],
      )
    ).rows[0].used_units,
    1,
  );
});

test("a future feature uses configuration without structural migration", async () => {
  await db.exec(
    `UPDATE public.app_settings SET usage_feature_policies=usage_feature_policies||'{"replacement_refinement":{"owner_limit":2,"free_limit":1,"resource":"item","operations":{"refine":1}}}'::jsonb WHERE id=1`,
  );
  const a = await account();
  const r = await reserve(a, randomUUID(), {
    p_feature: "replacement_refinement",
    p_operation: "refine",
    p_resource_id: a.item,
  });
  assert.equal(r.execute, true);
  await db.exec(
    "UPDATE public.app_settings SET usage_feature_policies=usage_feature_policies-'replacement_refinement' WHERE id=1",
  );
});

test("upgrade preserves committed history and releases pre-upgrade reservations", async () => {
  const rows = (
    await db.query(
      "SELECT idempotency_key,status,ledger_version FROM public.feature_usage_reservations WHERE user_id=$1 ORDER BY idempotency_key",
      [historicUser],
    )
  ).rows;
  assert.deepEqual(rows, [
    {
      idempotency_key: "old-committed",
      status: "committed",
      ledger_version: 1,
    },
    { idempotency_key: "old-reserved", status: "expired", ledger_version: 1 },
  ]);
  const monthly = (
    await db.query(
      "SELECT used_units,reserved_units FROM public.feature_usage_monthly WHERE user_id=$1",
      [historicUser],
    )
  ).rows[0];
  assert.equal(monthly.used_units, 1);
  assert.equal(monthly.reserved_units, 0);
  await asUser(historicUser, async () => {
    await assert.rejects(
      db.exec("UPDATE public.app_settings SET entitlement_mode='open'"),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("TRUNCATE public.app_settings"),
      /permission denied/,
    );
  });
});
