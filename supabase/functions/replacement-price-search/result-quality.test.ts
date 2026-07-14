import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReplacementResult,
  evaluateReplacementResult,
  inferQueryProductType,
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

test("broad Shopping products remain eligible without a known brand or model", () => {
  for (const [itemName, title] of [
    ["Black curved gaming monitor", "AOC CQ32G3SE Curved Gaming Display"],
    ["Black toaster", "Breville 4-Slice Black Toaster"],
    ["Black subwoofer speaker", "Polk HTS 10 Powered Subwoofer"],
  ] as const) {
    const product = candidate({
      title,
      price: 399,
      priceRaw: "$399",
      link: "https://example.co.nz/offer",
      providerType: "shopping",
      priceSource: "structured",
    });
    const evaluation = evaluateReplacementResult(product, { itemName });
    assert.equal(evaluation.accepted, true, `${itemName}: ${title}`);
  }
});

test("type aliases identify displays, powered subwoofers, toaster variants, and monitor shelves", () => {
  for (const [itemName, title] of [
    ["Curved monitor", "LG UltraGear Curved Gaming Display"],
    ["Subwoofer speaker", "Sony Wireless Powered Subwoofer"],
    ["Black toaster", "Russell Hobbs 4-Slice Black Toaster"],
    ["Monitor riser", "Bamboo Desktop Monitor Stand"],
    ["Monitor riser", "Black Monitor Shelf"],
  ] as const) {
    const product = candidate({
      title,
      link: "https://example.co.nz/p/specific-product/SKU1.html",
    });
    assert.equal(
      evaluateReplacementResult(product, { itemName }).accepted,
      true,
      `${itemName}: ${title}`,
    );
  }
  assert.equal(
    inferQueryProductType({ itemName: "Black curved gaming monitor" }),
    "monitor",
  );
  assert.equal(
    inferQueryProductType({ itemName: "Desktop monitor stand" }),
    "monitor_riser",
  );
});

test("common household product types remain eligible while clear accessories do not", () => {
  const cases = [
    {
      itemName: "Dyson vacuum cleaner",
      product: "Dyson V15 Detect Vacuum Cleaner",
      wrong: "Dyson V15 Replacement Filter for Vacuum Cleaner",
    },
    {
      itemName: "Microwave",
      product: "Panasonic 32L Inverter Microwave Oven",
      wrong: "Microwave Shelf and Storage Rack",
    },
    {
      itemName: "Dining chair",
      product: "Oak Upholstered Dining Chair",
      wrong: "Dining Chair Covers Set of 6",
    },
    {
      itemName: "Breville coffee machine",
      product: "Breville Barista Express Coffee Machine",
      wrong: "Breville Smart Grinder Coffee Grinder",
    },
  ];
  for (const entry of cases) {
    assert.equal(
      evaluateReplacementResult(
        candidate({
          title: entry.product,
          link: "https://retailer.co.nz/unfamiliar/product-location",
        }),
        { itemName: entry.itemName },
      ).accepted,
      true,
      entry.product,
    );
    const wrong = evaluateReplacementResult(
      candidate({
        title: entry.wrong,
        price: 99,
        priceRaw: "$99",
        link: "https://retailer.co.nz/products/accessory",
        providerType: "shopping",
        priceSource: "structured",
      }),
      { itemName: entry.itemName },
    );
    assert.equal(wrong.accepted, false, entry.wrong);
    assert.equal(wrong.rejectionReason, "contradictory_product_type");
  }
});

test("credible same-type Organic products do not require a known URL pattern or price", () => {
  for (const [itemName, title, link] of [
    [
      "Black curved gaming monitor",
      "AOC CQ32G3SE Curved Gaming Monitor",
      "https://retailer.co.nz/catalogue/sku-12345",
    ],
    [
      "Black subwoofer speaker",
      "Polk Audio Powered Subwoofer",
      "https://retailer.co.nz/audio/hts10",
    ],
    [
      "Black toaster",
      "Breville Black Toaster",
      "https://retailer.co.nz/kitchen/smart-toast",
    ],
  ] as const) {
    const evaluation = evaluateReplacementResult(
      candidate({ title, link }),
      { itemName },
    );
    assert.equal(evaluation.accepted, true, title);
  }
});

test("a different brand remains eligible but cannot become Close match", () => {
  const results = rankAndFilterReplacementResults(
    [
      candidate({
        title: "AOC 32-inch Curved Gaming Monitor",
        price: 499,
        priceRaw: "$499",
        link: "https://example.co.nz/products/aoc-curved-monitor",
        providerType: "shopping",
        priceSource: "structured",
      }),
    ],
    {
      itemName: "Samsung curved gaming monitor",
      brand: "Samsung",
    },
    10,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].matchType, "similar_item");
});

test("precision exclusions still reject monitor arms, desks, and TV accessories", () => {
  for (const [itemName, title] of [
    ["Monitor riser", "Adjustable Monitor Arm Mount"],
    ["Monitor stand", "Computer Desk with Built-in Monitor Stand"],
    ["Television", "Television Wall Mount Bracket"],
  ] as const) {
    const evaluation = evaluateReplacementResult(
      candidate({
        title,
        price: 99,
        priceRaw: "$99",
        link: "https://example.co.nz/products/accessory",
        providerType: "shopping",
        priceSource: "structured",
      }),
      { itemName },
    );
    assert.equal(evaluation.accepted, false, `${itemName}: ${title}`);
    assert.equal(evaluation.rejectionReason, "contradictory_product_type");
  }
});

test("merged provider candidates deduplicate matching URLs and products", () => {
  const duplicate = {
    title: "Breville 4-Slice Black Toaster",
    price: 129,
    priceRaw: "$129",
    link: "https://example.co.nz/p/breville-toaster?source=google",
  };
  const results = rankAndFilterReplacementResults(
    [
      candidate({
        ...duplicate,
        providerType: "shopping",
        priceSource: "structured",
      }),
      candidate({
        ...duplicate,
        link: "https://example.co.nz/p/breville-toaster?source=organic",
        providerType: "organic",
        priceSource: "text",
      }),
      candidate({
        ...duplicate,
        link: "https://another.example.co.nz/products/breville-toaster",
        providerType: "organic",
        priceSource: "text",
      }),
    ],
    { itemName: "Black toaster" },
    10,
  );
  assert.equal(results.length, 1);
});

test("matching products from distinct retailers remain separate price offers", () => {
  const shared = {
    title: "Samsung QA65S95D 65-inch OLED 4K Smart TV",
    price: 4999,
    priceRaw: "$4,999",
    providerType: "shopping" as const,
    priceSource: "structured" as const,
  };
  const results = rankAndFilterReplacementResults(
    [
      candidate({
        ...shared,
        source: "Retailer One",
        link: "https://one.co.nz/products/qa65s95d",
      }),
      candidate({
        ...shared,
        source: "Retailer Two",
        link: "https://two.co.nz/products/qa65s95d",
      }),
    ],
    { itemName: "Television", model: "QA65S95D" },
    10,
  );
  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.matchType === "best_match"));
});
