import assert from "node:assert/strict";
import test from "node:test";

import { formatMoney, groupAmountsByCurrency } from "../money.ts";

test("money formatting disambiguates dollar currencies", () => {
  assert.match(formatMoney(1250, "NZD", { locale: "en-NZ" }), /NZ\$/);
  assert.match(formatMoney(1250, "AUD", { locale: "en-AU" }), /A\$/);
  assert.match(formatMoney(1250, "USD", { locale: "en-US" }), /US\$/);
  assert.match(formatMoney(1250, "CAD", { locale: "en-CA" }), /CA\$/);
});

test("money formatting supports European, formal, and zero-decimal currencies", () => {
  assert.match(formatMoney(1250, "EUR", { locale: "de-DE" }), /€/);
  assert.match(formatMoney(1250, "CHF", { locale: "de-CH" }), /CHF/);
  assert.equal(formatMoney(125000, "JPY", { locale: "ja-JP" }).includes(".00"), false);
  assert.equal(formatMoney(125000, "KRW", { locale: "ko-KR" }).includes(".00"), false);
  assert.match(formatMoney(1250, "NZD", { formal: true, locale: "en-NZ" }), /NZD/);
  assert.equal(formatMoney(null, "NZD"), "—");
  assert.equal(formatMoney(Number.NaN, "NZD"), "—");
});

test("currency grouping never converts or combines currencies", () => {
  const totals = groupAmountsByCurrency(
    [{ amount: 10, currency: "NZD" }, { amount: 20, currency: "AUD" }, { amount: 5, currency: "NZD" }],
    (value) => value.amount,
    (value) => value.currency,
  );
  assert.deepEqual(totals, { NZD: 15, AUD: 20 });
});
