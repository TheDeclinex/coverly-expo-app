import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { URL } from "node:url";
import ts from "typescript";
import * as entitlementModel from "../billing-entitlements.ts";

type Billing = typeof import("../billing");
function harness() {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let identity = "";
  const sdk = {
    __esModule: true,
    default: {
      configure: ({ appUserID }: { appUserID: string }) => {
        identity = appUserID;
        events.push(`configure:${identity}`);
      },
      logIn: async (id: string) => {
        identity = id;
        events.push(`login:${id}`);
      },
      logOut: async () => {
        events.push(`logout:${identity}`);
        identity = "";
      },
      purchasePackage: async () => {
        events.push(`purchase:${identity}`);
        await gate;
        events.push(`purchased:${identity}`);
        return { customerInfo: { originalAppUserId: identity } };
      },
      restorePurchases: async () => {
        events.push(`restore:${identity}`);
        return { originalAppUserId: identity, activeSubscriptions: [] };
      },
      getCustomerInfo: async () => ({ originalAppUserId: identity }),
    },
  };
  const module = { exports: {} };
  const source = ts.transpileModule(
    readFileSync(new URL("../billing.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports: module.exports,
    module,
    __DEV__: false,
    console: { info() {} },
    process: { env: { EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: "mock-public-key" } },
    require(id: string) {
      if (id === "expo-constants") return {};
      if (id === "react-native") return { Platform: { OS: "ios" } };
      if (id === "react-native-purchases") return sdk;
      if (id === "@/lib/billing-entitlements") return entitlementModel;
      if (id === "@/lib/runtime-config")
        return {
          resolveAppEnvironment: () => "production",
          revenueCatEnvironmentIssue: () => null,
        };
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  return { billing: module.exports as Billing, events, release };
}
test("real billing adapter serializes purchase with logout/login and rejects wrong identity", async () => {
  const h = harness();
  await h.billing.configureBilling("A");
  const purchase = h.billing.buyPackage(
    { identifier: "mock", product: { identifier: "mock" } } as Parameters<
      Billing["buyPackage"]
    >[0],
    "A",
  );
  const logout = h.billing.clearBillingUser();
  const login = h.billing.configureBilling("B");
  h.release();
  await Promise.all([purchase, logout, login]);
  assert.deepEqual(h.events, [
    "configure:A",
    "purchase:A",
    "purchased:A",
    "logout:A",
    "login:B",
  ]);
  assert.equal((await h.billing.restoreBilling("A")).ok, false);
  assert.equal((await h.billing.loadCustomerInfo("A")).ok, false);
  assert.equal((await h.billing.restoreBilling("B")).ok, true);
  assert.equal(h.events.at(-1), "restore:B");
});
test("durable SDK restore works without configured owned entitlement or active subscriptions", async () => {
  const h = harness();
  await h.billing.configureBilling("A");
  const result = await h.billing.restoreBilling("A");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.activeSubscriptions.length, 0);
});
