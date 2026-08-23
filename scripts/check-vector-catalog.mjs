import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), '..');
const catalogPath = resolve(repositoryRoot, 'evals/vector-catalog.json');
const designSpecPath = resolve(repositoryRoot, 'docs/superpowers/specs/2026-08-18-evidence-aware-product-ux-skill-design.md');

function reject(code, detail = '') {
  throw new Error(detail === '' ? code : `${code}:${detail}`);
}

function designRows(markdown) {
  const startMarker = '### 18.1 Vector contract';
  const endMarker = '### 18.2 Holdout';
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) reject('VECTOR_CATALOG_SPEC_SECTION_MISSING');

  const rows = markdown.slice(start + startMarker.length, end)
    .split(/\r?\n/u)
    .map((line) => line.match(/^\| ([A-Z0-9-]+) \| (.*) \|$/u))
    .filter(Boolean)
    .map((match) => ({ vector_id: match[1], expected_contract: match[2] }));

  if (rows.length === 0) reject('VECTOR_CATALOG_SPEC_EMPTY');
  return rows;
}

export async function loadVectorCatalog() {
  const [catalogSource, designSource] = await Promise.all([
    readFile(catalogPath, 'utf8'),
    readFile(designSpecPath, 'utf8'),
  ]);

  let catalog;
  try {
    catalog = JSON.parse(catalogSource);
  } catch {
    reject('VECTOR_CATALOG_JSON_INVALID');
  }
  if (!Array.isArray(catalog)) reject('VECTOR_CATALOG_NOT_ARRAY');

  const seen = new Set();
  for (const [index, row] of catalog.entries()) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      reject('VECTOR_CATALOG_ROW_INVALID', String(index));
    }
    if (typeof row.vector_id !== 'string' || row.vector_id.trim() === '') {
      reject('VECTOR_CATALOG_ID_MISSING', String(index));
    }
    if (seen.has(row.vector_id)) reject('VECTOR_CATALOG_DUPLICATE_ID', row.vector_id);
    seen.add(row.vector_id);
    if (typeof row.expected_contract !== 'string' || row.expected_contract.trim() === '') {
      reject('VECTOR_CATALOG_EXPECTED_CONTRACT_MISSING', row.vector_id);
    }
  }

  const approved = designRows(designSource);
  if (catalog.length !== approved.length) {
    reject('VECTOR_CATALOG_ID_MISMATCH', `expected_count=${approved.length},actual_count=${catalog.length}`);
  }
  for (let index = 0; index < approved.length; index += 1) {
    const actual = catalog[index];
    const expected = approved[index];
    if (actual.vector_id !== expected.vector_id) {
      reject('VECTOR_CATALOG_ID_MISMATCH', `index=${index},expected=${expected.vector_id},actual=${actual.vector_id}`);
    }
    if (actual.expected_contract !== expected.expected_contract) {
      reject('VECTOR_CATALOG_CONTRACT_MISMATCH', expected.vector_id);
    }
  }

  return catalog;
}

async function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try { const [invokedPath, physicalModulePath] = await Promise.all([realpath(resolve(process.argv[1])), realpath(modulePath)]); return invokedPath === physicalModulePath; } catch { return false; }
}

if (await isDirectInvocation()) {
  const rows = await loadVectorCatalog();
  console.log(`vector_catalog=ok count=${rows.length}`);
}
