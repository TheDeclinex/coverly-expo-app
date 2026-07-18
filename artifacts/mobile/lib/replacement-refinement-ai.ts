import { friendlyNetworkErrorMessage } from "@/lib/network-errors";
import { supabase } from "@/lib/supabase";
import type {
  ReplacementRefinementDraft,
  ReplacementRefinementTextField,
} from "./replacement-refinement-model.ts";

const FUNCTION_NAME = "replacement-refinement-v2";

export interface AiReplacementRefinementResult {
  draft: Pick<ReplacementRefinementDraft, ReplacementRefinementTextField>;
  changedFields: ReplacementRefinementTextField[];
  suggestedChips: string[];
}

interface AiRefinementFunctionResponse {
  success: boolean;
  draft?: Pick<ReplacementRefinementDraft, ReplacementRefinementTextField> & {
    changedFields?: ReplacementRefinementTextField[];
    suggestedChips?: string[];
  };
  error?: string;
}

export async function improveReplacementRefinementWithAi(
  itemId: string,
  draft: ReplacementRefinementDraft,
): Promise<AiReplacementRefinementResult> {
  try {
    const { data, error } = await supabase.functions.invoke<AiRefinementFunctionResponse>(FUNCTION_NAME, {
      body: {
        itemId,
        draft: {
          searchTerm: draft.searchTerm,
          brand: draft.brand,
          model: draft.model,
          additionalDetails: draft.additionalDetails,
        },
      },
    });
    if (error || !data?.success || !data.draft) {
      throw new Error(data?.error || error?.message || "AI could not improve the search right now.");
    }
    return {
      draft: {
        searchTerm: data.draft.searchTerm ?? draft.searchTerm,
        brand: data.draft.brand ?? draft.brand,
        model: data.draft.model ?? draft.model,
        additionalDetails: data.draft.additionalDetails ?? draft.additionalDetails,
      },
      changedFields: Array.isArray(data.draft.changedFields) ? data.draft.changedFields : [],
      suggestedChips: Array.isArray(data.draft.suggestedChips) ? data.draft.suggestedChips : [],
    };
  } catch (error) {
    throw new Error(friendlyNetworkErrorMessage(error) || (error instanceof Error ? error.message : "AI could not improve the search right now."));
  }
}
