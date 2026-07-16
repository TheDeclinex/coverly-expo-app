import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(resolve(testDirectory, "../../../../supabase/migrations/20260717_property_limits_by_plan.sql"), "utf8");
const edgeFunction = readFileSync(resolve(testDirectory, "../../../../supabase/functions/create-property/index.ts"), "utf8");

test("migration preserves the six-argument RPC and applies the shared allowance", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_my_property\([\s\S]*p_policy_number text[\s\S]*p_property_cover_image_url text/);
  assert.match(migration, /coverly_property_allowance_for_user\(v_user_id\)/);
  assert.match(migration, /MESSAGE = 'PROPERTY_LIMIT_REACHED'/);
});

test("direct inserts use NEW.user_id and the same per-user concurrency lock", () => {
  assert.match(migration, /BEFORE INSERT ON public\.inventory_files/);
  assert.match(migration, /coverly_property_allowance_for_user\(NEW\.user_id\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(NEW\.user_id::text, 0\)\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_user_id::text, 0\)\)/);
});

test("tester and admin signals retain full access while Plus remains limited", () => {
  assert.match(migration, /app_role'[\s\S]*= 'admin'/);
  assert.match(migration, /access_override_reason'[\s\S]*LIKE 'tester access%'/);
  assert.match(migration, /v_access_class IN \('family', 'full_access'\)/);
  assert.match(migration, /RETURN 'plus'/);
});

test("legacy Edge Function delegates to the authoritative RPC", () => {
  assert.match(edgeFunction, /\.rpc\('create_my_property'/);
  assert.doesNotMatch(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY|\.from\('inventory_files'\)\s*\.insert/);
});
