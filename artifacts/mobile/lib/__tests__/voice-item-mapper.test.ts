import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSelectedVoicePatch,
  mapVoiceItemExtraction,
  resolveAmbiguousPrice,
} from "../voice-item-mapper.ts";
import type { VoiceExtractionResult } from "../../types/voice.ts";

function extraction(overrides: Partial<VoiceExtractionResult> = {}): VoiceExtractionResult {
  return {
    display_name: null, description: null, category: null, brand: null, make: null,
    model: null, maker_artist_brand: null, model_title: null, serial_number: null,
    year_or_era: null, purchase_year: null, retailer_store_purchased_from: null,
    seller: null, purchase_source_type: null, purchase_price: null, estimated_value: null,
    quantity: null, currency: null, condition: null, material_medium: null,
    original_or_copy: null, pricing_match_terms: [], notes: null, raw_summary: null,
    uncertain_fields: [], ...overrides,
  };
}

test("maps item name", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "Rename this TV", extraction: extraction({ display_name: "Samsung 65 inch TV" }) });
  assert.deepEqual(change.patch, { name: "Samsung 65 inch TV" });
});

test("maps valid quantity and rejects invalid quantity", () => {
  assert.deepEqual(mapVoiceItemExtraction({ transcript: "Set quantity to two", extraction: extraction({ quantity: 2 }) })[0].patch, { quantity: 2 });
  assert.equal(mapVoiceItemExtraction({ transcript: "Set quantity", extraction: extraction({ quantity: 1.5 }) }).length, 0);
});

test("prefers maker/artist/brand for brand maker", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "Set brand", extraction: extraction({ maker_artist_brand: "Fisher & Paykel", brand: "F&P" }) });
  assert.deepEqual(change.patch, { brand_maker: "Fisher & Paykel" });
});

test("maps model title", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "Model QN90B", extraction: extraction({ model_title: "QN90B" }) });
  assert.deepEqual(change.patch, { model_series: "QN90B" });
});

test("maps purchase store and year", () => {
  const changes = mapVoiceItemExtraction({ transcript: "Bought from Harvey Norman in 2022", extraction: extraction({ retailer_store_purchased_from: "Harvey Norman", purchase_year: "2022" }) });
  assert.deepEqual(changes.map((change) => change.patch), [{ purchase_source: "Harvey Norman" }, { purchase_year_approx: "2022" }]);
});

test("maps explicit original purchase price", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "I bought it for 900 dollars", extraction: extraction({ purchase_price: 900 }) });
  assert.deepEqual(change.patch, { original_purchase_price: 900 });
});

test("maps explicit replacement price as a unit value without a total", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "Set replacement price to 1500 dollars", extraction: extraction({ estimated_value: 1500 }) });
  assert.deepEqual(change.patch, { estimated_price: 1500, unit_estimated_price: 1500, price_source_type: "user_entered", valuation_basis: "manual" });
  assert.equal("total" in change.patch, false);
});

test("maps notes", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "Add a note", extraction: extraction({ notes: "Small scratch on the left side" }) });
  assert.deepEqual(change.patch, { notes: "Small scratch on the left side" });
});

test("generic price requires resolution", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "Set price to 1500 dollars", extraction: extraction({ estimated_value: 1500 }) });
  assert.equal(change.field, "ambiguous_price");
  assert.equal(change.requiresResolution, true);
  assert.equal(change.selectedByDefault, false);
  assert.deepEqual(resolveAmbiguousPrice(change, "replacement_price").patch, { estimated_price: 1500, unit_estimated_price: 1500, price_source_type: "user_entered", valuation_basis: "manual" });
});

test("field targeting resolves generic price and uncertain changes default off", () => {
  const [price] = mapVoiceItemExtraction({ transcript: "Set price to 500", targetField: "replacement_price", extraction: extraction({ estimated_value: 500 }) });
  assert.equal(price.field, "replacement_price");
  const [name] = mapVoiceItemExtraction({ transcript: "Maybe rename it", extraction: extraction({ display_name: "Television", uncertain_fields: ["display_name"] }) });
  assert.equal(name.selectedByDefault, false);
});

test("field-targeted price accepts the legacy backend alternate price slot", () => {
  const [replacement] = mapVoiceItemExtraction({ transcript: "Set this to 650", targetField: "replacement_price", extraction: extraction({ purchase_price: 650 }) });
  assert.deepEqual(replacement.patch, { estimated_price: 650, unit_estimated_price: 650, price_source_type: "user_entered", valuation_basis: "manual" });
  const [original] = mapVoiceItemExtraction({ transcript: "I paid 400", targetField: "original_purchase_price", extraction: extraction({ estimated_value: 400 }) });
  assert.deepEqual(original.patch, { original_purchase_price: 400 });
});

test("selected patch includes only approved allowlisted changes", () => {
  const changes = mapVoiceItemExtraction({ transcript: "Samsung model QN90B", extraction: extraction({ brand: "Samsung", model: "QN90B" }) });
  const patch = buildSelectedVoicePatch(changes, new Set(["brand_maker"]));
  assert.deepEqual(patch, { brand_maker: "Samsung" });
  assert.equal("delete" in patch, false);
});
