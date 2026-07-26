import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("onboarding replacement-pricing copy is market-neutral and support-qualified", () => {
  const onboarding = read("app/onboarding.tsx");

  assert.match(onboarding, /Find comparable local listings where supported and keep your item values current\./);
  assert.doesNotMatch(onboarding, /comparable NZ|New Zealand listings|Kiwi listings|Aotearoa listings/i);
});

test("the first-property empty room state makes Add room primary and keeps Scan items", () => {
  const property = read("app/(tabs)/property/[id].tsx");
  const emptyStateStart = property.indexOf('title="Add your first room"');
  const emptyState = property.slice(emptyStateStart, emptyStateStart + 3_500);

  assert.ok(emptyStateStart >= 0);
  assert.match(emptyState, /styles\.emptyRoomPrimaryAction[\s\S]*Add room/);
  assert.match(emptyState, /styles\.emptyRoomSecondaryAction[\s\S]*Scan items/);
  assert.match(emptyState, /setAddRoomVisible\(true\)/);
  assert.match(emptyState, /pathname: "\/\(tabs\)\/scan"/);
  assert.ok(emptyState.indexOf("Add room") < emptyState.indexOf("Scan items"));
});

test("the existing header Add room action remains available", () => {
  const property = read("app/(tabs)/property/[id].tsx");

  assert.match(property, /accessibilityLabel="Add room"[\s\S]*styles\.addRoomHeaderAction/);
});
