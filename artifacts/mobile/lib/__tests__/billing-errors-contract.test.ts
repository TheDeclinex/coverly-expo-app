import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "lib/billing.ts"), "utf8");

test("billing failures return safe user copy while diagnostics remain development-only", () => {
  assert.match(source, /if \(!__DEV__\) return/);
  assert.doesNotMatch(source, /return \{ ok: false, error: error instanceof Error \? error\.message/);
  assert.doesNotMatch(source, /error: value\.message \?\?/);
  assert.match(source, /Purchases could not be restored\. Check your connection and try again\./);
});

test("cancelled purchases remain distinct from failed purchases", () => {
  assert.match(source, /const cancelled = value\.userCancelled === true/);
  assert.match(source, /cancelled[\s\S]*Purchase cancelled\./);
  assert.match(source, /Purchase could not be completed\. Check your connection and try again\./);
});
