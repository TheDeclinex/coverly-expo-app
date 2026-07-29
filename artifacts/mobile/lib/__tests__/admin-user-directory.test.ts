import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  adminUserDirectoryEffectiveQuery,
  adminUsersRpcParams,
  mergeAdminPages,
} from "../admin-list-model.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(testDirectory, "../../../../supabase/migrations/20260729010000_admin_user_directory_pagination.sql"),
  "utf8",
);
const service = readFileSync(resolve(testDirectory, "../admin-service.ts"), "utf8");
const screen = readFileSync(resolve(testDirectory, "../../app/(tabs)/admin-users.tsx"), "utf8");

test("blank and one-character input keep the unfiltered user directory", () => {
  assert.equal(adminUserDirectoryEffectiveQuery(""), null);
  assert.equal(adminUserDirectoryEffectiveQuery("   "), null);
  assert.equal(adminUserDirectoryEffectiveQuery("a"), null);
  assert.equal(adminUserDirectoryEffectiveQuery(" a "), null);
  assert.equal(adminUsersRpcParams({ query: "a" }).p_query, null);
});

test("two-character input activates search and clearing restores the directory", () => {
  assert.equal(adminUserDirectoryEffectiveQuery("ab"), "ab");
  assert.equal(adminUserDirectoryEffectiveQuery("  Jay  "), "Jay");
  assert.equal(adminUserDirectoryEffectiveQuery(""), null);
});

test("complete UUID lookup remains supported", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  assert.equal(adminUserDirectoryEffectiveQuery(uuid), uuid);
  assert.match(migration, /v_is_uuid AND up\.id = v_query::uuid/);
});

test("user directory RPC params default to 50 and clamp at 50", () => {
  assert.deepEqual(adminUsersRpcParams({ query: null }), {
    p_query: null,
    p_limit: 50,
    p_before_created_at: null,
    p_before_id: null,
  });
  assert.equal(adminUsersRpcParams({ query: null, limit: 500 }).p_limit, 50);
});

test("user directory maps the stable created-at and id cursor", () => {
  const cursor = {
    createdAt: "2026-07-28T12:34:56.000Z",
    id: "11111111-1111-4111-8111-111111111111",
  };
  assert.deepEqual(adminUsersRpcParams({ query: "jay", cursor }), {
    p_query: "jay",
    p_limit: 50,
    p_before_created_at: cursor.createdAt,
    p_before_id: cursor.id,
  });
  assert.match(migration, /up\.created_at < p_before_created_at[\s\S]*up\.created_at = p_before_created_at[\s\S]*up\.id < p_before_id/);
});

test("next user pages merge without duplicate rows", () => {
  const users = mergeAdminPages([
    { items: [{ id: "3" }, { id: "2" }], hasMore: true },
    { items: [{ id: "2" }, { id: "1" }], hasMore: false },
  ]);
  assert.deepEqual(users.map((user) => user.id), ["3", "2", "1"]);
});

test("blank backend query returns a newest-first bounded directory", () => {
  assert.match(migration, /v_query text := btrim\(COALESCE\(p_query, ''\)\)/);
  assert.match(migration, /v_query = ''/);
  assert.match(migration, /ORDER BY up\.created_at DESC NULLS LAST, up\.id DESC/);
  assert.match(migration, /LIMIT v_limit \+ 1/);
  assert.match(migration, /count\(\*\) > v_limit/);
});

test("directory RPC returns only summary fields and remains admin-only", () => {
  const selectStart = migration.indexOf("SELECT\n      up.id,");
  const fromStart = migration.indexOf("FROM public.user_profiles up", selectStart);
  const selectList = migration.slice(selectStart, fromStart);
  for (const field of ["up.id", "up.email", "up.full_name", "up.app_role", "effective_plan", "tester_status", "up.created_at"]) {
    assert.match(selectList, new RegExp(field.replace(".", "\\.")));
  }
  assert.match(migration, /PERFORM public\.assert_current_user_admin\(\)/);
  assert.match(migration, /SET search_path TO 'public', 'pg_temp'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_list_users_page[\s\S]*FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_list_users_page[\s\S]*TO authenticated, service_role/);
});

test("client uses the paginated directory RPC and resets on effective query changes", () => {
  assert.match(service, /"admin_list_users_page"/);
  assert.match(screen, /useInfiniteQuery/);
  assert.match(screen, /<FlatList/);
  assert.match(screen, /limit: 50/);
  assert.match(screen, /isFetchingNextPage/);
  assert.match(screen, /mergeAdminPages/);
  assert.match(screen, /setQueryRevision/);
  assert.match(screen, /resetQueries/);
});
