export const PROPERTY_TYPES = [
  { label: "Main home",             value: "main_home" },
  { label: "Rental property",       value: "rental_property" },
  { label: "Holiday / beach house", value: "holiday_beach_house" },
  { label: "Storage unit",          value: "storage_unit" },
  { label: "Parent's home",         value: "parents_home" },
  { label: "Business",              value: "business"  },
  { label: "Other",                 value: "other"     },
];

const LEGACY_PROPERTY_TYPE_VALUES: Record<string, string> = {
  rental: "rental_property",
  holiday: "holiday_beach_house",
  holiday_home: "holiday_beach_house",
  storage: "storage_unit",
  parents: "parents_home",
};

export function normalizePropertyTypeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return LEGACY_PROPERTY_TYPE_VALUES[normalized] ?? normalized;
}

/**
 * Returns the human-readable display label for a stored property_type value.
 * Falls back to capitalising the first letter and replacing underscores for
 * unknown values that may have been stored before the canonical list existed.
 */
export function propertyTypeLabel(value: string | null | undefined): string | null {
  const normalized = normalizePropertyTypeValue(value);
  if (!normalized) return null;
  const match = PROPERTY_TYPES.find((pt) => pt.value === normalized);
  if (match) return match.label;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, " ");
}
