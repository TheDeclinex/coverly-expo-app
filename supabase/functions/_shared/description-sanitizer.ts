function cleanSpacing(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .trim()
    .replace(/^[,;:\s]+|[,;:\s]+$/g, "");
}

const EXPLICIT_RETAILER_PATTERNS = [
  /\bonly\s+search(?:\s+(?:at|from|on))?\s+(.+?)(?=\s+(?:for|under|over|below|above|between|with)\b|[,.!?;]|$)/i,
  /\bfind(?:\s+(?:this|it|the item))?\s+at\s+(.+?)(?=\s+(?:for|under|over|below|above|between|with)\b|[,.!?;]|$)/i,
  /\bshow(?:\s+me)?\s+(.+?)\s+listings?\b/i,
] as const;

const PURCHASE_HISTORY_PATTERNS = [
  /\s*,?\s*\b(?:originally\s+)?(?:purchased|bought)\s+(?:online\s+)?(?:from|at|through|via)\s+[^.!?;]*/gi,
  /\s*,?\s*\bfrom\s+(?:the\s+warehouse|amazon)\b[^.!?;]*/gi,
  /\s*,?\s*\b(?:purchase\s+source|original\s+retailer|retailer\s+originally\s+used)\s*[:\-]\s*[^.!?;]*/gi,
] as const;

function cleanRetailer(value: string): string | null {
  const cleaned = cleanSpacing(value)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .slice(0, 100);
  return cleaned || null;
}

export function extractPreferredRetailerIntent(
  value: string | null | undefined,
): string | null {
  const input = cleanSpacing(value ?? "");
  for (const pattern of EXPLICIT_RETAILER_PATTERNS) {
    const match = input.match(pattern);
    const retailer = cleanRetailer(match?.[1] ?? "");
    if (retailer) return retailer;
  }
  return null;
}

export function sanitizeReplacementSearchText(
  value: string | null | undefined,
  maximum = Number.POSITIVE_INFINITY,
): string {
  let next = value ?? "";
  for (const pattern of PURCHASE_HISTORY_PATTERNS)
    next = next.replace(pattern, "");
  for (const pattern of EXPLICIT_RETAILER_PATTERNS)
    next = next.replace(pattern, "");
  return cleanSpacing(next)
    .replace(/^for\s+/i, "")
    .slice(0, maximum)
    .trim();
}

const WHOLE_SCENE_SENTENCE =
  /^(?:(?:it|the item)\s+(?:is|was)\s+)?(?:placed|sitting|positioned|located|shown)\b|^(?:located\s+)?(?:next to|to the (?:left|right)(?:\s+side)? of|in front of|behind)\b|^(?:it|the item)\s+(?:is|was)\s+part of\s+(?:the|a)\s+(?:sound|audio|home theatre|home theater|entertainment)\s+system\b/i;

const SCENE_SUFFIX =
  /\s+(?:(?:(?:it|the item)\s+)?(?:is|was)\s+)?(?:placed|sitting|positioned|located|shown)\s+(?:on|upon|next to|beside|near|to the (?:left|right)(?:\s+side)? of|in front of|behind|under|above)\b.*$/i;

export function sanitizeSceneDescription(
  value: string | null | undefined,
  maximum = Number.POSITIVE_INFINITY,
): string {
  const input = cleanSpacing(value ?? "");
  if (!input) return "";

  const sentences = input.match(/[^.!?]+[.!?]?/g) ?? [input];
  const kept = sentences.flatMap((rawSentence) => {
    const sentence = rawSentence.trim();
    if (!sentence || WHOLE_SCENE_SENTENCE.test(sentence)) return [];

    const punctuation = /[.!?]$/.exec(sentence)?.[0] ?? "";
    const withoutPunctuation = punctuation ? sentence.slice(0, -1) : sentence;
    const intrinsic = cleanSpacing(
      withoutPunctuation.replace(SCENE_SUFFIX, ""),
    );
    return intrinsic ? [`${intrinsic}${punctuation}`] : [];
  });

  return cleanSpacing(kept.join(" ")).slice(0, maximum).trim();
}

export function stripStructuredCriteriaTerms(
  value: string,
  criteria: { condition?: "new" | "used" | null; country?: string | null },
): string {
  let next = cleanSpacing(value);
  if (criteria.condition) {
    next = next.replace(/\b(?:new|used)(?:\s+only)?\b/gi, "");
  }
  if ((criteria.country ?? "NZ").toUpperCase() === "NZ") {
    next = next.replace(/\b(?:new zealand|nz)(?:\s+listings?)?\b/gi, "");
  }
  return cleanSpacing(next);
}
