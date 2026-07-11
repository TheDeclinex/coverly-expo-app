import assert from "node:assert/strict";
import test from "node:test";

import {
  beginViewerPinEdit,
  cancelViewerPinEdit,
  commitViewerPinDraft,
  createViewerPinState,
  syncIncomingViewerPin,
  updateViewerPinDraft,
} from "../viewer-pin-state.ts";

test("successful save promotes the draft to the mounted viewer's committed pin", () => {
  const editing = updateViewerPinDraft(beginViewerPinEdit(createViewerPinState({ x: 0.2, y: 0.3 })), { x: 0.8, y: 0.7 });
  const committed = commitViewerPinDraft(editing);
  assert.deepEqual(committed.committedPin, { x: 0.8, y: 0.7 });
  assert.equal(committed.editing, false);
  assert.equal(syncIncomingViewerPin(committed, { x: 0.2, y: 0.3 }), committed);
});

test("Cancel restores the latest committed pin", () => {
  const committed = commitViewerPinDraft(updateViewerPinDraft(beginViewerPinEdit(createViewerPinState({ x: 0.1, y: 0.2 })), { x: 0.6, y: 0.7 }));
  const cancelled = cancelViewerPinEdit(updateViewerPinDraft(beginViewerPinEdit(committed), { x: 0.9, y: 0.9 }));
  assert.deepEqual(cancelled.draftPin, { x: 0.6, y: 0.7 });
  assert.deepEqual(cancelled.committedPin, { x: 0.6, y: 0.7 });
});

test("save failure preserves committed state by leaving the edit state unpromoted", () => {
  const editing = updateViewerPinDraft(beginViewerPinEdit(createViewerPinState({ x: 0.2, y: 0.3 })), { x: 0.9, y: 0.8 });
  assert.deepEqual(editing.committedPin, { x: 0.2, y: 0.3 });
  assert.equal(editing.editing, true);
});

test("incoming props cannot overwrite an active edit but refresh an idle viewer", () => {
  const editing = beginViewerPinEdit(createViewerPinState({ x: 0.2, y: 0.3 }));
  assert.equal(syncIncomingViewerPin(editing, { x: 0.4, y: 0.5 }), editing);
  const refreshed = syncIncomingViewerPin(cancelViewerPinEdit(editing), { x: 0.4, y: 0.5 });
  assert.deepEqual(refreshed.committedPin, { x: 0.4, y: 0.5 });
});
