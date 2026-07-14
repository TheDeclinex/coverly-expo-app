import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReplacementResult,
  rankAndFilterReplacementResults,
  type ReplacementResultCandidate,
} from "./result-quality.ts";

const context = {
  itemName: "Soundbar and subwoofer",
  searchTerm: "Sony soundbar wireless subwoofer",
  brand: "Sony",
  model: "HT-S400",
  category: "Home audio",
  preferredRetailer: "JB Hi-Fi",
};

function candidate(
  overrides: Partial<ReplacementResultCandidate>,
): ReplacementResultCandidate {
  return {
    title: "Unknown",
    source: "Unknown",
    price: null,
    priceRaw: "",
    link: "https://example.com/page",
    position: 1,
    providerType: "organic",
    priceSource: "none",
    ...overrides,
  };
}

test("product pages rank above and replace homepages and collection pages", () => {
  const results = rankAndFilterReplacementResults(
    [
      candidate({
        title: "JB Hi-Fi New Zealand",
        source: "JB Hi-Fi",
        link: "https://www.jbhifi.co.nz/",
        position: 1,
      }),
      candidate({
        title: "Soundbars | JB Hi-Fi",
        source: "JB Hi-Fi",
        link: "https://www.jbhifi.co.nz/collections/soundbars",
        position: 2,
      }),
      candidate({
        title: "Sony Audio",
        source: "Sony",
        link: "https://www.sony.co.nz/electronics/audio",
        position: 3,
      }),
      candidate({
        title: "Sony HT-S400 Soundbar with Wireless Subwoofer",
        source: "JB Hi-Fi",
        price: 449,
        priceRaw: "$449",
        link: "https://www.jbhifi.co.nz/products/sony-ht-s400",
        position: 4,
        providerType: "shopping",
        priceSource: "structured",
      }),
    ],
    context,
    10,
  );

  assert.deepEqual(
    results.map((result) => result.title),
    ["Sony HT-S400 Soundbar with Wireless Subwoofer"],
  );
  assert.equal(results[0].matchType, "best_match");
});

test("YouTube, buying-guide, and trade-in pages are excluded", () => {
  const results = rankAndFilterReplacementResults(
    [
      candidate({
        title: "Sony Soundbar Buying Guide",
        link: "https://example.com/blog/soundbar-buying-guide",
      }),
      candidate({
        title: "Sony HT-S400 Review Video",
        link: "https://youtube.com/watch?v=123",
      }),
      candidate({
        title: "Trade in your old soundbar",
        link: "https://example.com/trade-in/soundbar",
      }),
    ],
    context,
    10,
  );
  assert.deepEqual(results, []);
});

test("a specific product page may remain without a price", () => {
  const product = candidate({
    title: "Sony HT-S400 2.1ch Soundbar",
    source: "Sony New Zealand",
    link: "https://www.sony.co.nz/electronics/sound-bars/ht-s400",
  });
  assert.equal(classifyReplacementResult(product, context), "product");
  assert.deepEqual(
    rankAndFilterReplacementResults([product], context, 10).map(
      (result) => result.title,
    ),
    [product.title],
  );
});

test("generic identity-free pages are excluded and cannot receive Close match", () => {
  const generic = candidate({
    title: "Great deals available now",
    link: "https://example.com/promotions",
  });
  assert.equal(classifyReplacementResult(generic, context), "unknown");
  assert.deepEqual(rankAndFilterReplacementResults([generic], context, 10), []);
});

test("credible results are not padded to ten", () => {
  const credible = Array.from({ length: 5 }, (_, index) =>
    candidate({
      title: `Sony Soundbar Subwoofer Product ${index + 1}`,
      price: 300 + index * 20,
      priceRaw: `$${300 + index * 20}`,
      link: `https://example.com/products/sony-${index + 1}`,
      position: index + 1,
    }),
  );
  const filler = Array.from({ length: 5 }, (_, index) =>
    candidate({
      title: `Generic promotion ${index + 1}`,
      link: `https://example.com/promotions/${index + 1}`,
      position: index + 6,
    }),
  );
  assert.equal(
    rankAndFilterReplacementResults([...credible, ...filler], context, 10)
      .length,
    5,
  );
});
