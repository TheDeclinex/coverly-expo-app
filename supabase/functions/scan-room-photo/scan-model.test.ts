import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SCAN_MODEL,
  SCAN_MODES,
  resolveScanModel,
  scanModelForMode,
} from './scan-model.ts';

test('defaults inventory scans to the exact GPT-5.6 Luna model ID', () => {
  assert.equal(DEFAULT_SCAN_MODEL, 'gpt-5.6-luna');
  assert.equal(resolveScanModel(), 'gpt-5.6-luna');
  assert.notEqual(DEFAULT_SCAN_MODEL, 'gpt-5.6');
});

test('all inventory scan modes use the same server scan model config', () => {
  for (const mode of SCAN_MODES) {
    assert.equal(scanModelForMode(mode), 'gpt-5.6-luna');
    assert.equal(scanModelForMode(mode, 'configured-scan-model'), 'configured-scan-model');
  }
});

test('blank scan model config falls back safely', () => {
  assert.equal(resolveScanModel('   '), 'gpt-5.6-luna');
});
