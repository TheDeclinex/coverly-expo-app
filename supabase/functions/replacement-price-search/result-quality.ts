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
  queryProductType: string;
  candidateProductTypes: string[];
  eligibilitySignals: string[];
}

export interface ReplacementResultQualitySummary {
  candidateCount: number;
  acceptedCount: number;
  pricedAcceptedCount: number;
  rejectedCount: number;
  rejectionReasons: Record<string, number>;
}

type KnownProductType =
  | "coffee_machine"
  | "dining_chair"
  | "laptop"
  | "microwave"
  | "monitor"
  | "monitor_riser"
  | "soundbar"
  | "subwoofer"
  | "television"
  | "toaster"
  | "vacuum_cleaner"
  | "washer";

const PRODUCT_TYPE_ALIASES: Record<KnownProductType, string[]> = {
  coffee_machine: ["coffee machine", "espresso machine", "coffee maker"],
  dining_chair: ["dining chair"],
  laptop: ["laptop", "notebook"],
  microwave: ["microwave oven", "microwave"],
  monitor: ["monitor", "display"],
  monitor_riser: [
    "monitor riser",
    "monitor stand",
    "desktop monitor stand",
    "monitor shelf",
  ],
  soundbar: ["soundbar", "sound bar"],
  subwoofer: ["subwoofer"],
  television: ["television", "smart tv", "oled tv", "qled tv", "tv"],
  toaster: ["toaster"],
  vacuum_cleaner: ["vacuum cleaner", "vacuum"],
  washer: ["washer", "washing machine"],
};

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
    ...new Set([...terms(context.itemName), ...terms(context.searchTerm)]),
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
  return normalise(`${context.itemName} ${context.searchTerm ?? ""}`);
}

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${normalise(phrase)} `);
}

export function inferQueryProductType(
  context: ReplacementResultQualityContext,
): string {
  const text = contextText(context);
  if (/\b(?:coffee|espresso)\s+(?:machine|maker)\b/.test(text))
    return "coffee_machine";
  if (/\bdining\s+chairs?\b/.test(text)) return "dining_chair";
  if (
    /\b(?:monitor|display)\b/.test(text) &&
    /\b(?:riser|stand|shelf)\b/.test(text)
  )
    return "monitor_riser";
  if (/\b(?:laptop|notebook)\b/.test(text)) return "laptop";
  if (/\bmicrowave(?:\s+oven)?\b/.test(text)) return "microwave";
  if (/\b(?:monitor|display)\b/.test(text)) return "monitor";
  if (/\bsound\s*bar\b|\bsoundbar\b/.test(text)) return "soundbar";
  if (/\bsubwoofer\b/.test(text)) return "subwoofer";
  if (/\b(?:television|tv)\b/.test(text)) return "television";
  if (/\btoaster\b/.test(text)) return "toaster";
  if (/\bvacuum(?:\s+cleaner)?\b/.test(text)) return "vacuum_cleaner";
  if (/\bwasher|washing machine\b/.test(text)) return "washer";
  return productTerms(context)[0] ?? "unknown";
}

function expectedTypeTerms(context: ReplacementResultQualityContext): string[] {
  const inferred = inferQueryProductType(context);
  return inferred in PRODUCT_TYPE_ALIASES
    ? PRODUCT_TYPE_ALIASES[inferred as KnownProductType]
    : inferred === "unknown"
      ? []
      : [inferred];
}

export function inferCandidateProductTypes(
  candidate: Pick<ReplacementResultCandidate, "title">,
): string[] {
  const title = normalise(candidate.title);
  if (!title) return [];
  const found: string[] = [];
  for (const [productType, aliases] of Object.entries(PRODUCT_TYPE_ALIASES)) {
    if (aliases.some((alias) => containsPhrase(title, alias))) {
      found.push(productType);
    }
  }
  if (found.includes("monitor_riser")) {
    return found.filter((productType) => productType !== "monitor");
  }
  return found;
}

function titleHasExpectedType(
  title: string,
  context: ReplacementResultQualityContext,
): boolean {
  return expectedTypeTerms(context).some((term) => containsPhrase(title, term));
}

export function hasContradictoryProductType(
  candidate: Pick<ReplacementResultCandidate, "title" | "snippet">,
  context: ReplacementResultQualityContext,
): boolean {
  const expectedType = inferQueryProductType(context);
  const result = normalise(candidate.title);
  if (expectedType === "coffee_machine") {
    if (
      /\b(?:coffee grinder|replacement filters?|filter papers?|cleaning tablets?|portafilter|tamper|milk jug|coffee pods?)\b/.test(
        result,
      )
    )
      return true;
  }
  if (expectedType === "dining_chair") {
    if (
      /\b(?:dining table|chair covers?|chair cushions?|slipcovers?|replacement legs?)\b/.test(
        result,
      )
    )
      return true;
  }
  if (expectedType === "microwave") {
    if (
      /\b(?:microwave shelf|storage rack|microwave cover|turntable plate|replacement plate|microwave stand|microwave cabinet)\b/.test(
        result,
      )
    )
      return true;
  }
  if (expectedType === "vacuum_cleaner") {
    if (
      /\b(?:replacement filters?|vacuum bags?|replacement hose|vacuum hose|replacement battery|vacuum battery|vacuum heads?|floor heads?|brush attachments?|vacuum attachments?|vacuum charger)\b/.test(
        result,
      )
    )
      return true;
  }
  if (expectedType === "monitor_riser") {
    if (
      /\b(?:desk|monitor mount|monitor arm|mounting arm|wall mount|bracket)\b/.test(
        result,
      )
    )
      return true;
  }
  if (expectedType === "monitor") {
    if (
      /\b(?:monitor mount|monitor arm|wall mount|mounting bracket|monitor riser|monitor shelf|replacement stand|display stand|display mount|display arm|display cable)\b/.test(
        result,
      )
    )
      return true;
  }
  if (expectedType === "laptop") {
    if (
      /\b(?:bag|case|charger|dock|sleeve|battery|screen protector|laptop stand)\b/.test(
        result,
      )
    )
      return true;
  }
  if (expectedType === "soundbar" || expectedType === "subwoofer") {
    if (/\b(?:mount|bracket|remote|replacement cable)\b/.test(result))
      return true;
  }
  if (expectedType === "television") {
    if (
      /\b(?:wall mount|mounting bracket|remote control|replacement remote)\b/.test(
        result,
      )
    )
      return true;
  }
  if (expectedType === "toaster") {
    if (
      /\b(?:toaster cover|toast rack|sandwich cage|replacement element)\b/.test(
        result,
      )
    )
      return true;
  }
  return false;
}

function productSpecificPath(url: URL | null): boolean {
  if (!url) return false;
  if (/\/(?:products?|item|dp|p|productdetails?)\/[^/?#]+/i.test(url.pathname))
    return true;
  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  return (
    /\.html?$/i.test(lastSegment) &&
    !/^(?:index|products?|category|catalog)\.html?$/i.test(lastSegment)
  );
}

const GENERIC_IDENTITY_WORDS = new Set([
  "active",
  "audio",
  "black",
  "computer",
  "curved",
  "display",
  "gaming",
  "home",
  "inch",
  "monitor",
  "new",
  "only",
  "powered",
  "qhd",
  "slice",
  "smart",
  "speaker",
  "stainless",
  "steel",
  "subwoofer",
  "theatre",
  "toaster",
  "uhd",
  "wireless",
]);

function specificIdentityTerms(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): string[] {
  const contextTerms = new Set([
    ...terms(context.itemName),
    ...terms(context.searchTerm),
    ...terms(context.brand),
    ...terms(context.model),
    ...expectedTypeTerms(context).flatMap((term) => terms(term)),
  ]);
  return terms(candidate.title).filter(
    (term) => !contextTerms.has(term) && !GENERIC_IDENTITY_WORDS.has(term),
  );
}

function modelOrSpecificationSignal(title: string): boolean {
  return (
    /\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)*\b/i.test(
      title,
    ) || /\b\d+(?:\.\d+)?\s*(?:inch|hz|gb|tb|slice|channel|ch)\b/i.test(title)
  );
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
  const genericExpectedTypeTitle = expectedTypeTerms(context).some(
    (term) => title === normalise(term) || title === `${normalise(term)}s`,
  );

  if (candidate.title.includes(">")) return true;
  if (
    /\b(?:for work study everyday use|shop .* new zealand|all laptops|all products|view all|filter by|mounts accessories risers stands|find the best price|compare prices)\b/.test(
      title,
    )
  )
    return true;
  if (
    /^(?:gaming monitors|monitors|displays|toasters|vacuum cleaners|microwaves|dining chairs|coffee machines|home theatre speakers (?:and )?subwoofers|speakers (?:and )?subwoofers|laptops|notebooks|soundbars|subwoofers|televisions)$/i.test(
      title,
    )
  )
    return true;
  if (genericExpectedTypeTitle && !productPath && !modelOrSpecificationSignal(title))
    return true;
  if (
    /\b(?:collections?|categor(?:y|ies)|catalog|product category|filtered products?)\b/.test(
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
    /\/(?:shop|laptops?|notebooks?|soundbars?|subwoofers?|monitors?|displays?|gaming-monitors?|toasters?|vacuum-cleaners?|microwaves?|dining-chairs?|coffee-machines?|accessories)\/?$/i.test(
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

  const title = normalise(candidate.title);
  const typeMatches = titleHasExpectedType(title, context);
  if (typeMatches) return "product";
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
  if (
    typeMatches &&
    (!brand || brandMatches) &&
    (attributeMatches > 0 || brandMatches)
  )
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
  const identityMatches = specificIdentityTerms(candidate, context).length;
  const hasModelOrSpecification = modelOrSpecificationSignal(candidate.title);
  const specificPage = productSpecificPath(safeUrl(candidate.link));
  const knownRetailer =
    Boolean(normalise(candidate.source)) &&
    !/^unknown(?: retailer)?$/.test(normalise(candidate.source));
  return (
    (model && title.includes(model) ? 80 : 0) +
    (brand && title.includes(brand) ? 30 : 0) +
    (typeMatches ? 25 : 0) +
    attributeMatches * 8 +
    (identityMatches > 0 ? 18 : 0) +
    (hasModelOrSpecification ? 12 : 0) +
    (specificPage ? 12 : 0) +
    (candidate.price != null && candidate.price > 0 ? 20 : 0) +
    (candidate.providerType === "shopping" ? 10 : 0) +
    (candidate.priceSource === "structured" ? 10 : 0) +
    (knownRetailer ? 4 : 0) +
    (hostname.endsWith(".nz") ? 8 : 0) +
    (preferredRetailer && sourceAndLink.includes(preferredRetailer) ? 10 : 0)
  );
}

function pageRejectionReason(
  classification: ReplacementResultPageKind,
): string {
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
    unknown: "insufficient_product_identity",
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
  const typeMatches = titleHasExpectedType(normalise(candidate.title), context);
  const contradictoryType = hasContradictoryProductType(candidate, context);
  const queryProductType = inferQueryProductType(context);
  const candidateProductTypes = inferCandidateProductTypes(candidate);
  const url = safeUrl(candidate.link);
  const eligibilitySignals = [
    ...(typeMatches ? ["product_type_match"] : []),
    ...(candidate.providerType === "shopping" ? ["shopping_result"] : []),
    ...(candidate.price != null && candidate.price > 0 ? ["valid_price"] : []),
    ...(candidate.priceSource === "structured" ? ["structured_price"] : []),
    ...(productSpecificPath(url) ? ["product_specific_url"] : []),
    ...(specificIdentityTerms(candidate, context).length > 0
      ? ["specific_title_identity"]
      : []),
    ...(modelOrSpecificationSignal(candidate.title)
      ? ["model_or_specification"]
      : []),
  ];
  const rejectionReason = accepted
    ? null
    : classification !== "unknown"
      ? pageRejectionReason(classification)
      : contradictoryType
        ? "contradictory_product_type"
        : !typeMatches
          ? "product_type_mismatch"
          : "insufficient_product_identity";
  return {
    classification,
    accepted,
    rejectionReason,
    relevanceScore: score(candidate, context),
    matchType: accepted ? assignMatchType(candidate, context) : null,
    queryProductType,
    candidateProductTypes,
    eligibilitySignals,
  };
}

export function summarizeReplacementCandidates(
  candidates: ReplacementResultCandidate[],
  context: ReplacementResultQualityContext,
): ReplacementResultQualitySummary {
  const evaluations = candidates.map((candidate) => ({
    candidate,
    evaluation: evaluateReplacementResult(candidate, context),
  }));
  const accepted = evaluations.filter(({ evaluation }) => evaluation.accepted);
  const rejectionReasons: Record<string, number> = {};
  for (const { evaluation } of evaluations) {
    if (!evaluation.rejectionReason) continue;
    rejectionReasons[evaluation.rejectionReason] =
      (rejectionReasons[evaluation.rejectionReason] ?? 0) + 1;
  }
  return {
    candidateCount: candidates.length,
    acceptedCount: accepted.length,
    pricedAcceptedCount: accepted.filter(
      ({ candidate }) => candidate.price != null && candidate.price > 0,
    ).length,
    rejectedCount: evaluations.length - accepted.length,
    rejectionReasons,
  };
}

export function rankAndFilterReplacementResults(
  candidates: ReplacementResultCandidate[],
  context: ReplacementResultQualityContext,
  limit: number,
): QualifiedReplacementResult[] {
  const seenLinks = new Set<string>();
  const seenRetailerTitles = new Set<string>();
  return candidates
    .flatMap((candidate) => {
      const evaluation = evaluateReplacementResult(candidate, context);
      if (!evaluation.accepted || !evaluation.matchType) return [];
      const url = safeUrl(candidate.link);
      const linkIdentity = url
        ? `${url.hostname.toLowerCase()}${url.pathname.toLowerCase().replace(/\/$/, "")}`
        : normalise(candidate.link);
      const titleIdentity = normalise(candidate.title);
      const retailerTitleIdentity = `${normalise(candidate.source)}|${titleIdentity}`;
      if (
        (!linkIdentity && !titleIdentity) ||
        (linkIdentity && seenLinks.has(linkIdentity)) ||
        (titleIdentity && seenRetailerTitles.has(retailerTitleIdentity))
      )
        return [];
      if (linkIdentity) seenLinks.add(linkIdentity);
      if (titleIdentity) seenRetailerTitles.add(retailerTitleIdentity);
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
