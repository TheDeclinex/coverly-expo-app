import type { InventoryItem, ItemPhoto } from "@/types";

export function getItemPrice(item: InventoryItem): number {
  return item.estimated_price ?? item.unit_estimated_price ?? 0;
}

export function getItemTotalValue(item: InventoryItem): number {
  const price = getItemPrice(item);
  const qty = item.quantity ?? 1;
  return price * qty;
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
  return item.estimated_price != null || item.unit_estimated_price != null;
}

export function needsReview(item: InventoryItem): boolean {
  return !hasPhoto(item) || !hasValue(item);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatCurrencyFull(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
