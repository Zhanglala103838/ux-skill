import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { ImportType, init, parse } from 'es-module-lexer';

await init;

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

function localSpecifiers(source, sourceName) {
  const [imports] = parse(source, sourceName);
  const specifiers = [];
  for (const entry of imports) {
    if (entry.t === ImportType.ImportMeta) continue;
    assert.ok(
      entry.t === ImportType.Static || entry.t === ImportType.Dynamic,
      `${sourceName} uses unsupported import syntax type ${entry.t}`
    );
    if (entry.t === ImportType.Dynamic) {
      assert.equal(typeof entry.n, 'string', `${sourceName} dynamic import must use one literal module specifier`);
    } else {
      assert.equal(typeof entry.n, 'string', `${sourceName} static import must expose one literal module specifier`);
    }
    specifiers.push(entry.n);
  }
  const local = specifiers.filter((specifier) => specifier.startsWith('.'));
  const unique = new Set();
  for (const specifier of local) {
    assert.ok(!unique.has(specifier), `duplicate local evaluator import: ${specifier}`);
    unique.add(specifier);
  }
  return local;
}

export async function collectLocalEvaluatorImportClosure({ repositoryRoot, entryPath = 'evaluator/index.mjs' }) {
  const root = resolve(repositoryRoot);
  const evaluatorRoot = resolve(root, 'evaluator');
  const states = new Map();
  const visited = new Set();

  async function visit(absolutePath, ancestry = []) {
    const repoPath = relative(root, absolutePath).split(sep).join('/');
    assert.ok(!repoPath.startsWith('../') && repoPath !== '..', `local import escapes repository: ${repoPath}`);
    assert.ok(absolutePath === evaluatorRoot || absolutePath.startsWith(`${evaluatorRoot}${sep}`), `local evaluator import escapes evaluator/: ${repoPath}`);
    assert.match(repoPath, /^evaluator\/[a-z0-9-]+\.mjs$/, `noncanonical evaluator module path: ${repoPath}`);
    if (states.get(repoPath) === 'visiting') throw new Error(`local evaluator import cycle: ${[...ancestry, repoPath].join(' -> ')}`);
    if (states.get(repoPath) === 'visited') return;
    states.set(repoPath, 'visiting');
    visited.add(repoPath);
    const source = await readFile(absolutePath, 'utf8');
    for (const specifier of localSpecifiers(source, repoPath)) {
      const importedPath = resolve(dirname(absolutePath), specifier);
      const importedRepoPath = relative(root, importedPath).split(sep).join('/');
      assert.ok(importedPath === evaluatorRoot || importedPath.startsWith(`${evaluatorRoot}${sep}`), `local evaluator import escapes evaluator/: ${importedRepoPath}`);
      assert.match(specifier, /^\.\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.mjs$/, `local import must name an explicit canonical .mjs path: ${specifier}`);
      await visit(importedPath, [...ancestry, repoPath]);
    }
    states.set(repoPath, 'visited');
  }

  await visit(resolve(root, entryPath));
  return [...visited].sort(utf8Compare);
}

export async function assertEvaluatorManifestMatchesImportClosure({ repositoryRoot, manifestPaths, entryPath = 'evaluator/index.mjs' }) {
  const closure = await collectLocalEvaluatorImportClosure({ repositoryRoot, entryPath });
  assert.deepEqual(closure, EXPECTED_EVALUATOR_MODULE_PATHS, 'evaluator/index.mjs local import closure must be the canonical nine modules');
  assert.deepEqual(manifestPaths, closure, 'evaluator manifest paths must exactly equal the local import closure');
  return closure;
}
