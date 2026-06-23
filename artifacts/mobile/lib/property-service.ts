import { supabase } from "@/lib/supabase";
import type { InventoryFile } from "@/types";

interface CreatePropertyInput {
  name: string;
  propertyType?: string | null;
  contentsSumInsured?: number | null;
  propertyCoverImageUrl?: string | null;
}

function parseRpcErrorMessage(error: { message?: string } | null): string {
  return error?.message ?? "Could not create property. Please try again.";
}

export async function createProperty(input: CreatePropertyInput): Promise<InventoryFile> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Property name is required.");
  }

  const { data, error } = await supabase
    .rpc("create_my_property", {
      p_name: name,
      p_property_type: input.propertyType ?? null,
      p_contents_sum_insured: input.contentsSumInsured ?? null,
      p_property_cover_image_url: input.propertyCoverImageUrl ?? null,
    })
    .single();

  if (error) {
    throw new Error(parseRpcErrorMessage(error));
  }

  if (!data) {
    throw new Error("Could not create property. Please try again.");
  }

  return data as InventoryFile;
}
