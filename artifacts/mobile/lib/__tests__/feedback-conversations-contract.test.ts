import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260723000000_feedback_conversations_and_build_context.sql"),
  "utf8",
);
const unreadConversationMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260725000000_feedback_user_unread_conversations.sql"),
  "utf8",
);
const hardeningMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260724000000_feedback_screenshot_security_and_high_priority.sql"),
  "utf8",
);
const baseFeedbackMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260627000000_feedback_reports_mobile.sql"),
  "utf8",
);
const adminSupportSource = readFileSync(
  resolve(process.cwd(), "app/(tabs)/admin-support.tsx"),
  "utf8",
);
const feedbackConversationSource = readFileSync(
  resolve(process.cwd(), "components/FeedbackConversation.tsx"),
  "utf8",
);
const feedbackScreenSource = readFileSync(
  resolve(process.cwd(), "app/(tabs)/feedback.tsx"),
  "utf8",
);
const feedbackUnreadHookSource = readFileSync(
  resolve(process.cwd(), "hooks/useFeedbackUnread.ts"),
  "utf8",
);
const homeSource = readFileSync(
  resolve(process.cwd(), "app/(tabs)/index.tsx"),
  "utf8",
);
const accountSource = readFileSync(
  resolve(process.cwd(), "app/(tabs)/account.tsx"),
  "utf8",
);
const accountMenuSource = readFileSync(
  resolve(process.cwd(), "components/AccountMenu.tsx"),
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

test("user unread count is distinct conversations with admin or support-system activity", () => {
  assert.match(
    unreadConversationMigration,
    /count\(DISTINCT fm\.ticket_id\)[\s\S]*fr\.user_id = auth\.uid\(\)::text[\s\S]*fm\.sender_role IN \('admin', 'system'\)[\s\S]*fr\.user_last_read_at/,
  );
  assert.match(
    unreadConversationMigration,
    /last_admin_message_at = v_now[\s\S]*latest_message_preview = left\(v_event, 180\)/,
  );
  assert.match(
    unreadConversationMigration,
    /WITH latest_admin_activity[\s\S]*WHERE sender_role IN \('admin', 'system'\)[\s\S]*UPDATE public\.feedback_reports/,
  );
});

test("viewing one ticket marks only that ticket read and refreshes its account-scoped badge", () => {
  assert.match(feedbackConversationSource, /markFeedbackTicketRead\(ticketId, viewerRole\)/);
  assert.match(feedbackConversationSource, /feedbackUnreadQueryKey\(session\?\.user\.id\)/);
  assert.doesNotMatch(feedbackConversationSource, /markAll|clearAll|feedback_mark_all/i);
  assert.match(
    unreadConversationMigration,
    /p_viewer_role text[\s\S]*p_viewer_role = 'user'[\s\S]*v_owner_id <> auth\.uid\(\)::text[\s\S]*SET user_last_read_at = now\(\)[\s\S]*p_viewer_role = 'admin'[\s\S]*v_is_admin[\s\S]*SET admin_last_read_at = now\(\)/,
  );
});

test("feedback badge cache and fetching stay scoped to the authenticated account", () => {
  assert.match(
    feedbackUnreadHookSource,
    /feedbackUnreadQueryKey\(session\?\.user\.id\)/,
  );
  assert.match(feedbackUnreadHookSource, /enabled: Boolean\(session\?\.user\.id\)/);
  assert.doesNotMatch(feedbackUnreadHookSource, /refetchInterval/);
  assert.match(homeSource, /useFocusEffect\([\s\S]*feedbackUnread\.refetch\(\)/);
  assert.match(homeSource, /refetchHome[\s\S]*feedbackUnread\.refetch\(\)/);
});

test("home badge uses inset Coverly notification colours and bounded text", () => {
  assert.match(homeSource, /headerUnreadBadge, \{ backgroundColor: colors\.primary \}/);
  assert.match(homeSource, /color: colors\.primaryForeground/);
  assert.match(homeSource, /right: 1[\s\S]*top: 1[\s\S]*minWidth: 15[\s\S]*height: 15/);
  assert.match(homeSource, /maxFontSizeMultiplier=\{1\.2\}/);
  assert.match(feedbackScreenSource, /unreadDot, \{ backgroundColor: colors\.primary \}/);
  assert.match(
    accountSource,
    /title="Feedback & support"[\s\S]*tone="teal"[\s\S]*badgeCount=\{feedbackUnread\.data\?\.userUnreadCount\}/,
  );
  assert.match(accountMenuSource, /unreadBadge, \{ backgroundColor: colors\.primary \}/);
  assert.match(accountMenuSource, /unreadBadgeText, \{ color: colors\.primaryForeground \}/);
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

test("storage writes and reads stay inside the owner namespace without update or delete grants", () => {
  assert.match(baseFeedbackMigration, /feedback screenshots upload own[\s\S]*FOR INSERT[\s\S]*auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/);
  assert.match(baseFeedbackMigration, /feedback screenshots read own[\s\S]*FOR SELECT[\s\S]*auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/);
  assert.match(baseFeedbackMigration, /feedback screenshots read admin[\s\S]*FOR SELECT[\s\S]*up\.app_role = 'admin'/);
  const screenshotPolicySection = baseFeedbackMigration.match(
    /feedback screenshots upload own[\s\S]*?CREATE OR REPLACE FUNCTION public\.admin_update_feedback_status/,
  )?.[0] ?? "";
  assert.doesNotMatch(screenshotPolicySection, /FOR UPDATE|FOR DELETE/);
});

test("feedback report reads and screenshot attachment updates enforce ticket ownership", () => {
  assert.match(baseFeedbackMigration, /feedback reports mobile select own[\s\S]*USING \(auth\.uid\(\)::text = user_id\)/);
  assert.match(hardeningMigration, /feedback reports mobile attach screenshot own[\s\S]*USING \(auth\.uid\(\)::text = user_id\)[\s\S]*WITH CHECK \([\s\S]*auth\.uid\(\)::text = user_id/);
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
