import type { InventoryItem } from "@/types";

export function getItemPrice(item: InventoryItem): number {
  return item.estimated_price ?? item.unit_estimated_price ?? 0;
}

export function getItemTotalValue(item: InventoryItem): number {
  const price = getItemPrice(item);
  const qty = item.quantity ?? 1;
  return price * qty;
}

export function getItemPhoto(item: InventoryItem): string | null {
  return item.image_url ?? item.photo_url ?? null;
}

export function hasPhoto(item: InventoryItem): boolean {
  return !!(item.image_url || item.photo_url);
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
