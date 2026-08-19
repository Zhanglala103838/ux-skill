import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import {
  assertCanonicalRelativePath,
  assertIJson,
  assertNfc,
  jcsBytes,
} from '../evaluator/canonical.mjs';
import { digestJcs } from '../evaluator/digests.mjs';

const modulePath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(modulePath), '..');
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const GLOB_PATTERN = /[*?\[\]{}]/u;

export const KNOWLEDGE_JSON_LIMITS = Object.freeze({
  MAX_BYTES: 1_048_576,
  MAX_DEPTH: 128,
  MAX_NODES: 100_000,
  MAX_STRING_UTF8_BYTES: 262_144,
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

const DANGEROUS_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseKnowledgeJson(bytes, path, syntaxCode) {
  const input = Buffer.from(bytes);
  if (input.length > KNOWLEDGE_JSON_LIMITS.MAX_BYTES) {
    fail('KNOWLEDGE_JSON_RESOURCE_LIMIT', path);
  }
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    fail('KNOWLEDGE_JSON_BOM_FORBIDDEN', path);
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    fail('KNOWLEDGE_JSON_UTF8_INVALID', path);
  }

  let lexicalDepth = 0;
  let inString = false;
  let escaped = false;
  for (let position = 0; position < text.length; position += 1) {
    const code = text.charCodeAt(position);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (code === 0x5c) {
        escaped = true;
      } else if (code === 0x22) {
        inString = false;
      }
      continue;
    }
    if (code === 0x22) {
      inString = true;
    } else if (code === 0x7b || code === 0x5b) {
      lexicalDepth += 1;
      if (lexicalDepth > KNOWLEDGE_JSON_LIMITS.MAX_DEPTH) {
        fail('KNOWLEDGE_JSON_RESOURCE_LIMIT', path);
      }
    } else if ((code === 0x7d || code === 0x5d) && lexicalDepth > 0) {
      lexicalDepth -= 1;
    }
  }

  let index = 0;
  let nodeUnits = 0;
  const syntaxFail = () => fail(syntaxCode, path);
  const unicodeFail = () => fail('KNOWLEDGE_JSON_UNICODE_INVALID', path);
  const resourceFail = () => fail('KNOWLEDGE_JSON_RESOURCE_LIMIT', path);
  const takeNodeUnit = () => {
    nodeUnits += 1;
    if (nodeUnits > KNOWLEDGE_JSON_LIMITS.MAX_NODES) resourceFail();
  };
  const isWhitespace = (code) => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  const skipWhitespace = () => {
    while (index < text.length && isWhitespace(text.charCodeAt(index))) index += 1;
  };
  const pointerFor = (pointer, key) =>
    pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');

  const parseString = () => {
    if (text.charCodeAt(index) !== 0x22) syntaxFail();
    index += 1;
    let value = '';
    let decodedUtf8Bytes = 0;
    const append = (fragment, byteLength) => {
      if (decodedUtf8Bytes > KNOWLEDGE_JSON_LIMITS.MAX_STRING_UTF8_BYTES - byteLength) {
        resourceFail();
      }
      decodedUtf8Bytes += byteLength;
      value += fragment;
    };

    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        return value;
      }
      if (code < 0x20) syntaxFail();

      if (code === 0x5c) {
        index += 1;
        if (index >= text.length) syntaxFail();
        const escape = text[index];
        index += 1;
        if (escape === '"' || escape === '/' || escape.charCodeAt(0) === 0x5c) {
          append(escape, 1);
          continue;
        }
        if (escape === 'b') {
          append(String.fromCharCode(0x08), 1);
          continue;
        }
        if (escape === 'f') {
          append(String.fromCharCode(0x0c), 1);
          continue;
        }
        if (escape === 'n') {
          append(String.fromCharCode(0x0a), 1);
          continue;
        }
        if (escape === 'r') {
          append(String.fromCharCode(0x0d), 1);
          continue;
        }
        if (escape === 't') {
          append(String.fromCharCode(0x09), 1);
          continue;
        }
        if (escape !== 'u' || index + 4 > text.length) syntaxFail();

        const digits = text.slice(index, index + 4);
        if (![...digits].every((digit) =>
          (digit >= '0' && digit <= '9')
          || (digit >= 'a' && digit <= 'f')
          || (digit >= 'A' && digit <= 'F'))) {
          syntaxFail();
        }
        index += 4;
        const unit = Number.parseInt(digits, 16);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          if (text.charCodeAt(index) !== 0x5c || text[index + 1] !== 'u' || index + 6 > text.length) {
            unicodeFail();
          }
          const lowDigits = text.slice(index + 2, index + 6);
          if (![...lowDigits].every((digit) =>
            (digit >= '0' && digit <= '9')
            || (digit >= 'a' && digit <= 'f')
            || (digit >= 'A' && digit <= 'F'))) {
            syntaxFail();
          }
          const lowUnit = Number.parseInt(lowDigits, 16);
          if (lowUnit < 0xdc00 || lowUnit > 0xdfff) unicodeFail();
          append(String.fromCharCode(unit, lowUnit), 4);
          index += 6;
          continue;
        }
        if (unit >= 0xdc00 && unit <= 0xdfff) unicodeFail();
        append(
          String.fromCharCode(unit),
          unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3,
        );
        continue;
      }

      if (code >= 0xd800 && code <= 0xdbff) {
        const low = text.charCodeAt(index + 1);
        if (low < 0xdc00 || low > 0xdfff) unicodeFail();
        append(text[index] + text[index + 1], 4);
        index += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) unicodeFail();
      append(text[index], code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3);
      index += 1;
    }
    syntaxFail();
  };

  const parseNumber = () => {
    const start = index;
    if (text[index] === '-') index += 1;
    if (text[index] === '0') {
      index += 1;
    } else {
      if (text[index] < '1' || text[index] > '9') syntaxFail();
      while (text[index] >= '0' && text[index] <= '9') index += 1;
    }
    if (text[index] === '.') {
      index += 1;
      const fractionStart = index;
      while (text[index] >= '0' && text[index] <= '9') index += 1;
      if (index === fractionStart) syntaxFail();
    }
    if (text[index] === 'e' || text[index] === 'E') {
      index += 1;
      if (text[index] === '+' || text[index] === '-') index += 1;
      const exponentStart = index;
      while (text[index] >= '0' && text[index] <= '9') index += 1;
      if (index === exponentStart) syntaxFail();
    }
    return Number(text.slice(start, index));
  };

  const parseValue = (pointer) => {
    skipWhitespace();
    takeNodeUnit();
    const character = text[index];
    if (character === '"') return parseString();
    if (character === '{') return parseObject(pointer);
    if (character === '[') return parseArray(pointer);
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return null;
    }
    if (character === '-' || (character >= '0' && character <= '9')) return parseNumber();
    syntaxFail();
  };

  const parseObject = (pointer) => {
    index += 1;
    skipWhitespace();
    const value = {};
    const seen = new Set();
    if (text[index] === '}') {
      index += 1;
      return value;
    }

    while (index < text.length) {
      skipWhitespace();
      const key = parseString();
      takeNodeUnit();
      const keyPointer = pointerFor(pointer, key);
      if (seen.has(key)) fail('KNOWLEDGE_JSON_DUPLICATE_KEY', path + keyPointer);
      if (DANGEROUS_JSON_KEYS.has(key)) fail('KNOWLEDGE_JSON_DANGEROUS_KEY', path + keyPointer);
      seen.add(key);
      skipWhitespace();
      if (text[index] !== ':') syntaxFail();
      index += 1;
      const member = parseValue(keyPointer);
      Object.defineProperty(value, key, {
        configurable: true,
        enumerable: true,
        value: member,
        writable: true,
      });
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return value;
      }
      if (text[index] !== ',') syntaxFail();
      index += 1;
    }
    syntaxFail();
  };

  const parseArray = (pointer) => {
    index += 1;
    skipWhitespace();
    const value = [];
    if (text[index] === ']') {
      index += 1;
      return value;
    }

    while (index < text.length) {
      value.push(parseValue(pointer + '/' + value.length));
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return value;
      }
      if (text[index] !== ',') syntaxFail();
      index += 1;
    }
    syntaxFail();
  };

  try {
    const value = parseValue('');
    skipWhitespace();
    if (index !== text.length) syntaxFail();
    return value;
  } catch (error) {
    if (error instanceof RangeError || error?.name === 'RangeError') resourceFail();
    throw error;
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

async function readSecureRegularFile(repositoryRoot, path) {
  assertPath(path);
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
      fail('KNOWLEDGE_SYMLINK_PATH_COMPONENT', `${path}:symlink path component`);
    }
    if (index < segments.length - 1 && !status.isDirectory()) {
      fail('KNOWLEDGE_PATH_COMPONENT_INVALID', `${path}:directory required`);
    }
    if (index === segments.length - 1 && !status.isFile()) {
      fail('KNOWLEDGE_FILE_NOT_REGULAR', `${path}:regular file required`);
    }
  }

  const rootPrefix = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
  const absolutePath = resolve(repositoryRoot, path);
  const actualPath = await realpath(absolutePath);
  if (!absolutePath.startsWith(rootPrefix) || actualPath !== absolutePath) {
    fail('KNOWLEDGE_REALPATH_IDENTITY_INVALID', `${path}:symlink path component or escape`);
  }
  return readFile(absolutePath);
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
  return parseKnowledgeJson(await readSecureRegularFile(repositoryRoot, path), path, parseCode);
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
  const policyBytes = await readSecureRegularFile(repositoryRoot, row.path);
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
    const bytes = await readSecureRegularFile(repositoryRoot, row.path);
    const actualDigest = createHash('sha256').update(bytes).digest('hex');
    if (actualDigest !== row.file_digest) fail('KNOWLEDGE_DIGEST_MISMATCH', row.path);
    if (row.path.endsWith('.json')) {
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
