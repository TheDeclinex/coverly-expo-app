export interface DuplicateCandidateItem {
  id: string;
  name: string;
  brand_maker?: string | null;
  model_series?: string | null;
  barcode?: string | null;
  category?: string | null;
  estimated_price?: number | null;
  unit_estimated_price?: number | null;
}

export interface PotentialDuplicateGroup<T extends DuplicateCandidateItem> {
  id: string;
  reason: "Matching item names" | "Similar item names";
  items: T[];
}

const NAME_ALIASES: Array<[RegExp, string]> = [
  [/\btelevisions?\b/g, "tv"],
  [/\brefrigerators?\b/g, "fridge"],
  [/\bcell\s+phones?\b/g, "phone"],
  [/\bmobile\s+phones?\b/g, "phone"],
  [/\bseries\s+(\d+)\b/g, "s$1"],
];

export function normalizeDuplicateItemName(value: string): string {
  let normalized = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  for (const [pattern, replacement] of NAME_ALIASES) normalized = normalized.replace(pattern, replacement);
  return normalized
    .replace(/(\d+)\s*(?:-|\s)?(?:inch(?:es)?|in\b|[\"”])/g, "$1")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedField(value: string | null | undefined): string {
  return normalizeDuplicateItemName(value ?? "");
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function nameSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshteinDistance(a, b) / longest;
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.max(left.size, right.size);
}

function recordedValue(item: DuplicateCandidateItem): number | null {
  const value = item.unit_estimated_price ?? item.estimated_price;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function valuesAreSimilar(a: DuplicateCandidateItem, b: DuplicateCandidateItem): boolean {
  const left = recordedValue(a);
  const right = recordedValue(b);
  if (left == null || right == null) return false;
  return Math.abs(left - right) / Math.max(left, right) <= 0.15;
}

function duplicatePairReason(
  a: DuplicateCandidateItem,
  b: DuplicateCandidateItem,
): PotentialDuplicateGroup<DuplicateCandidateItem>["reason"] | null {
  const leftName = normalizeDuplicateItemName(a.name);
  const rightName = normalizeDuplicateItemName(b.name);
  if (!leftName || !rightName) return null;
  if (leftName === rightName) return "Matching item names";

  const similarity = nameSimilarity(leftName, rightName);
  const overlap = tokenOverlap(leftName, rightName);
  const sameBarcode = !!normalizedField(a.barcode) && normalizedField(a.barcode) === normalizedField(b.barcode);
  const sameModel = !!normalizedField(a.model_series) && normalizedField(a.model_series) === normalizedField(b.model_series);
  const sameBrand = !!normalizedField(a.brand_maker) && normalizedField(a.brand_maker) === normalizedField(b.brand_maker);
  const sameCategory = !!normalizedField(a.category) && normalizedField(a.category) === normalizedField(b.category);

  if (sameBarcode && similarity >= 0.5) return "Similar item names";
  if (sameModel && sameBrand && similarity >= 0.6) return "Similar item names";
  if (similarity >= 0.9 && (overlap >= 0.5 || sameBrand || sameCategory)) return "Similar item names";
  if (overlap >= 0.8 && similarity >= 0.72 && (sameBrand || sameCategory || valuesAreSimilar(a, b))) {
    return "Similar item names";
  }
  return null;
}

export function findPotentialDuplicateGroups<T extends DuplicateCandidateItem>(items: T[]): PotentialDuplicateGroup<T>[] {
  const parents = items.map((_, index) => index);
  const exactPairs = new Set<string>();
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const reason = duplicatePairReason(items[left], items[right]);
      if (!reason) continue;
      union(left, right);
      if (reason === "Matching item names") exactPairs.add(`${left}:${right}`);
    }
  }

  const groupedIndexes = new Map<number, number[]>();
  items.forEach((_, index) => {
    const root = find(index);
    groupedIndexes.set(root, [...(groupedIndexes.get(root) ?? []), index]);
  });

  return [...groupedIndexes.values()]
    .filter((indexes) => indexes.length > 1)
    .map((indexes, groupIndex) => ({
      id: `duplicate-group-${groupIndex + 1}`,
      reason: indexes.some((left, position) => indexes.slice(position + 1).some((right) => exactPairs.has(`${left}:${right}`)))
        ? "Matching item names" as const
        : "Similar item names" as const,
      items: indexes.map((index) => items[index]),
    }));
}
