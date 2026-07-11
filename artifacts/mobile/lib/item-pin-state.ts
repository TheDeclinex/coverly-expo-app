import type { InventoryItem } from "@/types";

export type CommittedPin = { x: number; y: number };

export function itemWithCommittedPin(item: InventoryItem, pin: CommittedPin): InventoryItem {
  const previous = item.image_pin as Record<string, unknown> | null | undefined;
  return {
    ...item,
    image_pin: {
      x: pin.x,
      y: pin.y,
      sourcePhotoIndex: typeof previous?.sourcePhotoIndex === "number" ? previous.sourcePhotoIndex : 0,
      type: previous?.type ?? "user",
    },
  };
}

export function replaceItemWithCommittedPin(
  items: InventoryItem[] | undefined,
  itemId: string,
  pin: CommittedPin,
): InventoryItem[] | undefined {
  return items?.map((item) => item.id === itemId ? itemWithCommittedPin(item, pin) : item);
}
