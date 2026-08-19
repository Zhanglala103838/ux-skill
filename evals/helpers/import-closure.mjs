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

const isIdentifierStart = (char) => {
  const code = char?.codePointAt(0) ?? -1;
  return char === '_' || char === '$' || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
};
const isIdentifierPart = (char) => {
  const code = char?.codePointAt(0) ?? -1;
  return isIdentifierStart(char) || (code >= 48 && code <= 57);
};
const isWhitespace = (char) => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\v' || char === '\f';
const REGEX_PREFIX_KEYWORDS = new Set(['await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'of', 'return', 'throw', 'typeof', 'void', 'yield']);
const REGEX_DISALLOWED_AFTER_PUNCTUATOR = new Set([')', ']', '}']);

function regexCanStartAfter(previous) {
  if (!previous) return true;
  if (previous.kind === 'identifier') return REGEX_PREFIX_KEYWORDS.has(previous.value);
  if (previous.kind === 'string' || previous.kind === 'number') return false;
  return !REGEX_DISALLOWED_AFTER_PUNCTUATOR.has(previous.value);
}

function lexicalTokens(source) {
  assert.equal(typeof source, 'string', 'module source must be a string');
  const tokens = [];
  const modes = [{ kind: 'code', templateExpression: false, braceDepth: 0 }];
  let index = source.startsWith('#!') ? source.indexOf('\n') : 0;
  if (index < 0) return tokens;
  const push = (kind, value) => tokens.push({ kind, value });

  while (index < source.length) {
    const mode = modes.at(-1);
    const char = source[index];
    const next = source[index + 1];

    if (mode.kind === 'template') {
      if (char === '\\') {
        index += 2;
      } else if (char === '`') {
        modes.pop();
        index += 1;
      } else if (char === '$' && next === '{') {
        modes.push({ kind: 'code', templateExpression: true, braceDepth: 0 });
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (mode.templateExpression && char === '}' && mode.braceDepth === 0) {
      modes.pop();
      index += 1;
      continue;
    }
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      assert.notEqual(end, -1, 'unterminated block comment in evaluator module');
      index = end + 2;
      continue;
    }
    if (char === '\'' || char === '"') {
      const quote = char;
      let value = '';
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        assert.ok(current !== '\n' && current !== '\r', 'unterminated string literal in evaluator module');
        if (current === '\\') {
          assert.ok(index + 1 < source.length, 'unterminated string escape in evaluator module');
          value += source.slice(index, index + 2);
          index += 2;
        } else {
          value += current;
          index += 1;
        }
      }
      assert.ok(closed, 'unterminated string literal in evaluator module');
      push('string', value);
      continue;
    }
    if (char === '`') {
      modes.push({ kind: 'template' });
      index += 1;
      continue;
    }
    if (mode.templateExpression && char === '{') mode.braceDepth += 1;
    if (mode.templateExpression && char === '}' && mode.braceDepth > 0) mode.braceDepth -= 1;

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(source[index])) index += 1;
      push('identifier', source.slice(start, index));
      continue;
    }
    const charCode = char.codePointAt(0);
    if (charCode >= 48 && charCode <= 57) {
      const start = index;
      index += 1;
      while (index < source.length) {
        const code = source[index].codePointAt(0);
        if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || source[index] === '_' || source[index] === '.')) break;
        index += 1;
      }
      push('number', source.slice(start, index));
      continue;
    }
    if (char === '/' && regexCanStartAfter(tokens.at(-1))) {
      index += 1;
      let inCharacterClass = false;
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        assert.ok(current !== '\n' && current !== '\r', 'unterminated regular expression in evaluator module');
        if (current === '\\') {
          index += 2;
        } else if (current === '[') {
          inCharacterClass = true;
          index += 1;
        } else if (current === ']' && inCharacterClass) {
          inCharacterClass = false;
          index += 1;
        } else if (current === '/' && !inCharacterClass) {
          closed = true;
          index += 1;
          while (isIdentifierPart(source[index])) index += 1;
          break;
        } else {
          index += 1;
        }
      }
      assert.ok(closed, 'unterminated regular expression in evaluator module');
      push('regex', '/');
      continue;
    }
    push('punctuator', char);
    index += 1;
  }

  assert.equal(modes.length, 1, 'unterminated template literal or expression in evaluator module');
  return tokens;
}

function localSpecifiers(source) {
  const tokens = lexicalTokens(source);
  const specifiers = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'identifier') continue;
    if (token.value === 'import') {
      const following = tokens[index + 1];
      if (following?.kind === 'punctuator' && following.value === '.') continue;
      if (following?.kind === 'punctuator' && following.value === '(') {
        const argument = tokens[index + 2];
        assert.equal(argument?.kind, 'string', 'dynamic import must use one literal module specifier');
        specifiers.push(argument.value);
        continue;
      }
      if (following?.kind === 'string') {
        specifiers.push(following.value);
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].value !== ';'; cursor += 1) {
        if (tokens[cursor].kind === 'identifier' && tokens[cursor].value === 'from' && tokens[cursor + 1]?.kind === 'string') {
          specifiers.push(tokens[cursor + 1].value);
          break;
        }
      }
    } else if (token.value === 'export') {
      const following = tokens[index + 1];
      if (!(following?.kind === 'punctuator' && (following.value === '*' || following.value === '{'))) continue;
      for (let cursor = index + 2; cursor < tokens.length && tokens[cursor].value !== ';'; cursor += 1) {
        if (tokens[cursor].kind === 'identifier' && tokens[cursor].value === 'from' && tokens[cursor + 1]?.kind === 'string') {
          specifiers.push(tokens[cursor + 1].value);
          break;
        }
      }
    }
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
    for (const specifier of localSpecifiers(source)) {
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
