import {
  normalizeOrganicResults,
  normalizeShoppingResults,
} from "./provider-normalization.ts";
import { buildReplacementExternalQuery } from "./query-model.ts";
import { replacementRegressionFixtures } from "./regression-fixtures.ts";
import {
  evaluateReplacementResult,
  rankAndFilterReplacementResults,
  type ReplacementResultCandidate,
} from "./result-quality.ts";

const PROVIDER_PRICE_FIELDS = [
  "salePrice",
  "currentPrice",
  "extractedPrice",
  "priceValue",
  "offerPrice",
  "offers",
  "price",
];

function providerPriceFields(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    PROVIDER_PRICE_FIELDS.filter((field) => field in raw).map((field) => [
      field,
      raw[field],
    ]),
  );
}

function diagnostic(
  raw: Record<string, unknown>,
  candidate: ReplacementResultCandidate,
  context: (typeof replacementRegressionFixtures)[number]["context"],
) {
  const evaluation = evaluateReplacementResult(candidate, context);
  return {
    providerRequestType: candidate.providerType,
    rawTitle: raw.title ?? null,
    rawUrl: raw.link ?? raw.productLink ?? raw.url ?? null,
    rawSnippet: raw.snippet ?? raw.description ?? null,
    providerPriceFields: providerPriceFields(raw),
    parsedPrice: candidate.price,
    parsedPriceSource: candidate.priceSource,
    pageClassification: evaluation.classification,
    relevanceScore: evaluation.relevanceScore,
    matchLabel: evaluation.matchType,
    rejectionReason: evaluation.rejectionReason,
  };
}

const report = replacementRegressionFixtures.map((fixture, fixtureIndex) => {
  const shopping = normalizeShoppingResults({ shopping: fixture.shopping }, 10);
  const acceptedShopping = rankAndFilterReplacementResults(
    shopping,
    fixture.context,
    10,
  );
  const organicFallbackUsed = !acceptedShopping.some(
    (result) => result.price != null && result.price > 0,
  );
  const organic = normalizeOrganicResults({ organic: fixture.organic }, 10);
  const candidates = organicFallbackUsed ? [...shopping, ...organic] : shopping;
  const ranked = rankAndFilterReplacementResults(
    candidates,
    fixture.context,
    10,
  );
  const request = {
    itemName: fixture.context.itemName,
    country: "NZ",
    num: 10,
    ...(fixture.context.searchTerm
      ? { searchQuery: fixture.context.searchTerm }
      : {}),
    ...(fixture.context.brand ? { brand: fixture.context.brand } : {}),
    ...(fixture.context.model ? { model: fixture.context.model } : {}),
    ...(fixture.context.category ? { category: fixture.context.category } : {}),
  };

  return {
    search: fixture.name,
    finalProviderQuery: buildReplacementExternalQuery(request),
    providerStrategy: organicFallbackUsed
      ? "shopping_then_organic_fallback"
      : "shopping_only",
    organicFallbackUsed,
    diagnostics: [
      ...fixture.shopping.map((raw, index) =>
        diagnostic(raw, shopping[index], fixture.context),
      ),
      ...fixture.organic.map((raw, index) => ({
        ...diagnostic(raw, organic[index], fixture.context),
        usedBySimulatedProviderStrategy: organicFallbackUsed,
      })),
    ],
    ranked: ranked.map((result, index) => ({
      rank: index + 1,
      title: result.title,
      price: result.price,
      matchLabel: result.matchType,
      url: result.link,
    })),
    fixtureIndex,
  };
});

console.log(JSON.stringify(report, null, 2));
