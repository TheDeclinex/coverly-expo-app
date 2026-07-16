import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isAdminQueryKey, isAdminRoutePath } from "../admin-access.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const layoutSource = readFileSync(resolve(testDirectory, "../../app/(tabs)/_layout.tsx"), "utf8");
const accountSource = readFileSync(resolve(testDirectory, "../../app/(tabs)/account.tsx"), "utf8");
const adminMigration = readFileSync(resolve(testDirectory, "../../../../supabase/migrations/20260701_admin_mvp_v1.sql"), "utf8");
const feedbackMigration = readFileSync(resolve(testDirectory, "../../../../supabase/migrations/20260627_feedback_reports_mobile.sql"), "utf8");

test("all current admin route shapes are recognized", () => {
  for (const path of ["/admin", "/admin-users", "/admin-user/123", "/admin-claim-pack/abc", "/admin-support"]) {
    assert.equal(isAdminRoutePath(path), true, path);
  }
  for (const path of ["/account", "/upgrade", "/administration", "/properties/admin-notes"]) {
    assert.equal(isAdminRoutePath(path), false, path);
  }
});

test("only admin-scoped query caches are selected for removal", () => {
  assert.equal(isAdminQueryKey(["admin-user-detail", "user-1"]), true);
  assert.equal(isAdminQueryKey(["account-profile", "v2", "user-1"]), false);
  assert.equal(isAdminQueryKey(["inventory-files", "user-1"]), false);
});

test("menu and direct routes both require the admin profile role", () => {
  assert.match(accountSource, /\{isAdmin && \(/);
  assert.match(layoutSource, /isAdminRoutePath\(pathname\)/);
  assert.match(layoutSource, /if \(!isAdmin\) return <Redirect href="\/account"/);
});

test("admin server RPCs retain the authoritative assertion", () => {
  const protectedRpcNames = [
    "admin_get_overview",
    "admin_search_users",
    "admin_get_user_detail",
    "admin_update_user_access",
    "admin_get_entitlement_debug",
    "admin_list_user_files",
    "admin_list_claim_packs",
    "admin_get_claim_pack_detail",
    "admin_list_recent_events",
  ];
  for (const name of protectedRpcNames) {
    const start = adminMigration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    assert.notEqual(start, -1, name);
    const next = adminMigration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
    const definition = adminMigration.slice(start, next === -1 ? undefined : next);
    assert.match(definition, /PERFORM public\.assert_current_user_admin\(\)/);
  }
});

test("support data keeps admin RLS and protected status mutation", () => {
  assert.match(feedbackMigration, /policyname = 'feedback reports mobile select admin'[\s\S]*up\.app_role = 'admin'/);
  assert.match(feedbackMigration, /CREATE OR REPLACE FUNCTION public\.admin_update_feedback_status[\s\S]*PERFORM public\.assert_current_user_admin\(\)/);
  assert.match(feedbackMigration, /policyname = 'feedback screenshots read admin'[\s\S]*up\.app_role = 'admin'/);
});
