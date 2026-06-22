import type { InventoryItem } from "@/types";
import type { VoiceItemPatch } from "@/types/voice";

function hasOwn(patch: VoiceItemPatch, key: keyof VoiceItemPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function validMoney(value: number | null | undefined, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or more.`);
  }
  return value;
}

/**
 * Converts a user-reviewed voice patch into a narrow inventory_items update.
 * Only voice-supported fields are allowlisted. Unrelated item metadata is never
 * copied into the payload, so Supabase leaves it unchanged.
 */
export function buildVoiceItemUpdatePayload(
  patch: VoiceItemPatch,
): Partial<InventoryItem> {
  const update: Partial<InventoryItem> = {};

  if (hasOwn(patch, "name")) {
    const name = patch.name?.trim();
    if (!name) throw new Error("Item name cannot be empty.");
    update.name = name;
  }

  if (hasOwn(patch, "quantity")) {
    const quantity = patch.quantity;
    if (!Number.isInteger(quantity) || (quantity ?? 0) < 1) {
      throw new Error("Quantity must be a whole number of 1 or more.");
    }
    update.quantity = quantity!;
  }

  if (hasOwn(patch, "brand_maker")) update.brand_maker = optionalText(patch.brand_maker);
  if (hasOwn(patch, "model_series")) update.model_series = optionalText(patch.model_series);
  if (hasOwn(patch, "purchase_source")) update.purchase_source = optionalText(patch.purchase_source);
  if (hasOwn(patch, "purchase_year_approx")) update.purchase_year_approx = optionalText(patch.purchase_year_approx);
  if (hasOwn(patch, "description")) update.description = optionalText(patch.description);
  if (hasOwn(patch, "notes")) update.notes = optionalText(patch.notes);

  if (hasOwn(patch, "original_purchase_price")) {
    update.original_purchase_price = validMoney(
      patch.original_purchase_price,
      "Original purchase price",
    );
  }

  if (hasOwn(patch, "unit_estimated_price") || hasOwn(patch, "estimated_price")) {
    const proposedUnitPrice = patch.unit_estimated_price ?? patch.estimated_price;
    const unitPrice = validMoney(proposedUnitPrice, "Replacement price");
    update.unit_estimated_price = unitPrice;
    update.estimated_price = unitPrice;

    if (unitPrice !== null) {
      update.price_source_type = patch.price_source_type ?? "user_entered";
      update.valuation_basis = patch.valuation_basis ?? "manual";
    }
  }

  return update;
}
