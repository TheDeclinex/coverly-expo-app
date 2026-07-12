import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const roomSource = readFileSync(resolve(testDir, "../../app/(tabs)/room/[id].tsx"), "utf8");
const propertySource = readFileSync(resolve(testDir, "../../app/(tabs)/property/[id].tsx"), "utf8");
const colorsSource = readFileSync(resolve(testDir, "../../hooks/useColors.ts"), "utf8");

test("scroll-linked room and property animations stay on the native driver", () => {
  for (const [screen, source] of [["room", roomSource], ["property", propertySource]] as const) {
    const scrollEvent = source.match(/onScroll=\{Animated\.event\([\s\S]*?\)\}/)?.[0] ?? "";
    assert.match(scrollEvent, /useNativeDriver: true/, `${screen} scroll should use the native driver`);
    assert.doesNotMatch(scrollEvent, /listener:/, `${screen} scroll should not call into JS per frame`);
  }
});

test("room scroll position is captured only when dragging or momentum settles", () => {
  assert.match(roomSource, /onScrollEndDrag=\{persistRoomScrollSnapshot\}/);
  assert.match(roomSource, /onMomentumScrollEnd=\{persistRoomScrollSnapshot\}/);
  assert.match(roomSource, /event\?\.nativeEvent\.contentOffset\.y/);
});

test("theme tokens keep stable identity across parent rerenders", () => {
  assert.match(colorsSource, /return useMemo\(/);
  assert.match(colorsSource, /\[palette\]/);
});

test("property room cards do not animate SVG progress through React state", () => {
  assert.match(propertySource, /const MemoizedRoomCard = React\.memo/);
  assert.doesNotMatch(propertySource, /setRenderedRingProgress|ringProgress\.addListener/);
  assert.match(propertySource, /strokeDashoffset=\{ringOffset\}/);
});
