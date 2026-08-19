import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
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
const isWithin = (root, target) => {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
};

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

async function checkedLstat(path, label) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`missing evaluator module: ${label}`, { cause: error });
    throw error;
  }
}

async function assertRealDirectory(path, label) {
  const stats = await checkedLstat(path, label);
  assert.ok(!stats.isSymbolicLink(), `symlink path component is forbidden: ${label}`);
  assert.ok(stats.isDirectory(), `evaluator path component must be a directory: ${label}`);
  return stats;
}

async function assertRealFilePath(root, absolutePath, repoPath) {
  assert.ok(isWithin(root, absolutePath), `local evaluator import escapes repository: ${repoPath}`);
  const parts = relative(root, absolutePath).split(sep).filter(Boolean);
  let current = root;
  let finalStats;
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    const stats = await checkedLstat(current, repoPath);
    assert.ok(!stats.isSymbolicLink(), `symlink path component is forbidden: ${repoPath}`);
    if (index < parts.length - 1) {
      assert.ok(stats.isDirectory(), `evaluator path component must be a directory: ${repoPath}`);
    } else {
      assert.ok(stats.isFile(), `evaluator module must be a regular file: ${repoPath}`);
      finalStats = stats;
    }
  }
  assert.ok(finalStats, `missing evaluator module: ${repoPath}`);
  return finalStats;
}

export async function collectLocalEvaluatorImportClosure({ repositoryRoot, entryPath = 'evaluator/index.mjs' }) {
  const root = resolve(repositoryRoot);
  const evaluatorRoot = resolve(root, 'evaluator');
  await assertRealDirectory(root, '<repository-root>');
  await assertRealDirectory(evaluatorRoot, 'evaluator');
  const realRoot = await realpath(root);
  const realEvaluatorRoot = await realpath(evaluatorRoot);
  assert.ok(isWithin(realRoot, realEvaluatorRoot), 'real evaluator root escapes real repository root');
  const states = new Map();
  const visited = new Set();

  async function readVerifiedModule(absolutePath, repoPath) {
    await assertRealFilePath(root, absolutePath, repoPath);
    const actualPath = await realpath(absolutePath);
    assert.ok(isWithin(realEvaluatorRoot, actualPath) && actualPath !== realEvaluatorRoot, `evaluator module escapes real evaluator root: ${repoPath}`);
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(actualPath, constants.O_RDONLY | noFollow);
    try {
      const openedStats = await handle.stat();
      assert.ok(openedStats.isFile(), `evaluator module must be a regular file: ${repoPath}`);
      const source = await handle.readFile({ encoding: 'utf8' });
      await assertRealFilePath(root, absolutePath, repoPath);
      const finalPath = await realpath(absolutePath);
      const finalStats = await lstat(absolutePath);
      assert.equal(finalPath, actualPath, `evaluator module path changed during verification: ${repoPath}`);
      assert.equal(finalStats.dev, openedStats.dev, `evaluator module device changed during verification: ${repoPath}`);
      assert.equal(finalStats.ino, openedStats.ino, `evaluator module inode changed during verification: ${repoPath}`);
      return source;
    } finally {
      await handle.close();
    }
  }

  async function visit(absolutePath, ancestry = []) {
    const repoPath = relative(root, absolutePath).split(sep).join('/');
    assert.ok(!repoPath.startsWith('../') && repoPath !== '..', `local import escapes repository: ${repoPath}`);
    assert.ok(absolutePath === evaluatorRoot || absolutePath.startsWith(`${evaluatorRoot}${sep}`), `local evaluator import escapes evaluator/: ${repoPath}`);
    assert.match(repoPath, /^evaluator\/[a-z0-9-]+\.mjs$/, `noncanonical evaluator module path: ${repoPath}`);
    if (states.get(repoPath) === 'visiting') throw new Error(`local evaluator import cycle: ${[...ancestry, repoPath].join(' -> ')}`);
    if (states.get(repoPath) === 'visited') return;
    states.set(repoPath, 'visiting');
    visited.add(repoPath);
    const source = await readVerifiedModule(absolutePath, repoPath);
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
