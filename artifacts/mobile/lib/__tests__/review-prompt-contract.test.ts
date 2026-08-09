import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const scan = read("app/(tabs)/scan.tsx");
const room = read("app/(tabs)/room/[id].tsx");
const account = read("app/(tabs)/account.tsx");
const analyticsMigration = read("../../supabase/migrations/20260809000000_review_prompt_analytics.sql");

test("scan success is recorded after saved item IDs exist and eligibility is carried to the room", () => {
  assert.match(scan, /savedItemIds\.push\(payload\.id\)/);
  assert.match(scan, /recordSuccessfulScanForReview\(savedItemIds\.length\)/);
  assert.match(scan, /reviewPrompt: AUTOMATIC_REVIEW_TRIGGER/);
});

test("room waits for foreground, visible saved items, and settled navigation interactions", () => {
  assert.match(room, /currentAppState !== "active"/);
  assert.match(room, /expectedIds\.every[\s\S]*items/);
  assert.match(room, /InteractionManager\.runAfterInteractions[\s\S]*attemptAutomaticReviewPrompt/);
});

test("Account includes a permanent Rate Coverly action with graceful failure copy", () => {
  assert.match(account, /title="Rate Coverly"/);
  assert.match(account, /openCoverlyStoreReview\(\)/);
  assert.match(account, /Unable to open the store/);
});

test("analytics migration allowlists all three review events", () => {
  assert.match(analyticsMigration, /'review_prompt_eligible'/);
  assert.match(analyticsMigration, /'review_prompt_requested'/);
  assert.match(analyticsMigration, /'review_store_link_opened'/);
});
