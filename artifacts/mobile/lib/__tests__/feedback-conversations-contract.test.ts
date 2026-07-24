import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260723_feedback_conversations_and_build_context.sql"),
  "utf8",
);
const hardeningMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260724_feedback_screenshot_security_and_high_priority.sql"),
  "utf8",
);
const baseFeedbackMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260627_feedback_reports_mobile.sql"),
  "utf8",
);
const adminSupportSource = readFileSync(
  resolve(process.cwd(), "app/(tabs)/admin-support.tsx"),
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

test("feedback screenshot writes are restricted to the authenticated namespace", () => {
  assert.match(hardeningMigration, /feedback reports screenshot insert namespace/);
  assert.match(hardeningMigration, /feedback reports screenshot update namespace/);
  assert.match(hardeningMigration, /AS RESTRICTIVE[\s\S]*FOR INSERT[\s\S]*screenshot_url IS NULL[\s\S]*screenshot_url LIKE auth\.uid\(\)::text \|\| '\/%'/);
  assert.match(hardeningMigration, /AS RESTRICTIVE[\s\S]*FOR UPDATE[\s\S]*screenshot_url IS NULL[\s\S]*screenshot_url LIKE auth\.uid\(\)::text \|\| '\/%'/);
  assert.doesNotMatch(
    hardeningMigration.match(/feedback reports screenshot insert namespace[\s\S]*?CREATE POLICY "feedback reports screenshot update namespace"/)?.[0] ?? "",
    /https?:\/\//,
  );
});

test("legacy screenshots remain readable and admins retain storage access", () => {
  assert.match(baseFeedbackMigration, /feedback screenshots read admin/);
  assert.match(baseFeedbackMigration, /up\.app_role = 'admin'/);
  assert.doesNotMatch(
    hardeningMigration.match(/feedback reports screenshot (?:insert|update) namespace[\s\S]*?;/)?.[0] ?? "",
    /FOR SELECT/,
  );
});

test("high priority is accepted between blocking and normal", () => {
  assert.match(hardeningMigration, /severity IN \('minor', 'moderate', 'high', 'critical'\)/);
  assert.match(hardeningMigration, /feedback_reports_severity_check/);
  assert.match(hardeningMigration, /admin_update_feedback_priority/);
  assert.match(hardeningMigration, /p_priority NOT IN \('blocking', 'high', 'normal', 'low'\)/);
  assert.match(hardeningMigration, /WHEN 'high' THEN 'high'/);
  assert.match(hardeningMigration, /PERFORM public\.assert_current_user_admin\(\)/);
  assert.match(hardeningMigration, /SET search_path TO 'public', 'pg_temp'/);
  assert.match(adminSupportSource, /feedbackPriorityOptions\.map/);
  assert.match(adminSupportSource, /normalizeFeedbackPriority\(report\.severity\)/);
  assert.match(adminSupportSource, /updateFeedbackReportPriority/);
});

test("admin ticket rows announce unread user replies", () => {
  assert.match(adminSupportSource, /unread user reply/);
  assert.match(adminSupportSource, /ticketIsUnreadForAdmin\(report\)/);
});
