import {
  parseAccessCapabilities,
  type AccessCapabilities,
} from "./access-capabilities.ts";

export class AccessError extends Error {
  code:
    | "AUTH_REQUIRED"
    | "ACCOUNT_CHANGED"
    | "VERIFICATION_UNAVAILABLE"
    | "INVALID_ACCESS_RESPONSE";
  constructor(code: AccessError["code"]) {
    super(code);
    this.code = code;
  }
}
export interface AccessTransport {
  session(): Promise<{ userId: string; token: string } | null>;
  read(token: string): Promise<{ data: unknown; error: unknown }>;
  reconcile(
    token: string,
  ): Promise<{ data: unknown; error: unknown; status?: number }>;
}
export function createAccessClient(transport: AccessTransport) {
  async function execute(
    userId: string,
    reconcile: boolean,
  ): Promise<AccessCapabilities> {
    try {
      const session = await transport.session();
      if (!session) throw new AccessError("AUTH_REQUIRED");
      if (session.userId !== userId) throw new AccessError("ACCOUNT_CHANGED");
      // Transport must bind this token, never a later SDK/global session.
      const response = await (reconcile
        ? transport.reconcile(session.token)
        : transport.read(session.token));
      const current = await transport.session();
      if (!current) throw new AccessError("AUTH_REQUIRED");
      if (current.userId !== userId) throw new AccessError("ACCOUNT_CHANGED");
      if ("status" in response && response.status === 401)
        throw new AccessError("AUTH_REQUIRED");
      if (response.error) throw new AccessError("VERIFICATION_UNAVAILABLE");
      const data = response.data as { ok?: boolean; access?: unknown } | null;
      if (reconcile && data?.ok !== true)
        throw new AccessError("VERIFICATION_UNAVAILABLE");
      try {
        return parseAccessCapabilities(reconcile ? data?.access : data);
      } catch {
        throw new AccessError("INVALID_ACCESS_RESPONSE");
      }
    } catch (error) {
      if (error instanceof AccessError) throw error;
      throw new AccessError("VERIFICATION_UNAVAILABLE");
    }
  }
  return {
    read: (id: string) => execute(id, false),
    reconcile: (id: string) => execute(id, true),
  };
}
