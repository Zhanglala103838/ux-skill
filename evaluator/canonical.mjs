import { canonicalize } from 'json-canonicalize';

const fail = (code) => {
  const error = new TypeError(code);
  error.code = code;
  throw error;
};

const isUnicodeScalarString = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
};

const assertScalarString = (value) => {
  if (!isUnicodeScalarString(value)) fail('IJSON_INVALID_UNICODE_SCALAR');
};

const validateArray = (value, active) => {
  if (Object.getPrototypeOf(value) !== Array.prototype) fail('IJSON_NON_PLAIN_OBJECT');

  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (key === 'length') continue;
    if (typeof key !== 'string') fail('IJSON_NON_JSON_PROPERTY');
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      fail('IJSON_NON_JSON_PROPERTY');
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail('IJSON_SPARSE_ARRAY');
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('IJSON_NON_JSON_PROPERTY');
    }
    validateIJson(value[index], active);
  }
};

const validateObject = (value, active) => {
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('IJSON_NON_PLAIN_OBJECT');

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('IJSON_NON_JSON_PROPERTY');
    assertScalarString(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('IJSON_NON_JSON_PROPERTY');
    }
    validateIJson(descriptor.value, active);
  }
};

const validateIJson = (value, active) => {
  if (value === null || typeof value === 'boolean') return;

  if (typeof value === 'string') {
    assertScalarString(value);
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('IJSON_NON_FINITE_NUMBER');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail('IJSON_UNSAFE_INTEGER');
    return;
  }

  if (typeof value !== 'object') fail('IJSON_NON_JSON_VALUE');
  if (active.has(value)) fail('IJSON_CYCLE');

  active.add(value);
  try {
    if (Array.isArray(value)) validateArray(value, active);
    else validateObject(value, active);
  } finally {
    active.delete(value);
  }
};

export const assertIJson = (value) => {
  validateIJson(value, new WeakSet());
  return value;
};

const validateNfc = (value) => {
  if (typeof value === 'string') {
    if (value.normalize('NFC') !== value) fail('UNICODE_NOT_NFC');
    return;
  }
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) validateNfc(item);
    return;
  }

  for (const key of Object.keys(value)) {
    if (key.normalize('NFC') !== key) fail('UNICODE_NOT_NFC');
    validateNfc(value[key]);
  }
};

export const assertNfc = (value) => {
  assertIJson(value);
  validateNfc(value);
  return value;
};

export const jcsBytes = (value) => {
  assertIJson(value);
  validateNfc(value);
  return Buffer.from(canonicalize(value), 'utf8');
};

export const canonicalSet = (items, keyOf) => {
  assertIJson(items);
  if (typeof keyOf !== 'function') fail('IJSON_NON_JSON_VALUE');

  const entries = items.map((item) => ({
    item,
    itemBytes: jcsBytes(item),
    keyBytes: jcsBytes(keyOf(item)),
  }));
  entries.sort((left, right) => Buffer.compare(left.keyBytes, right.keyBytes));

  const result = [];
  let previous;
  for (const entry of entries) {
    if (previous && entry.keyBytes.equals(previous.keyBytes)) {
      if (entry.itemBytes.equals(previous.itemBytes)) continue;
      fail('DUPLICATE_ID_CONFLICT');
    }
    result.push(entry.item);
    previous = entry;
  }
  return result;
};

const pathInvalid = () => fail('PATH_INVALID');

export const assertCanonicalRelativePath = (path) => {
  if (typeof path !== 'string') pathInvalid();
  if (!isUnicodeScalarString(path) || path.normalize('NFC') !== path) pathInvalid();

  const totalBytes = Buffer.byteLength(path, 'utf8');
  if (totalBytes < 1 || totalBytes > 100) pathInvalid();
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(path)) pathInvalid();
  if (path.includes('\\') || /%2f|%5c/iu.test(path)) pathInvalid();
  if (path.startsWith('/') || path.endsWith('/') || path.includes('//')) pathInvalid();

  const segments = path.split('/');
  for (const segment of segments) {
    const segmentBytes = Buffer.byteLength(segment, 'utf8');
    if (segmentBytes < 1 || segmentBytes > 100) pathInvalid();
    if (segment === '.' || segment === '..') pathInvalid();
  }
  return path;
};
