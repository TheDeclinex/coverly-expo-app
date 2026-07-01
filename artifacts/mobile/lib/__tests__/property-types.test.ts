import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePropertyTypeValue,
  propertyTypeLabel,
} from "../../constants/propertyTypes.ts";

test("normalises legacy property type values to canonical values", () => {
  assert.equal(normalizePropertyTypeValue("rental"), "rental_property");
  assert.equal(normalizePropertyTypeValue("holiday"), "holiday_beach_house");
  assert.equal(normalizePropertyTypeValue("holiday_home"), "holiday_beach_house");
  assert.equal(normalizePropertyTypeValue("storage"), "storage_unit");
  assert.equal(normalizePropertyTypeValue("parents"), "parents_home");
});

test("labels canonical and legacy property type values consistently", () => {
  assert.equal(propertyTypeLabel("business"), "Business");
  assert.equal(propertyTypeLabel("rental_property"), "Rental property");
  assert.equal(propertyTypeLabel("rental"), "Rental property");
  assert.equal(propertyTypeLabel("holiday_beach_house"), "Holiday / beach house");
  assert.equal(propertyTypeLabel("holiday"), "Holiday / beach house");
});
