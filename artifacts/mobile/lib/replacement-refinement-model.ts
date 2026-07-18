import type { InventoryItem } from "@/types";
import { currencyFractionDigits } from "./money.ts";

export type ReplacementRefinementTextField =
  | "searchTerm"
  | "brand"
  | "model"
  | "additionalDetails";

export interface ReplacementRefinementChip {
  id: string;
  label: string;
  field: ReplacementRefinementTextField;
  value: string;
  source: "deterministic" | "ai";
}

export interface ReplacementRefinementDraft {
  searchTerm: string;
  brand: string;
  model: string;
  additionalDetails: string;
  minimumPrice: string;
  maximumPrice: string;
  chipContributions: ReplacementRefinementChip[];
}

export interface ParsedReplacementPriceRange {
  minimumPrice?: number;
  maximumPrice?: number;
}

export interface ReplacementPriceRangeValidation {
  parsed: ParsedReplacementPriceRange;
  minimumError: string | null;
  maximumError: string | null;
  rangeError: string | null;
  valid: boolean;
}

export function normalizeRefinementText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function createOriginalReplacementRefinementDraft(
  item: Pick<InventoryItem, "name" | "brand_maker" | "model_series" | "description">,
): ReplacementRefinementDraft {
  const brand = normalizeRefinementText(item.brand_maker);
  const model = normalizeRefinementText(item.model_series);
  const name = normalizeRefinementText(item.name);
  const terms = [brand, model, name].filter(Boolean);
  const uniqueTerms = terms.filter(
    (term, index) => terms.findIndex((candidate) => candidate.toLowerCase() === term.toLowerCase()) === index,
  );
  return {
    searchTerm: uniqueTerms.join(" "),
    brand,
    model,
    additionalDetails: normalizeRefinementText(item.description),
    minimumPrice: "",
    maximumPrice: "",
    chipContributions: [],
  };
}

export function cloneReplacementRefinementDraft(
  draft: ReplacementRefinementDraft,
): ReplacementRefinementDraft {
  return {
    ...draft,
    chipContributions: draft.chipContributions.map((chip) => ({ ...chip })),
  };
}

export function applyAiTextUpdate(
  draft: ReplacementRefinementDraft,
  update: Pick<ReplacementRefinementDraft, ReplacementRefinementTextField>,
): { draft: ReplacementRefinementDraft; undoDraft: ReplacementRefinementDraft } {
  return {
    undoDraft: cloneReplacementRefinementDraft(draft),
    draft: {
      ...draft,
      searchTerm: normalizeRefinementText(update.searchTerm),
      brand: normalizeRefinementText(update.brand),
      model: normalizeRefinementText(update.model),
      additionalDetails: normalizeRefinementText(update.additionalDetails),
    },
  };
}

function containsPhrase(haystack: string, needle: string): boolean {
  return normalizeRefinementText(haystack).toLocaleLowerCase("en")
    .includes(normalizeRefinementText(needle).toLocaleLowerCase("en"));
}

export function effectiveRefinementFieldValue(
  draft: ReplacementRefinementDraft,
  field: ReplacementRefinementTextField,
): string {
  const manualValue = normalizeRefinementText(draft[field]);
  const contributions = draft.chipContributions
    .filter((chip) => chip.field === field && !containsPhrase(manualValue, chip.value))
    .map((chip) => normalizeRefinementText(chip.value))
    .filter(Boolean);
  return normalizeRefinementText([manualValue, ...contributions].filter(Boolean).join(" "));
}

export function toggleRefinementChip(
  draft: ReplacementRefinementDraft,
  chip: ReplacementRefinementChip,
): ReplacementRefinementDraft {
  const selected = draft.chipContributions.some((candidate) => candidate.id === chip.id);
  return {
    ...draft,
    chipContributions: selected
      ? draft.chipContributions.filter((candidate) => candidate.id !== chip.id)
      : [...draft.chipContributions, { ...chip }],
  };
}

const HIGH_CONFIDENCE_DETAIL_PATTERNS = [
  /\b(?:OLED|QLED|Mini LED|4K|8K|UHD|HDR)\b/gi,
  /\b\d+(?:\.\d+)?\s?(?:inch|inches|in|\"|kg|g|l|litre|litres|cm|mm|tb|gb)\b/gi,
  /\b(?:stainless steel|front load|top load|solid wood|oak|pine|leather)\b/gi,
];

function chipId(field: ReplacementRefinementTextField, value: string, source: "deterministic" | "ai") {
  return `${source}:${field}:${normalizeRefinementText(value).toLocaleLowerCase("en")}`;
}

export function deterministicRefinementChips(
  draft: ReplacementRefinementDraft,
): ReplacementRefinementChip[] {
  const candidates: Array<Omit<ReplacementRefinementChip, "id" | "source">> = [];
  if (draft.brand && !containsPhrase(draft.searchTerm, draft.brand)) {
    candidates.push({ label: draft.brand, field: "searchTerm", value: draft.brand });
  }
  if (draft.model && !containsPhrase(draft.searchTerm, draft.model)) {
    candidates.push({ label: draft.model, field: "searchTerm", value: draft.model });
  }
  const context = `${draft.searchTerm} ${draft.additionalDetails}`;
  for (const pattern of HIGH_CONFIDENCE_DETAIL_PATTERNS) {
    for (const match of context.matchAll(pattern)) {
      const value = normalizeRefinementText(match[0]).replace(/\b(?:inch|inches)\b/i, "in");
      if (value && !candidates.some((candidate) => candidate.value.toLowerCase() === value.toLowerCase())) {
        candidates.push({ label: value, field: "additionalDetails", value });
      }
    }
  }
  return candidates.slice(0, 6).map((candidate) => ({
    ...candidate,
    source: "deterministic" as const,
    id: chipId(candidate.field, candidate.value, "deterministic"),
  }));
}

export function createAiRefinementChip(
  value: string,
  field: ReplacementRefinementTextField = "additionalDetails",
): ReplacementRefinementChip {
  const normalized = normalizeRefinementText(value);
  return {
    id: chipId(field, normalized, "ai"),
    label: normalized,
    value: normalized,
    field,
    source: "ai",
  };
}

function parsePriceInput(
  value: string,
  currencyCode: string,
  locale = "en",
): { value?: number; error: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { error: null };
  const maximumFractionDigits = currencyFractionDigits(currencyCode, locale).maximum;
  let decimalSeparator = ".";
  let groupingSeparator = ",";
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
    decimalSeparator = parts.find((part) => part.type === "decimal")?.value ?? ".";
    groupingSeparator = parts.find((part) => part.type === "group")?.value ?? ",";
  } catch {
    // The defaults match the editable fallback locale.
  }
  let normalized = trimmed
    .replace(new RegExp(currencyCode, "ig"), "")
    .replace(/[^0-9.,-]/g, "");
  const hasDot = normalized.includes(".");
  const hasComma = normalized.includes(",");
  if (hasDot && hasComma) {
    normalized = normalized.split(groupingSeparator).join("");
    normalized = normalized.split(decimalSeparator).join(".");
  } else {
    const separator = hasDot ? "." : hasComma ? "," : null;
    if (separator) {
      const finalDigits = normalized.length - normalized.lastIndexOf(separator) - 1;
      const looksLikeGrouping = separator === groupingSeparator && finalDigits === 3;
      normalized = looksLikeGrouping
        ? normalized.split(separator).join("")
        : normalized.split(separator).join(".");
    }
  }
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return { error: "Enter a valid amount." };
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return { error: "Enter zero or a positive amount." };
  const decimals = normalized.split(".")[1]?.length ?? 0;
  if (decimals > maximumFractionDigits) {
    return { error: `${currencyCode} supports up to ${maximumFractionDigits} decimal places.` };
  }
  return { value: parsed, error: null };
}

export function validateReplacementPriceRange(
  minimumPrice: string,
  maximumPrice: string,
  currencyCode: string,
  locale = "en",
): ReplacementPriceRangeValidation {
  const minimum = parsePriceInput(minimumPrice, currencyCode, locale);
  const maximum = parsePriceInput(maximumPrice, currencyCode, locale);
  const rangeError = minimum.value != null && maximum.value != null && minimum.value > maximum.value
    ? "Minimum price cannot be greater than maximum price."
    : null;
  return {
    parsed: {
      minimumPrice: minimum.value,
      maximumPrice: maximum.value,
    },
    minimumError: minimum.error,
    maximumError: maximum.error,
    rangeError,
    valid: !minimum.error && !maximum.error && !rangeError,
  };
}

export function buildCurrentSearchSummary(
  draft: ReplacementRefinementDraft,
): { primary: string; details: string[] } {
  const primary = effectiveRefinementFieldValue(draft, "searchTerm");
  const details = [
    effectiveRefinementFieldValue(draft, "brand"),
    effectiveRefinementFieldValue(draft, "model"),
    effectiveRefinementFieldValue(draft, "additionalDetails"),
  ].filter((value, index, values) => value && values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
  return { primary, details };
}
