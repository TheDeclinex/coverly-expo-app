import assert from "node:assert/strict";
import test from "node:test";

import { findPotentialDuplicateGroups, normalizeDuplicateItemName } from "../potential-duplicates.ts";

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, ...extra });

test("normalizes punctuation, spacing, inch labels, and safe aliases", () => {
  assert.equal(normalizeDuplicateItemName('  Samsung  55-inch Television! '), "samsung 55 tv");
  assert.equal(normalizeDuplicateItemName("Apple Watch Series 8"), "apple watch s8");
});

test("groups exact and conservative formatting variants", () => {
  const groups = findPotentialDuplicateGroups([
    item("a", "Samsung 55 TV", { brand_maker: "Samsung", category: "Electronics" }),
    item("b", "Samsung 55-inch Television", { brand_maker: "Samsung", category: "Electronics" }),
    item("c", "Dining chair", { category: "Furniture" }),
  ]);
  assert.deepEqual(groups.map((group) => group.items.map((candidate) => candidate.id)), [["a", "b"]]);
});

test("does not group on category or value alone", () => {
  const groups = findPotentialDuplicateGroups([
    item("a", "Coffee table", { category: "Furniture", estimated_price: 500 }),
    item("b", "Dining chair", { category: "Furniture", estimated_price: 500 }),
  ]);
  assert.equal(groups.length, 0);
});

test("uses matching model and brand only when names still resemble each other", () => {
  const groups = findPotentialDuplicateGroups([
    item("a", "Sony Bravia television", { brand_maker: "Sony", model_series: "XR55" }),
    item("b", "Sony Bravia TV", { brand_maker: "Sony", model_series: "XR55" }),
    item("c", "Sony soundbar", { brand_maker: "Sony", model_series: "XR55" }),
  ]);
  assert.deepEqual(groups.map((group) => group.items.map((candidate) => candidate.id)), [["a", "b"]]);
});
