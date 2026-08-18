import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVectorCatalog } from './check-vector-catalog.mjs';

export function recordBaseline(catalog) {
  if (!Array.isArray(catalog)) throw new TypeError('BASELINE_CATALOG_NOT_ARRAY');
  const rows = catalog.map(({ vector_id }) => ({
    vector_id,
    behavior_version: 'absent',
    outcome: 'red',
    reason: 'EVALUATOR_ABSENT',
  }));
  return {
    rows,
    green: rows.filter((row) => row.outcome === 'green').length,
    red: rows.filter((row) => row.outcome === 'red').length,
    release: 'no_release',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = recordBaseline(await loadVectorCatalog());
  for (const row of report.rows) console.log(JSON.stringify(row));
  console.log(`green=${report.green} red=${report.red} release=${report.release}`);
  const honestRed = report.rows.length === 100
    && report.green === 0
    && report.red === 100
    && report.release === 'no_release'
    && report.rows.every((row) => row.outcome === 'red');
  if (!honestRed) process.exitCode = 1;
}
