export type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: any; error: any }>;
};
export class UsageError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export async function fingerprint(input: unknown) {
  return sha256(JSON.stringify(canonical(input)));
}
export function usageFailure(error: unknown) {
  const code =
    error instanceof UsageError ? error.code : "USAGE_SERVICE_UNAVAILABLE";
  const message =
    code === "OWNER_FAIR_USE_EXHAUSTED"
      ? "Your included AI allowance is used for this month. Manual editing remains available."
      : code === "FREE_ALLOWANCE_EXHAUSTED"
        ? "Your free AI allowance is used for this month. Manual editing remains available."
        : code.startsWith("OPERATION_")
          ? "This operation cannot run again. Check its outcome before starting a new request."
          : code === "IDEMPOTENCY_CONFLICT"
            ? "This request key was already used for different input."
            : code === "INVALID_WORKLOAD"
              ? "The request exceeds the supported workload or contains invalid images."
              : "Usage accounting could not confirm this operation. Please try again later.";
  return {
    success: false,
    errorCode: code,
    error: message,
    message,
    retryable: error instanceof UsageError ? error.status === 503 : true,
  };
}

// Constructed only after auth.getUser and resource RLS checks. The resource is
// also ownership-checked by SQL. Never accept a user ID or fingerprint from JSON.
export class TrustedUsage {
  private client: RpcClient;
  private userId: string;
  claim: any;
  private settlementAttempted = false;
  private diagnostic: Record<string, unknown> = {};
  constructor(client: RpcClient, userId: string) {
    this.client = client;
    this.userId = userId;
  }
  private async call(
    name: string,
    args: Record<string, unknown>,
    code = "USAGE_SERVICE_UNAVAILABLE",
  ) {
    let response;
    try {
      response = await this.client.rpc(name, {
        p_user_id: this.userId,
        ...args,
      });
    } catch {
      throw new UsageError(code);
    }
    if (response.error || !response.data) throw new UsageError(code);
    return response.data;
  }
  async reserve(
    feature: string,
    operation: string,
    key: string,
    input: unknown,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    this.claim = await this.call("reserve_feature_usage", {
      p_feature: feature,
      p_operation: operation,
      p_key: key,
      p_fingerprint: await fingerprint(input),
      p_resource_id: resourceId,
      p_metadata: metadata,
    });
    const c = this.claim;
    Object.assign(this.diagnostic, {
      reservationId: c.reservation_id,
      feature,
      operation,
      status: c.status,
      code: c.code,
      policyClass: c.policy_class,
      isBypassed: c.is_bypassed,
      entitlementMode: c.entitlement_mode,
      effectivePlan: c.effective_plan,
      units: c.units,
      usedUnits: c.used_units,
      reservedUnits: c.reserved_units,
      remainingUnits: c.remaining_units,
      limitUnits: c.limit_units,
      wouldHaveBlocked: c.would_have_blocked,
    });
    if (c.execute !== true || !c.execution_token || !c.reservation_id) {
      const code = c.code ?? "USAGE_SERVICE_UNAVAILABLE";
      // Released clients turn any 402 into a subscription upsell. An owner has
      // already paid: use 429 plus a distinct fair-use code, never that upsell.
      throw new UsageError(
        code,
        code === "OWNER_FAIR_USE_EXHAUSTED"
          ? 429
          : code === "FREE_ALLOWANCE_EXHAUSTED"
            ? 402
            : code.startsWith("OPERATION_") || code === "IDEMPOTENCY_CONFLICT"
              ? 409
              : 503,
      );
    }
    return c;
  }
  diagnostics() {
    return this.diagnostic;
  }
  private identity() {
    if (!this.claim?.execution_token)
      throw new UsageError("EXECUTION_CLAIM_LOST");
    return {
      p_reservation_id: this.claim.reservation_id,
      p_token: this.claim.execution_token,
    };
  }
  async provider(
    attempt: string,
    execute: () => Promise<Response>,
  ): Promise<Response> {
    const start = await this.call("start_feature_provider_attempt", {
      ...this.identity(),
      p_attempt: attempt,
    });
    if (start.execute !== true)
      throw new UsageError(start.code ?? "EXECUTION_CLAIM_LOST", 409);
    let response: Response;
    try {
      response = await execute();
    } catch (error) {
      await this.finishAttempt(attempt, false, null);
      throw error;
    }
    await this.finishAttempt(attempt, response.ok, response.status);
    return response;
  }
  private async finishAttempt(
    attempt: string,
    success: boolean,
    status: number | null,
  ) {
    const result = await this.call(
      "finish_feature_provider_attempt",
      {
        ...this.identity(),
        p_attempt: attempt,
        p_success: success,
        p_http_status: status,
      },
      "USAGE_TELEMETRY_FAILED",
    );
    if (result.ok !== true) throw new UsageError("USAGE_TELEMETRY_FAILED");
  }
  async settle(
    outcome: "committed" | "refunded",
    reason: string | null = null,
  ) {
    if (this.settlementAttempted)
      throw new UsageError("USAGE_SETTLEMENT_UNCERTAIN");
    this.settlementAttempted = true; // Never refund after an uncertain commit.
    const result = await this.call(
      "settle_feature_usage",
      { ...this.identity(), p_outcome: outcome, p_reason: reason },
      "USAGE_SETTLEMENT_FAILED",
    );
    if (result.ok !== true || result.status !== outcome)
      throw new UsageError("USAGE_SETTLEMENT_FAILED");
    Object.assign(this.diagnostic, {
      status: outcome,
      settled: true,
      usedUnits: result.used_units,
      reservedUnits: result.reserved_units,
      remainingUnits: result.remaining_units,
    });
  }
}

export async function boundedJson(req: Request, maximum: number): Promise<any> {
  if (Number(req.headers.get("content-length")) > maximum)
    throw new UsageError("INVALID_WORKLOAD", 413);
  if (!req.body) throw new UsageError("INVALID_WORKLOAD", 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) {
        await reader.cancel();
        throw new UsageError("INVALID_WORKLOAD", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new UsageError("INVALID_WORKLOAD", 400);
  }
}
