import type { ReplacementSearchRefinementDraft } from "./replacement-pricing-model.ts";

export type ReplacementRefinementDisplayedField =
  | "searchTerm"
  | "brand"
  | "model"
  | "additionalDetails"
  | "minPrice"
  | "maxPrice";

const DISPLAYED_FIELDS: readonly ReplacementRefinementDisplayedField[] = [
  "searchTerm",
  "brand",
  "model",
  "additionalDetails",
  "minPrice",
  "maxPrice",
];

export function shouldInitialiseRefinementModal(
  wasVisible: boolean,
  isVisible: boolean,
): boolean {
  return isVisible && !wasVisible;
}

export function changedRefinementDisplayedFields(
  before: ReplacementSearchRefinementDraft,
  after: ReplacementSearchRefinementDraft,
): ReplacementRefinementDisplayedField[] {
  return DISPLAYED_FIELDS.filter((field) => before[field] !== after[field]);
}

export function clearChangedRefinementField(
  fields: readonly ReplacementRefinementDisplayedField[],
  field: ReplacementRefinementDisplayedField,
): ReplacementRefinementDisplayedField[] {
  return fields.filter((candidate) => candidate !== field);
}
