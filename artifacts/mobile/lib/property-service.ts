import { supabase } from "@/lib/supabase";
import { normalizePropertyTypeValue } from "@/constants/propertyTypes";
import type { InventoryFile } from "@/types";
import { normalizePropertyCreationError } from "@/lib/property-errors";

export { formatPropertySaveError, PropertyCreationError } from "@/lib/property-errors";

interface CreatePropertyInput {
  name: string;
  propertyType?: string | null;
  contentsSumInsured?: number | null;
  insurerName?: string | null;
  policyNumber?: string | null;
  propertyCoverImageUrl?: string | null;
}

export async function createProperty(input: CreatePropertyInput): Promise<InventoryFile> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Property name is required.");
  }

  const { data, error } = await supabase
    .rpc("create_my_property", {
      p_name: name,
      p_property_type: normalizePropertyTypeValue(input.propertyType),
      p_contents_sum_insured: input.contentsSumInsured ?? null,
      p_insurer_name: input.insurerName ?? null,
      p_policy_number: input.policyNumber ?? null,
      p_property_cover_image_url: input.propertyCoverImageUrl ?? null,
    })
    .single();

  if (error) {
    throw normalizePropertyCreationError(error);
  }

  if (!data) {
    throw new Error("Could not create property. Please try again.");
  }

  return data as InventoryFile;
}
