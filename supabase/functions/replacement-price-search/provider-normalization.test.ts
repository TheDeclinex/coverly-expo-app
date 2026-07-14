import assert from "node:assert/strict";
import test from "node:test";

import {
  countRawProviderResults,
  normalizeOrganicResults,
  normalizeShoppingResults,
} from "./provider-normalization.ts";

test("raw provider counts are measured before normalization and limits", () => {
  const payload = { shopping: [{ title: "One" }, null, { title: "Two" }] };
  assert.equal(countRawProviderResults(payload, "shopping"), 3);
  assert.equal(normalizeShoppingResults(payload, 2).length, 1);
  assert.equal(countRawProviderResults(payload, "organic"), 0);
});

test("structured Shopping prices survive normalization", () => {
  const [result] = normalizeShoppingResults(
    {
      shopping: [
        {
          title: "HP Pavilion 14-inch Laptop",
          source: "Harvey Norman",
          link: "https://example.co.nz/product/hp-pavilion-14",
          price: "$1,699.00",
          extractedPrice: 1499,
        },
      ],
    },
    10,
  );
  assert.equal(result.price, 1499);
  assert.equal(result.priceRaw, "1499");
  assert.equal(result.priceSource, "structured");
  assert.equal(result.providerType, "shopping");
});

test("organic current-price snippets are parsed but starting prices remain unavailable", () => {
  const results = normalizeOrganicResults(
    {
      organic: [
        {
          title: "HP Pavilion 14 Laptop",
          link: "https://example.co.nz/product/hp-pavilion-14",
          snippet: "Our Price $1,299.00. SAVE $200.",
        },
        {
          title: "14-inch Laptops",
          link: "https://example.co.nz/laptops",
          snippet: "Starting from $999.00",
        },
      ],
    },
    10,
  );
  assert.equal(results[0].price, 1299);
  assert.equal(results[0].priceSource, "text");
  assert.equal(results[1].price, null);
  assert.equal(results[1].priceRaw, "");
});
