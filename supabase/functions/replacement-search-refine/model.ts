import {
  sanitizeReplacementSearchText,
  sanitizeSceneDescription,
  stripStructuredCriteriaTerms,
} from "../_shared/description-sanitizer.ts";

export const REFINEMENT_LIMITS = {
  searchTerm: 300,
  brand: 100,
  model: 120,
  details: 400,
  itemName: 200,
  description: 600,
  category: 100,
  condition: 100,
  voiceTranscript: 1_500,
  rationale: 180,
  maxPrice: 10_000_000,
  request: 16_000,
} as const;

export interface RefinementRequest {
  item: {
    itemName: string;
    description?: string;
    category?: string;
    brandMaker?: string;
    modelSeries?: string;
    condition?: string;
  };
  draft: {
    searchTerm: string;
    brandMaker?: string;
    modelSeries?: string;
    additionalDetails?: string;
    minPrice?: number;
    maxPrice?: number;
    selectedCriteria: {
      condition: "new" | "used" | null;
      country: "NZ";
    };
  };
  voiceTranscript?: string;
}

export interface RefinementSuggestion {
  searchTerm: string;
  brandMaker: string | null;
  modelSeries: string | null;
  additionalDetails: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  rationale: string | null;
}

export type RefinementValidation<T> =
  | { ok: true; value: T; rejectedFields?: Array<"brand" | "model"> }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractAiResponseText(envelope: unknown): string | null {
  if (!isRecord(envelope)) return null;
  if (typeof envelope.output_text === "string" && envelope.output_text.trim()) {
    return envelope.output_text;
  }
  if (!Array.isArray(envelope.output)) return null;
  for (const outputItem of envelope.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) continue;
    for (const contentItem of outputItem.content) {
      if (
        isRecord(contentItem) &&
        typeof contentItem.text === "string" &&
        contentItem.text.trim()
      ) {
        return contentItem.text;
      }
    }
  }
  return null;
}

function text(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, maximum) : undefined;
}

function invalidText(value: unknown, maximum: number): boolean {
  return (
    value != null &&
    (typeof value !== "string" || value.trim().length > maximum)
  );
}

function price(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,\s]/g, ""))
        : Number.NaN;
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > REFINEMENT_LIMITS.maxPrice
  ) {
    return undefined;
  }
  return Math.round(parsed * 100) / 100;
}

export function validateRefinementRequest(
  input: unknown,
): RefinementValidation<RefinementRequest> {
  if (!isRecord(input) || !isRecord(input.item) || !isRecord(input.draft)) {
    return { ok: false, error: "Item and draft criteria are required." };
  }
  if (JSON.stringify(input).length > REFINEMENT_LIMITS.request) {
    return { ok: false, error: "Refinement request is too large." };
  }

  const fields: Array<[unknown, number, string]> = [
    [input.item.itemName, REFINEMENT_LIMITS.itemName, "Item name"],
    [input.item.description, REFINEMENT_LIMITS.description, "Description"],
    [input.item.category, REFINEMENT_LIMITS.category, "Category"],
    [input.item.brandMaker, REFINEMENT_LIMITS.brand, "Item brand"],
    [input.item.modelSeries, REFINEMENT_LIMITS.model, "Item model"],
    [input.item.condition, REFINEMENT_LIMITS.condition, "Condition"],
    [input.draft.searchTerm, REFINEMENT_LIMITS.searchTerm, "Search term"],
    [input.draft.brandMaker, REFINEMENT_LIMITS.brand, "Draft brand"],
    [input.draft.modelSeries, REFINEMENT_LIMITS.model, "Draft model"],
    [input.draft.additionalDetails, REFINEMENT_LIMITS.details, "Draft details"],
    [
      input.voiceTranscript,
      REFINEMENT_LIMITS.voiceTranscript,
      "Voice transcript",
    ],
  ];
  for (const [value, maximum, label] of fields) {
    if (invalidText(value, maximum)) {
      return { ok: false, error: `${label} is invalid or too long.` };
    }
  }

  const itemName = text(input.item.itemName, REFINEMENT_LIMITS.itemName);
  const searchTerm = sanitizeReplacementSearchText(
    text(input.draft.searchTerm, REFINEMENT_LIMITS.searchTerm),
    REFINEMENT_LIMITS.searchTerm,
  );
  if (!itemName || !searchTerm) {
    return { ok: false, error: "Item name and search term are required." };
  }
  const selectedCriteria = isRecord(input.draft.selectedCriteria)
    ? input.draft.selectedCriteria
    : {};
  if (
    selectedCriteria.condition != null &&
    selectedCriteria.condition !== "new" &&
    selectedCriteria.condition !== "used"
  ) {
    return { ok: false, error: "Selected condition is invalid." };
  }
  if (selectedCriteria.country != null && selectedCriteria.country !== "NZ") {
    return { ok: false, error: "Selected country is invalid." };
  }
  const minPrice = price(input.draft.minPrice);
  const maxPrice = price(input.draft.maxPrice);
  if (input.draft.minPrice != null && minPrice == null) {
    return { ok: false, error: "Minimum price is invalid." };
  }
  if (input.draft.maxPrice != null && maxPrice == null) {
    return { ok: false, error: "Maximum price is invalid." };
  }
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    return {
      ok: false,
      error: "Maximum price must be at least the minimum price.",
    };
  }
  const itemDescription = sanitizeSceneDescription(
    sanitizeReplacementSearchText(
      text(input.item.description, REFINEMENT_LIMITS.description),
    ),
    REFINEMENT_LIMITS.description,
  );
  const draftDetails = sanitizeSceneDescription(
    sanitizeReplacementSearchText(
      text(input.draft.additionalDetails, REFINEMENT_LIMITS.details),
    ),
    REFINEMENT_LIMITS.details,
  );

  return {
    ok: true,
    value: {
      item: {
        itemName,
        ...(itemDescription ? { description: itemDescription } : {}),
        ...(text(input.item.category, REFINEMENT_LIMITS.category)
          ? { category: text(input.item.category, REFINEMENT_LIMITS.category) }
          : {}),
        ...(text(input.item.brandMaker, REFINEMENT_LIMITS.brand)
          ? {
              brandMaker: text(input.item.brandMaker, REFINEMENT_LIMITS.brand),
            }
          : {}),
        ...(text(input.item.modelSeries, REFINEMENT_LIMITS.model)
          ? {
              modelSeries: text(
                input.item.modelSeries,
                REFINEMENT_LIMITS.model,
              ),
            }
          : {}),
        ...(text(input.item.condition, REFINEMENT_LIMITS.condition)
          ? {
              condition: text(
                input.item.condition,
                REFINEMENT_LIMITS.condition,
              ),
            }
          : {}),
      },
      draft: {
        searchTerm,
        ...(text(input.draft.brandMaker, REFINEMENT_LIMITS.brand)
          ? {
              brandMaker: text(input.draft.brandMaker, REFINEMENT_LIMITS.brand),
            }
          : {}),
        ...(text(input.draft.modelSeries, REFINEMENT_LIMITS.model)
          ? {
              modelSeries: text(
                input.draft.modelSeries,
                REFINEMENT_LIMITS.model,
              ),
            }
          : {}),
        ...(draftDetails ? { additionalDetails: draftDetails } : {}),
        ...(minPrice != null ? { minPrice } : {}),
        ...(maxPrice != null ? { maxPrice } : {}),
        selectedCriteria: {
          condition:
            selectedCriteria.condition === "new" ||
            selectedCriteria.condition === "used"
              ? selectedCriteria.condition
              : null,
          country: "NZ",
        },
      },
      ...(sanitizeReplacementSearchText(
        text(input.voiceTranscript, REFINEMENT_LIMITS.voiceTranscript),
        REFINEMENT_LIMITS.voiceTranscript,
      )
        ? {
            voiceTranscript: sanitizeReplacementSearchText(
              text(input.voiceTranscript, REFINEMENT_LIMITS.voiceTranscript),
              REFINEMENT_LIMITS.voiceTranscript,
            ),
          }
        : {}),
    },
  };
}

function normalised(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function grounded(candidate: string, request: RefinementRequest): boolean {
  const context = normalised(
    [
      request.item.itemName,
      request.item.description,
      request.item.category,
      request.item.brandMaker,
      request.item.modelSeries,
      request.item.condition,
      request.draft.searchTerm,
      request.draft.brandMaker,
      request.draft.modelSeries,
      request.draft.additionalDetails,
      request.voiceTranscript,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const expected = normalised(candidate);
  return Boolean(expected) && context.includes(expected);
}

function dedupe(value: string): string {
  const seen = new Set<string>();
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((word) => {
      const key = normalised(word);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

function removePhrase(value: string, phrase: string | undefined): string {
  if (!phrase) return value;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(
      new RegExp(`\\b${escaped.replace(/\\s+/g, "\\\\s+")}\\b`, "gi"),
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableNumber(value: unknown): value is number | null {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

export function validateAiSuggestion(
  input: unknown,
  request: RefinementRequest,
): RefinementValidation<RefinementSuggestion> {
  if (!isRecord(input))
    return { ok: false, error: "AI returned invalid data." };
  const allowed = new Set([
    "searchTerm",
    "brandMaker",
    "modelSeries",
    "additionalDetails",
    "minPrice",
    "maxPrice",
    "rationale",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, error: "AI returned unexpected fields." };
  }
  if (
    !nullableString(input.searchTerm) ||
    !nullableString(input.brandMaker) ||
    !nullableString(input.modelSeries) ||
    !nullableString(input.additionalDetails) ||
    !nullableNumber(input.minPrice) ||
    !nullableNumber(input.maxPrice) ||
    !nullableString(input.rationale)
  ) {
    return { ok: false, error: "AI returned invalid field types." };
  }

  const rejectedFields: Array<"brand" | "model"> = [];
  const candidateBrand = text(input.brandMaker, REFINEMENT_LIMITS.brand);
  const candidateModel = text(input.modelSeries, REFINEMENT_LIMITS.model);
  const brandMaker =
    candidateBrand && grounded(candidateBrand, request)
      ? candidateBrand
      : (request.draft.brandMaker ?? null);
  const modelSeries =
    candidateModel && grounded(candidateModel, request)
      ? candidateModel
      : (request.draft.modelSeries ?? null);
  if (candidateBrand && brandMaker !== candidateBrand)
    rejectedFields.push("brand");
  if (candidateModel && modelSeries !== candidateModel)
    rejectedFields.push("model");

  // Price bounds are explicit user criteria. AI may preserve them but cannot
  // introduce or alter bounds inferred from item imagery or general context.
  const minPrice = request.draft.minPrice ?? null;
  const maxPrice = request.draft.maxPrice ?? null;
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    return { ok: false, error: "AI returned an invalid price range." };
  }

  let proposedSearchTerm = dedupe(
    text(input.searchTerm, REFINEMENT_LIMITS.searchTerm) ??
      request.draft.searchTerm,
  );
  if (candidateBrand && brandMaker !== candidateBrand)
    proposedSearchTerm = removePhrase(proposedSearchTerm, candidateBrand);
  if (candidateModel && modelSeries !== candidateModel)
    proposedSearchTerm = removePhrase(proposedSearchTerm, candidateModel);
  const searchTerm = stripStructuredCriteriaTerms(
    sanitizeReplacementSearchText(proposedSearchTerm) ||
      request.draft.searchTerm,
    request.draft.selectedCriteria,
  );
  if (!searchTerm)
    return { ok: false, error: "AI returned an empty search term." };

  const proposedAdditionalDetails = sanitizeReplacementSearchText(
    text(input.additionalDetails, REFINEMENT_LIMITS.details),
    REFINEMENT_LIMITS.details,
  );

  return {
    ok: true,
    rejectedFields,
    value: {
      searchTerm,
      brandMaker,
      modelSeries,
      additionalDetails:
        stripStructuredCriteriaTerms(
          sanitizeSceneDescription(
            proposedAdditionalDetails || request.draft.additionalDetails || "",
            REFINEMENT_LIMITS.details,
          ),
          request.draft.selectedCriteria,
        ) || null,
      minPrice,
      maxPrice,
      rationale: text(input.rationale, REFINEMENT_LIMITS.rationale) ?? null,
    },
  };
}
