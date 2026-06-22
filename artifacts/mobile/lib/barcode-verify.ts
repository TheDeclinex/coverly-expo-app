import { supabase } from "@/lib/supabase";

const BARCODE_FUNCTION_NAME = "barcode-verify";

function describeErrorContext(context: unknown): unknown {
  if (!context || typeof context !== "object") return context ?? null;
  const value = context as Record<string, unknown>;
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
    status: typeof value.status === "number" ? value.status : undefined,
    statusText: typeof value.statusText === "string" ? value.statusText : undefined,
    url: typeof value.url === "string" ? value.url : undefined,
  };
}

export interface BarcodeVerifyRequest {
  barcode: string;
  itemName?: string;
  category?: string;
  itemId?: string;
}

export interface BarcodeMatchedProduct {
  title?: string;
  brand?: string;
  model?: string;
  description?: string;
  images?: string[];
  offers?: Array<{ merchant?: string; price?: string; link?: string }>;
}

export interface BarcodeVerifySuccess {
  success: true;
  barcode: string | null;
  barcodeType: string;
  productName?: string;
  brand?: string;
  matchedProduct: BarcodeMatchedProduct | null;
  confidence: number;
  source: "gpt_vision" | "supplied";
}

export interface BarcodeVerifyFailure {
  success: false;
  errorCode: string;
  error: string;
  barcode?: string | null;
}

export type BarcodeVerifyResponse = BarcodeVerifySuccess | BarcodeVerifyFailure;

export async function verifyBarcode(
  request: BarcodeVerifyRequest,
): Promise<BarcodeVerifyResponse> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
  let supabaseHost = "not-configured";
  try {
    supabaseHost = new URL(supabaseUrl).host;
  } catch {
    supabaseHost = supabaseUrl || "not-configured";
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const session = sessionData.session;
  const diagnostic = {
    operation: "barcode_verify",
    barcode: request.barcode,
    functionName: BARCODE_FUNCTION_NAME,
    functionUrl: supabaseUrl
      ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${BARCODE_FUNCTION_NAME}`
      : "not-configured",
    supabaseHost,
    userPresent: Boolean(session?.user),
    sessionPresent: Boolean(session),
    sessionError: sessionError?.message ?? null,
  };

  console.info("[barcodeVerify] request", diagnostic);

  if (!session) {
    console.error("[barcodeVerify] request blocked: no authenticated session", diagnostic);
    throw new Error("No authenticated session is available for barcode verification.");
  }

  const { data, error } = await supabase.functions.invoke<BarcodeVerifyResponse>(
    BARCODE_FUNCTION_NAME,
    {
      body: request,
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  );

  if (error) {
    const errorWithContext = error as typeof error & { context?: unknown };
    console.error("[barcodeVerify] request failed", {
      ...diagnostic,
      errorName: error.name,
      errorMessage: error.message,
      errorContext: describeErrorContext(errorWithContext.context),
    });
    throw new Error(error.message || "Barcode lookup failed.");
  }
  if (!data) {
    console.error("[barcodeVerify] empty response", diagnostic);
    throw new Error("Barcode lookup returned no response.");
  }
  console.info("[barcodeVerify] response", {
    ...diagnostic,
    success: data.success,
    errorCode: data.success ? null : data.errorCode,
  });
  return data;
}
