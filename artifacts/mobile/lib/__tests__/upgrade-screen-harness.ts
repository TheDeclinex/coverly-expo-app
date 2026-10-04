import { readFileSync } from "node:fs";
import { URL } from "node:url";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
import * as model from "../upgrade-model.ts";
import * as analytics from "../analytics-core.ts";
import * as legal from "../legal-links.ts";
import colors from "../../constants/colors.ts";
import type { RecoveryResult } from "../entitlement-controller.ts";

export const fixturePackage = {
  identifier: "fixture-package",
  packageType: "LIFETIME",
  product: {
    identifier: "fixture.owned",
    price: 42.35,
    priceString: "42,35 €",
    subscriptionPeriod: null,
  },
};
// Exercise actual screen JSX and handlers with all native, store and network
// dependencies mocked. This is not a native-device layout renderer.
export function upgradeHarness(kind = "free", productAvailable = true) {
  const events: { name: string; properties: Record<string, unknown> }[] = [];
  const calls = { purchase: 0, restore: 0, confirm: 0, refresh: 0 };
  let result: RecoveryResult = {
    ok: true,
    outcome: "confirmed",
    message: "Confirmed fixture",
  };
  let hold: Promise<RecoveryResult> | null = null;
  const capabilities = {
    ownsCoverly: kind === "owner",
    accessClass: kind,
    effectivePlan:
      kind === "free"
        ? "free"
        : kind === "owner"
          ? "coverly_owned"
          : "coverly_plus",
  };
  const entitlements: any = {
    capabilities,
    ownsCoverly: capabilities.ownsCoverly,
    offering: productAvailable ? { availablePackages: [fixturePackage] } : null,
    ownershipVerificationState: "verified",
    pendingOperation: null,
    purchaseLoading: false,
    isRefreshing: false,
    purchasePackage: async () => {
      calls.purchase++;
      return hold ?? result;
    },
    restorePurchases: async () => {
      calls.restore++;
      return result;
    },
    retryReconciliation: async () => {
      calls.confirm++;
      return result;
    },
    refreshEntitlements: async () => {
      calls.refresh++;
    },
    refreshOffering: async () => {
      calls.refresh++;
    },
  };
  const hooks: any[] = [];
  let cursor = 0;
  const effects: (() => void)[] = [];
  const mockReact = {
    ...React,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => void) => {
      effects.push(fn);
    },
    useState: (initial: unknown) => {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = initial;
      return [
        hooks[slot],
        (value: unknown) => {
          hooks[slot] = value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = { current: initial };
      return hooks[slot];
    },
  };
  const module = { exports: {} as { default?: () => React.ReactNode } };
  const code = ts.transpileModule(
    readFileSync(new URL("../../app/upgrade.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id: string) {
      if (id === "react")
        return { __esModule: true, ...mockReact, default: mockReact };
      if (id === "react-native")
        return {
          ActivityIndicator: "Spinner",
          Platform: { OS: "ios" },
          Pressable: "Button",
          ScrollView: "Scroll",
          Text: "Text",
          View: "View",
          StyleSheet: { create: (x: unknown) => x },
        };
      if (id === "@expo/vector-icons") return { Feather: "Icon" };
      if (id === "expo-router")
        return {
          Stack: { Screen: "Screen" },
          router: { canGoBack: () => true, back() {}, replace() {} },
          useLocalSearchParams: () => ({}),
        };
      if (id === "expo-web-browser")
        return {
          openBrowserAsync: async () => {
            throw new Error("Network forbidden");
          },
        };
      if (id === "react-native-safe-area-context")
        return { useSafeAreaInsets: () => ({ bottom: 20 }) };
      if (id === "@/components/LegalDocumentModal")
        return { LegalDocumentModal: "Legal" };
      if (id === "@/context/EntitlementsContext")
        return { useEntitlements: () => entitlements };
      if (id === "@/hooks/useColors") return { useColors: () => colors.light };
      if (id === "@/lib/billing")
        return {
          ownershipPackageMapping: {
            productId: fixturePackage.product.identifier,
            packageId: fixturePackage.identifier,
          },
        };
      if (id === "@/lib/analytics")
        return {
          trackEvent: async (
            name: string,
            properties: Record<string, unknown>,
          ) => {
            events.push({ name, properties });
          },
        };
      if (id === "@/lib/analytics-core") return analytics;
      if (id === "@/lib/legal-links") return legal;
      if (id === "@/lib/upgrade-model") return model;
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  let tree: React.ReactNode;
  const walk = (node: any): any[] =>
    Array.isArray(node)
      ? node.flatMap((n) => walk(n))
      : node && typeof node === "object" && node.props
        ? [node, ...walk(node.props.children)]
        : [];
  const words = (node: any): string =>
    Array.isArray(node)
      ? node.map((n) => words(n)).join(" ")
      : typeof node === "string" || typeof node === "number"
        ? String(node)
        : node?.props
          ? words(node.props.children)
          : "";
  const nodes = () => walk(tree);
  const text = () => words(tree);
  const render = () => {
    cursor = 0;
    tree = module.exports.default!();
    effects.splice(0).forEach((fn) => fn());
    return tree;
  };
  render();
  return {
    entitlements,
    calls,
    events,
    render,
    nodes,
    text,
    button: (label: string) =>
      nodes().find(
        (node) =>
          node.type === "Button" && node.props.accessibilityLabel === label,
      ),
    result: (next: RecoveryResult) => {
      result = next;
    },
    hold: (next: Promise<RecoveryResult>) => {
      hold = next;
    },
    flush: async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      render();
    },
  };
}
