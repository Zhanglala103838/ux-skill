import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { O_NOFOLLOW, O_RDONLY } from 'node:constants';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCanonicalRelativePath,
  assertIJson,
  assertNfc,
  jcsBytes,
} from '../evaluator/canonical.mjs';
import { digestJcs } from '../evaluator/digests.mjs';
import { KNOWLEDGE_JSON_LIMITS, parseKnowledgeJson } from './strict-json.mjs';
export { KNOWLEDGE_JSON_LIMITS, parseKnowledgeJson } from './strict-json.mjs';

const modulePath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(modulePath), '..');
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const GLOB_PATTERN = /[*?\[\]{}]/u;


const KNOWLEDGE_JSON_READ_OPTIONS = Object.freeze({
  maxBytes: KNOWLEDGE_JSON_LIMITS.MAX_BYTES,
  resourceCode: 'KNOWLEDGE_JSON_RESOURCE_LIMIT',
});
const KNOWLEDGE_REFERENCE_READ_OPTIONS = Object.freeze({
  maxBytes: 1_048_576,
  resourceCode: 'KNOWLEDGE_REFERENCE_RESOURCE_LIMIT',
});

const REFERENCE_PATHS = [
  'references/claim-study.md',
  'references/context-model.md',
  'references/ethics.md',
  'references/implementation-mapping.md',
  'references/inquiry-design.md',
  'references/journey-authority.md',
  'references/risk-reporting.md',
  'references/rules-runtime.md',
];

const FILE_PATHS = [
  'knowledge/assertions.json',
  'knowledge/decision-policies.json',
  'knowledge/policy-manifest.json',
  'knowledge/registries.json',
  'knowledge/rules.json',
  'knowledge/sources.json',
  ...REFERENCE_PATHS,
];

const DEPENDENCY_GRAPH = [
  { path: 'references/claim-study.md', requires: ['references/context-model.md'] },
  { path: 'references/context-model.md', requires: [] },
  { path: 'references/ethics.md', requires: ['references/context-model.md'] },
  {
    path: 'references/implementation-mapping.md',
    requires: [
      'references/context-model.md',
      'references/journey-authority.md',
      'references/rules-runtime.md',
      'references/claim-study.md',
      'references/inquiry-design.md',
      'references/risk-reporting.md',
      'references/ethics.md',
    ],
  },
  {
    path: 'references/inquiry-design.md',
    requires: ['references/context-model.md', 'references/claim-study.md'],
  },
  { path: 'references/journey-authority.md', requires: ['references/context-model.md'] },
  {
    path: 'references/risk-reporting.md',
    requires: [
      'references/context-model.md',
      'references/journey-authority.md',
      'references/rules-runtime.md',
      'references/claim-study.md',
    ],
  },
  {
    path: 'references/rules-runtime.md',
    requires: ['references/context-model.md', 'references/journey-authority.md'],
  },
];

const ROUTES = {
  guide: [
    'references/context-model.md',
    'references/journey-authority.md',
    'references/claim-study.md',
    'references/inquiry-design.md',
    'references/ethics.md',
  ],
  scan: [
    'references/context-model.md',
    'references/journey-authority.md',
    'references/rules-runtime.md',
    'references/claim-study.md',
    'references/risk-reporting.md',
    'references/ethics.md',
  ],
  refactor: [
    'references/context-model.md',
    'references/journey-authority.md',
    'references/rules-runtime.md',
    'references/claim-study.md',
    'references/inquiry-design.md',
    'references/risk-reporting.md',
    'references/ethics.md',
    'references/implementation-mapping.md',
  ],
  verify: [
    'references/context-model.md',
    'references/journey-authority.md',
    'references/rules-runtime.md',
    'references/claim-study.md',
    'references/risk-reporting.md',
    'references/ethics.md',
  ],
};

function fail(code, detail = '') {
  const error = new Error(detail === '' ? code : `${code}:${detail}`);
  error.code = code;
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, keys, code) {
  if (!isRecord(value)) fail(code.replace('ADDITIONAL_PROPERTY', 'TYPE_INVALID'));
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    fail(code);
  }
}

function sameData(left, right) {
  return Buffer.from(jcsBytes(left)).equals(Buffer.from(jcsBytes(right)));
}

function pathCompare(left, right) {
  return Buffer.compare(Buffer.from(jcsBytes(left)), Buffer.from(jcsBytes(right)));
}

function assertPath(path) {
  assertCanonicalRelativePath(path);
  if (GLOB_PATTERN.test(path)) fail('KNOWLEDGE_GLOB_FORBIDDEN', path);
}

function assertCanonicalPathOrder(paths, code) {
  const sorted = [...paths].sort(pathCompare);
  if (!sameData(paths, sorted)) fail(code);
}

function assertUniquePaths(paths, code) {
  const seen = new Set();
  for (const path of paths) {
    if (seen.has(path)) fail(code, path);
    seen.add(path);
  }
}


async function resolveRepositoryRoot(options) {
  if (options === undefined) options = {};
  if (!isRecord(options) || Object.keys(options).some((key) => key !== 'repositoryRoot')) {
    fail('KNOWLEDGE_OPTIONS_INVALID');
  }
  const supplied = Object.hasOwn(options, 'repositoryRoot')
    ? options.repositoryRoot
    : defaultRepositoryRoot;
  if (typeof supplied !== 'string' || supplied.length === 0 || !isAbsolute(supplied)) {
    fail('KNOWLEDGE_REPOSITORY_ROOT_INVALID');
  }

  const repositoryRoot = resolve(supplied);
  let status;
  try {
    status = await lstat(repositoryRoot);
  } catch {
    fail('KNOWLEDGE_REPOSITORY_ROOT_INVALID');
  }
  if (status.isSymbolicLink()) {
    fail('KNOWLEDGE_SYMLINK_PATH_COMPONENT', 'repository root:symlink path component');
  }
  if (!status.isDirectory()) fail('KNOWLEDGE_REPOSITORY_ROOT_INVALID');

  const actualRoot = await realpath(repositoryRoot);
  if (actualRoot !== repositoryRoot) {
    fail('KNOWLEDGE_SYMLINK_PATH_COMPONENT', 'repository root:symlink path component');
  }
  return repositoryRoot;
}

export function assertKnowledgeFileSnapshot(before, after, bytesRead, path) {
  const sizeMatches = before.size === after.size;
  const identityMatches = before.dev === after.dev && before.ino === after.ino;
  let completeRead = false;
  try {
    completeRead = BigInt(bytesRead) === BigInt(before.size);
  } catch {
    completeRead = false;
  }
  if (!sizeMatches || !identityMatches || !completeRead) {
    fail('KNOWLEDGE_FILE_CHANGED_DURING_READ', path);
  }
}

async function readSecureRegularFile(repositoryRoot, path, options) {
  assertPath(path);
  if (
    !isRecord(options)
    || !Number.isSafeInteger(options.maxBytes)
    || options.maxBytes < 0
    || typeof options.resourceCode !== 'string'
    || options.resourceCode.length === 0
  ) {
    fail('KNOWLEDGE_READ_OPTIONS_INVALID', path);
  }

  const segments = path.split('/');
  let current = repositoryRoot;

  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let status;
    try {
      status = await lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') fail('KNOWLEDGE_FILE_MISSING', path);
      throw error;
    }
    if (status.isSymbolicLink()) {
      fail('KNOWLEDGE_SYMLINK_PATH_COMPONENT', path + ':symlink path component');
    }
    if (index < segments.length - 1 && !status.isDirectory()) {
      fail('KNOWLEDGE_PATH_COMPONENT_INVALID', path + ':directory required');
    }
    if (index === segments.length - 1 && !status.isFile()) {
      fail('KNOWLEDGE_FILE_NOT_REGULAR', path + ':regular file required');
    }
  }

  const rootPrefix = repositoryRoot.endsWith(sep) ? repositoryRoot : repositoryRoot + sep;
  const absolutePath = resolve(repositoryRoot, path);
  if (!absolutePath.startsWith(rootPrefix)) {
    fail('KNOWLEDGE_REALPATH_IDENTITY_INVALID', path + ':symlink path component or escape');
  }

  let handle;
  try {
    handle = await open(absolutePath, O_RDONLY | O_NOFOLLOW);
  } catch (error) {
    if (error?.code === 'ELOOP') {
      fail('KNOWLEDGE_SYMLINK_PATH_COMPONENT', path + ':symlink path component');
    }
    if (error?.code === 'ENOENT') fail('KNOWLEDGE_FILE_MISSING', path);
    throw error;
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      fail('KNOWLEDGE_FILE_NOT_REGULAR', path + ':regular file required');
    }
    if (before.size > BigInt(options.maxBytes)) {
      fail(options.resourceCode, path);
    }

    const capacity = Math.min(options.maxBytes + 1, Number(before.size) + 1);
    const allocation = Buffer.allocUnsafe(capacity);
    let bytesRead = 0;
    while (bytesRead < capacity) {
      const result = await handle.read(
        allocation,
        bytesRead,
        capacity - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }

    let after;
    let pathStatus;
    let actualPath;
    try {
      after = await handle.stat({ bigint: true });
      actualPath = await realpath(absolutePath);
      pathStatus = await lstat(absolutePath, { bigint: true });
    } catch {
      fail('KNOWLEDGE_FILE_CHANGED_DURING_READ', path);
    }
    if (actualPath !== absolutePath) {
      fail('KNOWLEDGE_FILE_CHANGED_DURING_READ', path);
    }
    assertKnowledgeFileSnapshot(before, after, bytesRead, path);
    assertKnowledgeFileSnapshot(after, pathStatus, bytesRead, path);
    if (bytesRead > options.maxBytes) fail(options.resourceCode, path);
    return allocation.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function validateFileRows(files) {
  if (!Array.isArray(files)) fail('KNOWLEDGE_MANIFEST_TYPE_INVALID');
  const paths = [];
  for (const row of files) {
    assertExactKeys(row, ['path', 'file_digest'], 'KNOWLEDGE_FILE_ROW_ADDITIONAL_PROPERTY');
    assertPath(row.path);
    if (row.path === 'knowledge/manifest.json') fail('KNOWLEDGE_MANIFEST_SELF_REFERENCE');
    if (typeof row.file_digest !== 'string' || !DIGEST_PATTERN.test(row.file_digest)) {
      fail('KNOWLEDGE_FILE_DIGEST_INVALID', row.path);
    }
    paths.push(row.path);
  }

  assertUniquePaths(paths, 'KNOWLEDGE_DUPLICATE_PATH');
  assertCanonicalPathOrder(paths, 'KNOWLEDGE_FILES_NOT_CANONICAL');
  if (!sameData(paths, FILE_PATHS)) fail('KNOWLEDGE_FILE_SET_MISMATCH');
}

function validateDependencyGraph(graph) {
  if (!Array.isArray(graph)) fail('KNOWLEDGE_MANIFEST_TYPE_INVALID');
  const rows = new Map();
  const paths = [];

  for (const row of graph) {
    assertExactKeys(row, ['path', 'requires'], 'KNOWLEDGE_DEPENDENCY_ADDITIONAL_PROPERTY');
    assertPath(row.path);
    if (!REFERENCE_PATHS.includes(row.path) || !Array.isArray(row.requires)) {
      fail('KNOWLEDGE_DEPENDENCY_INVALID', row.path);
    }
    for (const requiredPath of row.requires) {
      assertPath(requiredPath);
      if (!REFERENCE_PATHS.includes(requiredPath)) {
        fail('KNOWLEDGE_DEPENDENCY_INVALID', requiredPath);
      }
    }
    assertUniquePaths(row.requires, 'KNOWLEDGE_DEPENDENCY_DUPLICATE');
    if (rows.has(row.path)) fail('KNOWLEDGE_DEPENDENCY_DUPLICATE', row.path);
    rows.set(row.path, row.requires);
    paths.push(row.path);
  }

  assertCanonicalPathOrder(paths, 'KNOWLEDGE_DEPENDENCIES_NOT_CANONICAL');
  if (!sameData(paths, REFERENCE_PATHS)) fail('KNOWLEDGE_DEPENDENCY_SET_MISMATCH');
  for (const [path, requires] of rows) {
    for (const requiredPath of requires) {
      if (!rows.has(requiredPath)) fail('KNOWLEDGE_DEPENDENCY_MISSING', `${path}:${requiredPath}`);
    }
  }

  const active = new Set();
  const complete = new Set();
  const visit = (path) => {
    if (active.has(path)) fail('KNOWLEDGE_DEPENDENCY_CYCLE', path);
    if (complete.has(path)) return;
    active.add(path);
    for (const requiredPath of rows.get(path)) visit(requiredPath);
    active.delete(path);
    complete.add(path);
  };
  for (const path of paths) visit(path);

  if (!sameData(graph, DEPENDENCY_GRAPH)) fail('KNOWLEDGE_DEPENDENCY_CONTRACT_MISMATCH');
  return rows;
}

function validateRoutes(routes, dependencyMap) {
  assertExactKeys(routes, ['guide', 'scan', 'refactor', 'verify'], 'KNOWLEDGE_ROUTES_ADDITIONAL_PROPERTY');

  for (const mode of ['guide', 'scan', 'refactor', 'verify']) {
    const route = routes[mode];
    assertExactKeys(route, ['paths'], 'KNOWLEDGE_ROUTE_ADDITIONAL_PROPERTY');
    if (!Array.isArray(route.paths)) fail('KNOWLEDGE_ROUTE_TYPE_INVALID', mode);
    for (const path of route.paths) {
      assertPath(path);
      if (!dependencyMap.has(path)) fail('KNOWLEDGE_ROUTE_PATH_INVALID', `${mode}:${path}`);
    }
    assertUniquePaths(route.paths, `KNOWLEDGE_ROUTE_DUPLICATE_PATH:${mode}`);

    const position = new Map(route.paths.map((path, index) => [path, index]));
    for (const [index, path] of route.paths.entries()) {
      for (const requiredPath of dependencyMap.get(path)) {
        if (!position.has(requiredPath)) {
          fail(`KNOWLEDGE_ROUTE_DEPENDENCY_MISSING:${mode}`, `${path}:${requiredPath}`);
        }
        if (position.get(requiredPath) >= index) {
          fail(`KNOWLEDGE_ROUTE_ORDER_INVALID:${mode}`, `${path}:${requiredPath}`);
        }
      }
    }
    if (!sameData(route.paths, ROUTES[mode])) {
      fail(`KNOWLEDGE_ROUTE_CONTRACT_MISMATCH:${mode}`);
    }
  }
}

function validateKnowledgeManifestStructure(manifest) {
  assertIJson(manifest);
  assertNfc(manifest);
  if (!isRecord(manifest)) fail('KNOWLEDGE_MANIFEST_TYPE_INVALID');
  assertExactKeys(
    manifest,
    ['manifest_version', 'files', 'dependency_graph', 'routes'],
    'KNOWLEDGE_MANIFEST_ADDITIONAL_PROPERTY',
  );
  if (manifest.manifest_version !== 'knowledge-manifest-v1') {
    fail('KNOWLEDGE_MANIFEST_VERSION_INVALID');
  }
  validateFileRows(manifest.files);
  const dependencyMap = validateDependencyGraph(manifest.dependency_graph);
  validateRoutes(manifest.routes, dependencyMap);
  return manifest;
}

function validatePolicyManifestStructure(manifest) {
  assertIJson(manifest);
  assertNfc(manifest);
  if (!isRecord(manifest)) fail('POLICY_MANIFEST_TYPE_INVALID');
  assertExactKeys(manifest, ['policy_files'], 'POLICY_MANIFEST_ADDITIONAL_PROPERTY');
  if (!Array.isArray(manifest.policy_files) || manifest.policy_files.length !== 1) {
    fail('POLICY_MANIFEST_FILE_SET_INVALID');
  }
  const row = manifest.policy_files[0];
  assertExactKeys(row, ['path', 'file_digest'], 'POLICY_FILE_ROW_ADDITIONAL_PROPERTY');
  assertPath(row.path);
  if (row.path !== 'knowledge/decision-policies.json') fail('POLICY_MANIFEST_FILE_SET_INVALID');
  if (typeof row.file_digest !== 'string' || !DIGEST_PATTERN.test(row.file_digest)) {
    fail('POLICY_FILE_DIGEST_INVALID');
  }
  return manifest;
}

async function validateReferenceDirectory(repositoryRoot) {
  const referencesPath = join(repositoryRoot, 'references');
  let status;
  try {
    status = await lstat(referencesPath);
  } catch {
    fail('KNOWLEDGE_REFERENCE_SET_MISMATCH');
  }
  if (status.isSymbolicLink()) {
    fail('KNOWLEDGE_SYMLINK_PATH_COMPONENT', 'references:symlink path component');
  }
  if (!status.isDirectory()) fail('KNOWLEDGE_REFERENCE_SET_MISMATCH');

  const actualPath = await realpath(referencesPath);
  if (actualPath !== referencesPath) {
    fail('KNOWLEDGE_REALPATH_IDENTITY_INVALID', 'references:symlink path component');
  }
  const entries = (await readdir(referencesPath)).map((name) => `references/${name}`).sort(pathCompare);
  if (!sameData(entries, REFERENCE_PATHS)) fail('KNOWLEDGE_REFERENCE_SET_MISMATCH');
}

async function loadManifestJson(repositoryRoot, path, parseCode) {
  const bytes = await readSecureRegularFile(repositoryRoot, path, KNOWLEDGE_JSON_READ_OPTIONS);
  return parseKnowledgeJson(bytes, path, parseCode);
}

export function knowledgeManifestDigest(manifest) {
  validateKnowledgeManifestStructure(manifest);
  return digestJcs('ux-skill:knowledge:v1', manifest.files);
}

export function policyManifestDigest(manifest) {
  validatePolicyManifestStructure(manifest);
  return digestJcs('ux-skill:manifest:v1', manifest);
}

export async function loadPolicyManifest(options) {
  const repositoryRoot = await resolveRepositoryRoot(options);
  const manifest = validatePolicyManifestStructure(
    await loadManifestJson(repositoryRoot, 'knowledge/policy-manifest.json', 'POLICY_MANIFEST_JSON_INVALID'),
  );
  const row = manifest.policy_files[0];
  const policyBytes = await readSecureRegularFile(
    repositoryRoot,
    row.path,
    KNOWLEDGE_JSON_READ_OPTIONS,
  );
  const actualDigest = createHash('sha256').update(policyBytes).digest('hex');
  if (actualDigest !== row.file_digest) fail('POLICY_FILE_DIGEST_MISMATCH', row.path);
  const policyValue = parseKnowledgeJson(policyBytes, row.path, 'KNOWLEDGE_JSON_INVALID');
  assertIJson(policyValue);
  assertNfc(policyValue);
  return manifest;
}

export async function loadKnowledgeManifest(options) {
  const repositoryRoot = await resolveRepositoryRoot(options);
  const manifest = validateKnowledgeManifestStructure(
    await loadManifestJson(repositoryRoot, 'knowledge/manifest.json', 'KNOWLEDGE_MANIFEST_JSON_INVALID'),
  );

  await validateReferenceDirectory(repositoryRoot);
  for (const row of manifest.files) {
    const isJson = row.path.endsWith('.json');
    const bytes = await readSecureRegularFile(
      repositoryRoot,
      row.path,
      isJson ? KNOWLEDGE_JSON_READ_OPTIONS : KNOWLEDGE_REFERENCE_READ_OPTIONS,
    );
    const actualDigest = createHash('sha256').update(bytes).digest('hex');
    if (actualDigest !== row.file_digest) fail('KNOWLEDGE_DIGEST_MISMATCH', row.path);
    if (isJson) {
      const value = parseKnowledgeJson(bytes, row.path, 'KNOWLEDGE_JSON_INVALID');
      assertIJson(value);
      assertNfc(value);
    }
  }
  await loadPolicyManifest({ repositoryRoot });
  return manifest;
}

export async function checkKnowledge(options) {
  const repositoryRoot = await resolveRepositoryRoot(options);
  const [knowledgeManifest, policyManifest] = await Promise.all([
    loadKnowledgeManifest({ repositoryRoot }),
    loadPolicyManifest({ repositoryRoot }),
  ]);
  return {
    knowledgeManifest,
    policyManifest,
    knowledge_manifest_digest: knowledgeManifestDigest(knowledgeManifest),
    policy_manifest_digest: policyManifestDigest(policyManifest),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const result = await checkKnowledge();
  console.log(
    `knowledge_manifest=ok files=${result.knowledgeManifest.files.length} knowledge_manifest_digest=${result.knowledge_manifest_digest} policy_manifest_digest=${result.policy_manifest_digest}`,
  );
}
