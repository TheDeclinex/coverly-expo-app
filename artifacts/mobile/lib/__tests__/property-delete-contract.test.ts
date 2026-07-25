import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const screen = readFileSync(resolve(process.cwd(), "app/(tabs)/edit-property/[id].tsx"), "utf8");
const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260725_transactional_property_delete.sql"),
  "utf8",
);

test("property deletion uses one transactional RPC instead of independent client deletes", () => {
  assert.match(screen, /rpc\("delete_my_inventory_file"/);
  assert.doesNotMatch(screen, /from\("inventory_items"\)\.delete\(\)/);
  assert.doesNotMatch(screen, /from\("inventory_rooms"\)\.delete\(\)/);
  assert.doesNotMatch(screen, /from\("inventory_files"\)[\s\S]{0,80}\.delete\(\)/);
});

test("property deletion verifies ownership and exposes only authenticated execution", () => {
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /user_id = v_user_id/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.delete_my_inventory_file\(text\) FROM PUBLIC, anon, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.delete_my_inventory_file\(text\) TO authenticated/);
});

test("items, rooms, and the property are deleted inside the same database function", () => {
  assert.match(migration, /DELETE FROM public\.inventory_items/);
  assert.match(migration, /DELETE FROM public\.inventory_rooms/);
  assert.match(migration, /DELETE FROM public\.inventory_files/);
});
