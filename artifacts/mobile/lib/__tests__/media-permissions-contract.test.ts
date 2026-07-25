import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const helper = read("lib/media-permissions.ts");

test("permanent image permission denial offers a recoverable Settings path", () => {
  assert.match(helper, /permission\.canAskAgain === false/);
  assert.match(helper, /Linking\.openSettings\(\)/);
  assert.match(helper, /Open Settings/);
  assert.match(helper, /return false/);
});

test("core non-scan image entry points use the shared permission recovery", () => {
  const entryPoints = [
    "app/(tabs)/add-item.tsx",
    "app/(tabs)/feedback.tsx",
    "app/(tabs)/property/[id].tsx",
    "components/DraggablePhotoStrip.tsx",
    "components/ItemEvidenceSection.tsx",
  ];

  for (const entryPoint of entryPoints) {
    assert.match(
      read(entryPoint),
      /requestImagePermission\(/,
      `${entryPoint} must keep the Settings recovery path`,
    );
  }
});

test("cover photo failures do not render storage or database diagnostics", () => {
  const property = read("app/(tabs)/property/[id].tsx");
  const room = read("app/(tabs)/room/[id].tsx");

  assert.doesNotMatch(property, /Alert\.alert\("Property cover upload failed", diagnostic\)/);
  assert.doesNotMatch(property, /Alert\.alert\("Save failed", updateError\.message\)/);
  assert.doesNotMatch(room, /Alert\.alert\("Room cover upload failed", diagnostic\)/);
  assert.doesNotMatch(room, /Alert\.alert\("Save failed", updateError\.message\)/);
});
