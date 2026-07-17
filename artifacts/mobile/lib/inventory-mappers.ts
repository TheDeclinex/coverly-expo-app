import type { InventoryItem, ItemPhoto } from "@/types";
import { formatMoney } from "./money.ts";

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
  currencyCode = "NZD",
  contextCurrency: string | null | undefined = currencyCode,
): string {
  return formatMoney(value, currencyCode, { contextCurrency });
  /* legacy formatter retained below only for source-history clarity
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`; */
}

export function formatCurrencyFull(
  value: number | null | undefined,
  currencyCode = "NZD",
  contextCurrency: string | null | undefined = currencyCode,
): string {
  return formatMoney(value, currencyCode, { contextCurrency });
  /* legacy formatter retained below only for source-history clarity
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`; */
}
