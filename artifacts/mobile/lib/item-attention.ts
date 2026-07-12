import { getItemTotalValue, hasValue } from "./inventory-mappers.ts";
import type { InventoryItem } from "../types/index.ts";

export const HIGH_VALUE_EVIDENCE_THRESHOLD = 1000;

export type ItemAttentionFilter =
  | "missing_photo"
  | "missing_value"
  | "needs_details"
  | "missing_evidence"
  | "ai_value";

export const ITEM_ATTENTION_COPY: Record<
  ItemAttentionFilter,
  { title: string; explanation: string; chip: string }
> = {
  missing_photo: {
    title: "Items missing photos",
    explanation: "Add a primary photo to make these records easier to identify and support.",
    chip: "Missing photo",
  },
  missing_value: {
    title: "Items missing values",
    explanation: "Add or review a value for these items to improve your recorded contents total.",
    chip: "Missing value",
  },
  needs_details: {
    title: "Items needing details",
    explanation: "Review the quantity, name, or confidence details for these item records.",
    chip: "Check details",
  },
  missing_evidence: {
    title: "Items needing evidence",
    explanation: "Add a receipt, photo, or document to strengthen these high-value records.",
    chip: "Missing evidence",
  },
  ai_value: {
    title: "Items with estimated values",
    explanation: "Review AI estimates and add current replacement listings where useful.",
    chip: "Review value",
  },
};

export function itemHasUnclearDetails(item: InventoryItem): boolean {
  const name = item.name.trim().toLowerCase();
  return name.length < 3 || ["item", "unknown", "object", "misc", "miscellaneous"].includes(name);
}

export function itemNeedsDetailReview(item: InventoryItem): boolean {
  const lowConfidence = item.confidence != null && item.confidence < 0.7;
  return item.quantity == null || lowConfidence || itemHasUnclearDetails(item);
}

export function itemNeedsRoomReview(item: InventoryItem): boolean {
  return !hasValue(item) || itemNeedsDetailReview(item);
}

export function itemHasPrimaryPhoto(item: InventoryItem): boolean {
  return Boolean(item.image_url || item.photo_url);
}

export function itemHasAiEstimate(item: InventoryItem): boolean {
  const source = `${item.price_source_type ?? ""} ${item.valuation_basis ?? ""}`.toLowerCase();
  return source.includes("ai") || source.includes("scan");
}

export function itemMatchesAttention(
  item: InventoryItem,
  filter: ItemAttentionFilter,
  evidenceCount = 0,
): boolean {
  if (filter === "missing_photo") return !itemHasPrimaryPhoto(item);
  if (filter === "missing_value") return !hasValue(item);
  if (filter === "needs_details") return itemNeedsDetailReview(item);
  if (filter === "missing_evidence") {
    return getItemTotalValue(item) >= HIGH_VALUE_EVIDENCE_THRESHOLD && evidenceCount === 0;
  }
  return itemHasAiEstimate(item);
}

export function filterItemsNeedingAttention(
  items: readonly InventoryItem[],
  filter: ItemAttentionFilter,
  evidenceCounts: Readonly<Record<string, number>> = {},
): InventoryItem[] {
  return items.filter((item) => itemMatchesAttention(item, filter, evidenceCounts[item.id] ?? 0));
}

export function isItemAttentionFilter(value: string | undefined): value is ItemAttentionFilter {
  return Boolean(value && value in ITEM_ATTENTION_COPY);
}
