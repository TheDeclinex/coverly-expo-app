import { supabase } from "@/lib/supabase";
import { normalizePropertyTypeValue } from "@/constants/propertyTypes";
import type { InventoryFile } from "@/types";

interface CreatePropertyInput {
  name: string;
  propertyType?: string | null;
  contentsSumInsured?: number | null;
  insurerName?: string | null;
  policyNumber?: string | null;
  propertyCoverImageUrl?: string | null;
}

const UNSUPPORTED_PROPERTY_TYPE_MESSAGE =
  "This property type is not currently supported. Please choose another type or update the app.";

export function formatPropertySaveError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error ?? "");

  if (
    /inventory_files_property_type_check/i.test(message) ||
    /property_type/i.test(message)
  ) {
    return UNSUPPORTED_PROPERTY_TYPE_MESSAGE;
  }

  return message || "Could not create property. Please try again.";
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
    throw new Error(formatPropertySaveError(error));
  }

  if (!data) {
    throw new Error("Could not create property. Please try again.");
  }

  return data as InventoryFile;
}
