import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

export const EXPECTED_EVALUATOR_MODULE_PATHS = Object.freeze([
  'evaluator/authority.mjs',
  'evaluator/canonical.mjs',
  'evaluator/claims.mjs',
  'evaluator/dependency-decision.mjs',
  'evaluator/digests.mjs',
  'evaluator/index.mjs',
  'evaluator/projection.mjs',
  'evaluator/rules-runtime.mjs',
  'evaluator/validation.mjs'
]);

const CONTRACT_PATTERN = /<!-- evaluator-import-closure:v1\s*\n([\s\S]*?)\n-->/g;
const CONTRACT_KEYS = Object.freeze([
  'task10_evaluator_manifest_paths',
  'task13_artifact_manifest_evaluator_paths'
]);
const utf8Compare = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

export function parseEvaluatorImportClosureContract(markdown, sourceName = '<markdown>') {
  const matches = [...markdown.matchAll(CONTRACT_PATTERN)];
  assert.equal(matches.length, 1, `${sourceName} must contain exactly one evaluator-import-closure:v1 contract`);
  const contract = JSON.parse(matches[0][1]);
  assert.deepEqual(Object.keys(contract), CONTRACT_KEYS, `${sourceName} evaluator import-closure contract keys drifted`);
  for (const key of CONTRACT_KEYS) {
    assert.deepEqual(contract[key], EXPECTED_EVALUATOR_MODULE_PATHS, `${sourceName} ${key} must list the canonical nine evaluator paths`);
  }
  return contract;
}

function localSpecifiers(source) {
  const specifiers = [];
  const staticPattern = /(?:^|\n)\s*(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+(?:[^'";]+?\s+from\s+|\*\s+from\s+))['"]([^'"]+)['"]/g;
  const dynamicPattern = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const match of source.matchAll(staticPattern)) specifiers.push(match[1]);
  for (const match of source.matchAll(dynamicPattern)) specifiers.push(match[2]);
  return specifiers.filter((specifier) => specifier.startsWith('.'));
}

export async function collectLocalEvaluatorImportClosure({ repositoryRoot, entryPath = 'evaluator/index.mjs' }) {
  const root = resolve(repositoryRoot);
  const evaluatorRoot = resolve(root, 'evaluator');
  const pending = [resolve(root, entryPath)];
  const visited = new Set();
  while (pending.length > 0) {
    const absolutePath = pending.pop();
    const repoPath = relative(root, absolutePath).split(sep).join('/');
    assert.ok(!repoPath.startsWith('../') && repoPath !== '..', `local import escapes repository: ${repoPath}`);
    assert.ok(absolutePath === evaluatorRoot || absolutePath.startsWith(`${evaluatorRoot}${sep}`), `local evaluator import escapes evaluator/: ${repoPath}`);
    assert.match(repoPath, /^evaluator\/[a-z0-9-]+\.mjs$/, `noncanonical evaluator module path: ${repoPath}`);
    if (visited.has(repoPath)) continue;
    visited.add(repoPath);
    const source = await readFile(absolutePath, 'utf8');
    for (const specifier of localSpecifiers(source)) {
      assert.match(specifier, /^\.\.?\/[a-z0-9./-]+\.mjs$/, `local import must name an explicit canonical .mjs path: ${specifier}`);
      pending.push(resolve(dirname(absolutePath), specifier));
    }
  }
  return [...visited].sort(utf8Compare);
}

export async function assertEvaluatorManifestMatchesImportClosure({ repositoryRoot, manifestPaths, entryPath = 'evaluator/index.mjs' }) {
  const closure = await collectLocalEvaluatorImportClosure({ repositoryRoot, entryPath });
  assert.deepEqual(closure, EXPECTED_EVALUATOR_MODULE_PATHS, 'evaluator/index.mjs local import closure must be the canonical nine modules');
  assert.deepEqual(manifestPaths, closure, 'evaluator manifest paths must exactly equal the local import closure');
  return closure;
}
