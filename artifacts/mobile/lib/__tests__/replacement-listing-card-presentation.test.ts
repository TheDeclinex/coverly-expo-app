import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

import { replacementListingFulfilmentLabel } from "../replacement-listing-policy.ts";

const cardSource = readFileSync(
  new URL("../../components/ReplacementListingCard.tsx", import.meta.url),
  "utf8",
);

test("unknown and local results omit retailer-location status", () => {
  assert.equal(replacementListingFulfilmentLabel("unknown"), null);
  assert.equal(replacementListingFulfilmentLabel("local"), null);
  assert.doesNotMatch(cardSource, /Retailer location unconfirmed|Local retailer/);
});

test("the fulfilment status row is mounted only when a label exists", () => {
  assert.match(cardSource, /\{fulfilmentLabel \? \(\s*<Text/);
  assert.match(cardSource, /\{fulfilmentLabel\}\s*<\/Text>\s*\) : null\}/);
});

test("overseas results retain their visible and accessible status", () => {
  assert.equal(replacementListingFulfilmentLabel("overseas"), "Overseas listing");
  assert.match(cardSource, /accessibilityLabel=\{fulfilmentLabel\}/);
});

test("core listing content and interactions remain present", () => {
  assert.match(cardSource, /\{result\.source\}/);
  assert.match(cardSource, /formatReplacementListingPrice\(result, contextCurrency\)/);
  assert.match(cardSource, /onPress=\{onOpen\}/);
  assert.match(cardSource, /Open listing/);
  assert.match(cardSource, /onPress=\{onUse\}/);
  assert.match(cardSource, /Use this listing/);
});
