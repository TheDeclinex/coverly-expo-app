import type { InventoryItem, ItemPhoto } from "@/types";
import { formatMoney, isCurrencyCode } from "./money.ts";

export function getItemPrice(item: InventoryItem): number {
  return getItemUnitPrice(item);
}

/** Canonical per-item replacement price. Legacy rows may only have estimated_price. */
export function getItemUnitPrice(item: InventoryItem): number {
  const value = item.unit_estimated_price ?? item.estimated_price;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function getItemTotalValue(item: InventoryItem): number {
  const unitPrice = getItemUnitPrice(item);
  return unitPrice > 0 ? unitPrice * Math.max(1, item.quantity ?? 1) : 0;
}

export function getItemPhotos(item: InventoryItem): ItemPhoto[] {
  if (Array.isArray(item.attachments) && item.attachments.length > 0) {
    return item.attachments.filter(
      (a): a is ItemPhoto =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as ItemPhoto).url === "string"
    );
  }
  const url = item.image_url ?? item.photo_url ?? null;
  if (url) return [{ url, caption: "" }];
  return [];
}

export function getItemPhoto(item: InventoryItem): string | null {
  const photos = getItemPhotos(item);
  if (photos.length > 0) return photos[0].url;
  return item.image_url ?? item.photo_url ?? null;
}

export function hasPhoto(item: InventoryItem): boolean {
  return getItemPhotos(item).length > 0;
}

export function hasValue(item: InventoryItem): boolean {
  return getItemUnitPrice(item) > 0;
}

export function needsReview(item: InventoryItem): boolean {
  return !hasPhoto(item) || !hasValue(item);
}

export function formatCurrency(
  value: number | null | undefined,
  currencyCode: string | null | undefined = "NZD",
  contextCurrency?: string | null,
): string {
  const propertyCurrency = isCurrencyCode(currencyCode) ? currencyCode.trim().toUpperCase() : "NZD";
  return formatMoney(value, propertyCurrency, {
    contextCurrency: contextCurrency === undefined ? propertyCurrency : contextCurrency,
    precision: "summary",
  });
}

export function formatCurrencyFull(
  value: number | null | undefined,
  currencyCode: string | null | undefined = "NZD",
  contextCurrency?: string | null,
): string {
  const propertyCurrency = isCurrencyCode(currencyCode) ? currencyCode.trim().toUpperCase() : "NZD";
  return formatMoney(value, propertyCurrency, {
    contextCurrency: contextCurrency === undefined ? propertyCurrency : contextCurrency,
    precision: "value",
  });
}
