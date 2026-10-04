import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { before, after, test } from "node:test";
import { OWNERSHIP_ACTIONS } from "../../artifacts/mobile/lib/analytics-core.ts";
const modulePath = process.env.COVERLY_PGLITE_MODULE;
assert.ok(modulePath && isAbsolute(modulePath), "Use the cached local PGlite module only");
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = (file: string) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
const insert = (user: string, name: string, properties: object) => db.query(`INSERT INTO public.app_analytics_events (user_id,installation_id,session_id,event_name,platform,app_version,build_number,properties) VALUES ($1,$1,$1,$2,'ios','fixture','fixture',$3::jsonb)`, [user, name, JSON.stringify(properties)]);
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    INSERT INTO auth.users VALUES ('${a}','a@fixture.invalid'),('${b}','b@fixture.invalid');`);
  await db.exec(migration("20260806000000_app_analytics_events.sql"));
  await db.exec(migration("20260809000000_review_prompt_analytics.sql"));
  await insert(a, "purchase_completed", { plan: "family", billing_period: "annual" });
  await db.exec(migration("20260929070806_ownership_purchase_analytics.sql"));
});
after(async () => { await db.close(); });
test("historical subscription event remains unchanged", async () => {
  const { rows } = await db.query("SELECT properties FROM public.app_analytics_events WHERE event_name='purchase_completed'");
  assert.deepEqual(rows[0].properties, { plan: "family", billing_period: "annual" });
});
test("all new ownership actions accepted as caller-owned events", async () => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a}',false);`);
  try { for (const action of OWNERSHIP_ACTIONS) await insert(a, "ownership_flow", { ownership_action: action, plan: "owned", billing_period: "one_time" }); }
  finally { await db.exec("RESET ROLE"); }
});
test("unknown event names, personal keys and nested payloads remain rejected", async () => {
  await assert.rejects(insert(a, "arbitrary-price-event", {}));
  await assert.rejects(insert(a, "ownership_flow", { email: "private@fixture.invalid" }));
  await assert.rejects(insert(a, "ownership_flow", { ownership_action: { nested: true } }));
});
test("RLS still denies another user and client history reads, updates and deletes", async () => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a}',false);`);
  try {
    await assert.rejects(insert(b, "ownership_flow", { ownership_action: "paywall_viewed" }));
    await assert.rejects(db.query("SELECT * FROM public.app_analytics_events"));
    await assert.rejects(db.query("UPDATE public.app_analytics_events SET properties='{}'"));
    await assert.rejects(db.query("DELETE FROM public.app_analytics_events"));
  } finally { await db.exec("RESET ROLE"); }
});
