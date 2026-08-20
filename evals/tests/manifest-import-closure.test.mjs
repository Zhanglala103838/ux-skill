import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  EXPECTED_EVALUATOR_MODULE_PATHS,
  assertEvaluatorManifestMatchesImportClosure,
  collectLocalEvaluatorImportClosure,
  parseEvaluatorImportClosureContract
} from '../helpers/import-closure.mjs';

const PLAN_PATH = 'docs/superpowers/plans/2026-08-18-evidence-aware-product-ux-skill-v0.1-vertical-slice.md';
const DESIGN_PATH = 'docs/superpowers/specs/2026-08-18-evidence-aware-product-ux-skill-design.md';
const utf8Compare = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

async function withEvaluatorGraph(overrides, callback) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'ux-skill-import-closure-'));
  const files = Object.fromEntries(EXPECTED_EVALUATOR_MODULE_PATHS.map((path) => [path, 'export const fixture = true;\n']));
  Object.assign(files, overrides);
  try {
    for (const [path, source] of Object.entries(files)) {
      const absolutePath = join(repositoryRoot, path);
      await mkdir(join(absolutePath, '..'), { recursive: true });
      await writeFile(absolutePath, source, 'utf8');
    }
    return await callback(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

const importsFor = (paths) => paths.map((path) => `import './${path.slice('evaluator/'.length)}';`).join('\n');

test('MANIFEST_IMPORT_CLOSURE_RED freezes exact nine evaluator paths for Task10 and Task13', async () => {
  const currentEvaluatorModules = (await readdir('evaluator'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `evaluator/${name}`)
    .sort(utf8Compare);
  assert.deepEqual(
    currentEvaluatorModules,
    EXPECTED_EVALUATOR_MODULE_PATHS,
    'the Task10 evaluator surface must be the exact canonical nine modules'
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

test('IMPORT_CLOSURE_LEXICAL_AUTHENTICITY_RED parses only executable module edges and rejects invalid graphs', async () => {
  const exactIndex = `
import './authority.mjs';
import canonical from "./canonical.mjs";
export { claim } from './claims.mjs';
export * from "./dependency-decision.mjs";
const digestModule = import('./digests.mjs');
import './projection.mjs';
import './rules-runtime.mjs';
import './validation.mjs';
// import('./ghost-line.mjs');
/*
import './ghost-block.mjs';
*/
const singleQuoted = 'import("./ghost-single.mjs")';
const doubleQuoted = "import('./ghost-double.mjs')";
const templateRaw = \`import('./ghost-template.mjs')\nexport * from './ghost-template-export.mjs';\`;
void canonical; void digestModule; void singleQuoted; void doubleQuoted; void templateRaw;
`;
  await withEvaluatorGraph({ 'evaluator/index.mjs': exactIndex }, async (repositoryRoot) => {
    assert.deepEqual(
      await collectLocalEvaluatorImportClosure({ repositoryRoot }),
      EXPECTED_EVALUATOR_MODULE_PATHS,
      'static import, export-from, and literal dynamic import form the exact executable nine-module closure'
    );
    await assertEvaluatorManifestMatchesImportClosure({
      repositoryRoot,
      manifestPaths: EXPECTED_EVALUATOR_MODULE_PATHS
    });
  });

  const withoutDigests = EXPECTED_EVALUATOR_MODULE_PATHS.filter((path) => !path.endsWith('/index.mjs') && !path.endsWith('/digests.mjs'));
  await withEvaluatorGraph({
    'evaluator/index.mjs': `${importsFor(withoutDigests)}\n// import('./digests.mjs');\n`
  }, async (repositoryRoot) => {
    await assert.rejects(
      () => assertEvaluatorManifestMatchesImportClosure({ repositoryRoot, manifestPaths: EXPECTED_EVALUATOR_MODULE_PATHS }),
      /canonical nine modules/,
      'a comment must not conceal a missing real digests edge'
    );
  });

  const allDependencies = EXPECTED_EVALUATOR_MODULE_PATHS.filter((path) => !path.endsWith('/index.mjs'));
  await withEvaluatorGraph({
    'evaluator/index.mjs': `${importsFor(allDependencies)}\nimport './authority.mjs';\n`
  }, async (repositoryRoot) => {
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /duplicate/i);
  });
  await withEvaluatorGraph({
    'evaluator/index.mjs': importsFor(allDependencies),
    'evaluator/authority.mjs': "import './index.mjs';\n"
  }, async (repositoryRoot) => {
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /cycle/i);
  });
  await withEvaluatorGraph({
    'evaluator/index.mjs': "import '../outside.mjs';\n",
    'outside.mjs': 'export const outside = true;\n'
  }, async (repositoryRoot) => {
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /escapes evaluator/);
  });
  await withEvaluatorGraph({
    'evaluator/index.mjs': "import './authority.js';\n",
    'evaluator/authority.js': 'export const wrongExtension = true;\n'
  }, async (repositoryRoot) => {
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /explicit canonical \.mjs path/);
  });
});

test('ECMASCRIPT_PARSER_AUTHENTICITY_RED ignores regex and method-call lookalikes while preserving real module edges', async () => {
  const parserAuthenticityIndex = String.raw`
import './authority.mjs';
import canonical from "./canonical.mjs";
import { claim } from './claims.mjs';
export * from './dependency-decision.mjs';
export { digest } from "./digests.mjs";
const projectionModule = import('./projection.mjs');
import './rules-runtime.mjs';
import './validation.mjs';
/import\('\.\/ghost-statement\.mjs'\)/;
const escapedRegex = /\\\/[a-z]+import\(['"]\.\/ghost-escaped\.mjs['"]\)/;
const classRegex = /[a-z\/'"]+import\(['"]\.\/ghost-class\.mjs['"]\)/;
const quotient = numerator / denominator / 2;
loader.import('./ghost-method.mjs');
loader['import']('./ghost-computed.mjs');
void canonical; void claim; void projectionModule; void escapedRegex; void classRegex; void quotient;
`;
  await withEvaluatorGraph({ 'evaluator/index.mjs': parserAuthenticityIndex }, async (repositoryRoot) => {
    assert.deepEqual(
      await collectLocalEvaluatorImportClosure({ repositoryRoot }),
      EXPECTED_EVALUATOR_MODULE_PATHS,
      'only real ImportDeclaration, export-from, and literal import() edges belong to the closure'
    );
  });

  await withEvaluatorGraph({
    'evaluator/index.mjs': "const modulePath = './authority.mjs';\nimport(modulePath);\n"
  }, async (repositoryRoot) => {
    await assert.rejects(
      () => collectLocalEvaluatorImportClosure({ repositoryRoot }),
      /dynamic import must use one literal module specifier/,
      'nonliteral dynamic imports are fail-closed because their local closure cannot be proven'
    );
  });
});

async function withPathAuthenticitySandbox(callback) {
  const sandbox = await mkdtemp(join(tmpdir(), 'ux-skill-path-authenticity-'));
  try {
    return await callback(sandbox);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

async function writeFixtureFile(path, source = 'export const fixture = true;\n') {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, 'utf8');
}

async function createRealEvaluatorTree(repositoryRoot, indexSource) {
  for (const modulePath of EXPECTED_EVALUATOR_MODULE_PATHS) {
    await writeFixtureFile(
      join(repositoryRoot, modulePath),
      modulePath === 'evaluator/index.mjs' ? indexSource : 'export const fixture = true;\n'
    );
  }
}

test('IMPORT_CLOSURE_REALPATH_AUTHENTICITY_RED rejects symlinked paths missing modules and nonfiles', async () => {
  const dependencies = EXPECTED_EVALUATOR_MODULE_PATHS.filter((path) => !path.endsWith('/index.mjs'));
  const exactIndex = importsFor(dependencies);

  await withPathAuthenticitySandbox(async (sandbox) => {
    const repositoryRoot = join(sandbox, 'normal-repository');
    await createRealEvaluatorTree(repositoryRoot, exactIndex);
    assert.deepEqual(await collectLocalEvaluatorImportClosure({ repositoryRoot }), EXPECTED_EVALUATOR_MODULE_PATHS);
  });

  await withPathAuthenticitySandbox(async (sandbox) => {
    const repositoryRoot = join(sandbox, 'entry-symlink-repository');
    await createRealEvaluatorTree(repositoryRoot, exactIndex);
    const entryPath = join(repositoryRoot, 'evaluator/index.mjs');
    const outsideEntry = join(sandbox, 'outside-entry.mjs');
    await writeFixtureFile(outsideEntry, exactIndex);
    await rm(entryPath);
    await symlink(outsideEntry, entryPath, 'file');
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /symlink path component/i);
  });

  await withPathAuthenticitySandbox(async (sandbox) => {
    const repositoryRoot = join(sandbox, 'import-symlink-repository');
    await createRealEvaluatorTree(repositoryRoot, exactIndex);
    const importedPath = join(repositoryRoot, 'evaluator/authority.mjs');
    const outsideModule = join(sandbox, 'outside-authority.mjs');
    await writeFixtureFile(outsideModule);
    await rm(importedPath);
    await symlink(outsideModule, importedPath, 'file');
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /symlink path component/i);
  });

  await withPathAuthenticitySandbox(async (sandbox) => {
    const repositoryRoot = join(sandbox, 'directory-symlink-repository');
    const outsideRoot = join(sandbox, 'outside-root');
    const outsideEvaluator = join(outsideRoot, 'evaluator');
    await createRealEvaluatorTree(outsideRoot, exactIndex);
    await mkdir(repositoryRoot, { recursive: true });
    await symlink(outsideEvaluator, join(repositoryRoot, 'evaluator'), 'dir');
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /symlink path component/i);
  });

  await withPathAuthenticitySandbox(async (sandbox) => {
    const realRepository = join(sandbox, 'real-repository');
    const repositoryAlias = join(sandbox, 'repository-alias');
    await createRealEvaluatorTree(realRepository, exactIndex);
    await symlink(realRepository, repositoryAlias, 'dir');
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot: repositoryAlias }), /symlink path component/i);
  });

  await withPathAuthenticitySandbox(async (sandbox) => {
    const repositoryRoot = join(sandbox, 'missing-module-repository');
    await writeFixtureFile(join(repositoryRoot, 'evaluator/index.mjs'), "import './authority.mjs';\n");
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /missing evaluator module/i);
  });

  await withPathAuthenticitySandbox(async (sandbox) => {
    const repositoryRoot = join(sandbox, 'nonfile-module-repository');
    await writeFixtureFile(join(repositoryRoot, 'evaluator/index.mjs'), "import './authority.mjs';\n");
    await mkdir(join(repositoryRoot, 'evaluator/authority.mjs'), { recursive: true });
    await assert.rejects(() => collectLocalEvaluatorImportClosure({ repositoryRoot }), /regular file/i);
  });
});
