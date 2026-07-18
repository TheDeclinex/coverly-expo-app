function normalizedTokens(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.trim().toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function containsReplacementSearchPhrase(haystack: string, needle: string): boolean {
  const source = normalizedTokens(haystack);
  const target = normalizedTokens(needle);
  if (!target.length || target.length > source.length) return false;
  return source.some((_, start) => target.every((token, offset) => source[start + offset] === token));
}

function removeRepeatedWholePhrase(value: string, phrase: string): string {
  const phraseTokens = phrase.trim().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!phraseTokens.length) return value;
  const pattern = phraseTokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^\\p{L}\\p{N}]+");
  const matcher = new RegExp(`(^|[^\\p{L}\\p{N}])(${pattern})(?=$|[^\\p{L}\\p{N}])`, "giu");
  let seen = false;
  return value.replace(matcher, (match, prefix: string) => {
    if (!seen) {
      seen = true;
      return match;
    }
    return prefix;
  }).trim().replace(/\s+/g, " ");
}

export function deduplicateReplacementSearchAttributes(value: string, attributes: string[]): string {
  return attributes
    .map((attribute) => attribute.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .reduce((current, attribute) => removeRepeatedWholePhrase(current, attribute), value.trim().replace(/\s+/g, " "));
}

export function composeReplacementSearchTerm(input: {
  name?: string | null;
  brand?: string | null;
  model?: string | null;
}): string {
  const clean = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ") ?? "";
  const name = clean(input.name);
  const candidates = [clean(input.brand), clean(input.model), name].filter(Boolean);
  const result: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (candidates.slice(index + 1).some((later) => containsReplacementSearchPhrase(later, candidate))) continue;
    if (result.some((existing) => containsReplacementSearchPhrase(existing, candidate))) continue;
    result.push(candidate);
  }
  return deduplicateReplacementSearchAttributes(result.join(" "), [clean(input.brand), clean(input.model)]);
}
