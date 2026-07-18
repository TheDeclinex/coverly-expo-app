function tokens(value: string): string[] {
  return value.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function containsRefinementPhrase(haystack: string, needle: string): boolean {
  const source = tokens(haystack);
  const target = tokens(needle);
  return target.length > 0 && target.length <= source.length
    && source.some((_, start) => target.every((token, offset) => source[start + offset] === token));
}

function removeRepeatedWholePhrase(value: string, phrase: string): string {
  const phraseTokens = phrase.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!phraseTokens.length) return value;
  const pattern = phraseTokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^\\p{L}\\p{N}]+');
  const matcher = new RegExp(`(^|[^\\p{L}\\p{N}])(${pattern})(?=$|[^\\p{L}\\p{N}])`, 'giu');
  let seen = false;
  return value.replace(matcher, (match, prefix: string) => {
    if (!seen) {
      seen = true;
      return match;
    }
    return prefix;
  }).trim().replace(/\s+/g, ' ');
}

export function buildV2RefinementSearchTerms(searchTerm: string, supportValues: string[]): string {
  const cleanedSupport = supportValues
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
  const support = cleanedSupport
    .filter((value) => !containsRefinementPhrase(searchTerm, value))
    .filter((value, index, values) => !values.slice(index + 1).some((later) => containsRefinementPhrase(later, value)));
  return cleanedSupport.reduce(
    (value, phrase) => removeRepeatedWholePhrase(value, phrase),
    [searchTerm.trim(), ...support].filter(Boolean).join(' '),
  );
}
