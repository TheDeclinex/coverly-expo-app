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

test("Free capabilities default safely without granting durable ownership", async () => {
  const a = await access(await user());
  assert.equal(a.access_class, "free");
  assert.equal(a.owns_coverly, false);
  assert.equal(a.ownership_status, "none");
  assert.equal(a.ownership_verification, "not_owned");
  assert.equal(a.property_limit, 1);
  assert.equal(a.can_export_claim_pack, false);
  assert.equal(a.ai_policy_class, "free");
  assert.equal(a.ai_requires_metering, true);
  assert.equal(a.can_manage_inventory, true);
  assert.equal(a.can_access_evidence, true);
});

test("verified ownership is durable, limited to five properties and independently metered", async () => {
  const id = await user({
    subscription_plan: "coverly_family",
    subscription_status: "active",
  });
  await owned(id);
  const a = await access(id);
  assert.equal(a.access_class, "owner");
  assert.equal(a.owns_coverly, true);
  assert.equal(a.ownership_verification, "verified");
  assert.equal(a.property_limit, 5);
  assert.equal(a.can_export_claim_pack, true);
  assert.equal(a.ai_policy_class, "owned");
  assert.equal(a.ai_requires_metering, true);
  assert.equal(a.effective_plan, "coverly_owned");
});

test("revocation defeats stale subscription and plan fields", async () => {
  const id = await user({
    plan: "coverly_family",
    subscription_plan: "coverly_family",
    subscription_status: "active",
    revenuecat_status: "active",
  });
  await owned(id, {
    ownership_status: "revoked",
    revoked_at: "2026-01-03T00:00:00Z",
  });
  const a = await access(id);
  assert.equal(a.ownership_status, "revoked");
  assert.equal(a.ownership_verification, "revoked");
  assert.equal(a.owns_coverly, false);
  assert.equal(a.access_class, "free");
  assert.equal(a.property_limit, 1);
  assert.equal(a.can_export_claim_pack, false);
});

test("incomplete, future-dated and wrong-entitlement projections cannot grant ownership", async () => {
  for (const fields of [
    { last_verified_at: null },
    { acquired_at: null },
    { last_verified_at: "2999-01-01" },
    { revenuecat_entitlement_id: "Coverly Plus" },
    { revenuecat_product_id: "" },
    { revenuecat_customer_id: null },
    { ownership_source: null },
    { ownership_environment: null },
    { revoked_at: "2026-01-03" },
  ]) {
    const id = await user({ plan: "coverly_family" });
    await owned(id, fields);
    const a = await access(id);
    assert.equal(a.owns_coverly, false);
    assert.equal(a.access_class, "free");
    assert.equal(a.ownership_verification, "unverified");
  }
});

test("legacy Plus and Family preserve limits and claims without ownership backfill", async () => {
  for (const [plan, expected, limit] of [
    ["coverly_plus", "legacy_plus", 1],
    ["coverly_family", "legacy_family", null],
  ] as const) {
    const id = await user({
      subscription_plan: plan,
      revenuecat_status: "active",
    });
    const a = await access(id);
    assert.equal(a.access_class, expected);
    assert.equal(a.property_limit, limit);
    assert.equal(a.can_export_claim_pack, true);
    assert.equal(a.owns_coverly, false);
    assert.equal(a.legacy_compatibility, true);
    assert.equal(a.legacy_plan, plan);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM public.user_ownership WHERE user_id = $1",
          [id],
        )
      ).rows.length,
      0,
    );
  }
});

test("inactive providers and expired subscriptions defeat stale legacy strings", async () => {
  for (const fields of [
    { revenuecat_status: "expired", subscription_status: "active" },
    { revenuecat_status: "active", revenuecat_expiration_at: "2020-01-01" },
    { subscription_status: "canceled" },
    { subscription_status: "active", subscription_period_end: "2020-01-01" },
  ]) {
    const a = await access(
      await user({
        plan: "coverly_family",
        subscription_plan: "coverly_family",
        ...fields,
      }),
    );
    assert.equal(a.access_class, "free");
  }
  assert.equal(
    (await access(await user({ plan: "coverly_plus" }))).access_class,
    "legacy_plus",
  );
});

test("tester, admin and support overrides remain explicit and do not manufacture ownership", async () => {
  for (const fields of [
    { plan: "tester" },
    {
      access_override_status: "active",
      access_override_plan: "coverly_plus",
      access_override_reason: "Tester access QA",
    },
  ]) {
    const testerId = await user(fields);
    const a = await access(testerId);
    assert.equal(a.access_class, "tester");
    assert.equal(a.override_type, "tester");
    assert.equal(a.property_limit, null);
    assert.equal(a.owns_coverly, false);
    assert.equal(a.can_export_claim_pack, true);
    assert.equal(a.ai_policy_class, "tester");
    assert.equal(
      (
        await db.query(
          "SELECT public.admin_tester_status_from_profile($1) AS status",
          [{ id: testerId }],
        )
      ).rows[0].status,
      "active",
    );
  }
  const admin = await user({ app_role: "admin" });
  await owned(admin, { ownership_status: "revoked", revoked_at: "2026-01-03" });
  const a = await access(admin);
  assert.equal(a.access_class, "admin");
  assert.equal(a.owns_coverly, false);
  assert.equal(a.ai_policy_class, "admin");
  assert.equal(a.property_limit, null);
  assert.equal(
    (
      await db.query(
        "SELECT public.admin_tester_status_from_profile($1) AS status",
        [{ id: admin }],
      )
    ).rows[0].status,
    "not_tester",
  );
  assert.equal(
    (
      await access(
        await user({
          access_override_status: "active",
          access_override_plan: "coverly_family",
        }),
      )
    ).override_type,
    "support",
  );
  assert.equal(
    (
      await access(
        await user({
          access_override_status: "active",
          access_override_plan: "tester",
          access_override_expires_at: "2020-01-01",
        }),
      )
    ).access_class,
    "free",
  );
});

test("clients cannot insert, update, upsert, delete, or read ownership projections", async () => {
  const id = await user();
  await owned(id);
  const another = await user();
  await asUser(id, async () => {
    for (const sql of [
      "SELECT * FROM public.user_ownership",
      "INSERT INTO public.user_ownership(user_id, ownership_status) VALUES ($1, 'owned')",
      "UPDATE public.user_ownership SET ownership_status = 'owned', last_verified_at = now() WHERE user_id = $1",
      "DELETE FROM public.user_ownership WHERE user_id = $1",
      "INSERT INTO public.user_ownership(user_id) VALUES ($1) ON CONFLICT(user_id) DO UPDATE SET ownership_status = 'owned'",
    ]) {
      await assert.rejects(db.query(sql, sql.includes("$1") ? [id] : []), {
        code: "42501",
      });
    }
    await assert.rejects(
      db.query(
        "UPDATE public.user_profiles SET plan = 'tester' WHERE id = $1",
        [id],
      ),
      { code: "42501" },
    );
    await assert.rejects(
      db.query("SELECT private.resolve_coverly_access($1)", [another]),
      { code: "42501" },
    );
    await assert.rejects(
      db.query("SELECT public.coverly_effective_plan_from_profile($1)", [
        { id: another, app_role: "admin" },
      ]),
      { code: "42501" },
    );
    const mine = (
      await db.query("SELECT public.get_my_access_capabilities() AS a")
    ).rows[0].a;
    assert.equal(mine.owns_coverly, true);
    await db.query(
      "SELECT * FROM public.update_my_profile('Changed', 'NZ', false, false)",
    );
  });
  assert.equal((await access(id)).owns_coverly, true);
  assert.equal((await access(another)).owns_coverly, false);
  const flags = (
    await db.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_ownership'::regclass",
    )
  ).rows[0];
  assert.equal(flags.relrowsecurity, true);
});

test("anonymous access and forged profile roles cannot resolve privileged access", async () => {
  await db.exec("SET ROLE anon");
  try {
    await assert.rejects(
      db.query("SELECT public.get_my_access_capabilities()"),
      { code: "42501" },
    );
  } finally {
    await db.exec("RESET ROLE");
  }
  await asUser("", async () => {
    await assert.rejects(
      db.query("SELECT public.get_my_access_capabilities()"),
      { code: "28000" },
    );
  });
  const id = await user();
  assert.equal(
    (
      await db.query(
        "SELECT public.admin_effective_plan_from_profile($1) AS plan",
        [{ id, app_role: "admin", plan: "tester" }],
      )
    ).rows[0].plan,
    "free",
  );
});

test("existing profile and plan adapters agree with capabilities and keep response shapes", async () => {
  for (const [fields, expected] of [
    [{}, "free"],
    [{ plan: "coverly_plus" }, "coverly_plus"],
    [{ plan: "coverly_family" }, "coverly_family"],
    [{ app_role: "admin" }, "admin"],
  ] as const) {
    const id = await user(fields);
    await asUser(id, async () => {
      assert.equal(
        (await db.query("SELECT public.get_my_effective_plan() AS plan"))
          .rows[0].plan,
        expected,
      );
      assert.equal(
        (await db.query("SELECT * FROM public.load_my_profile()")).rows[0]
          .effective_plan,
        expected,
      );
    });
    assert.equal(
      (
        await db.query(
          "SELECT public.admin_effective_plan_from_profile($1) AS plan",
          [{ id }],
        )
      ).rows[0].plan,
      expected,
    );
  }
  const id = await user();
  await owned(id);
  await asUser(id, async () => {
    assert.equal(
      (await db.query("SELECT * FROM public.load_my_profile()")).rows[0]
        .effective_plan,
      "coverly_owned",
    );
    const row = (
      await db.query("SELECT * FROM public.get_my_property_allowance()")
    ).rows[0];
    assert.deepEqual(Object.keys(row), [
      "access_class",
      "property_count",
      "property_limit",
      "can_create_property",
      "required_plan",
      "block_reason",
    ]);
    assert.equal(row.property_limit, 5);
    assert.equal(row.access_class, "owner");
  });
});

test("Free creation stops at one; owner at five; country and currency stay server-derived", async () => {
  for (const limit of [1, 5]) {
    const id = await user();
    if (limit === 5) await owned(id);
    await asUser(id, async () => {
      await assert.rejects(
        db.query(
          "SELECT * FROM public.create_my_property(p_name => 'Bad', p_country_code => 'XX', p_contents_sum_insured => 10)",
        ),
        { code: "22023" },
      );
      for (let n = 0; n < limit; n++) {
        const result = await createProperty();
        assert.equal(result.rows[0].country_code, "AU");
        assert.equal(result.rows[0].currency_code, "AUD");
      }
      await assert.rejects(createProperty(), {
        code: "P0001",
        message: "PROPERTY_LIMIT_REACHED",
      });
    });
  }
});

test("revoked owners retain access to existing over-limit inventory and can edit it", async () => {
  const id = await user();
  await owned(id);
  await asUser(id, async () => {
    for (let n = 0; n < 5; n++) await createProperty();
  });
  await db.query(
    "UPDATE public.user_ownership SET ownership_status = 'revoked', revoked_at = now() WHERE user_id = $1",
    [id],
  );
  await asUser(id, async () => {
    const files = await db.query("SELECT id FROM public.inventory_files");
    assert.equal(files.rows.length, 5);
    await db.query(
      "SELECT public.update_my_property(p_property_id => $1, p_name => 'Retained', p_country_code => 'NZ', p_contents_sum_insured => 10000)",
      [files.rows[0].id],
    );
    await assert.rejects(createProperty(), { code: "P0001" });
  });
  const a = await access(id);
  assert.equal(a.property_count, 5);
  assert.equal(a.can_manage_inventory, true);
});

test("direct inserts cannot bypass limits or owner RLS; multi-row insert rolls back", async () => {
  const id = await user();
  const other = await user();
  await asUser(id, async () => {
    await assert.rejects(
      db.query(
        "INSERT INTO public.inventory_files(id,user_id,name) VALUES (gen_random_uuid()::text,$1,'Other')",
        [other],
      ),
      { code: "42501" },
    );
    await assert.rejects(
      db.query(
        "INSERT INTO public.inventory_files(id,user_id,name) SELECT gen_random_uuid()::text,$1,'Home' FROM generate_series(1,2)",
        [id],
      ),
      { code: "P0001" },
    );
    assert.equal(
      (await db.query("SELECT id FROM public.inventory_files")).rows.length,
      0,
    );
  });
});

test("simultaneously submitted creations respect the final slot and existing locks remain", async () => {
  const id = await user();
  await owned(id);
  await asUser(id, async () => {
    for (let n = 0; n < 4; n++) await createProperty();
    const results = await Promise.allSettled([
      createProperty(),
      createProperty(),
      createProperty(),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 2);
  });
  // PGlite serializes queries on one backend. Verify retained PostgreSQL lock
  // ordering separately; multi-connection race/load testing belongs to local PG/QA.
  for (const signature of [
    "public.create_my_property(text,text,numeric,text,text,text)",
    "public.create_my_property(text,text,text,numeric,text,text,text)",
    "public.enforce_inventory_file_property_limit()",
  ]) {
    const source = (
      await db.query("SELECT pg_get_functiondef($1::regprocedure) AS body", [
        signature,
      ])
    ).rows[0].body;
    assert.ok(
      source.indexOf("pg_advisory_xact_lock") <
        source.indexOf("INTO v_allowance"),
    );
    assert.match(source, /hashtextextended\([^\n]+::text, 0\)/);
  }
  assert.equal((await access(id)).property_count, 5);
});

test("service role can maintain the projection without changing legacy subscription fields", async () => {
  const id = await user({
    subscription_plan: "coverly_plus",
    revenuecat_customer_id: "legacy-customer",
  });
  await db.exec("SET ROLE service_role");
  try {
    await owned(id);
    await assert.rejects(
      db.query("DELETE FROM public.user_ownership WHERE user_id = $1", [id]),
      { code: "42501" },
    );
    await db.query(
      "UPDATE public.user_ownership SET last_event_id = 'test-event', updated_at = now() WHERE user_id = $1",
      [id],
    );
    assert.equal(
      (await db.query("SELECT private.resolve_coverly_access($1) AS a", [id]))
        .rows[0].a.owns_coverly,
      true,
    );
  } finally {
    await db.exec("RESET ROLE");
  }
  const profile = (
    await db.query(
      "SELECT subscription_plan, revenuecat_customer_id FROM public.user_profiles WHERE id = $1",
      [id],
    )
  ).rows[0];
  assert.deepEqual(profile, {
    subscription_plan: "coverly_plus",
    revenuecat_customer_id: "legacy-customer",
  });
});

test("legacy six-argument creation and Family/tester unlimited compatibility remain functional", async () => {
  const free = await user();
  await asUser(free, async () => {
    const row = (
      await db.query(
        "SELECT * FROM public.create_my_property(p_name => 'Legacy Home', p_contents_sum_insured => 10000)",
      )
    ).rows[0];
    assert.equal(row.country_code, "NZ");
    assert.equal(row.currency_code, "NZD");
    await assert.rejects(
      db.query(
        "SELECT * FROM public.create_my_property(p_name => 'Second', p_contents_sum_insured => 10000)",
      ),
      { code: "P0001" },
    );
  });
  for (const fields of [
    { plan: "coverly_family" },
    { plan: "tester" },
    { app_role: "admin" },
  ]) {
    const id = await user(fields);
    await asUser(id, async () => {
      for (let n = 0; n < 6; n++) await createProperty();
    });
    assert.equal((await access(id)).can_create_property, true);
    assert.equal((await access(id)).property_limit, null);
  }
  const owner = await user();
  await owned(owner);
  assert.equal(
    (
      await db.query(
        "SELECT public.coverly_property_access_class_for_user($1) AS access_class",
        [owner],
      )
    ).rows[0].access_class,
    "owner",
  );
});

test("owners do not inherit the existing legacy AI bypass and inventory stays available when exhausted", async () => {
  const id = await user({
    plan: "coverly_family",
    subscription_status: "active",
    subscription_plan: "coverly_family",
  });
  await owned(id);
  await asUser(id, async () => {
    const usage = await db.query(
      "SELECT * FROM public.load_my_usage_allowances()",
    );
    assert.ok(
      usage.rows.every(
        (r: any) => r.is_limited && r.effective_plan === "coverly_owned",
      ),
    );
    const result = (
      await db.query(
        "SELECT public.reserve_my_feature_usage('ai_scan','single_photo_scan','ownership-test') AS r",
      )
    ).rows[0].r;
    assert.equal(result.reserved_units, 1);
    assert.equal(result.effective_plan, "coverly_owned");
  });
  const reservation = (
    await db.query(
      "SELECT is_bypassed, is_limited FROM public.feature_usage_reservations WHERE user_id = $1",
      [id],
    )
  ).rows[0];
  assert.equal(reservation.is_bypassed, false);
  assert.equal(reservation.is_limited, true);
  await db.exec(
    "UPDATE public.app_settings SET free_ai_scan_monthly_limit = 0, free_replacement_pricing_monthly_limit = 0",
  );
  try {
    await asUser(id, async () => {
      const usage = await db.query(
        "SELECT * FROM public.load_my_usage_allowances()",
      );
      assert.ok(usage.rows.every((r: any) => r.would_be_blocked));
      await createProperty();
      const a = (
        await db.query("SELECT public.get_my_access_capabilities() AS a")
      ).rows[0].a;
      assert.equal(a.can_export_claim_pack, true);
      assert.equal(a.can_manage_inventory, true);
    });
  } finally {
    await db.exec(
      "UPDATE public.app_settings SET free_ai_scan_monthly_limit = 10, free_replacement_pricing_monthly_limit = 5",
    );
  }
});
