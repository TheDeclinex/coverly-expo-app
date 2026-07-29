export type BarcodeKind =
  | "ean-8"
  | "upc-a"
  | "ean-13"
  | "ean-13-upc-a-equivalent"
  | "unsupported";
export type ProviderFailureKind =
  | "not-found"
  | "invalid"
  | "authentication"
  | "rate-limit"
  | "provider";

export interface UpcProduct {
  title?: string;
  brand?: string;
  model?: string;
  description?: string;
  images?: string[];
  offers?: Array<{ merchant?: string; price?: string; link?: string }>;
}

export type ParsedUpcPayload =
  | { kind: "found"; product: UpcProduct; resultCount: number }
  | { kind: "not-found"; resultCount: 0 }
  | { kind: "malformed"; resultCount: null; reason: string }
  | { kind: "rejected"; resultCount: number; reason: string };

export function classifyBarcodeKind(value: string): BarcodeKind {
  if (!/^\d+$/.test(value)) return "unsupported";
  if (value.length === 8) return "ean-8";
  if (value.length === 12) return "upc-a";
  if (value.length === 13 && value.startsWith("0"))
    return "ean-13-upc-a-equivalent";
  if (value.length === 13) return "ean-13";
  return "unsupported";
}

/**
 * UPCitemdb stores its unique product identifier as EAN-13. UPC-A is the
 * equivalent 12-digit value without the leading zero, so submit its canonical
 * EAN-13 form while preserving the raw scanned string separately.
 */
export function normalizeBarcodeForLookup(rawValue: string): string {
  const value = rawValue.trim();
  return classifyBarcodeKind(value) === "upc-a" ? `0${value}` : value;
}

export function classifyUpcHttpFailure(
  status: number,
  providerCode: string | null,
): ProviderFailureKind {
  if (status === 404 || providerCode === "NOT_FOUND") return "not-found";
  if (
    status === 400 ||
    providerCode === "INVALID_UPC" ||
    providerCode === "INVALID_QUERY"
  ) {
    return "invalid";
  }
  if (status === 401 || status === 403 || providerCode === "AUTH_ERR") {
    return "authentication";
  }
  if (
    status === 429 ||
    providerCode === "EXCEED_LIMIT" ||
    providerCode === "TOO_FAST" ||
    providerCode === "HTTP_TOO_MANY_REQUESTS"
  ) {
    return "rate-limit";
  }
  return "provider";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseUpcSuccessPayload(payload: unknown): ParsedUpcPayload {
  if (!payload || typeof payload !== "object") {
    return {
      kind: "malformed",
      resultCount: null,
      reason: "response body is not an object",
    };
  }

  const value = payload as Record<string, unknown>;
  if (!Array.isArray(value.items)) {
    return {
      kind: "malformed",
      resultCount: null,
      reason: "items is not an array",
    };
  }
  if (value.items.length === 0) return { kind: "not-found", resultCount: 0 };

  const first = value.items[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return {
      kind: "malformed",
      resultCount: value.items.length,
      reason: "first item is not an object",
    };
  }

  const item = first as Record<string, unknown>;
  const images = Array.isArray(item.images)
    ? item.images
        .filter(
          (image): image is string =>
            typeof image === "string" && Boolean(image.trim()),
        )
        .slice(0, 3)
    : [];
  const offers = Array.isArray(item.offers)
    ? item.offers
        .filter(
          (
            offer,
          ): offer is { merchant?: string; price?: string; link?: string } =>
            Boolean(offer) &&
            typeof offer === "object" &&
            !Array.isArray(offer),
        )
        .slice(0, 3)
    : [];
  const product: UpcProduct = {
    title: optionalText(item.title) ?? optionalText(item.description),
    brand: optionalText(item.brand),
    model: optionalText(item.model),
    description: optionalText(item.description),
    images,
    offers,
  };

  if (
    !product.title &&
    !product.brand &&
    !product.model &&
    !product.description &&
    images.length === 0 &&
    offers.length === 0
  ) {
    return {
      kind: "rejected",
      resultCount: value.items.length,
      reason: "provider returned an item with no usable product fields",
    };
  }

  return { kind: "found", product, resultCount: value.items.length };
}
