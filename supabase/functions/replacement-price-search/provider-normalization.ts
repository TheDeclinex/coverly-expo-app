import { resolveProviderPrice } from "./price-parser.ts";
import type { ReplacementResultCandidate } from "./result-quality.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function countRawProviderResults(
  data: unknown,
  providerType: "shopping" | "organic",
): number {
  if (!isRecord(data)) return 0;
  const value = data[providerType];
  return Array.isArray(value) ? value.length : 0;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function position(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.round(value))
    : fallback;
}

function normalizeCandidate(
  raw: Record<string, unknown>,
  fallbackPosition: number,
  providerType: "shopping" | "organic",
): ReplacementResultCandidate {
  const title = text(raw.title) ?? "Unknown product";
  const snippet = text(raw.snippet) ?? text(raw.description);
  const price = resolveProviderPrice(raw, `${title} ${snippet ?? ""}`);
  return {
    title,
    source:
      text(raw.source) ??
      text(raw.displayLink) ??
      text(raw.merchant) ??
      "Unknown retailer",
    price: price?.value ?? null,
    priceRaw: price?.raw ?? "",
    link: text(raw.link) ?? text(raw.productLink) ?? text(raw.url) ?? "",
    ...(snippet ? { snippet } : {}),
    ...((text(raw.imageUrl) ?? text(raw.thumbnail))
      ? { thumbnail: text(raw.imageUrl) ?? text(raw.thumbnail) }
      : {}),
    position: position(raw.position, fallbackPosition),
    providerType,
    priceSource: price?.source ?? "none",
  };
}

export function normalizeShoppingResults(
  data: unknown,
  limit: number,
): ReplacementResultCandidate[] {
  const shopping =
    isRecord(data) && Array.isArray(data.shopping) ? data.shopping : [];
  return shopping
    .slice(0, Math.max(0, limit))
    .flatMap((raw, index) =>
      isRecord(raw) ? [normalizeCandidate(raw, index + 1, "shopping")] : [],
    );
}

export function normalizeOrganicResults(
  data: unknown,
  limit: number,
): ReplacementResultCandidate[] {
  const organic =
    isRecord(data) && Array.isArray(data.organic) ? data.organic : [];
  return organic
    .slice(0, Math.max(0, limit))
    .flatMap((raw, index) =>
      isRecord(raw) ? [normalizeCandidate(raw, index + 1, "organic")] : [],
    );
}
