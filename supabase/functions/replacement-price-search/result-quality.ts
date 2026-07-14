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
}

export interface QualifiedReplacementResult extends ReplacementResultCandidate {
  matchType: "best_match" | "close_match" | "similar_item";
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

function specificProductIdentity(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): boolean {
  const title = normalise(candidate.title);
  const model = normalise(context.model);
  const brand = normalise(context.brand);
  const matchingProductTerms = productTerms(context).filter((word) =>
    title.includes(word),
  );
  if (model && title.includes(model)) return true;
  if (brand && title.includes(brand) && matchingProductTerms.length > 0)
    return true;
  if (matchingProductTerms.length >= 2) return true;

  const path = normalise(safeUrl(candidate.link)?.pathname);
  return (
    matchingProductTerms.length > 0 &&
    /\b(?:product|products|item|dp|p)\b/.test(path)
  );
}

export function classifyReplacementResult(
  candidate: ReplacementResultCandidate,
  context: ReplacementResultQualityContext,
): ReplacementResultPageKind {
  const url = safeUrl(candidate.link);
  const host = normalise(url?.hostname);
  const path = normalise(url?.pathname);
  const query = normalise(url?.search);
  const productPath = /\b(?:product|products|item|dp|p)\b/.test(path);
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
  if (/\bsearch\b/.test(path) || /\b(?:query|search|q)\b/.test(query))
    return "search";
  if (url && (url.pathname === "" || url.pathname === "/")) return "homepage";
  const brand = normalise(context.brand);
  const model = normalise(context.model);
  const title = normalise(candidate.title);
  if (
    brand &&
    title.startsWith(`${brand} `) &&
    (!model || !title.includes(model)) &&
    /\b(?:products?|audio|home audio|soundbars?|subwoofers?|speakers?)\b$/.test(
      title,
    ) &&
    !productPath
  )
    return "collection";
  if (
    (/\b(?:collections?|categories?|catalog)\b/.test(path) &&
      !productPath &&
      !specificProductIdentity(candidate, context)) ||
    /^(?:shop\s+)?(?:soundbars?|subwoofers?|speakers?|home audio|televisions?|tvs?)\s*(?:[|\u2013\u2014-]\s*.+)?$/i.test(
      candidate.title.trim(),
    )
  )
    return "collection";
  if (
    (candidate.price != null &&
      Number.isFinite(candidate.price) &&
      candidate.price > 0) ||
    specificProductIdentity(candidate, context)
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
  const matchingProductTerms = productTerms(context).filter((word) =>
    title.includes(word),
  ).length;

  if (model && title.includes(model)) return "best_match";
  if (brandMatches && matchingProductTerms >= 1) return "close_match";
  if (matchingProductTerms >= 2) return "close_match";
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
  const matchingProductTerms = productTerms(context).filter((word) =>
    title.includes(word),
  ).length;
  return (
    (model && title.includes(model) ? 80 : 0) +
    (brand && title.includes(brand) ? 30 : 0) +
    matchingProductTerms * 15 +
    (candidate.price != null && candidate.price > 0 ? 20 : 0) +
    (hostname.endsWith(".nz") ? 8 : 0) +
    (preferredRetailer && sourceAndLink.includes(preferredRetailer) ? 10 : 0)
  );
}

export function rankAndFilterReplacementResults(
  candidates: ReplacementResultCandidate[],
  context: ReplacementResultQualityContext,
  limit: number,
): QualifiedReplacementResult[] {
  const seen = new Set<string>();
  return candidates
    .flatMap((candidate) => {
      const classification = classifyReplacementResult(candidate, context);
      if (classification !== "product") return [];
      const identity = normalise(candidate.link) || normalise(candidate.title);
      if (!identity || seen.has(identity)) return [];
      seen.add(identity);
      return [
        {
          candidate,
          qualityScore: score(candidate, context),
          matchType: assignMatchType(candidate, context),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.qualityScore - left.qualityScore ||
        left.candidate.position - right.candidate.position,
    )
    .slice(0, Math.max(0, limit))
    .map(({ candidate, matchType }) => ({ ...candidate, matchType }));
}
