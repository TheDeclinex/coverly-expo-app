export const PROPERTY_TYPES = [
  { label: "Main home",             value: "main_home" },
  { label: "Rental property",       value: "rental"    },
  { label: "Holiday / beach house", value: "holiday"   },
  { label: "Storage unit",          value: "storage"   },
  { label: "Parent's home",         value: "parents"   },
  { label: "Business",              value: "business"  },
  { label: "Other",                 value: "other"     },
];

/**
 * Returns the human-readable display label for a stored property_type value.
 * Falls back to capitalising the first letter and replacing underscores for
 * unknown values that may have been stored before the canonical list existed.
 */
export function propertyTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = PROPERTY_TYPES.find((pt) => pt.value === value);
  if (match) return match.label;
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}
