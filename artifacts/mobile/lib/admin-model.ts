export function adminNumberLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  return new Intl.NumberFormat("en-NZ").format(value);
}

export function adminCurrencyLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  return value.toLocaleString("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  });
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
