import {
  normalizeOrganicResults,
  normalizeShoppingResults,
} from "./provider-normalization.ts";
import { buildReplacementExternalQuery } from "./query-model.ts";
import { replacementRegressionFixtures } from "./regression-fixtures.ts";
import {
  evaluateExactModelShoppingCoverage,
  planReplacementProviders,
} from "./retrieval-policy.ts";
import { finalizeReplacementResults } from "./finalize-results.ts";
import {
  evaluateReplacementResult,
  rankAndFilterReplacementResults,
  summarizeReplacementCandidates,
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
    queryProductType: evaluation.queryProductType,
    candidateProductTypes: evaluation.candidateProductTypes,
    eligibilitySignals: evaluation.eligibilitySignals,
    relevanceScore: evaluation.relevanceScore,
    matchLabel: evaluation.matchType,
    rejectionReason: evaluation.rejectionReason,
  };
}

const report = replacementRegressionFixtures.map((fixture) => {
  const shopping = normalizeShoppingResults({ shopping: fixture.shopping }, 10);
  const acceptedShopping = rankAndFilterReplacementResults(
    shopping,
    fixture.context,
    shopping.length,
  );
  const providerPlan = planReplacementProviders(fixture.context);
  const exactCoverage = fixture.context.model
    ? evaluateExactModelShoppingCoverage(acceptedShopping, fixture.context)
    : null;
  const organicRequested =
    providerPlan.requestOrganicInParallel || exactCoverage?.adequate === false;
  const organic = normalizeOrganicResults({ organic: fixture.organic }, 10);
  const candidates = organicRequested ? [...shopping, ...organic] : shopping;
  const finalized = finalizeReplacementResults(
    candidates,
    fixture.context,
    10,
  );
  const ranked = finalized.results;
  const request = {
    itemName: fixture.context.itemName,
    country: "NZ",
    num: 10,
    searchQuery: fixture.context.searchTerm ?? fixture.context.itemName,
    ...(fixture.context.brand ? { brand: fixture.context.brand } : {}),
    ...(fixture.context.model ? { model: fixture.context.model } : {}),
    ...(fixture.context.category ? { category: fixture.context.category } : {}),
  };
  const finalProviderQuery = buildReplacementExternalQuery(request);

  return {
    search: fixture.name,
    finalProviderQuery,
    queryAudit: {
      savedItemFields: fixture.context,
      sanitisedRequestFields: request,
      shoppingRequest: { q: finalProviderQuery, gl: "nz", hl: "en", num: 10 },
      organicRequest: { q: finalProviderQuery, gl: "nz", hl: "en", num: 10 },
      negativeTerms: [],
      priceBounds: null,
      conditionConstraint: null,
    },
    providerStrategy: providerPlan.strategy,
    organicRequested,
    exactModelCoverage: exactCoverage,
    candidateCounts: {
      shopping: summarizeReplacementCandidates(shopping, fixture.context),
      organic: summarizeReplacementCandidates(organic, fixture.context),
      merged: candidates.length,
      rankedBeforeConstraints: finalized.rankedCount,
      afterHardConstraints: finalized.constrainedCount,
      final: ranked.length,
    },
    diagnostics: [
      ...fixture.shopping.map((raw, index) =>
        diagnostic(raw, shopping[index], fixture.context),
      ),
      ...fixture.organic.map((raw, index) => ({
        ...diagnostic(raw, organic[index], fixture.context),
        usedBySimulatedProviderStrategy: organicRequested,
      })),
    ],
    ranked: ranked.map((result, index) => ({
      rank: index + 1,
      title: result.title,
      price: result.price,
      matchLabel: result.matchType,
      url: result.link,
    })),
  };
});

const output = process.argv.includes("--summary")
  ? report.map((entry) => ({
      search: entry.search,
      providerStrategy: entry.providerStrategy,
      organicRequested: entry.organicRequested,
      candidateCounts: entry.candidateCounts,
      hardRejections: entry.diagnostics
        .filter((candidate) => candidate.rejectionReason)
        .map((candidate) => ({
          title: candidate.rawTitle,
          reason: candidate.rejectionReason,
        })),
      ranked: entry.ranked,
    }))
  : report;

console.log(JSON.stringify(output, null, 2));
