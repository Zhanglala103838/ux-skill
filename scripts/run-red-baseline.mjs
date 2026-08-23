import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types as utilTypes } from 'node:util';
import { loadVectorCatalog } from './check-vector-catalog.mjs';

const modulePath = fileURLToPath(import.meta.url);

export function recordBaseline(catalog) {
  if (utilTypes.isProxy(catalog) || !Array.isArray(catalog) || Reflect.getPrototypeOf(catalog) !== Array.prototype) throw new TypeError('BASELINE_CATALOG_NOT_ARRAY');
  let vectorIds;
  try {
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(catalog, 'length'), length = lengthDescriptor?.value, keys = Reflect.ownKeys(catalog);
    if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1 || !keys.includes('length')) throw new TypeError();
    vectorIds = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(catalog, String(index));
      if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value') || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) throw new TypeError();
      const row = descriptor.value;
      if (row === null || typeof row !== 'object' || Array.isArray(row) || utilTypes.isProxy(row)) throw new TypeError();
      const vectorDescriptor = Reflect.getOwnPropertyDescriptor(row, 'vector_id');
      if (vectorDescriptor === undefined || !Object.hasOwn(vectorDescriptor, 'value') || Object.hasOwn(vectorDescriptor, 'get') || Object.hasOwn(vectorDescriptor, 'set') || typeof vectorDescriptor.value !== 'string') throw new TypeError();
      vectorIds[index] = vectorDescriptor.value;
    }
  } catch { throw new TypeError('BASELINE_CATALOG_NOT_ARRAY'); }
  const rows = vectorIds.map((vector_id) => ({ vector_id, behavior_version: 'absent', outcome: 'red', reason: 'EVALUATOR_ABSENT' }));
  return { rows, green: rows.filter((row) => row.outcome === 'green').length, red: rows.filter((row) => row.outcome === 'red').length, release: 'no_release' };
}

async function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try { const [invokedPath, physicalModulePath] = await Promise.all([realpath(resolve(process.argv[1])), realpath(modulePath)]); return invokedPath === physicalModulePath; } catch { return false; }
}

if (await isDirectInvocation()) {
  const report = recordBaseline(await loadVectorCatalog());
  for (const row of report.rows) console.log(JSON.stringify(row));
  console.log(`green=${report.green} red=${report.red} release=${report.release}`);
  const honestRed = report.rows.length === 100 && report.green === 0 && report.red === 100 && report.release === 'no_release' && report.rows.every((row) => row.outcome === 'red');
  if (!honestRed) process.exitCode = 1;
}
