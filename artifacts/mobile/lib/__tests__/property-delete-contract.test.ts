import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const screen = readFileSync(resolve(process.cwd(), "app/(tabs)/edit-property/[id].tsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "lib/property-delete.ts"), "utf8");
const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260725010000_transactional_property_delete.sql"),
  "utf8",
);

test("property deletion delegates to the owned-data service", () => {
  assert.match(screen, /deletePropertyOwnedData\(id\)/);
  assert.match(service, /rpc\("delete_my_inventory_file"/);
  assert.doesNotMatch(screen, /from\("inventory_items"\)\.delete\(\)/);
  assert.doesNotMatch(screen, /from\("inventory_rooms"\)\.delete\(\)/);
});

test("the direct parent fallback is limited to the missing-RPC production condition", () => {
  assert.match(service, /metadata\.code === "PGRST202"/);
  assert.match(service, /if \(rpcError && !isMissingPropertyDeleteRpcError\(rpcError\)\)/);
  assert.match(service, /from\("inventory_files"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("id", propertyId\)/);
  assert.match(service, /select\("id"\)[\s\S]*maybeSingle\(\)/);
});

test("property deletion cleans only referenced property storage and retains claim-pack history", () => {
  assert.match(service, /INVENTORY_PHOTOS_BUCKET/);
  assert.match(service, /CLAIM_EVIDENCE_BUCKET/);
  assert.match(service, /inventory_files/);
  assert.match(service, /inventory_rooms/);
  assert.match(service, /inventory_items/);
  assert.match(service, /image_url, photo_url, attachments/);
  assert.match(service, /claim_evidence/);
  assert.doesNotMatch(service, /from\("claim_packs"\)/);
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
