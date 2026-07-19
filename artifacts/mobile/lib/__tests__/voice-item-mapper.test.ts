import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSelectedVoicePatch,
  mapVoiceItemExtraction,
  resolveAmbiguousPrice,
} from "../voice-item-mapper.ts";
import { buildItemInsertPayload } from "../item-insert-helpers.ts";
import type { VoiceExtractionResult } from "../../types/voice.ts";

function extraction(overrides: Partial<VoiceExtractionResult> = {}): VoiceExtractionResult {
  return {
    name: null, product_type: null, display_name: null, description: null, category: null, brand: null, make: null,
    model: null, maker_artist_brand: null, model_title: null, serial_number: null,
    year_or_era: null, purchase_year: null, retailer_store_purchased_from: null,
    seller: null, purchase_source_type: null, purchase_price: null, estimated_value: null,
    quantity: null, currency: null, condition: null, material_medium: null,
    original_or_copy: null, pricing_match_terms: [], notes: null, raw_summary: null,
    uncertain_fields: [], ...overrides,
  };
}

test("maps item name", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "Rename this TV", extraction: extraction({ name: "Samsung 65 inch TV" }) });
  assert.deepEqual(change.patch, { name: "Samsung 65 inch TV" });
});

test("builds a specific Traxxas item name from structured voice values", () => {
  const changes = mapVoiceItemExtraction({
    transcript: "Traxxas Revo 3 Nitro RC car, $2500.",
    extraction: extraction({
      brand: "Traxxas",
      model: "Revo 3 Nitro",
      product_type: "RC car",
      purchase_price: 2500,
      estimated_value: 2500,
      description: "Nitro-powered radio-controlled car",
    }),
  });
  const patch = buildSelectedVoicePatch(changes, new Set(changes.map((change) => change.id)));

  assert.equal(patch.name, "Traxxas Revo 3 Nitro RC Car");
  assert.equal(patch.brand_maker, "Traxxas");
  assert.equal(patch.model_series, "Revo 3 Nitro");
  assert.equal(patch.original_purchase_price, 2500);
  assert.equal(patch.unit_estimated_price, 2500);
  assert.equal(patch.estimated_price, 2500);
});

test("builds a Dyson item name while preserving retailer and year suggestions", () => {
  const changes = mapVoiceItemExtraction({
    transcript: "Dyson V15 vacuum cleaner bought from Harvey Norman in 2022.",
    extraction: extraction({
      brand: "Dyson",
      model: "V15",
      product_type: "vacuum cleaner",
      retailer_store_purchased_from: "Harvey Norman",
      purchase_year: "2022",
    }),
  });
  const patch = buildSelectedVoicePatch(changes, new Set(changes.map((change) => change.id)));

  assert.equal(patch.name, "Dyson V15 Vacuum Cleaner");
  assert.equal(patch.purchase_source, "Harvey Norman");
  assert.equal(patch.purchase_year_approx, "2022");
});

test("an existing item name is reviewed but only applied when explicitly selected", () => {
  const changes = mapVoiceItemExtraction({
    transcript: "Dyson V15 vacuum cleaner",
    currentValues: { name: "Cordless vacuum" },
    extraction: extraction({ brand: "Dyson", model: "V15", product_type: "vacuum cleaner" }),
  });
  const nameChange = changes.find((change) => change.field === "name");

  assert.ok(nameChange);
  assert.equal(nameChange.currentValue, "Cordless vacuum");
  assert.equal(nameChange.nextValue, "Dyson V15 Vacuum Cleaner");
  assert.equal(nameChange.selectedByDefault, false);
  assert.equal(buildSelectedVoicePatch(changes, new Set()).name, undefined);
  assert.equal(buildSelectedVoicePatch(changes, new Set(["name"])).name, "Dyson V15 Vacuum Cleaner");
});

test("does not fabricate a generic name from purchase-only speech", () => {
  const changes = mapVoiceItemExtraction({
    transcript: "Bought it in 2021 for $300.",
    extraction: extraction({ purchase_year: "2021", purchase_price: 300, estimated_value: 300 }),
  });
  const patch = buildSelectedVoicePatch(changes, new Set(changes.map((change) => change.id)));

  assert.equal(changes.some((change) => change.field === "name"), false);
  assert.equal(patch.name, undefined);
  assert.equal(patch.purchase_year_approx, "2021");
  assert.equal(patch.original_purchase_price, 300);
});

test("a selected generated name supplies the required manual item name", () => {
  const changes = mapVoiceItemExtraction({
    transcript: "Traxxas Revo 3 Nitro RC car, $2500.",
    extraction: extraction({ brand: "Traxxas", model: "Revo 3 Nitro", product_type: "RC car" }),
  });
  const patch = buildSelectedVoicePatch(changes, new Set(["name"]));
  assert.ok(patch.name?.trim());

  const insert = buildItemInsertPayload({
    fileId: "file-1",
    roomId: "00000000-0000-0000-0000-000000000001",
    name: patch.name!,
  });
  assert.equal(insert.name, "Traxxas Revo 3 Nitro RC Car");
});

test("falls back from spoken item phrase into structured add-item fields", () => {
  const changes = mapVoiceItemExtraction({
    transcript: "Samsung 65 inch LCD TV, $2000",
    extraction: extraction(),
  });
  const patch = buildSelectedVoicePatch(changes, new Set(changes.map((change) => change.id)));
  assert.equal(patch.name, "Samsung 65 inch LCD TV");
  assert.equal(patch.brand_maker, "Samsung");
  assert.equal(patch.category, "Electronics");
  assert.equal(patch.unit_estimated_price, 2000);
  assert.equal(patch.estimated_price, 2000);
  assert.equal(patch.original_purchase_price, 2000);
  assert.equal(patch.notes, undefined);
});

test("maps valid quantity and rejects invalid quantity", () => {
  assert.deepEqual(mapVoiceItemExtraction({ transcript: "Set quantity to two", extraction: extraction({ quantity: 2 }) })[0].patch, { quantity: 2 });
  assert.equal(mapVoiceItemExtraction({ transcript: "Set quantity", extraction: extraction({ quantity: 1.5 }) }).length, 0);
});

test("prefers maker/artist/brand for brand maker", () => {
  const [change] = mapVoiceItemExtraction({ transcript: "Set brand", extraction: extraction({ maker_artist_brand: "Fisher & Paykel", brand: "F&P" }) });
  assert.deepEqual(change.patch, { brand_maker: "Fisher & Paykel" });
});

test("field-targeted brand uses a plain transcript instead of an item-context guess", () => {
  const [change] = mapVoiceItemExtraction({
    transcript: "Bed Bath & Beyond.",
    targetField: "brand_maker",
    currentValues: { brand_maker: null },
    extraction: extraction({ maker_artist_brand: "Dark", uncertain_fields: ["maker_artist_brand"] }),
  });

  assert.deepEqual(change.patch, { brand_maker: "Bed Bath & Beyond" });
  assert.equal(change.selectedByDefault, true);
});

test("field-targeted brand accepts a plain transcript when extraction is empty", () => {
  const [change] = mapVoiceItemExtraction({
    transcript: "Bed Bath & Beyond.",
    targetField: "brand_maker",
    extraction: extraction(),
  });

  assert.deepEqual(change.patch, { brand_maker: "Bed Bath & Beyond" });
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
  const [name] = mapVoiceItemExtraction({ transcript: "Maybe rename it", extraction: extraction({ name: "Television", uncertain_fields: ["name"] }) });
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
