import type { InventoryFile, InventoryItem, InventoryRoom } from "@/types";
import {
  getItemTotalValue,
  hasPhoto,
  hasValue,
  needsReview,
} from "./inventory-mappers";

export interface RoomStat {
  room: InventoryRoom;
  itemCount: number;
  totalValue: number;
}

export interface PropertyStats {
  totalValue: number;
  itemCount: number;
  roomCount: number;
  recordedCoverValue: number | null;
  coveragePercent: number | null;
  roomStats: RoomStat[];
  topItems: InventoryItem[];
  itemsWithPhotos: number;
  itemsWithValues: number;
  itemsNeedingReview: number;
  photoPercent: number;
  valuePercent: number;
}

export function calcPropertyStats(
  property: InventoryFile,
  rooms: InventoryRoom[],
  items: InventoryItem[]
): PropertyStats {
  const totalValue = items.reduce(
    (sum, item) => sum + getItemTotalValue(item),
    0
  );
  const itemCount = items.length;
  const roomCount = rooms.length;

  const recordedCoverValue = property.contents_sum_insured ?? null;
  const coveragePercent =
    recordedCoverValue && recordedCoverValue > 0
      ? Math.min((totalValue / recordedCoverValue) * 100, 200)
      : null;

  const roomStats: RoomStat[] = rooms
    .map((room) => {
      const roomItems = items.filter((i) => i.room_id === room.id);
      return {
        room,
        itemCount: roomItems.length,
        totalValue: roomItems.reduce((s, i) => s + getItemTotalValue(i), 0),
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue);

  const topItems = [...items]
    .sort((a, b) => getItemTotalValue(b) - getItemTotalValue(a))
    .slice(0, 5);

  const itemsWithPhotos = items.filter(hasPhoto).length;
  const itemsWithValues = items.filter(hasValue).length;
  const itemsNeedingReview = items.filter(needsReview).length;

  return {
    totalValue,
    itemCount,
    roomCount,
    recordedCoverValue,
    coveragePercent,
    roomStats,
    topItems,
    itemsWithPhotos,
    itemsWithValues,
    itemsNeedingReview,
    photoPercent: itemCount > 0 ? (itemsWithPhotos / itemCount) * 100 : 0,
    valuePercent: itemCount > 0 ? (itemsWithValues / itemCount) * 100 : 0,
  };
}

export interface PortfolioStats {
  propertyCount: number;
  totalRecordedCover: number;
  totalInventoryValue: number;
  totalItems: number;
}

export function calcPortfolioStats(
  properties: InventoryFile[],
  items: InventoryItem[]
): PortfolioStats {
  const totalRecordedCover = properties.reduce(
    (sum, p) => sum + (p.contents_sum_insured ?? 0),
    0
  );
  const totalInventoryValue = items.reduce(
    (sum, i) => sum + getItemTotalValue(i),
    0
  );
  return {
    propertyCount: properties.length,
    totalRecordedCover,
    totalInventoryValue,
    totalItems: items.length,
  };
}
