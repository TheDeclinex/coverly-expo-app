import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrency, formatCurrencyFull } from "../inventory-mappers.ts";
import { formatCurrencyTotals, formatMoney, formatPropertyMoney, groupAmountsByCurrency, moneyDisplayToken } from "../money.ts";

test("compact money uses familiar symbols in matching property context", () => {
  for (const [currency, locale, expected] of [
    ["NZD", "en-NZ", "$1,250"],
    ["AUD", "en-AU", "$1,250"],
    ["USD", "en-US", "$1,250"],
    ["CAD", "en-CA", "$1,250"],
    ["GBP", "en-GB", "£1,250"],
    ["EUR", "en-IE", "€1,250"],
    ["INR", "en-IN", "₹1,250"],
    ["JPY", "en", "¥1,250"],
    ["KRW", "en", "₩1,250"],
  ]) {
    assert.equal(formatMoney(1250, currency, { contextCurrency: currency, locale }), expected);
  }
  assert.equal(formatMoney(1250.5, "NZD", { contextCurrency: "NZD", locale: "en-NZ" }), "$1,250.50");
  assert.equal(formatMoney(1250.99, "NZD", { contextCurrency: "NZD", locale: "en-NZ" }), "$1,250.99");
  assert.equal(formatMoney(1250.5, "EUR", { contextCurrency: "EUR", locale: "de-DE" }), "1.250,50 €");
  assert.equal(moneyDisplayToken("NZD"), "$");
});

test("foreign, mixed, and context-free currencies are explicit", () => {
  assert.equal(formatMoney(1250, "NZD", { contextCurrency: "AUD", locale: "en-AU" }), "NZ$1,250");
  assert.equal(formatMoney(1250, "AUD", { contextCurrency: "NZD", locale: "en-NZ" }), "A$1,250");
  assert.equal(formatMoney(1250, "USD", { contextCurrency: "NZD", locale: "en-NZ" }), "US$1,250");
  assert.equal(formatMoney(1250, "CAD", { contextCurrency: "NZD", locale: "en-NZ" }), "CA$1,250");
  assert.equal(formatMoney(1250.5, "NZD", { contextCurrency: "AUD", locale: "en-AU" }), "NZ$1,250.50");
  assert.equal(formatMoney(1250, "NZD", { locale: "en-NZ" }), "NZ$1,250");
  assert.equal(formatCurrencyTotals({ NZD: 5000, AUD: 1200 }), "NZ$5,000 · A$1,200");
});

test("formal money keeps ISO codes and normal currency precision", () => {
  assert.match(formatMoney(1250, "CHF", { locale: "de-CH" }), /CHF/);
  assert.equal(formatMoney(125000, "JPY", { contextCurrency: "JPY", locale: "en" }), "¥125,000");
  assert.equal(formatMoney(125000, "KRW", { contextCurrency: "KRW", locale: "en" }), "₩125,000");
  assert.equal(formatMoney(1250, "NZD", { mode: "formal", locale: "en-NZ" }), "NZD 1,250.00");
  assert.equal(formatMoney(1250, "AUD", { mode: "formal", locale: "en-AU" }), "AUD 1,250.00");
  assert.equal(formatMoney(125000, "JPY", { mode: "formal", locale: "en" }), "JPY 125,000");
  assert.equal(formatMoney(null, "NZD"), "—");
  assert.equal(formatMoney(Number.NaN, "NZD"), "—");
  assert.equal(formatMoney(10, "bad1"), "—");
});

test("currency grouping never converts or combines currencies", () => {
  const totals = groupAmountsByCurrency(
    [{ amount: 10, currency: "NZD" }, { amount: 20, currency: "AUD" }, { amount: 5, currency: "NZD" }],
    (value) => value.amount,
    (value) => value.currency,
  );
  assert.deepEqual(totals, { NZD: 15, AUD: 20 });
});

test("database-valid historic and special currencies remain visible and grouped", () => {
  for (const currency of ["XDR", "XAU", "XAG"]) {
    assert.equal(formatMoney(1250, currency, { mode: "explicit", locale: "en" }), `${currency} 1,250`);
  }
  assert.deepEqual(
    groupAmountsByCurrency(
      [{ amount: 1250, currency: "XDR" }, { amount: 10, currency: "NZD" }],
      (value) => value.amount,
      (value) => value.currency,
    ),
    { XDR: 1250, NZD: 10 },
  );
  assert.equal(formatCurrencyTotals({ XDR: 1250, NZD: 10 }), "XDR 1,250 · NZ$10");
});

test("single-property display inherits one currency across property, room, and item totals", () => {
  const propertyTotal = formatCurrency(81443.99, "NZD");
  const roomTotal = formatCurrencyTotals({ NZD: 58000 }, { contextCurrency: "NZD" });
  const itemTotal = formatCurrencyFull(200, "NZD");

  assert.equal(propertyTotal, "$81,443.99");
  assert.equal(roomTotal, "$58,000");
  assert.equal(itemTotal, "$200.00");
  assert.equal(formatCurrencyFull(200.25, "NZD"), "$200.25");
  assert.equal(formatCurrency(1250, null), "$1,250");
  assert.equal(formatPropertyMoney(1250, null, null), "$1,250");
  assert.equal(formatCurrency(1250, "GBP"), "£1,250");
  for (const output of [propertyTotal, roomTotal, itemTotal]) {
    assert.doesNotMatch(output, /NZ\$|NZD/);
  }
});

test("Hermes Apple fallback formats money when NumberFormat.formatToParts is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "formatToParts");
  assert.ok(descriptor);
  Object.defineProperty(Intl.NumberFormat.prototype, "formatToParts", {
    configurable: true,
    value: undefined,
  });

  try {
    for (const [currency, locale, expected] of [
      ["NZD", "en-NZ", "$1,250"],
      ["AUD", "en-AU", "$1,250"],
      ["USD", "en-US", "$1,250"],
      ["CAD", "en-CA", "$1,250"],
      ["GBP", "en-GB", "£1,250"],
      ["EUR", "en-IE", "€1,250"],
      ["INR", "en-IN", "₹1,250"],
      ["JPY", "en", "¥1,250"],
      ["KRW", "en", "₩1,250"],
    ]) {
      assert.equal(formatMoney(1250, currency, { contextCurrency: currency, locale }), expected);
    }

    assert.equal(formatMoney(1250.5, "NZD", { contextCurrency: "NZD", locale: "en-NZ" }), "$1,250.50");
    assert.equal(formatMoney(1250.99, "NZD", { contextCurrency: "NZD", locale: "en-NZ" }), "$1,250.99");
    assert.equal(formatMoney(81443.99, "NZD", { contextCurrency: "NZD" }), "$81,443.99");
    assert.equal(formatMoney(200, "NZD", { contextCurrency: "NZD", trimWholeDecimals: false }), "$200.00");
    assert.equal(formatMoney(1250.5, "EUR", { contextCurrency: "EUR", locale: "de-DE" }), "1.250,50 €");
    assert.equal(formatMoney(1250, "NZD", { contextCurrency: "AUD", locale: "en-AU" }), "NZ$1,250");
    assert.equal(formatMoney(1250, "AUD", { contextCurrency: "NZD", locale: "en-NZ" }), "A$1,250");
    assert.equal(formatMoney(1250, "USD", { contextCurrency: "NZD", locale: "en-NZ" }), "US$1,250");
    assert.equal(formatMoney(1250, "CAD", { contextCurrency: "NZD", locale: "en-NZ" }), "CA$1,250");
    assert.equal(formatMoney(1250, "NZD", { mode: "formal", locale: "en-NZ" }), "NZD 1,250.00");
    assert.equal(formatMoney(125000, "JPY", { mode: "formal", locale: "en" }), "JPY 125,000");

    for (const currency of ["XDR", "XAU", "XAG"]) {
      assert.equal(formatMoney(1250, currency, { mode: "explicit", locale: "en" }), `${currency} 1,250`);
    }
    assert.equal(formatCurrencyTotals({ XDR: 1250, NZD: 10 }), "XDR 1,250 · NZ$10");
  } finally {
    Object.defineProperty(Intl.NumberFormat.prototype, "formatToParts", descriptor);
  }
});
