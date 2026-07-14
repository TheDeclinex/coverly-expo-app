import { filterResultsToPriceRange } from "./query-model.ts";
import {
  rankAndFilterReplacementResults,
  type QualifiedReplacementResult,
  type ReplacementResultCandidate,
  type ReplacementResultQualityContext,
} from "./result-quality.ts";

export interface FinalizedReplacementResultSet {
  rankedCount: number;
  constrainedCount: number;
  results: QualifiedReplacementResult[];
}

export function finalizeReplacementResults(
  candidates: ReplacementResultCandidate[],
  context: ReplacementResultQualityContext,
  limit: number,
  minPrice?: number,
  maxPrice?: number,
): FinalizedReplacementResultSet {
  const ranked = rankAndFilterReplacementResults(
    candidates,
    context,
    candidates.length,
  );
  const constrained = filterResultsToPriceRange(ranked, minPrice, maxPrice);
  return {
    rankedCount: ranked.length,
    constrainedCount: constrained.length,
    results: constrained.slice(0, Math.max(0, limit)),
  };
}
