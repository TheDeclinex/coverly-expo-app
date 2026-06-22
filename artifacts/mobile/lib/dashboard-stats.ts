import type { InventoryFile, InventoryItem, InventoryRoom } from "@/types";
import { getCategoryLegendEntry } from "@/constants/categoryColors";
import {
  getItemTotalValue,
  hasPhoto,
  hasValue,
  needsReview,
} from "./inventory-mappers";
import { calculateCoverageInsight } from "./coverage";

export interface RoomStat {
  room: InventoryRoom;
  itemCount: number;
  totalValue: number;
  categoryValues: { key: string; label: string; value: number }[];
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
  const coveragePercent = calculateCoverageInsight(
    totalValue,
    recordedCoverValue,
  ).percent;

  const roomStats: RoomStat[] = rooms
    .map((room) => {
      const roomItems = items.filter((i) => i.room_id === room.id);
      const categoryMap = new Map<string, number>();
      for (const item of roomItems) {
        const category = getCategoryLegendEntry(item.category);
        categoryMap.set(
          category.key,
          (categoryMap.get(category.key) ?? 0) + getItemTotalValue(item),
        );
      }
      return {
        room,
        itemCount: roomItems.length,
        totalValue: roomItems.reduce((s, i) => s + getItemTotalValue(i), 0),
        categoryValues: [...categoryMap.entries()]
          .filter(([, value]) => value > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([key, value]) => ({
            key,
            label: getCategoryLegendEntry(key).label,
            value,
          })),
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

export interface PeriodGrowth {
  valueAdded: number;
  itemsAdded: number;
}

/**
 * Calculate value and item count added within the last N months using scan_date.
 *
 * TODO: Requires inventory_items.scan_date column to be populated.
 * True historical valuation snapshots would require a future value_history table.
 * Returns null if no items have a scan_date value.
 */
export function calcPeriodGrowth(
  items: InventoryItem[],
  months: 1 | 3 | 6 | 12
): PeriodGrowth | null {
  const datedItems = items.filter((i) => i.scan_date != null);
  if (datedItems.length === 0) return null;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const newItems = datedItems.filter(
    (i) => new Date(i.scan_date!) >= cutoff
  );

  return {
    valueAdded: newItems.reduce((s, i) => s + getItemTotalValue(i), 0),
    itemsAdded: newItems.length,
  };
}

/**
 * Build normalised {x, y} sparkline points for cumulative value over the last N months.
 *
 * TODO: Requires inventory_items.scan_date column. Returns [] if unavailable.
 */
export function buildSparklinePoints(
  items: InventoryItem[],
  months: number
): { x: number; y: number }[] {
  const datedItems = items
    .filter((i) => i.scan_date != null)
    .map((i) => ({
      date: new Date(i.scan_date!),
      value: getItemTotalValue(i),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (datedItems.length < 2) return [];

  const buckets = new Map<string, number>();
  for (let m = months - 1; m >= 0; m--) {
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, 0);
  }

  for (const item of datedItems) {
    const key = `${item.date.getFullYear()}-${String(item.date.getMonth() + 1).padStart(2, "0")}`;
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + item.value);
    }
  }

  const monthKeys = Array.from(buckets.keys()).sort();
  let cumulative = 0;
  const cumulativeValues = monthKeys.map((k) => {
    cumulative += buckets.get(k) ?? 0;
    return cumulative;
  });

  const maxVal = Math.max(...cumulativeValues, 1);
  return cumulativeValues.map((v, i) => ({
    x: monthKeys.length > 1 ? i / (monthKeys.length - 1) : 0.5,
    y: v / maxVal,
  }));
}
