import assert from "node:assert/strict";
import test from "node:test";

import { buildItemUpdatePayload } from "../item-insert-helpers.ts";

const base = {
  roomId: "room-1",
  roomName: "Lounge",
  name: "Television",
  description: "Large television",
  category: "Electronics",
  estimatedPrice: 1200,
  unitEstimatedPrice: 1200,
  quantity: 1,
};

test("undefined optional update fields are omitted and preserved", () => {
  const update = buildItemUpdatePayload(base);
  for (const key of ["notes", "brand_maker", "model_series", "condition_label", "purchase_source", "original_purchase_price", "purchase_year_approx", "valuation_basis", "price_source_type", "image_url", "photo_url", "attachments"]) {
    assert.equal(key in update, false, `${key} should be omitted`);
  }
});

test("explicit null clears optional fields", () => {
  const update = buildItemUpdatePayload({
    ...base,
    notes: null,
    brandMaker: null,
    modelSeries: null,
    conditionLabel: null,
    purchaseSource: null,
    originalPurchasePrice: null,
    purchaseYearApprox: null,
    valuationBasis: null,
    priceSourceType: null,
  });
  assert.equal(update.notes, null);
  assert.equal(update.brand_maker, null);
  assert.equal(update.model_series, null);
  assert.equal(update.condition_label, null);
  assert.equal(update.purchase_source, null);
  assert.equal(update.original_purchase_price, null);
  assert.equal(update.purchase_year_approx, null);
  assert.equal(update.valuation_basis, null);
  assert.equal(update.price_source_type, null);
});

test("explicit form fields update while unrelated metadata remains omitted", () => {
  const update = buildItemUpdatePayload({
    ...base,
    notes: "Receipt is in evidence",
    brandMaker: "Samsung",
    modelSeries: "QN90B",
    purchaseSource: "Harvey Norman",
    purchaseYearApprox: "2022",
    originalPurchasePrice: 1800,
  });
  assert.equal(update.notes, "Receipt is in evidence");
  assert.equal(update.brand_maker, "Samsung");
  assert.equal(update.model_series, "QN90B");
  assert.equal(update.purchase_source, "Harvey Norman");
  assert.equal(update.purchase_year_approx, "2022");
  assert.equal(update.original_purchase_price, 1800);
  assert.equal("condition_label" in update, false);
  assert.equal("price_source_type" in update, false);
});
