import { friendlyNetworkErrorMessage } from "@/lib/network-errors";
import { anonKey, debugSupabaseUrl, supabase } from "@/lib/supabase";
import {
  refinementFailureCode,
  replacementRefinementFailureMessage,
} from "./replacement-refinement-errors.ts";
import {
  postRefinementWithCurrentSession,
  RefinementSessionError,
} from "./replacement-refinement-transport.ts";
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
  errorCode?: string;
  code?: string;
  message?: string;
  requestId?: string;
}

export async function improveReplacementRefinementWithAi(
  itemId: string,
  draft: ReplacementRefinementDraft,
): Promise<AiReplacementRefinementResult> {
  let invocation: { status: number; ok: boolean; data: AiRefinementFunctionResponse | null };
  try {
    invocation = await postRefinementWithCurrentSession<AiRefinementFunctionResponse>({
      getSession: () => supabase.auth.getSession(),
      fetcher: fetch,
      functionUrl: `${debugSupabaseUrl.replace(/\/$/, "")}/functions/v1/${FUNCTION_NAME}`,
      anonKey,
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
  } catch (error) {
    if (error instanceof RefinementSessionError) {
      throw new Error(replacementRefinementFailureMessage(undefined, error.code));
    }
    throw new Error(friendlyNetworkErrorMessage(error) ?? replacementRefinementFailureMessage());
  }

  const { data, status, ok } = invocation;
  if (!ok || !data?.success || !data.draft) {
    const code = refinementFailureCode(status, data);
    if (__DEV__) {
      console.warn("[replacement-refinement-ai] function failure", {
        status,
        code,
        requestId: data?.requestId,
      });
    }
    throw new Error(replacementRefinementFailureMessage(status, code));
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
}
