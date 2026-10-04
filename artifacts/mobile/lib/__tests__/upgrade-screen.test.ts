import assert from "node:assert/strict";
import test from "node:test";
import { upgradeHarness } from "./upgrade-screen-harness.ts";

test("Free gets a single localized ownership CTA; unavailable gets retry", () => {
  const h = upgradeHarness();
  assert.ok(h.button("Unlock Coverly"));
  assert.match(h.text(), /42,35 €/);
  assert.doesNotMatch(h.text(), /Monthly|Annual|Family|Plus|subscription/);
  const missing = upgradeHarness("free", false);
  assert.equal(missing.button("Unlock Coverly"), undefined);
  assert.ok(missing.button("Try again"));
});
for (const kind of ["owner", "legacy_plus", "legacy_family", "tester", "admin"])
  test(`${kind} never renders a buy button`, () => {
    const h = upgradeHarness(kind, false);
    assert.equal(h.button("Unlock Coverly"), undefined);
    assert.ok(h.button("Back to my inventory"));
    if (kind === "owner") {
      assert.match(h.text(), /Coverly unlocked/);
      assert.doesNotMatch(h.text(), /subscription|cancel|Buy|Unlock Coverly/);
    }
  });
test("pending purchase shows confirmation and restore, never another purchase", async () => {
  const h = upgradeHarness();
  h.entitlements.pendingOperation = "purchase";
  h.entitlements.ownershipVerificationState = "unavailable";
  h.render();
  assert.match(h.text(), /Purchase complete/);
  assert.ok(h.button("Retry confirmation"));
  assert.ok(h.button("Restore Purchases"));
  assert.equal(h.button("Unlock Coverly"), undefined);
  h.button("Retry confirmation").props.onPress();
  await h.flush();
  assert.equal(h.calls.confirm, 1);
  assert.equal(h.calls.purchase, 0);
});
test("duplicate taps suppressed during store transaction", async () => {
  const h = upgradeHarness();
  let resolve!: (value: any) => void;
  h.hold(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const button = h.button("Unlock Coverly");
  button.props.onPress();
  button.props.onPress();
  assert.equal(h.calls.purchase, 1);
  resolve({
    ok: true,
    pending: true,
    outcome: "pending",
    message: "Purchase complete — confirming access",
  });
  await h.flush();
  const actions = h.events.map((e) => e.properties.ownership_action);
  assert.ok(actions.includes("purchase_completed"));
  assert.ok(actions.includes("verification_pending"));
  assert.ok(!actions.includes("purchase_failed"));
});
for (const outcome of ["cancelled", "failed", "confirmed"] as const)
  test(`purchase ${outcome} has distinct presentation and analytics`, async () => {
    const h = upgradeHarness();
    h.result({
      ok: outcome === "confirmed",
      cancelled: outcome === "cancelled",
      outcome,
      message: `fixture ${outcome}`,
    });
    h.button("Unlock Coverly").props.onPress();
    await h.flush();
    assert.match(h.text(), new RegExp(`fixture ${outcome}`));
    assert.ok(
      h.events.some(
        (e) =>
          e.properties.ownership_action ===
          (outcome === "confirmed"
            ? "ownership_confirmed"
            : `purchase_${outcome}`),
      ),
    );
  });
for (const outcome of [
  "owner_restored",
  "legacy_restored",
  "nothing_found",
  "pending",
] as const)
  test(`restore ${outcome} never initiates a purchase`, async () => {
    const h = upgradeHarness();
    h.result({
      ok: outcome.endsWith("restored"),
      pending: outcome === "pending",
      outcome,
      message: `fixture ${outcome}`,
    });
    h.button("Restore Purchases").props.onPress();
    await h.flush();
    assert.equal(h.calls.restore, 1);
    assert.equal(h.calls.purchase, 0);
    assert.match(h.text(), new RegExp(`fixture ${outcome}`));
    assert.ok(
      h.events.some((e) => e.properties.ownership_action === "restore_started"),
    );
  });
test("old-account result never displays on a new account", async () => {
  const h = upgradeHarness();
  let resolve!: (value: any) => void;
  h.hold(
    new Promise((done) => {
      resolve = done;
    }),
  );
  h.button("Unlock Coverly").props.onPress();
  h.entitlements.retryReconciliation = async () => ({ ok: false });
  h.render();
  resolve({
    ok: true,
    outcome: "confirmed",
    message: "PRIVATE OLD ACCOUNT RESULT",
  });
  await h.flush();
  assert.doesNotMatch(h.text(), /PRIVATE OLD ACCOUNT/);
});
test("owned render uses canonical state even if SDK offering disappears", () => {
  const h = upgradeHarness();
  h.entitlements.capabilities = {
    ownsCoverly: true,
    accessClass: "owner",
    effectivePlan: "coverly_owned",
  };
  h.entitlements.ownsCoverly = true;
  h.entitlements.offering = null;
  h.render();
  assert.match(h.text(), /Coverly unlocked/);
  assert.equal(h.button("Unlock Coverly"), undefined);
});
