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

function plainTargetValue(transcript: string, preserveTerminalPunctuation = false): string | null {
  const cleaned = transcript.trim();
  if (!cleaned) return null;

  // Command-style speech still benefits from structured extraction. A plain value
  // spoken from a field's mic should not be replaced with a guess from item context.
  if (
    /^(?:set|add|update|change|rename|fill|make|describe|description|brand|maker|model|category|note|notes|bought|purchased|paid)\b/i.test(
      cleaned,
    )
  ) {
    return null;
  }

  return preserveTerminalPunctuation
    ? cleaned
    : cleaned.replace(/[.!?]+$/g, "").trim() || null;
}

function cleanNameCandidate(value: string | null | undefined): string | null {
  const cleaned = value
    ?.replace(/(?:\$\s*\d+(?:,\d{3})*(?:\.\d{1,2})?|\b\d+(?:,\d{3})*(?:\.\d{1,2})?\s*(?:dollars?|nzd|nz dollars?))/gi, "")
    .replace(/\b(?:worth|valued at|value|price|costs?|cost|paid|bought for|purchased for)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[,\s.]+$/g, "")
    .trim();
  if (
    !cleaned ||
    cleaned.length < 3 ||
    /^(?:item|product|object|thing|it|this|that|unknown item)$/i.test(cleaned) ||
    /^(?:bought|purchased|paid)\b/i.test(cleaned)
  ) return null;
  return cleaned;
}

function titleCaseItemPhrase(value: string): string {
  return value
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part.trim() || part === "-") return part;
      if (/^(?:tv|rc|lcd|led|oled|qled|uhd|hd|4k|8k)$/i.test(part)) return part.toUpperCase();
      if (/^(?:inch|inches)$/i.test(part)) return part.toLowerCase();
      if (/^[A-Z0-9][A-Za-z0-9.-]*$/.test(part) && /[A-Z0-9]/.test(part.slice(1))) return part;
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

function inferProductType(...values: Array<string | null | undefined>): string | null {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  const types: Array<[RegExp, string]> = [
    [/\b(?:radio[ -]?controlled|remote[ -]?controlled|rc)\s+car\b/, "RC Car"],
    [/\bvacuum(?:\s+cleaner)?\b/, "Vacuum Cleaner"],
    [/\b(?:television|tv)\b/, "TV"],
    [/\bsoundbar\b/, "Soundbar"],
    [/\b(?:mobile\s+)?phone\b/, "Phone"],
    [/\blaptop\b/, "Laptop"],
    [/\btablet\b/, "Tablet"],
    [/\bcamera\b/, "Camera"],
    [/\bwashing\s+machine\b/, "Washing Machine"],
    [/\b(?:refrigerator|fridge)\b/, "Fridge"],
    [/\bsofa\b|\bcouch\b/, "Sofa"],
    [/\blawn\s*mower\b/, "Lawn Mower"],
  ];
  return types.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function joinDistinctNameParts(...values: Array<string | null>): string | null {
  const parts: string[] = [];
  for (const value of values) {
    const cleaned = cleanNameCandidate(value);
    if (!cleaned) continue;
    const normalized = cleaned.toLocaleLowerCase();
    if (parts.some((part) => part.toLocaleLowerCase().includes(normalized))) continue;
    const containedIndex = parts.findIndex((part) => normalized.includes(part.toLocaleLowerCase()));
    if (containedIndex >= 0) parts.splice(containedIndex, 1, cleaned);
    else parts.push(cleaned);
  }
  return parts.length ? titleCaseItemPhrase(parts.join(" ")) : null;
}

function fallbackName(transcript: string, extraction: VoiceExtractionResult): string | null {
  const brand = cleanText(extraction.maker_artist_brand) ?? cleanText(extraction.brand) ?? cleanText(extraction.make);
  const model = cleanText(extraction.model_title) ?? cleanText(extraction.model);
  const productType = cleanNameCandidate(extraction.product_type) ?? inferProductType(
    extraction.category,
    extraction.description,
    extraction.raw_summary,
    transcript,
  );
  const proposedName = cleanNameCandidate(extraction.name) ?? cleanNameCandidate(extraction.display_name);
  if (proposedName) {
    const normalizedProposal = proposedName.toLocaleLowerCase();
    const isOnlyKnownIdentifier = [brand, model, joinDistinctNameParts(brand, model)]
      .some((value) => value?.toLocaleLowerCase() === normalizedProposal);
    return productType && isOnlyKnownIdentifier
      ? joinDistinctNameParts(brand, model, productType)
      : proposedName;
  }

  if (productType && (brand || model)) return joinDistinctNameParts(brand, model, productType);
  if (brand && model) return joinDistinctNameParts(brand, model);

  // A transcript phrase is only used when it contains a recognisable product
  // type. This avoids fabricating names from purchase-only speech such as
  // "Bought it in 2021 for $300".
  if (productType) {
    const spokenIdentity = transcript
      .split(/\b(?:bought|purchased|paid|from|for\s+\$|in\s+(?:19|20)\d{2})\b|[,;\n]/i)[0]
      .trim();
    const transcriptName = cleanNameCandidate(spokenIdentity);
    if (transcriptName && !/^(?:it|this|that)\b/i.test(transcriptName)) {
      return titleCaseItemPhrase(transcriptName);
    }
    return joinDistinctNameParts(brand, model, productType);
  }

  return null;
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

function extractedCurrency(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  const aliases: Record<string, string> = { "NZ DOLLARS": "NZD", "AUSTRALIAN DOLLARS": "AUD", "US DOLLARS": "USD", "CANADIAN DOLLARS": "CAD", POUNDS: "GBP", EUROS: "EUR", YEN: "JPY" };
  if (!normalized) return null;
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  return aliases[normalized] ?? null;
}

function makeChange(
  field: VoiceItemField,
  currentValue: VoiceScalar,
  nextValue: VoiceScalar,
  patch: VoiceItemPatch,
  uncertain: boolean,
  selectedByDefault = !uncertain,
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
    selectedByDefault,
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
    const direct = targetField === "name" ? plainTargetValue(transcript) : null;
    const next = direct ?? fallbackName(transcript, extraction);
    const uncertain = direct ? false : isUncertain(extraction, "name", "display_name", "product_type");
    add(makeChange(
      "name",
      currentValues.name ?? null,
      next,
      { name: next },
      uncertain,
      !cleanText(currentValues.name) && !uncertain,
    ));
  }

  if (accepts("category")) {
    const next = inferCategory(extraction.category) ?? inferCategory(fallbackName(transcript, extraction));
    add(makeChange("category", currentValues.category ?? null, next, { category: next }, isUncertain(extraction, "category")));
  }

  if (accepts("quantity") && Number.isInteger(extraction.quantity) && (extraction.quantity ?? 0) >= 1) {
    add(makeChange("quantity", currentValues.quantity ?? null, extraction.quantity, { quantity: extraction.quantity }, isUncertain(extraction, "quantity")));
  }

  if (accepts("brand_maker")) {
    const direct = targetField === "brand_maker" ? plainTargetValue(transcript) : null;
    const next =
      direct ??
      cleanText(extraction.maker_artist_brand) ??
      cleanText(extraction.brand) ??
      cleanText(extraction.make) ??
      inferBrandFromName(fallbackName(transcript, extraction));
    add(makeChange("brand_maker", currentValues.brand_maker ?? null, next, { brand_maker: next }, direct ? false : isUncertain(extraction, "maker_artist_brand", "brand", "make")));
  }

  if (accepts("model_series")) {
    const direct = targetField === "model_series" ? plainTargetValue(transcript) : null;
    const next =
      direct ??
      cleanText(extraction.model_title) ?? cleanText(extraction.model);
    add(makeChange("model_series", currentValues.model_series ?? null, next, { model_series: next }, direct ? false : isUncertain(extraction, "model_title", "model")));
  }

  if (accepts("purchase_source")) {
    const direct = targetField === "purchase_source" ? plainTargetValue(transcript) : null;
    const next =
      direct ??
      cleanText(extraction.retailer_store_purchased_from) ?? cleanText(extraction.seller);
    add(makeChange("purchase_source", currentValues.purchase_source ?? null, next, { purchase_source: next }, direct ? false : isUncertain(extraction, "retailer_store_purchased_from", "seller")));
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
        { original_purchase_price: originalPrice, ...(extractedCurrency(extraction.currency) ? { original_purchase_currency: extractedCurrency(extraction.currency) } : {}) },
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
          ...(extractedCurrency(extraction.currency) ? { estimated_currency: extractedCurrency(extraction.currency) } : {}),
        },
        isUncertain(extraction, "estimated_value"),
      ));
    }
  }

  if (accepts("description")) {
    const direct = targetField === "description" ? plainTargetValue(transcript, true) : null;
    const next =
      direct ??
      cleanText(extraction.description);
    add(makeChange("description", currentValues.description ?? null, next, { description: next }, direct ? false : isUncertain(extraction, "description")));
  }

  if (accepts("notes")) {
    const direct = targetField === "notes" ? plainTargetValue(transcript, true) : null;
    const next =
      direct ??
      cleanText(extraction.notes);
    add(makeChange("notes", currentValues.notes ?? null, next, { notes: next }, direct ? false : isUncertain(extraction, "notes", "raw_summary")));
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
