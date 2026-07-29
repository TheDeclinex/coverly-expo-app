import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(testDirectory, "../../../../supabase/migrations/20260729000000_admin_phase1_scalable_lists.sql"),
  "utf8",
);
const service = readFileSync(resolve(testDirectory, "../admin-service.ts"), "utf8");
const supportScreen = readFileSync(resolve(testDirectory, "../../app/(tabs)/admin-support.tsx"), "utf8");
const claimPacksScreen = readFileSync(resolve(testDirectory, "../../app/(tabs)/admin-claim-packs.tsx"), "utf8");
const eventsScreen = readFileSync(resolve(testDirectory, "../../app/(tabs)/admin-errors.tsx"), "utf8");

test("all Phase 1 RPCs retain admin-only enforcement and a fixed search path", () => {
  const protectedRpcNames = [
    "admin_get_overview_v2",
    "admin_search_users",
    "admin_list_support_tickets",
    "admin_list_claim_packs_page",
    "admin_list_events_page",
    "admin_list_user_files_page",
    "admin_get_user_property_preview",
  ];

  for (const name of protectedRpcNames) {
    const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    assert.notEqual(start, -1, name);
    const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
    const definition = migration.slice(start, next === -1 ? undefined : next);
    assert.match(definition, /PERFORM public\.assert_current_user_admin\(\)/, name);
    assert.match(definition, /SET search_path TO 'public', 'pg_temp'/, name);
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(`), name);
  }
});

test("backend contracts clamp list limits and reject incomplete cursors", () => {
  assert.match(migration, /LEAST\(GREATEST\(COALESCE\(p_limit, 20\), 1\), 50\)/);
  assert.match(migration, /support cursor requires both timestamp and id/);
  assert.match(migration, /claim-pack cursor requires both timestamp and id/);
  assert.match(migration, /event cursor requires both timestamp and id/);
  assert.match(migration, /property cursor requires both timestamp and id/);
});

test("user search is gated before the RPC and on the backend", () => {
  const guard = service.indexOf("if (!canRunAdminUserSearch(normalizedQuery)) return Promise.resolve([]);");
  const call = service.indexOf('"admin_search_users"');
  assert.ok(guard >= 0 && guard < call);
  assert.match(migration, /IF char_length\(v_query\) < 2 THEN\s+RETURN;/);
  assert.doesNotMatch(migration, /WHERE v_query = ''/);
});

test("needs-attention filtering is server-side and not date-limited by the client", () => {
  assert.match(migration, /v_status = 'needs_attention'[\s\S]*fr\.status = 'new'[\s\S]*fr\.last_user_message_at > COALESCE\(fr\.admin_last_read_at/);
  assert.match(supportScreen, /filter, setFilter.*"needs_attention"/);
  assert.doesNotMatch(supportScreen, /\.filter\(\(report\)/);
});

test("large admin screens use FlatList and paginated RPCs", () => {
  for (const source of [supportScreen, claimPacksScreen, eventsScreen]) {
    assert.match(source, /<FlatList/);
    assert.match(source, /fetchNextPage/);
    assert.match(source, /isFetchingNextPage/);
  }
  assert.match(service, /admin_list_support_tickets/);
  assert.match(service, /admin_list_claim_packs_page/);
  assert.match(service, /admin_list_events_page/);
});

test("list RPCs omit full support text, event metadata, and claim error text", () => {
  const supportStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.admin_list_support_tickets");
  const claimStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.admin_list_claim_packs_page");
  const eventStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.admin_list_events_page");
  const propertyStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.admin_list_user_files_page");
  const supportDefinition = migration.slice(supportStart, claimStart);
  const claimDefinition = migration.slice(claimStart, eventStart);
  const eventDefinition = migration.slice(eventStart, propertyStart);

  assert.doesNotMatch(supportDefinition, /fr\.metadata_json/);
  assert.doesNotMatch(supportDefinition, /fr\.expected_result/);
  assert.doesNotMatch(claimDefinition, /AS generation_error/);
  assert.doesNotMatch(eventDefinition, /e\.metadata/);
});
