import type {
  VoiceExtractionResult,
  VoiceItemField,
  VoiceItemPatch,
  VoiceItemValues,
  VoiceMappedChange,
  VoiceScalar,
} from "../types/voice.ts";
import { ITEM_CATEGORIES } from "../constants/categories.ts";

const LABELS: Record<VoiceItemField, string> = {
  name: "Item name",
  category: "Category",
  quantity: "Quantity",
  brand_maker: "Brand / Maker",
  model_series: "Model / Series",
  purchase_source: "Purchased from",
  purchase_year_approx: "Purchase year",
  original_purchase_price: "Original purchase price",
  replacement_price: "Replacement / Each price",
  description: "Description",
  notes: "Notes",
};

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanNameCandidate(value: string | null | undefined): string | null {
  const cleaned = value
    ?.replace(/(?:\$\s*\d+(?:,\d{3})*(?:\.\d{1,2})?|\b\d+(?:,\d{3})*(?:\.\d{1,2})?\s*(?:dollars?|nzd|nz dollars?))/gi, "")
    .replace(/\b(?:worth|valued at|value|price|costs?|cost|paid|bought for|purchased for)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[,\s.]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 3) return null;
  return cleaned;
}

function fallbackName(transcript: string, extraction: VoiceExtractionResult): string | null {
  const hasDisplayName = cleanText(extraction.display_name);
  if (hasDisplayName) return hasDisplayName;

  if (isFieldCommand(transcript) || hasNonNameStructuredExtraction(extraction)) {
    return null;
  }

  return (
    cleanNameCandidate(transcript.split(/[.;\n]/)[0]) ??
    cleanNameCandidate(extraction.raw_summary) ??
    cleanNameCandidate(extraction.description)
  );
}

function isFieldCommand(transcript: string): boolean {
  return /^(?:set|add|update|change|rename|fill|make|i bought|bought|purchased|paid|model)\b/i.test(transcript.trim());
}

function hasNonNameStructuredExtraction(extraction: VoiceExtractionResult): boolean {
  return Boolean(
    extraction.quantity != null ||
      extraction.maker_artist_brand ||
      extraction.brand ||
      extraction.make ||
      extraction.model_title ||
      extraction.model ||
      extraction.retailer_store_purchased_from ||
      extraction.seller ||
      extraction.purchase_year ||
      extraction.year_or_era ||
      extraction.notes,
  );
}

function fallbackPrice(transcript: string): number | null {
  const match = transcript.match(
    /(?:\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)|\b(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars?|nzd|nz dollars?))/i,
  );
  if (!match) return null;
  const parsed = Number.parseFloat((match[1] ?? match[2]).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function inferBrandFromName(name: string | null): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  if (!first || first.length < 2) return null;
  return first[0].toUpperCase() + first.slice(1);
}

function inferCategory(value: string | null | undefined): string | null {
  const text = value?.toLowerCase() ?? "";
  const explicit = ITEM_CATEGORIES.find((category) => category.toLowerCase() === text);
  if (explicit) return explicit;

  const checks: Array<[RegExp, string]> = [
    [/\b(tv|television|lcd|oled|qled|soundbar|speaker|laptop|computer|monitor|phone|tablet|camera|console|xbox|playstation)\b/, "Electronics"],
    [/\b(fridge|freezer|washing machine|dryer|dishwasher|microwave|oven|vacuum)\b/, "Appliances"],
    [/\b(sofa|couch|chair|table|desk|bed|mattress|dresser|cabinet|bookshelf)\b/, "Furniture"],
    [/\b(ring|necklace|watch|bracelet|earrings|jewellery|jewelry)\b/, "Jewellery"],
    [/\b(book|dvd|record|vinyl|game|album)\b/, "Books & Media"],
    [/\b(jacket|coat|shirt|dress|shoes|boots|clothing)\b/, "Clothing"],
    [/\b(lawn mower|drill|saw|tool|garage|ladder)\b/, "Tools & Garage"],
    [/\b(kitchen|plate|pan|pot|cutlery|appliance)\b/, "Kitchenware"],
    [/\b(office|printer|filing|scanner)\b/, "Office"],
    [/\b(garden|outdoor|bbq|barbecue|patio)\b/, "Outdoor / Garden"],
  ];
  return checks.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function sameValue(a: VoiceScalar, b: VoiceScalar): boolean {
  if (typeof a === "string" || typeof b === "string") {
    return String(a ?? "").trim().toLocaleLowerCase() === String(b ?? "").trim().toLocaleLowerCase();
  }
  return a === b;
}

function isUncertain(extraction: VoiceExtractionResult, ...keys: string[]): boolean {
  const uncertain = new Set(extraction.uncertain_fields.map((field) => field.toLowerCase()));
  return keys.some((key) => uncertain.has(key.toLowerCase()));
}

function makeChange(
  field: VoiceItemField,
  currentValue: VoiceScalar,
  nextValue: VoiceScalar,
  patch: VoiceItemPatch,
  uncertain: boolean,
): VoiceMappedChange | null {
  if (nextValue === null || sameValue(currentValue, nextValue)) return null;
  return {
    id: field,
    field,
    label: LABELS[field],
    currentValue,
    nextValue,
    patch,
    uncertain,
    selectedByDefault: !uncertain,
  };
}

function genericPriceIsAmbiguous(transcript: string, targetField?: VoiceItemField): boolean {
  if (targetField === "replacement_price" || targetField === "original_purchase_price") return false;
  const text = transcript.toLowerCase();
  const mentionsPrice = /\b(price|value|worth|dollars?)\b/.test(text);
  const replacementIsExplicit = /\b(replacement|each|current value|estimated value|worth)\b/.test(text);
  const purchaseIsExplicit = /\b(original|purchase|purchased|bought|paid)\b/.test(text);
  return mentionsPrice && !replacementIsExplicit && !purchaseIsExplicit;
}

export function mapVoiceItemExtraction({
  transcript,
  extraction,
  currentValues = {},
  targetField,
}: {
  transcript: string;
  extraction: VoiceExtractionResult;
  currentValues?: Partial<VoiceItemValues>;
  targetField?: VoiceItemField;
}): VoiceMappedChange[] {
  const changes: VoiceMappedChange[] = [];
  const accepts = (field: VoiceItemField) => !targetField || targetField === field;
  const add = (change: VoiceMappedChange | null) => {
    if (change) changes.push(change);
  };

  if (accepts("name")) {
    const next = fallbackName(transcript, extraction);
    add(makeChange("name", currentValues.name ?? null, next, { name: next }, isUncertain(extraction, "display_name", "name")));
  }

  if (accepts("category")) {
    const next = inferCategory(extraction.category) ?? inferCategory(fallbackName(transcript, extraction));
    add(makeChange("category", currentValues.category ?? null, next, { category: next }, isUncertain(extraction, "category")));
  }

  if (accepts("quantity") && Number.isInteger(extraction.quantity) && (extraction.quantity ?? 0) >= 1) {
    add(makeChange("quantity", currentValues.quantity ?? null, extraction.quantity, { quantity: extraction.quantity }, isUncertain(extraction, "quantity")));
  }

  if (accepts("brand_maker")) {
    const next =
      cleanText(extraction.maker_artist_brand) ??
      cleanText(extraction.brand) ??
      cleanText(extraction.make) ??
      inferBrandFromName(fallbackName(transcript, extraction));
    add(makeChange("brand_maker", currentValues.brand_maker ?? null, next, { brand_maker: next }, isUncertain(extraction, "maker_artist_brand", "brand", "make")));
  }

  if (accepts("model_series")) {
    const next = cleanText(extraction.model_title) ?? cleanText(extraction.model);
    add(makeChange("model_series", currentValues.model_series ?? null, next, { model_series: next }, isUncertain(extraction, "model_title", "model")));
  }

  if (accepts("purchase_source")) {
    const next = cleanText(extraction.retailer_store_purchased_from) ?? cleanText(extraction.seller);
    add(makeChange("purchase_source", currentValues.purchase_source ?? null, next, { purchase_source: next }, isUncertain(extraction, "retailer_store_purchased_from", "seller")));
  }

  if (accepts("purchase_year_approx")) {
    const next = cleanText(extraction.purchase_year) ?? cleanText(extraction.year_or_era);
    add(makeChange("purchase_year_approx", currentValues.purchase_year_approx ?? null, next, { purchase_year_approx: next }, isUncertain(extraction, "purchase_year", "year_or_era")));
  }

  const ambiguousPrice = genericPriceIsAmbiguous(transcript, targetField);
  const transcriptPrice = fallbackPrice(transcript);
  const priceCandidate = extraction.estimated_value ?? extraction.purchase_price ?? transcriptPrice;
  if (ambiguousPrice && priceCandidate !== null && (!targetField || targetField === "replacement_price" || targetField === "original_purchase_price")) {
    changes.push({
      id: "ambiguous_price",
      field: "ambiguous_price",
      label: "Price",
      currentValue: null,
      nextValue: priceCandidate,
      patch: {},
      uncertain: false,
      selectedByDefault: false,
      requiresResolution: true,
    });
  } else {
    const replacementIsExplicit = /\b(replacement|each|current value|estimated value|worth)\b/i.test(transcript);
    const originalPrice = targetField === "original_purchase_price"
      ? extraction.purchase_price ?? extraction.estimated_value ?? transcriptPrice
      : extraction.purchase_price ?? (replacementIsExplicit ? null : transcriptPrice);
    const replacementPrice = targetField === "replacement_price"
      ? extraction.estimated_value ?? extraction.purchase_price ?? transcriptPrice
      : extraction.estimated_value ?? transcriptPrice;

    if (accepts("original_purchase_price") && originalPrice !== null && originalPrice >= 0) {
      add(makeChange(
        "original_purchase_price",
        currentValues.original_purchase_price ?? null,
        originalPrice,
        { original_purchase_price: originalPrice },
        isUncertain(extraction, "purchase_price"),
      ));
    }

    if (accepts("replacement_price") && replacementPrice !== null && replacementPrice >= 0) {
      add(makeChange(
        "replacement_price",
        currentValues.unit_estimated_price ?? currentValues.estimated_price ?? null,
        replacementPrice,
        {
          estimated_price: replacementPrice,
          unit_estimated_price: replacementPrice,
          price_source_type: "user_entered",
          valuation_basis: "manual",
        },
        isUncertain(extraction, "estimated_value"),
      ));
    }
  }

  if (accepts("description")) {
    const next = cleanText(extraction.description);
    add(makeChange("description", currentValues.description ?? null, next, { description: next }, isUncertain(extraction, "description")));
  }

  if (accepts("notes")) {
    const next = cleanText(extraction.notes);
    add(makeChange("notes", currentValues.notes ?? null, next, { notes: next }, isUncertain(extraction, "notes", "raw_summary")));
  }

  return changes;
}

export function resolveAmbiguousPrice(
  change: VoiceMappedChange,
  destination: "replacement_price" | "original_purchase_price",
  currentValues: Partial<VoiceItemValues> = {},
): VoiceMappedChange {
  if (change.field !== "ambiguous_price" || typeof change.nextValue !== "number") {
    throw new Error("Only an ambiguous numeric price can be resolved.");
  }
  const amount = change.nextValue;
  return destination === "replacement_price"
    ? {
        ...change,
        id: destination,
        field: destination,
        label: LABELS[destination],
        currentValue: currentValues.unit_estimated_price ?? currentValues.estimated_price ?? null,
        patch: {
          estimated_price: amount,
          unit_estimated_price: amount,
          price_source_type: "user_entered",
          valuation_basis: "manual",
        },
        selectedByDefault: true,
        requiresResolution: false,
      }
    : {
        ...change,
        id: destination,
        field: destination,
        label: LABELS[destination],
        currentValue: currentValues.original_purchase_price ?? null,
        patch: { original_purchase_price: amount },
        selectedByDefault: true,
        requiresResolution: false,
      };
}

export function buildSelectedVoicePatch(changes: VoiceMappedChange[], selectedIds: ReadonlySet<string>): VoiceItemPatch {
  return changes.reduce<VoiceItemPatch>((patch, change) => {
    if (!selectedIds.has(change.id) || change.requiresResolution) return patch;
    return { ...patch, ...change.patch };
  }, {});
}
