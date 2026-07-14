export type ReplacementResultPageKind =
  | "product"
  | "collection"
  | "article"
  | "video"
  | "homepage"
  | "search"
  | "trade_in"
  | "support"
  | "unknown";

export interface ReplacementResultQualityContext {
  itemName: string;
  searchTerm?: string;
  brand?: string;
  model?: string;
  category?: string;
  preferredRetailer?: string;
}

export interface ReplacementResultCandidate {
  title: string;
  source: string;
  price: number | null;
  priceRaw: string;
  link: string;
  snippet?: string;
  thumbnail?: string;
  position: number;
  providerType: "shopping" | "organic";
  priceSource: "structured" | "text" | "none";
}

export interface QualifiedReplacementResult {
  title: string;
  source: string;
  price: number | null;
  priceRaw: string;
  link: string;
  snippet?: string;
  thumbnail?: string;
  position: number;
  matchType: "best_match" | "close_match" | "similar_item";
}

export interface ReplacementResultEvaluation {
  classification: ReplacementResultPageKind;
  accepted: boolean;
  rejectionReason: string | null;
  relevanceScore: number;
  matchType: QualifiedReplacementResult["matchType"] | null;
}

const NON_IDENTITY_WORDS = new Set([
  "and",
  "audio",
  "black",
  "blue",
  "brown",
  "for",
  "from",
  "general",
  "green",
  "item",
  "electronics",
  "new",
  "only",
  "orange",
  "pink",
  "purple",
  "red",
  "replacement",
  "silver",
  "the",
  "used",
  "white",
  "wireless",
  "with",
]);

function normalise(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function terms(value: string | undefined): string[] {
  return normalise(value)
    .split(" ")
    .filter(
      (word) =>
        word.length > 2 && !NON_IDENTITY_WORDS.has(word) && !/^\d+$/.test(word),
    );
}

function productTerms(context: ReplacementResultQualityContext): string[] {
  return [
    ...new Set([
      ...terms(context.itemName),
      ...terms(context.searchTerm),
      ...terms(context.category),
    ]),
  ].filter(
    (word) =>
      !terms(context.brand).includes(word) &&
      !terms(context.model).includes(word),
  );
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function contextText(context: ReplacementResultQualityContext): string {
  return normalise(
    `${context.itemName} ${context.searchTerm ?? ""} ${context.category ?? ""}`,
  );
}

function expectedTypeTerms(context: ReplacementResultQualityContext): string[] {
  const text = contextText(context);
  const expected = new Set<string>();
  if (/\b(?:laptop|notebook)\b/.test(text)) {
    expected.add("laptop");
    expected.add("notebook");
  }
  if (/\bmonitor\b/.test(text) && /\b(?:riser|stand)\b/.test(text)) {
    expected.add("monitor riser");
    expected.add("monitor stand");
    expected.add("riser");
  }
  if (/\bsound\s*bar\b|\bsoundbar\b/.test(text)) expected.add("soundbar");
  if (/\bsubwoofer\b/.test(text)) expected.add("subwoofer");
  if (/\b(?:television|tv)\b/.test(text)) {
    expected.add("television");
    expected.add("tv");
  }
  if (/\bwasher|washing machine\b/.test(text)) expected.add("washer");
  return expected.size ? [...expected] : productTerms(context).slice(0, 3);
}

function titleHasExpectedType(
  title: string,
  context: ReplacementResultQualityContext,
): boolean {
  return expectedTypeTerms(context).some((term) => title.includes(term));
}

export function hasContradictoryProductType(
  candidate: Pick<ReplacementResultCandidate, "title" | "snippet">,
  context: ReplacementResultQualityContext,
): boolean {
  const expected = contextText(context);
  const result = normalise(`${candidate.title} ${candidate.snippet ?? ""}`);
  if (/\bmonitor\b/.test(expected) && /\b(?:riser|stand)\b/.test(expected)) {
    if (
      /\b(?:desk|monitor mount|monitor arm|mounting arm|wall mount|bracket)\b/.test(
        result,
      )
    )
      return true;
  }
  if (/\b(?:laptop|notebook)\b/.test(expected)) {
    if (
      /\b(?:bag|case|charger|dock|sleeve|battery|screen protector|laptop stand)\b/.test(
        result,
      )
    )
      return true;
  }
  if (/\b(?:soundbar|subwoofer)\b/.test(expected)) {
    if (/\b(?:mount|bracket|remote|replacement cable)\b/.test(result))
      return true;
  }
  if (/\b(?:television|tv)\b/.test(expected)) {
    if (
      /\b(?:wall mount|mounting bracket|remote control|replacement remote)\b/.test(
        result,
      )
    )
      return true;
  }
  return false;
}

function productSpecificPath(url: URL | null): boolean {
  if (!url) return false;
  return /\/(?:products?|item|dp)\/[^/?#]+/i.test(url.pathname);
}

function matchingAttributes(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): number {
  const title = normalise(candidate.title);
  const excluded = new Set([
    ...terms(context.brand),
    ...terms(context.model),
    ...expectedTypeTerms(context).flatMap((term) => terms(term)),
  ]);
  return [
    ...new Set(
      normalise(`${context.itemName} ${context.searchTerm ?? ""}`)
        .split(" ")
        .filter((term) => term.length > 1 && !excluded.has(term)),
    ),
  ].filter((term) => title.includes(term)).length;
}

function genericCollectionSignal(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): boolean {
  const url = safeUrl(candidate.link);
  const path = normalise(url?.pathname);
  const query = normalise(url?.search);
  const title = normalise(candidate.title);
  const brand = normalise(context.brand);
  const model = normalise(context.model);
  const exactModel = Boolean(model) && title.includes(model);
  const productPath = productSpecificPath(url);

  if (candidate.title.includes(">")) return true;
  if (
    /\b(?:for work study everyday use|shop .* new zealand|all laptops|all products|view all|filter by|mounts accessories risers stands)\b/.test(
      title,
    )
  )
    return true;
  if (
    /\b(?:collections?|categories?|catalog|product category|filtered products?)\b/.test(
      path,
    ) &&
    !productPath
  )
    return true;
  if (
    /\b(?:filter|filters|facet|facets|category|sort|page|product list order)\b/.test(
      query,
    )
  )
    return true;
  if (
    /\/(?:shop|laptops?|notebooks?|soundbars?|subwoofers?|monitors?|accessories)\/?$/i.test(
      url?.pathname ?? "",
    )
  )
    return true;
  if (
    brand &&
    title.startsWith(`${brand} `) &&
    !exactModel &&
    /\b(?:products?|laptops?|notebooks?|audio|soundbars?|subwoofers?|speakers?)\b$/.test(
      title,
    ) &&
    !productPath
  )
    return true;
  return false;
}

export function classifyReplacementResult(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): ReplacementResultPageKind {
  const url = safeUrl(candidate.link);
  const host = normalise(url?.hostname);
  const path = normalise(url?.pathname);
  const query = normalise(url?.search);
  const productPath = productSpecificPath(url);
  const text = normalise(
    `${candidate.title} ${candidate.snippet ?? ""} ${path}`,
  );

  if (
    /\b(?:youtube|youtu be|vimeo)\b/.test(host) ||
    /\b(?:watch|videos?)\b/.test(path)
  )
    return "video";
  if (/\btrade in\b/.test(text)) return "trade_in";
  if (
    /\b(?:buying guide|buyers guide|best (?:soundbars?|subwoofers?|speakers?|televisions?|tvs?)|best .* to buy|blog|how to choose|review roundup)\b/.test(
      text,
    )
  )
    return "article";
  if (/\b(?:support|help centre|manuals?|downloads?|warranty)\b/.test(text))
    return "support";
  if (
    /\b(?:search|sitesearch)\b/.test(path) ||
    /\b(?:query|search|q)\b/.test(query)
  )
    return "search";
  if (
    candidate.providerType === "organic" &&
    url &&
    (url.pathname === "" || url.pathname === "/")
  )
    return "homepage";
  if (genericCollectionSignal(candidate, context)) return "collection";
  if (hasContradictoryProductType(candidate, context)) return "unknown";

  const model = normalise(context.model);
  const title = normalise(candidate.title);
  const brand = normalise(context.brand);
  const typeMatches = titleHasExpectedType(title, context);
  const brandMatches = !brand || title.includes(brand);
  const modelMatches = Boolean(model) && title.includes(model);
  const validPrice = candidate.price != null && candidate.price > 0;

  if (
    modelMatches ||
    (candidate.providerType === "shopping" &&
      candidate.priceSource === "structured" &&
      validPrice &&
      typeMatches) ||
    (productPath && typeMatches && brandMatches) ||
    (validPrice &&
      typeMatches &&
      brandMatches &&
      matchingAttributes(candidate, context) > 0)
  )
    return "product";
  return "unknown";
}

function assignMatchType(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): QualifiedReplacementResult["matchType"] {
  const title = normalise(candidate.title);
  const model = normalise(context.model);
  const brand = normalise(context.brand);
  const brandMatches = Boolean(brand) && title.includes(brand);
  const typeMatches = titleHasExpectedType(title, context);
  const attributeMatches = matchingAttributes(candidate, context);

  if (model && title.includes(model)) return "best_match";
  if (model) return "similar_item";
  if (typeMatches && (!brand || brandMatches) && attributeMatches > 0)
    return "close_match";
  return "similar_item";
}

function score(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): number {
  const title = normalise(candidate.title);
  const sourceAndLink = normalise(`${candidate.source} ${candidate.link}`);
  const hostname = safeUrl(candidate.link)?.hostname.toLowerCase() ?? "";
  const model = normalise(context.model);
  const brand = normalise(context.brand);
  const preferredRetailer = normalise(context.preferredRetailer);
  const typeMatches = titleHasExpectedType(title, context);
  const attributeMatches = matchingAttributes(candidate, context);
  return (
    (model && title.includes(model) ? 80 : 0) +
    (brand && title.includes(brand) ? 30 : 0) +
    (typeMatches ? 25 : 0) +
    attributeMatches * 8 +
    (candidate.price != null && candidate.price > 0 ? 20 : 0) +
    (candidate.providerType === "shopping" ? 18 : 0) +
    (candidate.priceSource === "structured" ? 15 : 0) +
    (hostname.endsWith(".nz") ? 8 : 0) +
    (preferredRetailer && sourceAndLink.includes(preferredRetailer) ? 10 : 0)
  );
}

function rejectionReason(classification: ReplacementResultPageKind): string {
  const reasons: Record<
    Exclude<ReplacementResultPageKind, "product">,
    string
  > = {
    collection: "category_or_collection_page",
    article: "article_or_buying_guide",
    video: "video_page",
    homepage: "retailer_homepage",
    search: "search_or_filter_page",
    trade_in: "trade_in_page",
    support: "support_page",
    unknown: "insufficient_product_identity_or_contradictory_type",
  };
  return reasons[
    classification as Exclude<ReplacementResultPageKind, "product">
  ];
}

export function evaluateReplacementResult(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): ReplacementResultEvaluation {
  const classification = classifyReplacementResult(candidate, context);
  const accepted = classification === "product";
  return {
    classification,
    accepted,
    rejectionReason: accepted ? null : rejectionReason(classification),
    relevanceScore: score(candidate, context),
    matchType: accepted ? assignMatchType(candidate, context) : null,
  };
}

export function rankAndFilterReplacementResults(
  candidates: ReplacementResultCandidate[],
  context: ReplacementResultQualityContext,
  limit: number,
): QualifiedReplacementResult[] {
  const seen = new Set<string>();
  return candidates
    .flatMap((candidate) => {
      const evaluation = evaluateReplacementResult(candidate, context);
      if (!evaluation.accepted || !evaluation.matchType) return [];
      const identity = normalise(candidate.link) || normalise(candidate.title);
      if (!identity || seen.has(identity)) return [];
      seen.add(identity);
      return [
        {
          candidate,
          qualityScore: evaluation.relevanceScore,
          matchType: evaluation.matchType,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.qualityScore - left.qualityScore ||
        left.candidate.position - right.candidate.position,
    )
    .slice(0, Math.max(0, limit))
    .map(({ candidate, matchType }) => ({
      title: candidate.title,
      source: candidate.source,
      price: candidate.price,
      priceRaw: candidate.priceRaw,
      link: candidate.link,
      ...(candidate.snippet ? { snippet: candidate.snippet } : {}),
      ...(candidate.thumbnail ? { thumbnail: candidate.thumbnail } : {}),
      position: candidate.position,
      matchType,
    }));
}
