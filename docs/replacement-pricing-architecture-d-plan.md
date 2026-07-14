# Replacement pricing Architecture D plan

Status: Phase 2 technical design only. Do not implement without explicit approval.

## Objective

Evolve the Phase 1 hybrid retrieval recovery into a maintainable, measurable
replacement-pricing system without another single-step rewrite.

The target system should optimize for useful-product recall first, then product
type, price confidence, ranking quality, latency, and provider cost.

## Proposed modules

### `search-intent.ts`

Builds a structured intent from saved item fields and explicit refinements.

- Separates confirmed facts from inferred preferences.
- Records confidence and provenance for brand, model, product type, colour,
  dimensions, capacity, condition, retailer and price bounds.
- Produces a stable fingerprint for caching and evaluation.

### `provider-query.ts`

Creates provider-specific requests from one structured intent.

- Shopping query emphasizes product identity, model and locale.
- Organic query emphasizes direct retailer product discovery.
- Hard constraints remain structured and are not entrusted to query text.

### `provider-adapters/`

Owns provider request, timeout, response validation and normalization.

- Preserves raw field provenance.
- Produces the same normalized candidate contract for every provider.
- Does not make relevance or final eligibility decisions.

### `candidate-signals.ts`

Computes soft, explainable features.

- page-kind confidence;
- product-type confidence;
- exact model and brand signals;
- attribute matches and conflicts;
- accessory likelihood;
- price provenance and confidence;
- retailer and NZ relevance;
- provider rank and source.

### `candidate-cluster.ts`

Clusters equivalent product offers across providers and retailers.

- Canonical URL and merchant offer deduplication.
- Model/brand/title identity clustering.
- Keeps distinct retailer offers for price comparison.
- Aggregates Organic identity evidence with Shopping price evidence.

### `hard-exclusions.ts`

Contains the deliberately small set of terminal exclusions.

- video, article, support and trade-in pages;
- retailer homepages and clear search/category pages;
- high-confidence wrong product classes;
- high-confidence accessories for the queried main product.

Every exclusion must have a stable reason code and a labelled regression case.

### `candidate-ranker.ts`

Applies a deterministic, explainable score to eligible clusters and offers.

- Exact model and product type dominate.
- Brand and major attributes refine order.
- Price confidence, page specificity, retailer quality, provider source and NZ
  relevance contribute smaller priors.
- Missing or uncertain evidence lowers rank rather than causing deletion.

### `result-diversity.ts`

Prevents an otherwise high-scoring result set from becoming repetitive.

- Limits duplicate offers from one retailer.
- Preserves exact, close and similar coverage.
- Prevents accessories or one product family from crowding out alternatives.

### `quality-contract.ts`

Determines whether retrieval coverage is sufficient.

- Uses strong priced result count, exact/close coverage, retailer diversity,
  price confidence and contamination.
- Replaces raw or accepted-count thresholds.
- Controls exact-model short circuiting and future provider budgets.

### `search-cache.ts`

Provides short-lived caching by normalized intent fingerprint, country,
provider version and hard constraints.

- Does not persist user identity or raw descriptions in cache keys.
- Uses a short TTL appropriate to price freshness.
- Records cache age in diagnostics.

### `quality-telemetry.ts`

Emits privacy-safe aggregate retrieval metrics.

- Candidate survival by provider and reason.
- Final coverage, price confidence and zero-result outcome.
- Later client events may include opened listing, saved replacement price and
  immediate refinement, using opaque search/result identifiers.
- Must not record photos, free-form descriptions or personal inventory names.

## Data contracts

```ts
interface SearchIntent {
  intentId: string;
  country: string;
  productType: IntentValue<string>;
  brand?: IntentValue<string>;
  model?: IntentValue<string>;
  attributes: Record<string, IntentValue<string | number>>;
  condition?: "new" | "used";
  preferredRetailer?: string;
  priceBounds?: { min?: number; max?: number };
}

interface IntentValue<T> {
  value: T;
  confidence: "confirmed" | "high" | "medium" | "low";
  source: "saved_item" | "barcode" | "user_refinement" | "ai_inference";
}

interface NormalizedCandidate {
  candidateId: string;
  provider: "shopping" | "organic";
  providerPosition: number;
  title: string;
  source: string;
  url: string;
  snippet?: string;
  imageUrl?: string;
  price?: CandidatePrice;
  rawFieldProvenance: Record<string, string>;
}

interface CandidatePrice {
  value: number;
  currency: string;
  kind: "current" | "sale" | "reference" | "finance" | "from";
  confidence: "structured" | "text_high" | "text_low";
  raw: string;
}

interface CandidateSignals {
  candidateId: string;
  pageKind: ConfidenceLabel;
  productType: ConfidenceLabel;
  exactModel: number;
  brandMatch: number;
  attributeMatch: number;
  accessoryLikelihood: number;
  pageSpecificity: number;
  countryRelevance: number;
  priceConfidence: number;
  reasonCodes: string[];
}

interface RankedReplacementResult {
  resultId: string;
  clusterId: string;
  candidate: NormalizedCandidate;
  matchType: "best_match" | "close_match" | "similar_item";
  score: number;
  scoreReasons: Array<{ signal: string; contribution: number }>;
}
```

These are design contracts, not committed implementation APIs.

## Migration path from Phase 1

1. Freeze Phase 1 behavior with real anonymized provider captures and the
   existing deterministic fixture suite.
2. Introduce `SearchIntent` behind the existing request contract. Continue to
   accept current mobile fields and translate them server-side.
3. Move current normalization into provider adapters without changing output.
4. Add signal extraction alongside current classification and compare both in
   diagnostics without changing returned results.
5. Introduce clustering in shadow mode and measure offer loss/duplication.
6. Replace the current score with the explainable ranker behind a server-side
   version flag and offline evaluation gate.
7. Add diversity and quality-contract decisions.
8. Add short-term cache only after correctness and privacy review.
9. Remove legacy classification paths only after parity and rollback evidence.

No mobile contract change is required for stages 1–7. Any future response
metadata must remain optional until all supported clients can consume it.

## Labelled evaluation corpus

Start with anonymized provider payload captures for the eleven Phase 1 searches,
then expand across rooms and value bands.

Each candidate should be labelled for:

- same product class;
- exact, close, similar or irrelevant;
- product, category, article, homepage, support or search page;
- main product or accessory;
- usable current price and price provenance;
- should appear in the final result set;
- expected relative order where meaningful.

The corpus must contain provider payloads and labels only. Do not copy user IDs,
photos, property names or free-form private descriptions.

## Test strategy

### Unit tests

- intent extraction and confidence provenance;
- provider-specific query construction;
- normalization and price provenance;
- signal calculations and hard-exclusion reason codes;
- clustering and distinct-retailer offer preservation;
- ranking contribution explanations;
- diversity and quality-contract decisions;
- cache key privacy and TTL behavior.

### Offline evaluation

- recall of useful products;
- precision in the top three and top five;
- exact-model ranking rate;
- wrong-class/accessory rate;
- category-page rate;
- priced-result coverage;
- zero-result rate;
- provider contribution and overlap.

Changes should fail the evaluation gate if they materially reduce useful recall,
even when aggregate precision increases.

### Integration tests

- broad parallel retrieval;
- exact-model provider budgeting;
- partial provider failure;
- timeout and invalid JSON handling;
- one reservation and one terminal usage settlement;
- bounds before top-N;
- cache hit/miss behavior;
- response compatibility with the current mobile client.

## Risks

- Higher provider cost from broad dual retrieval.
- Increased latency if parallel requests are not bounded independently.
- Incorrect clustering may merge distinct models or remove retailer offers.
- Hand-tuned ranking weights can become a new source of hidden policy.
- Telemetry can create privacy risk if raw inventory text is retained.
- Cache freshness can present stale sale prices.
- Shadow and versioned paths increase temporary operational complexity.

Mitigations include timeouts, short TTLs, feature-version diagnostics, labelled
offline gates, opaque identifiers, no raw personal text in telemetry, and an
explicit server-side rollback path.

## Estimated implementation stages

1. Evaluation corpus and metrics harness: small/medium.
2. Structured intent and provider-query adapters: medium.
3. Soft feature extraction and shadow diagnostics: medium.
4. Cross-provider clustering: medium/high.
5. Explainable ranker and evaluation gates: high.
6. Diversity and quality contract: medium.
7. Privacy-safe telemetry: medium, with privacy review.
8. Short-term cache: medium, after freshness and privacy review.

Each stage should be reviewed and evaluated independently. Do not combine stages
2–8 into one release.

## Done looks like

- Broad searches consistently return useful same-type products.
- Exact models rank first without suppressing legitimate alternatives.
- Hard exclusions are few, explicit and regression-tested.
- Ranking decisions are explainable by stable signals.
- Price provenance and strict bounds remain authoritative.
- Quality can be measured on anonymized real provider captures before release.
- The current mobile request and response contract remains compatible.

## Do not change during Phase 2 preparation

- pricing limits or subscription behavior;
- mobile billing or item-save behavior;
- database schema or RLS;
- current deployment configuration;
- client contracts without an explicit compatibility plan;
- production traffic without explicit approval.
