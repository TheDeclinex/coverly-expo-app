export interface RefinementTextDraft {
  searchTerm: string;
  brand: string;
  model: string;
  additionalDetails: string;
}

export interface RefinementItemContext {
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  description?: string | null;
  category?: string | null;
}

export interface AiRefinementCandidate extends RefinementTextDraft {
  suggestedChips: string[];
}

export interface ValidatedAiRefinement extends RefinementTextDraft {
  changedFields: Array<keyof RefinementTextDraft>;
  suggestedChips: string[];
}

export const APPROVED_REPLACEMENT_REFINEMENT_MODEL = "gpt-5.6-luna";

export function resolveReplacementRefinementModel(configuredModel?: string | null): string {
  return configuredModel?.trim() || APPROVED_REPLACEMENT_REFINEMENT_MODEL;
}

const SAFE_EDITOR_WORDS = new Set([
  "a", "an", "and", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "without",
  "replacement", "item", "product",
]);

function normalize(value: unknown, maxLength = 500): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function tokens(value: string): string[] {
  return normalize(value).toLocaleLowerCase("en")
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function relatedToken(candidate: string, sourceTokens: Set<string>): boolean {
  if (SAFE_EDITOR_WORDS.has(candidate) || sourceTokens.has(candidate)) return true;
  if (candidate === "inch" || candidate === "inches") {
    return sourceTokens.has("in") || sourceTokens.has("inch") || sourceTokens.has("inches");
  }
  if (candidate.length < 4) return false;
  return [...sourceTokens].some((source) => source.length >= 4
    && (source.startsWith(candidate) || candidate.startsWith(source)));
}

export function isSupportedRefinementRewrite(candidate: string, approvedContext: string): boolean {
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) return true;
  const sourceTokens = new Set(tokens(approvedContext));
  return tokens(normalizedCandidate).every((token) => relatedToken(token, sourceTokens));
}

function exactSupportedAttribute(candidate: string, approvedContext: string): boolean {
  const normalizedCandidate = normalize(candidate, 100).toLocaleLowerCase("en");
  return !normalizedCandidate || normalize(approvedContext).toLocaleLowerCase("en").includes(normalizedCandidate);
}

export function validateAiRefinementCandidate(
  candidate: AiRefinementCandidate,
  currentDraft: RefinementTextDraft,
  itemContext: RefinementItemContext,
): ValidatedAiRefinement {
  const current: RefinementTextDraft = {
    searchTerm: normalize(currentDraft.searchTerm, 120),
    brand: normalize(currentDraft.brand, 80),
    model: normalize(currentDraft.model, 100),
    additionalDetails: normalize(currentDraft.additionalDetails, 500),
  };
  const approvedContext = [
    current.searchTerm,
    current.brand,
    current.model,
    current.additionalDetails,
    itemContext.name,
    itemContext.brand,
    itemContext.model,
    itemContext.description,
    itemContext.category,
  ].map((value) => normalize(value)).filter(Boolean).join(" ");

  const proposed: RefinementTextDraft = {
    searchTerm: normalize(candidate.searchTerm, 120),
    brand: normalize(candidate.brand, 80),
    model: normalize(candidate.model, 100),
    additionalDetails: normalize(candidate.additionalDetails, 500),
  };

  const validated: RefinementTextDraft = {
    searchTerm: proposed.searchTerm && isSupportedRefinementRewrite(proposed.searchTerm, approvedContext)
      ? proposed.searchTerm
      : current.searchTerm,
    brand: exactSupportedAttribute(proposed.brand, approvedContext) ? proposed.brand : current.brand,
    model: exactSupportedAttribute(proposed.model, approvedContext) ? proposed.model : current.model,
    additionalDetails: isSupportedRefinementRewrite(proposed.additionalDetails, approvedContext)
      ? proposed.additionalDetails
      : current.additionalDetails,
  };

  const changedFields = (Object.keys(validated) as Array<keyof RefinementTextDraft>)
    .filter((field) => validated[field] !== current[field]);
  const validatedContext = `${approvedContext} ${Object.values(validated).join(" ")}`.toLocaleLowerCase("en");
  const suggestedChips = Array.isArray(candidate.suggestedChips)
    ? candidate.suggestedChips
      .map((chip) => normalize(chip, 40))
      .filter((chip) => chip.length >= 2 && validatedContext.includes(chip.toLocaleLowerCase("en")))
      .filter((chip, index, values) => values.findIndex((value) => value.toLowerCase() === chip.toLowerCase()) === index)
      .slice(0, 6)
    : [];

  return { ...validated, changedFields, suggestedChips };
}
