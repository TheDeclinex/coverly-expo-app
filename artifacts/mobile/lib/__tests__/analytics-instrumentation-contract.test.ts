import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");
const propertyService = read("lib/property-service.ts");
const addItem = read("app/(tabs)/add-item.tsx");
const property = read("app/(tabs)/property/[id].tsx");
const scan = read("app/(tabs)/scan.tsx");
const replacement = read("app/(tabs)/replacement-pricing/[id].tsx");
const claimPack = read("app/(tabs)/claim-pack/[fileId].tsx");
const upgrade = read("app/upgrade.tsx");
const rootLayout = read("app/_layout.tsx");

test("inventory success events occur only beyond database success guards", () => {
  assert.match(
    propertyService,
    /if \(error\)[\s\S]*if \(!data\)[\s\S]*trackEvent\("property_created"/,
  );
  assert.match(
    addItem,
    /inventory_items"\)\.insert\(payload\)[\s\S]*if \(error\)[\s\S]*return;[\s\S]*trackEvent\("item_created_manually"/,
  );
  assert.match(
    property,
    /inventory_rooms"\)\.insert\([\s\S]*if \(error\)[\s\S]*return;[\s\S]*trackEvent\("room_created"/,
  );
  assert.match(
    scan,
    /inventory_rooms"\)\.insert\([\s\S]*if \(roomErr\)[\s\S]*return;[\s\S]*trackEvent\("room_created"/,
  );
});

test("scan analytics use the existing single-flight boundary and controlled failure mapping", () => {
  assert.match(
    scan,
    /scanSubmissionInFlightRef\.current !== null[\s\S]*duplicate scan start ignored/,
  );
  assert.match(
    scan,
    /scanSubmissionInFlightRef\.current = scanAttemptId[\s\S]*trackEvent\("scan_started"/,
  );
  assert.match(
    scan,
    /result\.status === "error"[\s\S]*trackEvent\("scan_failed"[\s\S]*categorizeAnalyticsFailure/,
  );
  assert.match(
    scan,
    /result\.items\.length === 0[\s\S]*trackEvent\("scan_failed"/,
  );
  assert.match(
    scan,
    /trackEvent\("scan_completed"[\s\S]*items_detected_count: result\.items\.length/,
  );
});

test("replacement, claim-pack, and purchase flows avoid duplicate starts", () => {
  assert.match(
    replacement,
    /searchAttemptInFlight\.current\) return;[\s\S]*trackEvent\("replacement_search_started"/,
  );
  assert.match(
    replacement,
    /trackEvent\("replacement_search_completed"[\s\S]*result_count: response\.results\.length/,
  );
  assert.match(claimPack, /claimPackGenerationInFlightRef\.current\) return/);
  assert.match(claimPack, /trackEvent\("claim_pack_started"/);
  assert.match(upgrade, /purchaseActionLockRef\.current\) return/);
  assert.match(upgrade, /paywallTrackedRef\.current === retryReconciliation\) return/);
  assert.match(
    upgrade,
    /RevenueCat webhook[\s\S]*authoritative billing record/,
  );
});

test("application events and last-active updates are rooted in the app lifecycle", () => {
  assert.match(rootLayout, /recordAppOpened\(\)/);
  assert.match(rootLayout, /AppState\.addEventListener\("change"/);
  assert.match(rootLayout, /trackEvent\("app_foregrounded"/);
  assert.match(rootLayout, /updateLastActive\(\)/);
});
