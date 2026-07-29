import { supabase } from "@/lib/supabase";
export {
  classifyBarcodeFailure,
  isSupportedBarcodeValue,
  type BarcodeFailureKind,
} from "@/lib/barcode-model";

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
  barcodeFormat?: string;
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
  offers?: Array<{ merchant?: string; price?: string; currencyCode?: string; retailerCountryCode?: string; link?: string }>;
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
  context?: { countryCode: string; currencyCode: string };
  diagnostics?: BarcodeDiagnostics;
}

export interface BarcodeVerifyFailure {
  success: false;
  errorCode: string;
  error: string;
  barcode?: string | null;
  diagnostics?: BarcodeDiagnostics;
}

export interface BarcodeDiagnostics {
  rawScannedBarcode?: string | null;
  detectedBarcodeFormat?: string | null;
  normalizedBarcode?: string | null;
  normalizedBarcodeKind?: string;
  providerPlan?: "trial" | "paid";
  providerHttpStatus?: number;
  providerResponseCode?: string | null;
  providerResultCount?: number | null;
  providerRateLimitRemaining?: string | null;
  providerRateLimitReset?: string | null;
  coverlyParseOutcome?: string;
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
    rawScannedBarcode: request.barcode,
    detectedBarcodeFormat: request.barcodeFormat ?? null,
    barcodePresent: Boolean(request.barcode),
    barcodeLength: request.barcode.length,
    functionName: BARCODE_FUNCTION_NAME,
    functionUrl: supabaseUrl
      ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${BARCODE_FUNCTION_NAME}`
      : "not-configured",
    supabaseHost,
    userPresent: Boolean(session?.user),
    sessionPresent: Boolean(session),
    sessionError: sessionError?.message ?? null,
  };

  if (__DEV__) console.info("[barcodeVerify] request", diagnostic);

  if (!session) {
    if (__DEV__) console.warn("[barcodeVerify] request blocked: no authenticated session", diagnostic);
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
    const context = errorWithContext.context;
    let functionFailure: BarcodeVerifyFailure | null = null;
    if (context && typeof context === "object" && "json" in context && typeof context.json === "function") {
      try {
        const body = await context.json();
        if (body && typeof body === "object" && (body as { success?: unknown }).success === false) {
          functionFailure = body as BarcodeVerifyFailure;
        }
      } catch {
        // The response was not JSON; the generic Supabase function error below is retained.
      }
    }
    if (__DEV__) console.warn("[barcodeVerify] request failed", {
      ...diagnostic,
      errorName: error.name,
      errorMessage: error.message,
      errorContext: describeErrorContext(errorWithContext.context),
      functionErrorCode: functionFailure?.errorCode ?? null,
    });
    if (functionFailure) return functionFailure;
    throw new Error(error.message || "Barcode lookup failed.");
  }
  if (!data) {
    if (__DEV__) console.warn("[barcodeVerify] empty response", diagnostic);
    throw new Error("Barcode lookup returned no response.");
  }
  if (__DEV__) console.info("[barcodeVerify] response", {
    ...diagnostic,
    success: data.success,
    errorCode: data.success ? null : data.errorCode,
    normalizedBarcode: data.diagnostics?.normalizedBarcode ?? null,
    normalizedBarcodeKind: data.diagnostics?.normalizedBarcodeKind ?? null,
    providerPlan: data.diagnostics?.providerPlan ?? null,
    providerHttpStatus: data.diagnostics?.providerHttpStatus ?? null,
    providerResponseCode: data.diagnostics?.providerResponseCode ?? null,
    providerResultCount: data.diagnostics?.providerResultCount ?? null,
    providerRateLimitRemaining: data.diagnostics?.providerRateLimitRemaining ?? null,
    coverlyParseOutcome: data.diagnostics?.coverlyParseOutcome ?? null,
  });
  return data;
}
