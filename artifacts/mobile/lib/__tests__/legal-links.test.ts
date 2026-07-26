import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  COVERLY_PRIVACY_POLICY_URL,
  COVERLY_TERMS_URL,
  shouldCloseLegalViewerNavigation,
} from "../legal-links.ts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("legal links use the verified live Coverly routes rather than build-time URLs", () => {
  assert.equal(COVERLY_PRIVACY_POLICY_URL, "https://www.coverly.nz/privacy-policy");
  assert.equal(COVERLY_TERMS_URL, "https://www.coverly.nz/terms");

  const account = read("app/(tabs)/account.tsx");
  const upgrade = read("app/upgrade.tsx");
  assert.doesNotMatch(account, /EXPO_PUBLIC_(?:PRIVACY|TERMS)_URL/);
  assert.doesNotMatch(upgrade, /EXPO_PUBLIC_(?:PRIVACY|TERMS)_URL/);
  assert.match(account, /COVERLY_LEGAL_DOCUMENTS\.privacy/);
  assert.match(upgrade, /COVERLY_LEGAL_DOCUMENTS\.terms/);
});

test("website-only Back to Coverly navigation closes the native viewer", () => {
  assert.equal(
    shouldCloseLegalViewerNavigation("https://www.coverly.nz/", COVERLY_TERMS_URL),
    true,
  );
  assert.equal(
    shouldCloseLegalViewerNavigation("https://www.coverly.nz/#top", COVERLY_PRIVACY_POLICY_URL),
    true,
  );
  assert.equal(
    shouldCloseLegalViewerNavigation(COVERLY_TERMS_URL, COVERLY_TERMS_URL),
    false,
  );
  assert.equal(
    shouldCloseLegalViewerNavigation("https://example.com/", COVERLY_TERMS_URL),
    false,
  );
});

test("the legal viewer retains X close and intercepts only the Coverly homepage", () => {
  const viewer = read("components/LegalDocumentModal.tsx");

  assert.match(viewer, /accessibilityLabel=\{`Close \$\{document\?\.title/);
  assert.match(viewer, /onShouldStartLoadWithRequest/);
  assert.match(viewer, /shouldCloseLegalViewerNavigation\(request\.url, document\.url\)/);
  assert.match(viewer, /requestAnimationFrame\(close\)/);
});

test("other account legal and support destinations remain app-owned routes", () => {
  const account = read("app/(tabs)/account.tsx");

  assert.match(account, /router\.push\("\/user-guide"/);
  assert.match(account, /router\.push\("\/feedback"/);
  assert.match(account, /router\.push\("\/account-deletion"/);
});
