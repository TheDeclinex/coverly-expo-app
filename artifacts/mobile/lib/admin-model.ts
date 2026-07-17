export function adminNumberLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  return new Intl.NumberFormat("en-NZ").format(value);
}

export function adminCurrencyLabel(value: number | null | undefined, currencyCode?: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  if (!currencyCode) return `${adminNumberLabel(value)} (currency unavailable)`;
  try { return new Intl.NumberFormat("en", { style: "currency", currency: currencyCode, currencyDisplay: "code", maximumFractionDigits: 0 }).format(value); }
  catch { return `${currencyCode} ${adminNumberLabel(value)}`; }
}

export function adminInventoryTotalLabel(
  primaryValue: number | null | undefined,
  propertyCurrency: string | null | undefined,
  totals: Record<string, number> | null | undefined,
): string {
  const priced = Object.entries(totals ?? {})
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (priced.length === 0) return "Not available";
  if (priced.length === 1 && priced[0][0] === propertyCurrency) {
    return adminCurrencyLabel(primaryValue ?? priced[0][1], propertyCurrency);
  }
  return priced.map(([currencyCode, value]) => adminCurrencyLabel(value, currencyCode)).join(" · ");
}

export function adminTextLabel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Not available";
}

export function adminDateLabel(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function adminStatusLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "Not available";
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function adminMetricLabel(value: number | null | undefined, isLoading = false, isError = false): string {
  if (isLoading) return "Loading";
  if (isError) return "Unavailable";
  return adminNumberLabel(value);
}

export function normalizeAdminUserIdParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function adminUserIdDebugSummary(value: unknown): {
  present: boolean;
  type: string;
  length: number;
  uuidLike: boolean;
} {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = typeof raw === "string" ? raw.trim() : "";
  return {
    present: text.length > 0,
    type: Array.isArray(value) ? "array" : typeof value,
    length: text.length,
    uuidLike: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text),
  };
}
