import test from 'node:test';
import assert from 'node:assert/strict';
import { loadVectorCatalog } from '../../scripts/check-vector-catalog.mjs';

test('catalog freezes every approved vector exactly once', async () => {
  const rows = await loadVectorCatalog();
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map((row) => row.vector_id)).size, 100);
  assert.ok(rows.some((row) => row.vector_id === 'RW-SNAPSHOT-HEADERS-001'));
  assert.ok(rows.some((row) => row.vector_id === 'ART-ONEFILE-001'));
});