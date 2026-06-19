export interface CategoryColorEntry {
  key: string;
  label: string;
  color: string;
}

/**
 * Global category-colour legend used by composition charts, room bars, and
 * item category markers. Colours are intentionally stable: category rank must
 * never change which colour represents a category.
 */
export const CATEGORY_COLOR_LEGEND: readonly CategoryColorEntry[] = [
  { key: "furniture", label: "Furniture", color: "#6FCFCE" },
  { key: "electronics", label: "Electronics", color: "#8FC4A6" },
  { key: "general_items", label: "General items", color: "#E8B989" },
  { key: "appliances", label: "Appliances", color: "#B8A4E3" },
  { key: "bedroom", label: "Bedroom", color: "#E0AFBB" },
  { key: "books_media", label: "Books & Media", color: "#8FBBD6" },
  { key: "clothing", label: "Clothing", color: "#E8C07A" },
  { key: "collectibles", label: "Collectibles", color: "#C4A8D8" },
  { key: "home_decor", label: "Home Decor", color: "#83CFC0" },
  { key: "jewellery", label: "Jewellery", color: "#E69AB5" },
  { key: "kitchenware", label: "Kitchenware", color: "#D9A66F" },
  { key: "office", label: "Office", color: "#9FB3D8" },
  { key: "outdoor_garden", label: "Outdoor / Garden", color: "#9ABFA0" },
  { key: "sports_outdoors", label: "Sports & Outdoors", color: "#7DBBC5" },
  { key: "tools_garage", label: "Tools & Garage", color: "#A6ADB8" },
  { key: "toys_games", label: "Toys & Games", color: "#D8A6CF" },
  { key: "lighting", label: "Lighting", color: "#E4C45D" },
  { key: "art", label: "Art", color: "#D3A4C7" },
  { key: "automotive", label: "Automotive", color: "#B9A99E" },
  { key: "other", label: "Other", color: "#C5B5AF" },
] as const;

const BY_KEY = new Map(CATEGORY_COLOR_LEGEND.map((entry) => [entry.key, entry]));

const CATEGORY_ALIASES: Record<string, string> = {
  general: "general_items",
  general_item: "general_items",
  miscellaneous: "general_items",
  decor: "home_decor",
  homewares: "home_decor",
  jewelry: "jewellery",
  kitchen: "kitchenware",
  outdoor: "outdoor_garden",
  garden: "outdoor_garden",
  sport: "sports_outdoors",
  sports: "sports_outdoors",
  tools: "tools_garage",
  garage: "tools_garage",
  toys: "toys_games",
  books: "books_media",
  media: "books_media",
  unknown: "other",
};

export function normalizeCategoryKey(category: string | null | undefined): string {
  if (!category?.trim()) return "general_items";
  const normalized = category
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_and_/g, "_");
  const key = CATEGORY_ALIASES[normalized] ?? normalized;
  return BY_KEY.has(key) ? key : "other";
}

export function getCategoryLegendEntry(
  category: string | null | undefined,
): CategoryColorEntry {
  return BY_KEY.get(normalizeCategoryKey(category)) ?? BY_KEY.get("other")!;
}

export function getCategoryColor(category: string | null | undefined): string {
  return getCategoryLegendEntry(category).color;
}

export function getCategoryLabel(category: string | null | undefined): string {
  return getCategoryLegendEntry(category).label;
}
