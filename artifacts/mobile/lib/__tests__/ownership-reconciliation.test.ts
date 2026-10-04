import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAccessCapabilities,
  accessPlanLabel,
} from "../access-capabilities.ts";
import { createAccessClient, AccessError } from "../access-client.ts";
import { EntitlementController } from "../entitlement-controller.ts";
import { normaliseUsageAllowance } from "../usage-allowances-model.ts";
import { normalizeLimitError } from "../limit-errors.ts";

function wire(kind = "free") {
  const owner = kind === "owner",
    legacy = kind.startsWith("legacy_");
  const plan = owner
    ? "coverly_owned"
    : kind === "legacy_family"
      ? "coverly_family"
      : kind === "legacy_plus" || kind === "tester" || kind === "override"
        ? "coverly_plus"
        : kind === "admin"
          ? "admin"
          : "free";
  return {
    contract_version: 1,
    effective_plan: plan,
    access_class: kind === "revoked" ? "free" : kind,
    ownership_status: owner ? "owned" : kind === "revoked" ? "revoked" : "none",
    can_manage_inventory: true,
    can_access_evidence: true,
    ai_requires_metering: owner || kind === "free" || kind === "revoked",
    owns_coverly: owner,
    ownership_verification: owner
      ? "verified"
      : kind === "revoked"
        ? "revoked"
        : "not_owned",
    property_limit: owner
      ? 5
      : ["legacy_family", "tester", "admin"].includes(kind)
        ? null
        : 1,
    property_count: 0,
    can_create_property: true,
    can_export_claim_pack:
      owner || legacy || ["tester", "admin", "override"].includes(kind),
    ai_policy_class: owner ? "owned" : kind === "revoked" ? "free" : kind,
    override_type:
      kind === "override"
        ? "support"
        : ["tester", "admin"].includes(kind)
          ? kind
          : "none",
  };
}
const caps = (kind = "free") => parseAccessCapabilities(wire(kind));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup(kind = "free") {
  let current = true,
    next = caps(kind),
    failure: Error | null = null,
    now = 0;
  let calls = 0,
    changes = 0;
  const controller = new EntitlementController("A", {
    isCurrent: () => current,
    now: () => now,
    changed: () => {
      changes++;
    },
    read: async () => {
      if (failure) throw failure;
      return next;
    },
    reconcile: async () => {
      calls++;
      if (failure) throw failure;
      return next;
    },
  });
  return {
    controller,
    get calls() {
      return calls;
    },
    get changes() {
      return changes;
    },
    set: (kind: string) => {
      next = caps(kind);
      failure = null;
    },
    fail: (
      code: ConstructorParameters<
        typeof AccessError
      >[0] = "VERIFICATION_UNAVAILABLE",
    ) => {
      failure = new AccessError(code);
    },
    leave: () => {
      current = false;
    },
    advance: () => {
      now += 300_001;
    },
  };
}

for (const kind of [
  "free",
  "owner",
  "legacy_plus",
  "legacy_family",
  "tester",
  "admin",
  "override",
  "revoked",
]) {
  test(`canonical ${kind} loads without RevenueCat/profile data`, async () => {
    const h = setup(kind);
    await h.controller.refresh();
    assert.deepEqual(h.controller.getSnapshot().access, caps(kind));
    assert.equal(
      h.controller.getSnapshot().verification,
      kind === "revoked" ? "revoked" : "verified",
    );
  });
}
test("owner capabilities are explicit and Free cannot export", () => {
  assert.equal(caps("owner").ownsCoverly, true);
  assert.equal(caps("owner").propertyLimit, 5);
  assert.equal(caps("owner").canExportClaimPack, true);
  assert.equal(caps().canExportClaimPack, false);
  assert.equal(accessPlanLabel("coverly_owned"), "Owner");
});
for (const invalid of [
  null,
  [],
  {},
  { ...wire(), contract_version: 2 },
  { ...wire(), property_limit: -1 },
  { ...wire(), can_export_claim_pack: "true" },
  { ...wire(), owns_coverly: true },
  { ...wire("owner"), ownership_verification: "revoked" },
]) {
  test(`malformed capability payload rejected ${JSON.stringify(invalid)}`, () =>
    assert.throws(() => parseAccessCapabilities(invalid)));
}
test("purchase success reconciles immediately to canonical owner", async () => {
  const h = setup("owner");
  let storeCalls = 0;
  const result = await h.controller.transact("purchase", async () => {
    storeCalls++;
    return { ok: true };
  });
  assert.equal(result.outcome, "confirmed");
  assert.equal(h.calls, 1);
  assert.equal(storeCalls, 1);
  assert.equal(h.controller.getSnapshot().access?.ownsCoverly, true);
});
for (const cancelled of [true, false])
  test(`store ${cancelled ? "cancellation" : "failure"} does not reconcile`, async () => {
    const h = setup();
    const result = await h.controller.transact("purchase", async () => ({
      ok: false,
      cancelled,
      error: "store",
    }));
    assert.equal(result.outcome, cancelled ? "cancelled" : "failed");
    assert.equal(h.calls, 0);
  });
test("successful purchase with failed sync is pending, and another Buy retries without a transaction", async () => {
  const h = setup();
  h.fail();
  let buys = 0;
  const buy = async () => {
    buys++;
    return { ok: true as const };
  };
  const first = await h.controller.transact("purchase", buy);
  assert.equal(first.ok, true);
  assert.equal(first.pending, true);
  assert.equal(first.outcome, "pending");
  h.set("owner");
  const second = await h.controller.transact("purchase", buy);
  assert.equal(second.outcome, "confirmed");
  assert.equal(buys, 1);
  assert.equal(h.calls, 2);
});
test("successful store purchase with canonical Free remains pending, not failed", async () => {
  const h = setup();
  const result = await h.controller.transact("purchase", async () => ({
    ok: true,
  }));
  assert.equal(result.pending, true);
  assert.equal(result.ok, true);
  assert.equal(h.controller.getSnapshot().access?.canExportClaimPack, false);
});
for (const [kind, outcome] of [
  ["owner", "owner_restored"],
  ["legacy_plus", "legacy_restored"],
  ["legacy_family", "legacy_restored"],
  ["free", "nothing_found"],
]) {
  test(`restore ${kind} uses server access without activeSubscriptions`, async () => {
    const h = setup(kind);
    const result = await h.controller.transact("restore", async () => ({
      ok: true,
    }));
    assert.equal(result.outcome, outcome);
    assert.equal(h.calls, 1);
  });
}
test("restore verification unavailable is distinct from nothing found", async () => {
  const h = setup();
  h.fail();
  const result = await h.controller.transact("restore", async () => ({
    ok: true,
  }));
  assert.equal(result.outcome, "pending");
  assert.equal(result.pending, true);
  h.set("owner");
  assert.equal((await h.controller.retry()).outcome, "owner_restored");
});
test("store success followed by authentication loss never becomes purchase failure", async () => {
  const h = setup();
  h.fail("AUTH_REQUIRED");
  const result = await h.controller.transact("purchase", async () => ({
    ok: true,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "auth_required");
  assert.equal(result.pending, true);
});
test("parallel purchases suppressed", async () => {
  const h = setup("owner"),
    gate = deferred<{ ok: true }>();
  const first = h.controller.transact("purchase", () => gate.promise);
  let called = false;
  assert.equal(
    (
      await h.controller.transact("purchase", async () => {
        called = true;
        return { ok: true };
      })
    ).outcome,
    "busy",
  );
  gate.resolve({ ok: true });
  await first;
  assert.equal(called, false);
});
test("A -> B -> A ignores delayed first A response and old listeners", async () => {
  const gate = deferred<ReturnType<typeof caps>>();
  let active: EntitlementController;
  let changes = 0;
  const a: EntitlementController = new EntitlementController("A", {
    read: () => gate.promise,
    reconcile: () => gate.promise,
    isCurrent: () => active === a,
    changed: () => {
      changes++;
    },
  });
  active = a;
  const pending = a.refresh(true);
  await Promise.resolve();
  const b = setup();
  active = b.controller;
  const a2 = setup();
  active = a2.controller;
  gate.resolve(caps("owner"));
  await pending;
  a.customerInfoChanged({ entitlements: { active: {} } });
  a.customerInfoChanged({ entitlements: { active: { owned: {} } } });
  await Promise.resolve();
  assert.equal(changes, 0);
  assert.equal(a2.controller.getSnapshot().access, null);
  assert.equal(b.controller.getSnapshot().access, null);
});
test("logout during store purchase ignores old result and never reconciles", async () => {
  const h = setup("owner"),
    gate = deferred<{ ok: true }>();
  const pending = h.controller.transact("purchase", () => gate.promise);
  h.leave();
  gate.resolve({ ok: true });
  assert.equal((await pending).outcome, "account_changed");
  assert.equal(h.calls, 0);
});
test("revocation replaces verified ownership and stale SDK paid data cannot resurrect it", async () => {
  const h = setup("owner");
  await h.controller.refresh();
  h.set("revoked");
  await h.controller.refresh();
  h.controller.customerInfoChanged({
    entitlements: { active: { "Coverly Plus": {} } },
  });
  assert.equal(h.controller.getSnapshot().access?.ownsCoverly, false);
  assert.equal(h.controller.getSnapshot().access?.canExportClaimPack, false);
});
test("temporary offline preserves only previously verified same-account access", async () => {
  const h = setup("owner");
  await h.controller.refresh();
  h.fail();
  await h.controller.refresh();
  assert.equal(h.controller.getSnapshot().verification, "unavailable");
  assert.equal(h.controller.getSnapshot().access?.ownsCoverly, true);
  assert.equal(setup().controller.getSnapshot().access, null);
});
test("automatic sync deduplicates and observes five-minute cooldown; explicit retry bypasses", async () => {
  const h = setup();
  await Promise.all([
    h.controller.automaticRefresh(),
    h.controller.automaticRefresh(),
  ]);
  await h.controller.automaticRefresh();
  assert.equal(h.calls, 1);
  await h.controller.retry();
  assert.equal(h.calls, 2);
  h.advance();
  await h.controller.automaticRefresh();
  assert.equal(h.calls, 3);
});
test("material CustomerInfo change triggers reconciliation but repeated payload does not", async () => {
  const h = setup();
  h.controller.customerInfoChanged({ entitlements: { active: {} } });
  const info = {
    entitlements: { active: { Coverly: { expirationDate: null } } },
  };
  h.controller.customerInfoChanged(info);
  await h.controller.automaticRefresh();
  h.controller.customerInfoChanged(info);
  assert.equal(h.calls, 1);
  assert.equal(h.controller.getSnapshot().access?.ownsCoverly, false);
});
test("client binds token and parses canonical reconciliation without caller claims", async () => {
  const seen: string[] = [];
  const client = createAccessClient({
    session: async () => ({ userId: "A", token: "token-A" }),
    read: async (token) => {
      seen.push(token);
      return { data: wire(), error: null };
    },
    reconcile: async (token) => {
      seen.push(token);
      return { data: { ok: true, access: wire("owner") }, error: null };
    },
  });
  assert.equal((await client.read("A")).effectivePlan, "free");
  assert.equal((await client.reconcile("A")).ownsCoverly, true);
  assert.deepEqual(seen, ["token-A", "token-A"]);
  await assert.rejects(client.reconcile("B"), /ACCOUNT_CHANGED/);
  assert.equal(seen.length, 2);
});
for (const mode of [
  "no_session",
  "401",
  "503",
  "malformed",
  "network",
  "account_change",
])
  test(`client handles ${mode}`, async () => {
    let count = 0;
    const client = createAccessClient({
      session: async () =>
        mode === "no_session"
          ? null
          : {
              userId: mode === "account_change" && count++ > 0 ? "B" : "A",
              token: "A",
            },
      read: async () => ({ data: wire(), error: null }),
      reconcile: async () => {
        if (mode === "network") throw new Error("offline");
        return {
          data:
            mode === "malformed"
              ? { ok: true, access: {} }
              : { ok: true, access: wire("owner") },
          error: mode === "401" || mode === "503" ? {} : null,
          status: Number(mode),
        };
      },
    });
    await assert.rejects(
      client.reconcile("A"),
      (error: unknown) => error instanceof AccessError,
    );
  });
test("bounded owner allowance and exhaustion never produce Plus upsell", () => {
  const row = {
    feature: "ai_scan",
    policy_class: "owned",
    is_limited: true,
    limit_units: 20,
    used_units: 20,
    reserved_units: 0,
    remaining_units: 0,
    reset_at: "2026-10-01",
    blocked: true,
  };
  const allowance = normaliseUsageAllowance(row);
  assert.equal(allowance?.remainingUnits, 0);
  assert.equal(allowance?.isBypassed, false);
  assert.equal(allowance?.resetAt, row.reset_at);
  assert.equal(
    normalizeLimitError({ errorCode: "OWNER_FAIR_USE_EXHAUSTED", status: 402 })?.primaryAction,
    "dismiss",
  );
  assert.equal(
    normaliseUsageAllowance({ ...row, policy_class: "free" })?.isLimited,
    true,
  );
});

test("one-time purchase cannot be confirmed by a stale legacy entitlement", async () => {
  const h = setup("legacy_plus"); let purchases = 0;
  const store = async () => { purchases++; return { ok: true as const }; };
  const first = await h.controller.transact("purchase", store, true);
  assert.equal(first.ok, true); assert.equal(first.pending, true);
  const retry = await h.controller.transact("purchase", store, true);
  assert.equal(retry.pending, true); assert.equal(purchases, 1);
  h.set("owner");
  assert.equal((await h.controller.retry()).outcome, "confirmed");
  assert.equal(purchases, 1);
});
