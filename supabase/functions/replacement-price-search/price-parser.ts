export type ListingPriceSource = "structured" | "text";

export interface ParsedListingPrice {
  value: number;
  raw: string;
  source: ListingPriceSource;
}

function validPrice(value: number): number | null {
  return Number.isFinite(value) && value > 0
    ? Math.round(value * 100) / 100
    : null;
}

function parsePriceValue(value: unknown): ParsedListingPrice | null {
  if (typeof value === "number") {
    const parsed = validPrice(value);
    return parsed == null
      ? null
      : { value: parsed, raw: String(value), source: "structured" };
  }
  if (typeof value === "string") {
    const match = value
      .replace(/,/g, "")
      .match(/(?:NZ\s*)?\$?\s*(\d+(?:\.\d{1,2})?)/i);
    const parsed = match?.[1] ? validPrice(Number(match[1])) : null;
    return parsed == null
      ? null
      : { value: parsed, raw: value.trim(), source: "structured" };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return (
      parsePriceValue(record.value) ??
      parsePriceValue(record.amount) ??
      parsePriceValue(record.price)
    );
  }
  return null;
}

export function parseStructuredProviderPrice(
  record: Record<string, unknown>,
): ParsedListingPrice | null {
  const offers =
    record.offers && typeof record.offers === "object"
      ? (record.offers as Record<string, unknown>)
      : null;
  for (const value of [
    record.salePrice,
    record.currentPrice,
    record.extractedPrice,
    record.priceValue,
    record.offerPrice,
    offers?.salePrice,
    offers?.price,
    record.price,
  ]) {
    const parsed = parsePriceValue(value);
    if (parsed) return parsed;
  }
  return null;
}

function textPrice(text: string, pattern: RegExp): ParsedListingPrice | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const parsed = validPrice(Number(match[1].replace(/,/g, "")));
  return parsed == null
    ? null
    : { value: parsed, raw: match[0].trim(), source: "text" };
}

export function parseListingPriceText(
  value: string | null | undefined,
): ParsedListingPrice | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const preferred = textPrice(
    text,
    /\b(?:now|our price|sale price|current price)\s*:?-?\s*(?:NZ\s*)?\$\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
  );
  if (preferred) return preferred;

  const withoutNonCurrentAmounts = text
    .replace(
      /\b(?:save|saving|was|rrp)\s*:?-?\s*(?:NZ\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?/gi,
      "",
    )
    .replace(
      /\b(?:starting\s+from|base\s+model\s+from|prices?\s+from|from)\s*:?-?\s*(?:NZ\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?/gi,
      "",
    );
  return textPrice(
    withoutNonCurrentAmounts,
    /(?:NZ\s*)?\$\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
  );
}

export function resolveProviderPrice(
  record: Record<string, unknown>,
  fallbackText: string,
): ParsedListingPrice | null {
  return (
    parseStructuredProviderPrice(record) ?? parseListingPriceText(fallbackText)
  );
}
