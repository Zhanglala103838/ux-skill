import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { digestJcs } from '../../evaluator/digests.mjs';

let knowledgeApi;
let importFailure;
try {
  knowledgeApi = await import('../../scripts/check-knowledge.mjs');
} catch (error) {
  importFailure = error;
}

if (importFailure) {
  test('TASK7_KNOWLEDGE_MANIFEST_RED', () => {
    assert.fail(`TASK7_KNOWLEDGE_MANIFEST_RED:${importFailure?.code ?? importFailure?.name ?? 'IMPORT_FAILED'}`);
  });
} else {
  const {
    checkKnowledge,
    KNOWLEDGE_JSON_LIMITS,
    parseKnowledgeJson,
    knowledgeManifestDigest,
    loadKnowledgeManifest,
    loadPolicyManifest,
    policyManifestDigest,
  } = knowledgeApi;

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
    {
      path: 'references/journey-authority.md',
      requires: ['references/context-model.md'],
    },
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

  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const utf8JcsStringCompare = (left, right) =>
    Buffer.compare(Buffer.from(JSON.stringify(left), 'utf8'), Buffer.from(JSON.stringify(right), 'utf8'));

  async function copyFile(sourceRoot, targetRoot, path) {
    const bytes = await readFile(join(sourceRoot, path));
    await mkdir(dirname(join(targetRoot, path)), { recursive: true });
    await writeFile(join(targetRoot, path), bytes);
  }

  async function withRepository(callback) {
    const sourceRoot = process.cwd();
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'ux-skill-knowledge-'));
    try {
      for (const path of ['knowledge/manifest.json', ...FILE_PATHS]) {
        await copyFile(sourceRoot, repositoryRoot, path);
      }
      return await callback(repositoryRoot);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  }

  async function rewriteManifest(repositoryRoot, mutate) {
    const path = join(repositoryRoot, 'knowledge/manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify(mutate(manifest)) + '\n', 'utf8');
  }

  async function assertRejected(repositoryRoot, pattern) {
    await assert.rejects(() => checkKnowledge({ repositoryRoot }), pattern);
  }

  test('closed knowledge manifest fixes exact raw bytes, eight references, routes, and dependency graph', async () => {
    const manifest = await loadKnowledgeManifest();
    assert.deepEqual(Object.keys(manifest).sort(), ['dependency_graph', 'files', 'manifest_version', 'routes']);
    assert.equal(manifest.manifest_version, 'knowledge-manifest-v1');
    assert.deepEqual(manifest.files.map((row) => row.path), FILE_PATHS);
    assert.deepEqual(
      manifest.files.map((row) => Object.keys(row).sort()),
      FILE_PATHS.map(() => ['file_digest', 'path']),
    );
    assert.deepEqual(manifest.dependency_graph, DEPENDENCY_GRAPH);
    assert.deepEqual(Object.keys(manifest.routes).sort(), ['guide', 'refactor', 'scan', 'verify']);
    for (const [mode, paths] of Object.entries(ROUTES)) {
      assert.deepEqual(Object.keys(manifest.routes[mode]), ['paths']);
      assert.deepEqual(manifest.routes[mode].paths, paths);
    }

    const actualReferencePaths = (await readdir('references'))
      .map((name) => `references/${name}`)
      .sort(utf8JcsStringCompare);
    assert.deepEqual(actualReferencePaths, REFERENCE_PATHS);

    const expectedRawDigests = new Map();
    for (const path of FILE_PATHS) expectedRawDigests.set(path, sha256(await readFile(path)));
    for (const row of manifest.files) assert.equal(row.file_digest, expectedRawDigests.get(row.path), row.path);
    assert.equal(new Set(manifest.files.map((row) => row.path)).size, FILE_PATHS.length);
    assert.equal(new Set(REFERENCE_PATHS.map((path) => expectedRawDigests.get(path))).size, REFERENCE_PATHS.length);
  });

  test('route order is a complete acyclic dependency closure', async () => {
    const manifest = await loadKnowledgeManifest();
    const dependencyMap = new Map(manifest.dependency_graph.map((row) => [row.path, row.requires]));
    for (const [mode, expectedPaths] of Object.entries(ROUTES)) {
      const loaded = new Set();
      for (const path of manifest.routes[mode].paths) {
        for (const requiredPath of dependencyMap.get(path) ?? []) {
          assert.ok(loaded.has(requiredPath), `${mode} must load ${requiredPath} before ${path}`);
        }
        loaded.add(path);
      }
      assert.deepEqual([...loaded], expectedPaths);
    }
  });

  test('policy manifest is the one-row closed preimage and uses only the manifest JCS domain', async () => {
    const policyManifest = await loadPolicyManifest();
    const decisionPolicyDigest = sha256(await readFile('knowledge/decision-policies.json'));
    assert.deepEqual(Object.keys(policyManifest), ['policy_files']);
    assert.deepEqual(policyManifest.policy_files, [
      { path: 'knowledge/decision-policies.json', file_digest: decisionPolicyDigest },
    ]);
    assert.equal(
      policyManifestDigest(policyManifest),
      digestJcs('ux-skill:manifest:v1', policyManifest),
    );
    const manifest = await loadKnowledgeManifest();
    assert.equal(
      knowledgeManifestDigest(manifest),
      digestJcs('ux-skill:knowledge:v1', manifest.files),
    );
    assert.notEqual(
      policyManifestDigest(policyManifest),
      sha256(await readFile('knowledge/policy-manifest.json')),
      'the policy digest must not be a raw-file shortcut',
    );
  });

  test('one-byte tamper fails before a manifest can be consumed', async () => {
    await withRepository(async (repositoryRoot) => {
      const path = join(repositoryRoot, 'references/context-model.md');
      await writeFile(path, Buffer.concat([await readFile(path), Buffer.from('x')]));
      await assertRejected(repositoryRoot, /KNOWLEDGE_DIGEST_MISMATCH:references\/context-model\.md/);
    });
  });

  test('glob paths, duplicates, locale order, and manifest self-reference fail closed', async () => {
    const cases = [
      {
        pattern: /KNOWLEDGE_GLOB_FORBIDDEN/,
        mutate(manifest) {
          manifest.files[0].path = 'knowledge/*.json';
          return manifest;
        },
      },
      {
        pattern: /KNOWLEDGE_DUPLICATE_PATH/,
        mutate(manifest) {
          manifest.files.splice(1, 0, structuredClone(manifest.files[0]));
          return manifest;
        },
      },
      {
        pattern: /KNOWLEDGE_FILES_NOT_CANONICAL/,
        mutate(manifest) {
          [manifest.files[0], manifest.files[1]] = [manifest.files[1], manifest.files[0]];
          return manifest;
        },
      },
      {
        pattern: /KNOWLEDGE_MANIFEST_SELF_REFERENCE/,
        mutate(manifest) {
          manifest.files.push({
            path: 'knowledge/manifest.json',
            file_digest: '0'.repeat(64),
          });
          manifest.files.sort((left, right) => utf8JcsStringCompare(left.path, right.path));
          return manifest;
        },
      },
    ];

    for (const fixture of cases) {
      await withRepository(async (repositoryRoot) => {
        await rewriteManifest(repositoryRoot, fixture.mutate);
        await assertRejected(repositoryRoot, fixture.pattern);
      });
    }
  });

  test('route missing dependency, wrong order, duplicate path, and dependency cycle fail closed', async () => {
    const cases = [
      {
        pattern: /KNOWLEDGE_ROUTE_DEPENDENCY_MISSING:scan/,
        mutate(manifest) {
          manifest.routes.scan.paths = manifest.routes.scan.paths.filter(
            (path) => path !== 'references/context-model.md',
          );
          return manifest;
        },
      },
      {
        pattern: /KNOWLEDGE_ROUTE_ORDER_INVALID:scan/,
        mutate(manifest) {
          [manifest.routes.scan.paths[0], manifest.routes.scan.paths[1]] =
            [manifest.routes.scan.paths[1], manifest.routes.scan.paths[0]];
          return manifest;
        },
      },
      {
        pattern: /KNOWLEDGE_ROUTE_DUPLICATE_PATH:guide/,
        mutate(manifest) {
          manifest.routes.guide.paths.push('references/context-model.md');
          return manifest;
        },
      },
      {
        pattern: /KNOWLEDGE_DEPENDENCY_CYCLE/,
        mutate(manifest) {
          const context = manifest.dependency_graph.find(
            (row) => row.path === 'references/context-model.md',
          );
          context.requires = ['references/journey-authority.md'];
          return manifest;
        },
      },
    ];

    for (const fixture of cases) {
      await withRepository(async (repositoryRoot) => {
        await rewriteManifest(repositoryRoot, fixture.mutate);
        await assertRejected(repositoryRoot, fixture.pattern);
      });
    }
  });

  test('invalid paths, malformed shapes, and unknown fields are total fail-closed inputs', async () => {
    for (const invalidPath of [
      '../outside.md',
      'references//context-model.md',
      'references/%2fcontext-model.md',
      'references/e\\context-model.md',
      'references/e\u0301.md',
    ]) {
      await withRepository(async (repositoryRoot) => {
        await rewriteManifest(repositoryRoot, (manifest) => {
          manifest.files[0].path = invalidPath;
          return manifest;
        });
        await assertRejected(
          repositoryRoot,
          invalidPath === 'references/e\u0301.md' ? /UNICODE_NOT_NFC/ : /PATH_INVALID/,
        );
      });
    }

    const hostileSources = [
      ['null\n', /KNOWLEDGE_MANIFEST_TYPE_INVALID/],
      ['[]\n', /KNOWLEDGE_MANIFEST_TYPE_INVALID/],
      ['{"files":', /KNOWLEDGE_MANIFEST_JSON_INVALID/],
      ['{"manifest_version":"knowledge-manifest-v1","files":[],"dependency_graph":[],"routes":{},"extra":true}\n', /KNOWLEDGE_MANIFEST_ADDITIONAL_PROPERTY/],
    ];
    for (const [source, pattern] of hostileSources) {
      await withRepository(async (repositoryRoot) => {
        await writeFile(join(repositoryRoot, 'knowledge/manifest.json'), source, 'utf8');
        await assertRejected(repositoryRoot, pattern);
      });
    }

    await assert.rejects(
      () => loadKnowledgeManifest({ repositoryRoot: null }),
      /KNOWLEDGE_REPOSITORY_ROOT_INVALID/,
    );
  });

  async function writeJsonBytesAndRebind(repositoryRoot, targetPath, bytes) {
    await writeFile(join(repositoryRoot, targetPath), bytes);

    if (targetPath === 'knowledge/manifest.json') return;

    const manifestPath = join(repositoryRoot, 'knowledge/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const setManifestDigest = (path, digest) => {
      const row = manifest.files.find((candidate) => candidate.path === path);
      assert.ok(row, `missing manifest row for ${path}`);
      row.file_digest = digest;
    };

    if (targetPath === 'knowledge/decision-policies.json') {
      const policyPath = join(repositoryRoot, 'knowledge/policy-manifest.json');
      const policyManifest = JSON.parse(await readFile(policyPath, 'utf8'));
      policyManifest.policy_files[0].file_digest = sha256(bytes);
      const policyBytes = Buffer.from(JSON.stringify(policyManifest) + '\n', 'utf8');
      await writeFile(policyPath, policyBytes);
      setManifestDigest(targetPath, sha256(bytes));
      setManifestDigest('knowledge/policy-manifest.json', sha256(policyBytes));
    } else {
      setManifestDigest(targetPath, sha256(bytes));
    }

    await writeFile(manifestPath, JSON.stringify(manifest) + '\n', 'utf8');
  }

  async function assertJsonRejected(repositoryRoot, fixture) {
    await assert.rejects(
      () => loadKnowledgeManifest({ repositoryRoot }),
      (error) => {
        assert.equal(error?.code, fixture.code, fixture.label);
        assert.equal(error?.message, `${fixture.code}:${fixture.path}${fixture.pointer ?? ''}`, fixture.label);
        return true;
      },
    );
  }


  const EXPECTED_JSON_LIMITS = Object.freeze({
    MAX_BYTES: 1_048_576,
    MAX_DEPTH: 128,
    MAX_NODES: 100_000,
    MAX_STRING_UTF8_BYTES: 262_144,
  });

  function jsonBytesWithSize(size) {
    assert.ok(size >= 5);
    return Buffer.from('null' + ' '.repeat(size - 5) + '\n', 'utf8');
  }

  function nestedArrayBytes(depth) {
    return Buffer.from('['.repeat(depth) + 'null' + ']'.repeat(depth) + '\n', 'utf8');
  }

  // Node units are the root value, every array value, and both the decoded
  // member-name and value of every object member.
  function wideArrayWithNodeUnits(total) {
    assert.ok(total >= 1);
    return Buffer.from('[' + Array(total - 1).fill('null').join(',') + ']\n', 'utf8');
  }

  function wideObjectWithNodeUnits(total) {
    assert.ok(total >= 1);
    let remaining = total - 1;
    let nextKey = 0;
    const members = [];
    if (remaining % 2 === 1) {
      assert.ok(remaining >= 3);
      members.push('"0":[null]');
      nextKey = 1;
      remaining -= 3;
    }
    for (let index = 0; index < remaining / 2; index += 1) {
      members.push(JSON.stringify(String(nextKey + index)) + ':null');
    }
    return Buffer.from('{' + members.join(',') + '}\n', 'utf8');
  }

  function escapedStringWithUtf8Bytes(decodedBytes) {
    assert.ok(decodedBytes >= 0);
    const pairs = Math.floor(decodedBytes / 2);
    const tail = decodedBytes % 2 === 1 ? 'a' : '';
    return Buffer.from('"' + String.raw`\u00e9`.repeat(pairs) + tail + '"\n', 'utf8');
  }

  function objectWithKeyUtf8Bytes(decodedBytes) {
    return Buffer.from('{"' + 'k'.repeat(decodedBytes) + '":null}\n', 'utf8');
  }

  test('TASK7_JSON_RESOURCE_LIMIT_RED enforces deterministic parser budgets and totality on every JSON surface', async () => {
    const failures = [];
    const resourceCode = 'KNOWLEDGE_JSON_RESOURCE_LIMIT';
    const fixturePath = 'knowledge/resource-budget-fixture.json';

    if (JSON.stringify(KNOWLEDGE_JSON_LIMITS) !== JSON.stringify(EXPECTED_JSON_LIMITS)) {
      failures.push(
        'limit contract mismatch: expected ' + JSON.stringify(EXPECTED_JSON_LIMITS)
          + ' got ' + JSON.stringify(KNOWLEDGE_JSON_LIMITS),
      );
    }

    const expectParse = (label, bytes, expectedCode = null, path = fixturePath) => {
      if (typeof parseKnowledgeJson !== 'function') {
        if (!failures.includes('parseKnowledgeJson export missing')) {
          failures.push('parseKnowledgeJson export missing');
        }
        return;
      }
      let value;
      let error;
      try {
        value = parseKnowledgeJson(bytes, path, 'KNOWLEDGE_JSON_INVALID');
      } catch (caught) {
        error = caught;
      }
      if (expectedCode === null) {
        if (error) failures.push(label + ': unexpected ' + (error.code ?? error.name));
        return value;
      }
      if (!error) {
        failures.push(label + ': accepted');
        return undefined;
      }
      if (error instanceof RangeError || error?.name === 'RangeError') {
        failures.push(label + ': leaked RangeError');
        return undefined;
      }
      if (error?.code !== expectedCode) {
        failures.push(label + ': expected ' + expectedCode + ' got ' + (error?.code ?? error?.name));
        return undefined;
      }
      if (error?.message !== expectedCode + ':' + path) {
        failures.push(label + ': nondeterministic message ' + error?.message);
      }
      return undefined;
    };

    const expectLoaderResource = async (label, targetPath, bytes) => {
      await withRepository(async (repositoryRoot) => {
        await writeJsonBytesAndRebind(repositoryRoot, targetPath, bytes);
        let error;
        try {
          await loadKnowledgeManifest({ repositoryRoot });
        } catch (caught) {
          error = caught;
        }
        if (!error) {
          failures.push(label + ': accepted');
        } else if (error instanceof RangeError || error?.name === 'RangeError') {
          failures.push(label + ': leaked RangeError');
        } else if (error?.code !== resourceCode) {
          failures.push(label + ': expected ' + resourceCode + ' got ' + (error?.code ?? error?.name));
        } else if (error?.message !== resourceCode + ':' + targetPath) {
          failures.push(label + ': nondeterministic message ' + error?.message);
        }
      });
    };

    for (const delta of [-1, 0, 1]) {
      const size = EXPECTED_JSON_LIMITS.MAX_BYTES + delta;
      expectParse(
        'raw byte boundary ' + size,
        jsonBytesWithSize(size),
        delta <= 0 ? null : resourceCode,
      );
    }

    for (const delta of [-1, 0, 1]) {
      const depth = EXPECTED_JSON_LIMITS.MAX_DEPTH + delta;
      expectParse(
        'container depth boundary ' + depth,
        nestedArrayBytes(depth),
        delta <= 0 ? null : resourceCode,
      );
    }
    expectParse('12000-level nesting', nestedArrayBytes(12_000), resourceCode);

    for (const delta of [-1, 0, 1]) {
      const nodes = EXPECTED_JSON_LIMITS.MAX_NODES + delta;
      expectParse(
        'wide array node boundary ' + nodes,
        wideArrayWithNodeUnits(nodes),
        delta <= 0 ? null : resourceCode,
      );
      expectParse(
        'wide object node boundary ' + nodes,
        wideObjectWithNodeUnits(nodes),
        delta <= 0 ? null : resourceCode,
      );
    }

    for (const delta of [-1, 0, 1]) {
      const decodedBytes = EXPECTED_JSON_LIMITS.MAX_STRING_UTF8_BYTES + delta;
      expectParse(
        'escaped decoded string UTF-8 boundary ' + decodedBytes,
        escapedStringWithUtf8Bytes(decodedBytes),
        delta <= 0 ? null : resourceCode,
      );
      expectParse(
        'decoded object key UTF-8 boundary ' + decodedBytes,
        objectWithKeyUtf8Bytes(decodedBytes),
        delta <= 0 ? null : resourceCode,
      );
    }

    expectParse(
      'invalid UTF-8 below raw byte budget',
      Buffer.from([0xff]),
      'KNOWLEDGE_JSON_UTF8_INVALID',
    );
    const oversizedInvalidUtf8 = jsonBytesWithSize(EXPECTED_JSON_LIMITS.MAX_BYTES + 1);
    oversizedInvalidUtf8[0] = 0xff;
    expectParse(
      'raw byte budget precedes invalid UTF-8 decoding',
      oversizedInvalidUtf8,
      resourceCode,
    );

    const declaredJsonPaths = [
      'knowledge/manifest.json',
      'knowledge/assertions.json',
      'knowledge/decision-policies.json',
      'knowledge/policy-manifest.json',
      'knowledge/registries.json',
      'knowledge/rules.json',
      'knowledge/sources.json',
    ];
    for (const path of declaredJsonPaths) {
      await expectLoaderResource(
        'declared JSON surface ' + path,
        path,
        jsonBytesWithSize(EXPECTED_JSON_LIMITS.MAX_BYTES + 1),
      );
    }
    await expectLoaderResource(
      'deep declared JSON surface is total',
      'knowledge/assertions.json',
      nestedArrayBytes(12_000),
    );

    assert.equal(failures.length, 0, failures.join('\n'));
  });

  test('TASK7_DUPLICATE_MEMBER_RED rejects duplicate-aware and hostile JSON bytes at every loader boundary', async () => {
    const duplicateFixtures = [
      {
        label: 'knowledge manifest root duplicate with canonical value last',
        path: 'knowledge/manifest.json',
        pointer: '/manifest_version',
        mutate(source) {
          return source.replace('{', '{"manifest_version":"shadow",');
        },
      },
      {
        label: 'knowledge manifest root duplicate with canonical value first',
        path: 'knowledge/manifest.json',
        pointer: '/manifest_version',
        mutate(source) {
          return source.replace(/\n\}\n$/u, ',\n"manifest_version":"shadow"\n}\n');
        },
      },
      {
        label: 'knowledge manifest escape-equivalent decoded key',
        path: 'knowledge/manifest.json',
        pointer: '/files',
        mutate(source) {
          return source.replace('{', String.raw`{"fi\u006ces":[],`);
        },
      },
      {
        label: 'knowledge manifest nested array object duplicate',
        path: 'knowledge/manifest.json',
        pointer: '/files/0/path',
        mutate(source) {
          return source.replace(
            '"path": "knowledge/assertions.json",',
            '"path":"knowledge/ghost.json","path": "knowledge/assertions.json",',
          );
        },
      },
      {
        label: 'policy manifest root duplicate',
        path: 'knowledge/policy-manifest.json',
        pointer: '/policy_files',
        mutate(source) {
          return source.replace('{', '{"policy_files":[],');
        },
      },
      {
        label: 'policy manifest nested array object duplicate',
        path: 'knowledge/policy-manifest.json',
        pointer: '/policy_files/0/path',
        mutate(source) {
          return source.replace(
            '"path": "knowledge/decision-policies.json",',
            '"path":"knowledge/ghost.json","path": "knowledge/decision-policies.json",',
          );
        },
      },
      ...[
        'knowledge/assertions.json',
        'knowledge/decision-policies.json',
        'knowledge/registries.json',
        'knowledge/rules.json',
        'knowledge/sources.json',
      ].map((path) => ({
        label: `${path} direct duplicate`,
        path,
        pointer: '/value',
        mutate() {
          return '{"value":"shadow","value":"canonical"}\n';
        },
      })),
      {
        label: 'nested object duplicate',
        path: 'knowledge/assertions.json',
        pointer: '/nested/x',
        mutate() {
          return '{"nested":{"x":1,"x":2}}\n';
        },
      },
      {
        label: 'array member duplicate',
        path: 'knowledge/registries.json',
        pointer: '/rows/0/id',
        mutate() {
          return '{"rows":[{"id":"shadow","id":"canonical"}]}\n';
        },
      },
    ];

    for (const fixture of duplicateFixtures) {
      await withRepository(async (repositoryRoot) => {
        const original = await readFile(join(repositoryRoot, fixture.path), 'utf8');
        const bytes = Buffer.from(fixture.mutate(original), 'utf8');
        await writeJsonBytesAndRebind(repositoryRoot, fixture.path, bytes);
        await assertJsonRejected(repositoryRoot, {
          ...fixture,
          code: 'KNOWLEDGE_JSON_DUPLICATE_KEY',
        });
      });
    }

    for (const dangerousKey of ['__proto__', 'constructor', 'prototype']) {
      await withRepository(async (repositoryRoot) => {
        const path = 'knowledge/sources.json';
        const bytes = Buffer.from(`{"safe":true,"${dangerousKey}":{"polluted":true}}\n`, 'utf8');
        await writeJsonBytesAndRebind(repositoryRoot, path, bytes);
        await assertJsonRejected(repositoryRoot, {
          label: `dangerous decoded key ${dangerousKey}`,
          path,
          pointer: `/${dangerousKey}`,
          code: 'KNOWLEDGE_JSON_DANGEROUS_KEY',
        });
      });
    }

    const hostileBytes = [
      {
        label: 'invalid UTF-8 is fatal',
        path: 'knowledge/assertions.json',
        code: 'KNOWLEDGE_JSON_UTF8_INVALID',
        bytes: Buffer.concat([Buffer.from('{"value":"', 'utf8'), Buffer.from([0xff]), Buffer.from('"}\n', 'utf8')]),
      },
      {
        label: 'UTF-8 BOM is forbidden',
        path: 'knowledge/registries.json',
        code: 'KNOWLEDGE_JSON_BOM_FORBIDDEN',
        bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"value":true}\n', 'utf8')]),
      },
      {
        label: 'lone surrogate escape is forbidden',
        path: 'knowledge/rules.json',
        code: 'KNOWLEDGE_JSON_UNICODE_INVALID',
        bytes: Buffer.from('{"value":"\\uD800"}\n', 'utf8'),
      },
    ];

    for (const fixture of hostileBytes) {
      await withRepository(async (repositoryRoot) => {
        await writeJsonBytesAndRebind(repositoryRoot, fixture.path, fixture.bytes);
        await assertJsonRejected(repositoryRoot, fixture);
      });
    }
  });

  test('symlink roots, symlinked declared files, and non-files cannot substitute raw identities', async () => {
    await withRepository(async (repositoryRoot) => {
      const alias = `${repositoryRoot}-alias`;
      await symlink(repositoryRoot, alias, 'dir');
      try {
        assert.notEqual(await realpath(alias), alias);
        await assert.rejects(() => loadKnowledgeManifest({ repositoryRoot: alias }), /symlink path component/i);
      } finally {
        await rm(alias, { force: true });
      }
    });

    await withRepository(async (repositoryRoot) => {
      const path = join(repositoryRoot, 'references/context-model.md');
      const outside = `${repositoryRoot}-outside.md`;
      await writeFile(outside, await readFile(path));
      await rm(path);
      await symlink(outside, path, 'file');
      try {
        await assertRejected(repositoryRoot, /symlink path component/i);
      } finally {
        await rm(outside, { force: true });
      }
    });

    await withRepository(async (repositoryRoot) => {
      const path = join(repositoryRoot, 'references/context-model.md');
      await rm(path);
      await mkdir(path);
      await assertRejected(repositoryRoot, /regular file/i);
    });
  });
}
