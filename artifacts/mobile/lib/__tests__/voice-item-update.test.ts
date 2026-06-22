import assert from "node:assert/strict";
import test from "node:test";

import { buildVoiceItemUpdatePayload } from "../voice-item-update.ts";

test("builds a narrow payload from approved voice fields", () => {
  const update = buildVoiceItemUpdatePayload({
    name: "  Lounge television  ",
    quantity: 2,
    brand_maker: "Samsung",
    notes: "Receipt attached",
  });

  assert.deepEqual(update, {
    name: "Lounge television",
    quantity: 2,
    brand_maker: "Samsung",
    notes: "Receipt attached",
  });
  for (const key of ["barcode", "web_listing_url", "attachments", "image_url", "room_id", "category", "condition_label"]) {
    assert.equal(key in update, false, `${key} must be preserved`);
  }
});

test("replacement price writes the unit value without multiplying quantity", () => {
  const update = buildVoiceItemUpdatePayload({
    quantity: 3,
    unit_estimated_price: 239,
    estimated_price: 239,
    price_source_type: "user_entered",
    valuation_basis: "manual",
  });

  assert.equal(update.quantity, 3);
  assert.equal(update.unit_estimated_price, 239);
  assert.equal(update.estimated_price, 239);
  assert.equal(update.price_source_type, "user_entered");
  assert.equal(update.valuation_basis, "manual");
});

test("quantity-only update preserves valuation source", () => {
  const update = buildVoiceItemUpdatePayload({ quantity: 4 });
  assert.deepEqual(update, { quantity: 4 });
  assert.equal("price_source_type" in update, false);
  assert.equal("valuation_basis" in update, false);
});

test("original price does not change replacement valuation", () => {
  const update = buildVoiceItemUpdatePayload({ original_purchase_price: 1500 });
  assert.deepEqual(update, { original_purchase_price: 1500 });
  assert.equal("estimated_price" in update, false);
  assert.equal("unit_estimated_price" in update, false);
});

test("rejects invalid required and numeric values", () => {
  assert.throws(() => buildVoiceItemUpdatePayload({ name: "  " }), /cannot be empty/);
  assert.throws(() => buildVoiceItemUpdatePayload({ quantity: 0 }), /whole number/);
  assert.throws(
    () => buildVoiceItemUpdatePayload({ unit_estimated_price: -1 }),
    /zero or more/,
  );
});
