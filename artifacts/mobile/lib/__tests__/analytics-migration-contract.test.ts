import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260806000000_app_analytics_events.sql",
  ),
  "utf8",
);

test("analytics RLS permits own inserts without client-side reads", () => {
  assert.match(
    migration,
    /ALTER TABLE public\.app_analytics_events ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    migration,
    /FOR INSERT\s+TO authenticated\s+WITH CHECK \(\(SELECT auth\.uid\(\)\) = user_id\)/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.app_analytics_events FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT INSERT ON TABLE public\.app_analytics_events TO authenticated/,
  );
  assert.doesNotMatch(migration, /GRANT SELECT[^;]+TO authenticated/);
});

test("database constraints reject unknown event names and property keys", () => {
  assert.match(migration, /app_analytics_events_event_name_check/);
  assert.match(migration, /app_analytics_events_properties_keys_check/);
  assert.match(migration, /app_analytics_events_properties_scalar_check/);
  assert.match(migration, /user_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
});

test("last-active RPC is caller-bound and database-throttled", () => {
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(
    migration,
    /up\.last_active_at <= now\(\) - interval '15 minutes'/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.touch_my_last_active\(\) FROM PUBLIC, anon/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.touch_my_last_active\(\) TO authenticated/,
  );
});
