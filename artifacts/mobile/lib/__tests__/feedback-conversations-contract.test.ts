import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../../supabase/migrations/20260723_feedback_conversations_and_build_context.sql", import.meta.url),
  "utf8",
);

test("feedback message writes derive role from authenticated admin state", () => {
  assert.match(migration, /up\.id = auth\.uid\(\)[\s\S]*up\.app_role = 'admin'/);
  assert.match(migration, /v_role := CASE WHEN v_is_admin THEN 'admin' ELSE 'user' END/);
  assert.doesNotMatch(migration, /p_sender_role/);
});

test("users can only read and reply to tickets they own", () => {
  assert.match(migration, /fr\.user_id = auth\.uid\(\)::text/);
  assert.match(migration, /v_ticket\.user_id <> auth\.uid\(\)::text/);
  assert.match(migration, /feedback ticket access denied/);
});

test("closed tickets are read-only and opposite-party unread state is database backed", () => {
  assert.match(migration, /v_ticket\.status = 'closed'/);
  assert.match(migration, /closed feedback tickets are read-only/);
  assert.match(migration, /fm\.sender_role = 'admin'[\s\S]*fr\.user_last_read_at/);
  assert.match(migration, /fm\.sender_role = 'user'[\s\S]*fr\.admin_last_read_at/);
});

test("status and classification are separate constrained fields", () => {
  assert.match(migration, /classification IN \('issue', 'bug', 'feature', 'feedback'\)/);
  assert.match(migration, /p_status NOT IN \([\s\S]*'under_investigation'[\s\S]*'closed'/);
  assert.doesNotMatch(migration.match(/p_status NOT IN \(([\s\S]*?)\)/)?.[1] ?? "", /'bug'|'feature'/);
});
