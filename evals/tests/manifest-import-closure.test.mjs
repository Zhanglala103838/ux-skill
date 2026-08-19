import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import {
  EXPECTED_EVALUATOR_MODULE_PATHS,
  parseEvaluatorImportClosureContract
} from '../helpers/import-closure.mjs';

const PLAN_PATH = 'docs/superpowers/plans/2026-08-18-evidence-aware-product-ux-skill-v0.1-vertical-slice.md';
const DESIGN_PATH = 'docs/superpowers/specs/2026-08-18-evidence-aware-product-ux-skill-design.md';
const utf8Compare = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

test('MANIFEST_IMPORT_CLOSURE_RED freezes exact nine evaluator paths for Task10 and Task13', async () => {
  const currentEvaluatorModules = (await readdir('evaluator'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `evaluator/${name}`)
    .sort(utf8Compare);
  assert.deepEqual(
    currentEvaluatorModules,
    EXPECTED_EVALUATOR_MODULE_PATHS.filter((path) => path !== 'evaluator/index.mjs'),
    'the pre-Task10 evaluator surface must remain the exact current eight modules'
  );

  const [plan, design] = await Promise.all([
    readFile(PLAN_PATH, 'utf8'),
    readFile(DESIGN_PATH, 'utf8')
  ]);
  const planContract = parseEvaluatorImportClosureContract(plan, PLAN_PATH);
  const designContract = parseEvaluatorImportClosureContract(design, DESIGN_PATH);
  assert.deepEqual(planContract, designContract, 'plan and design evaluator import-closure contracts must be byte-equivalent as data');
  for (const [sourceName, markdown] of [[PLAN_PATH, plan], [DESIGN_PATH, design]]) {
    assert.doesNotMatch(markdown, /\b(?:all\s+)?eight evaluator modules\b/i, `${sourceName} must not hard-code the stale eight-module count`);
  }
});
