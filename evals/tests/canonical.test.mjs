import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSet, assertCanonicalRelativePath } from '../../evaluator/canonical.mjs';
import { digestJcs } from '../../evaluator/digests.mjs';

import { readFileSync } from 'node:fs';
import { assertIJson, assertNfc, jcsBytes } from '../../evaluator/canonical.mjs';
import { digest } from '../../evaluator/digests.mjs';

test('scenario registry golden is exact', () => {
  const value = {registry_version:'scenario-family-v1',scenario_family_ids:['admin-internal-tool','ai-assisted-workflow','brand-marketing-website','consumer-transaction','cross-channel-service','developer-documentation','public-service-information','retail-commerce-discovery']};
  assert.equal(digestJcs('ux-skill:scenario-family-registry:v1', value), 'b764d922bd94ceb6869cd60984261acae344cd0a5e21c1cc9970cff710e417d0');
});

test('canonical set sorts by UTF-8 JCS key', () => {
  assert.deepEqual(canonicalSet([{id:'\u{10000}'},{id:'\uE000'}], (x) => x.id).map((x) => x.id), ['\uE000','\u{10000}']);
});

test('path rejects separators and dot segments', () => {
  for (const path of ['a//b','a/../b','a\\b','a%2fb']) assert.throws(() => assertCanonicalRelativePath(path), /PATH_INVALID/);
});

const readGolden = (name) =>
  JSON.parse(readFileSync(new URL('../golden/' + name, import.meta.url), 'utf8'));

const assertCode = (operation, code) => {
  assert.throws(operation, (error) => {
    assert.equal(error?.code, code);
    assert.match(error.message, new RegExp(code));
    return true;
  });
};

test('scenario registry fixture is consumed as an exact digest preimage', () => {
  const fixture = readGolden('scenario-family-registry.json');
  const expectedValue = {
    registry_version: 'scenario-family-v1',
    scenario_family_ids: [
      'admin-internal-tool',
      'ai-assisted-workflow',
      'brand-marketing-website',
      'consumer-transaction',
      'cross-channel-service',
      'developer-documentation',
      'public-service-information',
      'retail-commerce-discovery',
    ],
  };
  assert.equal(fixture.fixture_id, 'scenario-family-registry-v1');
  assert.equal(fixture.domain, 'ux-skill:scenario-family-registry:v1');
  assert.deepEqual(fixture.value, expectedValue);
  assert.equal(fixture.expected_digest, 'b764d922bd94ceb6869cd60984261acae344cd0a5e21c1cc9970cff710e417d0');
  assert.equal(digestJcs(fixture.domain, fixture.value), fixture.expected_digest);
});

test('rotation fixture freezes candidate order, selection, and digest', () => {
  const fixture = readGolden('rotation-selection.json');
  const expectedPreimage = {
    generation_commitment: '0000000000000000000000000000000000000000000000000000000000000000',
    generation_id: 'gen-000',
    generation_sequence: 0,
    portfolio_version: 'real-world-portfolio-v1',
    selected_case_id: 'RW-DOCS-STRIPE-001',
    sorted_candidate_case_ids: ['RW-DOCS-STRIPE-001', 'RW-WEBSITE-IKEA-001'],
  };
  assert.equal(fixture.fixture_id, 'rotation-selection-v1-gen-000');
  assert.equal(fixture.domain, 'ux-skill:rotation-selection:v1');
  assert.deepEqual(fixture.preimage, expectedPreimage);
  assert.deepEqual(fixture.preimage.sorted_candidate_case_ids, ['RW-DOCS-STRIPE-001', 'RW-WEBSITE-IKEA-001']);
  assert.equal(
    fixture.preimage.sorted_candidate_case_ids[
      fixture.preimage.generation_sequence % fixture.preimage.sorted_candidate_case_ids.length
    ],
    'RW-DOCS-STRIPE-001',
  );
  assert.equal(fixture.preimage.selected_case_id, 'RW-DOCS-STRIPE-001');
  assert.equal(fixture.expected_digest, 'e01f97c0db9a39b9bd3f61c187ce9892a962a953328eb3cdac67658974a3bfcd');
  assert.equal(digestJcs(fixture.domain, fixture.preimage), fixture.expected_digest);
});

test('I-JSON accepts plain JSON and repeated acyclic references', () => {
  const shared = { value: 1 };
  assert.doesNotThrow(() => assertIJson({
    boolean: true,
    null: null,
    number: 0.25,
    string: '\u{10000}',
    array: [shared],
    repeated: shared,
  }));
});

test('I-JSON rejects non-JSON values recursively', () => {
  for (const value of [
    undefined,
    1n,
    Symbol('value'),
    () => {},
    { nested: undefined },
    [undefined],
  ]) {
    assertCode(() => assertIJson(value), 'IJSON_NON_JSON_VALUE');
  }
});

test('I-JSON rejects non-finite and unsafe integer numbers', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assertCode(() => assertIJson(value), 'IJSON_NON_FINITE_NUMBER');
  }
  for (const value of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), 1e100]) {
    assertCode(() => assertIJson(value), 'IJSON_UNSAFE_INTEGER');
  }
});

test('I-JSON rejects cycles but not shared subobjects', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assertCode(() => assertIJson(cyclic), 'IJSON_CYCLE');

  const child = { ok: true };
  assert.doesNotThrow(() => assertIJson({ first: child, second: child }));
});

test('I-JSON rejects sparse arrays and ignored array properties', () => {
  const sparse = [];
  sparse.length = 1;
  assertCode(() => assertIJson(sparse), 'IJSON_SPARSE_ARRAY');

  const decorated = [1];
  decorated.extra = 2;
  assertCode(() => assertIJson(decorated), 'IJSON_NON_JSON_PROPERTY');
});

test('I-JSON accepts only ordinary enumerable data properties on plain objects', () => {
  assertCode(() => assertIJson(new Date(0)), 'IJSON_NON_PLAIN_OBJECT');
  assertCode(() => assertIJson(Object.assign(Object.create(null), { value: 1 })), 'IJSON_NON_PLAIN_OBJECT');
  assertCode(() => assertIJson(Object.create({ inherited: true })), 'IJSON_NON_PLAIN_OBJECT');

  const symbolic = { value: 1 };
  symbolic[Symbol('hidden')] = 2;
  assertCode(() => assertIJson(symbolic), 'IJSON_NON_JSON_PROPERTY');

  const hidden = {};
  Object.defineProperty(hidden, 'value', { value: 1, enumerable: false });
  assertCode(() => assertIJson(hidden), 'IJSON_NON_JSON_PROPERTY');

  let getterCalled = false;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 1;
    },
  });
  assertCode(() => assertIJson(accessor), 'IJSON_NON_JSON_PROPERTY');
  assert.equal(getterCalled, false);
});

test('I-JSON rejects unpaired surrogates in values and keys', () => {
  assertCode(() => assertIJson('\uD800'), 'IJSON_INVALID_UNICODE_SCALAR');
  assertCode(() => assertIJson('\uDC00'), 'IJSON_INVALID_UNICODE_SCALAR');
  assertCode(() => assertIJson({ ['bad\uD800']: true }), 'IJSON_INVALID_UNICODE_SCALAR');
  assert.doesNotThrow(() => assertIJson('\uD83D\uDE00'));
});

test('NFC validation is recursive across values and object keys', () => {
  assertCode(() => assertNfc({ nested: ['e\u0301'] }), 'UNICODE_NOT_NFC');
  assertCode(() => assertNfc({ ['e\u0301']: true }), 'UNICODE_NOT_NFC');
  assert.doesNotThrow(() => assertNfc({ nested: ['\u00E9'] }));
});

test('JCS bytes are UTF-8 after validation and use canonical property order', () => {
  const bytes = jcsBytes({ b: 1, a: '\u00E9' });
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes).toString('utf8'), '{"a":"\u00E9","b":1}');
  assertCode(() => jcsBytes({ value: 'e\u0301' }), 'UNICODE_NOT_NFC');
  assertCode(() => jcsBytes({ value: Number.MAX_SAFE_INTEGER + 1 }), 'IJSON_UNSAFE_INTEGER');
});

test('canonical set preserves composite key order and does not mutate input', () => {
  const items = [
    { id: ['b', 'a'], value: 1 },
    { id: ['a', 'z'], value: 2 },
    { id: ['a', 'a'], value: 3 },
  ];
  const original = items.slice();
  const result = canonicalSet(items, (item) => item.id);
  assert.deepEqual(result.map((item) => item.id), [['a', 'a'], ['a', 'z'], ['b', 'a']]);
  assert.deepEqual(items, original);
});

test('canonical set collapses byte-identical duplicates', () => {
  const result = canonicalSet(
    [{ id: 'same', a: 1, b: 2 }, { b: 2, id: 'same', a: 1 }],
    (item) => item.id,
  );
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { id: 'same', a: 1, b: 2 });
});

test('canonical set rejects conflicting duplicate keys and invalid keys', () => {
  assertCode(
    () => canonicalSet([{ id: 'same', value: 1 }, { id: 'same', value: 2 }], (item) => item.id),
    'DUPLICATE_ID_CONFLICT',
  );
  assertCode(() => canonicalSet([{ id: 'x' }], () => undefined), 'IJSON_NON_JSON_VALUE');
});

test('canonical relative paths accept exact original valid forms', () => {
  for (const path of [
    'a',
    'a/b',
    'a.b',
    '%20',
    '\u00E9/\u4E2D',
    'a'.repeat(100),
    '\u00E9'.repeat(50),
  ]) {
    assert.doesNotThrow(() => assertCanonicalRelativePath(path));
  }
});

test('canonical relative paths enforce byte, scalar, control, and encoding limits', () => {
  for (const path of [
    '',
    '/a',
    'a/',
    'a//b',
    '.',
    '..',
    'a/./b',
    'a/../b',
    'a\\b',
    'a%2Fb',
    'a%5cb',
    'a%5Cb',
    'a\u0000b',
    'a\u001Fb',
    'a\u007Fb',
    'a\u0085b',
    'e\u0301',
    '\uD800',
    'a'.repeat(101),
    '\u00E9'.repeat(51),
  ]) {
    assert.throws(() => assertCanonicalRelativePath(path), /PATH_INVALID/);
  }
  assert.throws(() => assertCanonicalRelativePath(123), /PATH_INVALID/);
});

test('digest concatenates UTF-8 domain and bytes without a delimiter', () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(digest('ab', Buffer.from('c')), expected);
  assert.equal(digest('a', new Uint8Array(Buffer.from('bc'))), expected);
});

test('digest rejects text and arbitrary preimages instead of coercing them', () => {
  assertCode(() => digest('domain', 'text'), 'DIGEST_BYTES_REQUIRED');
  assertCode(() => digest('domain', [1, 2, 3]), 'DIGEST_BYTES_REQUIRED');
  assertCode(() => digest(123, Buffer.from('bytes')), 'DIGEST_DOMAIN_INVALID');
});
