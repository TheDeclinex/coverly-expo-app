import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url).href), "utf8");
const formSource = source("../../components/ItemMaintenanceForm.tsx");
const detailSource = source("../../app/(tabs)/item/[id].tsx");
const oldRouteSource = source("../../app/(tabs)/edit-item/[id].tsx");
const claimPackSource = source("../../app/(tabs)/claim-pack/[fileId].tsx");

test("Item Detail mounts the single complete maintenance form", () => {
  assert.ok(detailSource.includes("<ItemMaintenanceForm ref={maintenanceFormRef}"));
  for (const label of ["Name", "Description", "Category", "Each price ($)", "Quantity", "Brand / Maker", "Model / Series", "Condition", "Purchased from", "Purchase year", "Original price ($)", "Notes", "ROOM", "PHOTOS"]) {
    assert.ok(formSource.includes(label), `Missing ${label}`);
  }
  assert.ok(formSource.includes("<DraggablePhotoStrip"));
  assert.equal(formSource.includes('styles.save'), false);
});

test("product details are collapsed by default and voice updates the draft", () => {
  assert.ok(formSource.includes("useState(false)"));
  assert.ok(formSource.includes("Brand, model, condition and purchase history"));
  assert.ok(formSource.includes("onApply={applyVoice}"));
});

test("dirty form state protects Room back navigation", () => {
  assert.ok(formSource.includes("onDirtyChange?.(dirty)"));
  assert.ok(detailSource.includes("Discard unsaved changes?"));
  assert.ok(detailSource.includes("onPress={handleItemBack}"));
});

test("sticky save state is driven by the form without an inline save action", () => {
  assert.ok(detailSource.includes("styles.stickySaveBar"));
  assert.ok(detailSource.includes("maintenanceFormRef.current?.save()"));
  for (const state of ["No unsaved changes", "Save Changes", "Saving", "Saved"]) {
    assert.ok(detailSource.includes(state), `Missing save state ${state}`);
  }
  assert.ok(formSource.includes("onSaveStateChange?."));
});

test("field voice actions and product placeholders are restored", () => {
  for (const target of ['openVoice("name")', 'openVoice("description")', 'openVoice("brand_maker")', 'openVoice("model_series")', 'openVoice("purchase_source")', 'openVoice("notes")']) {
    assert.ok(formSource.includes(target), `Missing voice target ${target}`);
  }
  for (const placeholder of ["e.g. Samsung", "e.g. QN90B", "e.g. Excellent", "e.g. Harvey Norman", "e.g. 2022", "e.g. 399", "Optional notes"]) {
    assert.ok(formSource.includes(placeholder), `Missing placeholder ${placeholder}`);
  }
});

test("supporting sections finish with barcode, valuation, then delete", () => {
  const evidenceIndex = detailSource.indexOf("<ItemEvidenceSection");
  const barcodeIndex = detailSource.lastIndexOf('<Section title="PRODUCT INFO"');
  const valuationIndex = detailSource.lastIndexOf('<Section title="VALUATION CONTEXT"');
  const deleteIndex = detailSource.lastIndexOf('<Section title="DELETE ITEM"');
  assert.ok(evidenceIndex < barcodeIndex && barcodeIndex < valuationIndex && valuationIndex < deleteIndex);
});

test("the combined form has one explicit inventory update", () => {
  assert.equal((formSource.match(/\.from\("inventory_items"\)\.update\(updates\)/g) ?? []).length, 1);
  assert.ok(formSource.includes('["items", item.room_id]'));
  assert.ok(formSource.includes('["items", draft.roomId]'));
});

test("old Edit Item entry points redirect or link directly to Item Detail", () => {
  assert.ok(oldRouteSource.includes('router.replace({ pathname: "/(tabs)/item/[id]"'));
  assert.equal(claimPackSource.includes('/(tabs)/edit-item/[id]'), false);
  assert.equal(detailSource.includes('pathname: "/(tabs)/edit-item/[id]"'), false);
});

test("supporting Item Detail functions remain available", () => {
  for (const feature of ["handleReplacementPricing", "ItemEvidenceSection", "BarcodeScanFlow", "handleDeleteItem", "VALUATION CONTEXT", "handleRepositionPin"]) {
    assert.ok(detailSource.includes(feature), `Missing ${feature}`);
  }
});
