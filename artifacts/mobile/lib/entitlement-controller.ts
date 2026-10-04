import type { AccessCapabilities } from "./access-capabilities.ts";
import { AccessError } from "./access-client.ts";

export type VerificationState =
  | "loading"
  | "verified"
  | "reconciling"
  | "unavailable"
  | "auth_required"
  | "revoked";
export type RecoveryResult = {
  ok: boolean;
  cancelled?: boolean;
  pending?: boolean;
  outcome:
    | "cancelled"
    | "failed"
    | "confirmed"
    | "pending"
    | "nothing_found"
    | "owner_restored"
    | "legacy_restored"
    | "account_changed"
    | "auth_required"
    | "busy";
  message: string;
};
export interface EntitlementState {
  access: AccessCapabilities | null;
  verification: VerificationState;
  refreshing: boolean;
  purchasing: boolean;
  pending: "purchase" | "restore" | null;
  error: string | null;
}
type StoreResult =
  | { ok: true }
  | { ok: false; cancelled?: boolean; error: string };
type Dependencies = {
  read: (id: string) => Promise<AccessCapabilities>;
  reconcile: (id: string) => Promise<AccessCapabilities>;
  isCurrent: () => boolean;
  changed: (access: AccessCapabilities) => void;
  now?: () => number;
};
const eligible = (a: AccessCapabilities | null) =>
  !!a &&
  (a.ownsCoverly ||
    a.accessClass === "legacy_plus" ||
    a.accessClass === "legacy_family");
const changedAccount = (): RecoveryResult => ({
  ok: false,
  outcome: "account_changed",
  message:
    "Your account changed. Refresh access in the account you used for the purchase.",
});

// One instance per session identity, including A -> B -> A. No persisted grants.
export class EntitlementController {
  readonly userId: string;
  private deps: Dependencies;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private automatic: Promise<void> | null = null;
  private lastAutomatic = -Infinity;
  private requireOwnership = false;
  private fingerprint: string | null = null;
  private state: EntitlementState = {
    access: null,
    verification: "loading",
    refreshing: false,
    purchasing: false,
    pending: null,
    error: null,
  };
  constructor(userId: string, deps: Dependencies) {
    this.userId = userId;
    this.deps = deps;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<EntitlementState>) {
    if (!this.deps.isCurrent()) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async refresh(reconcile = false): Promise<void> {
    const run = async () => {
      if (!this.deps.isCurrent()) return;
      this.update({
        refreshing: true,
        ...(reconcile ? { verification: "reconciling" as const } : {}),
      });
      try {
        const access = await (reconcile
          ? this.deps.reconcile(this.userId)
          : this.deps.read(this.userId));
        if (!this.deps.isCurrent()) return;
        this.update({
          access,
          error: null,
          verification:
            access.ownershipVerification === "revoked" ? "revoked" : "verified",
        });
        this.deps.changed(access);
      } catch (error) {
        const code =
          error instanceof AccessError
            ? error.code
            : "VERIFICATION_UNAVAILABLE";
        const auth = code === "AUTH_REQUIRED" || code === "ACCOUNT_CHANGED";
        this.update({
          verification: auth ? "auth_required" : "unavailable",
          error: code,
          ...(auth ? { access: null } : {}),
        });
      } finally {
        this.update({ refreshing: false });
      }
    };
    // A cheap read started before a transaction cannot overwrite its settlement.
    const task = this.queue.then(run, run);
    this.queue = task;
    await task;
  }
  automaticRefresh(materialChange = false): Promise<void> {
    if (this.automatic) return this.automatic;
    const now = (this.deps.now ?? Date.now)();
    if (!materialChange && now - this.lastAutomatic < 300_000)
      return Promise.resolve();
    this.lastAutomatic = now;
    this.automatic = this.refresh(true).finally(() => {
      this.automatic = null;
    });
    return this.automatic;
  }
  customerInfoChanged(info: {
    entitlements?: { active?: Record<string, unknown> };
  }): void {
    // Ignore request timestamps and ordering. No configured owned entitlement is needed.
    const active = info.entitlements?.active ?? {};
    const next = JSON.stringify(
      Object.keys(active)
        .sort()
        .map((key) => [key, active[key]]),
    );
    const changed = this.fingerprint !== null && next !== this.fingerprint;
    this.fingerprint = next;
    if (changed) void this.automaticRefresh(true);
  }
  private result(kind: "purchase" | "restore"): RecoveryResult {
    if (!this.deps.isCurrent()) return changedAccount();
    if (this.state.verification === "auth_required")
      return {
        ok: kind === "purchase",
        pending: true,
        outcome: "auth_required",
        message:
          kind === "purchase"
            ? "Purchase successful. Sign in to the same Coverly account to confirm access. Do not purchase again."
            : "Restore completed. Sign in to confirm access.",
      };
    if (
      this.state.verification === "unavailable" ||
      (this.state.pending === "purchase" && (!eligible(this.state.access) || (this.requireOwnership && !this.state.access?.ownsCoverly)))
    )
      return {
        ok: kind === "purchase",
        pending: true,
        outcome: "pending",
        message:
          kind === "purchase"
            ? "Purchase successful — confirming access. Retry verification or restore purchases later; do not purchase again."
            : "Restore completed, but access verification is temporarily unavailable. Please retry.",
      };
    if (eligible(this.state.access))
      return {
        ok: true,
        outcome:
          kind === "purchase"
            ? "confirmed"
            : this.state.access?.ownsCoverly
              ? "owner_restored"
              : "legacy_restored",
        message:
          kind === "purchase"
            ? "Purchase successful. Your access is confirmed."
            : this.state.access?.ownsCoverly
              ? "Coverly ownership restored."
              : "Legacy subscription restored.",
      };
    return {
      ok: false,
      outcome: "nothing_found",
      message: "No eligible Coverly purchase was found for this account.",
    };
  }
  async retry(): Promise<RecoveryResult> {
    const kind = this.state.pending ?? "restore";
    await this.refresh(true);
    const result = this.result(kind);
    if (!result.pending) this.update({ pending: null });
    return result;
  }
  async transact(
    kind: "purchase" | "restore",
    store: () => Promise<StoreResult>,
    requireOwnership = false,
  ): Promise<RecoveryResult> {
    if (!this.deps.isCurrent()) return changedAccount();
    if (this.state.purchasing)
      return {
        ok: false,
        outcome: "busy",
        message: "A purchase or restore is already processing.",
      };
    // Once the store has succeeded, another Buy action only retries verification.
    if (this.state.pending) return this.retry();
    this.requireOwnership = requireOwnership;
    this.update({ purchasing: true, error: null });
    try {
      const transaction = await store();
      if (!this.deps.isCurrent()) return changedAccount();
      if (!transaction.ok)
        return {
          ok: false,
          cancelled: transaction.cancelled,
          outcome: transaction.cancelled ? "cancelled" : "failed",
          message: transaction.error,
        };
      this.update({ pending: kind });
      await this.refresh(true);
      const result = this.result(kind);
      if (!result.pending) this.update({ pending: null });
      return result;
    } catch {
      return {
        ok: false,
        outcome: "failed",
        message:
          "The store transaction could not be completed. Please try again.",
      };
    } finally {
      this.update({ purchasing: false });
    }
  }
}
