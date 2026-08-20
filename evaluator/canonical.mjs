import { TextDecoder, types as utilTypes } from 'node:util';
import { canonicalize } from 'json-canonicalize';

export const KNOWLEDGE_JSON_LIMITS = Object.freeze({
  MAX_BYTES: 1_048_576,
  MAX_DEPTH: 128,
  MAX_NODES: 100_000,
  MAX_STRING_UTF8_BYTES: 262_144,
});
function jsonFail(code, detail = '') {
  const error = new Error(detail === '' ? code : `${code}:${detail}`);
  error.code = code;
  throw error;
}
const DANGEROUS_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseKnowledgeJson(bytes, path, syntaxCode, options = {}) {
  const allowDangerousKeys = options?.allowDangerousKeys === true;
  const input = Buffer.from(bytes);
  if (input.length > KNOWLEDGE_JSON_LIMITS.MAX_BYTES) {
    jsonFail('KNOWLEDGE_JSON_RESOURCE_LIMIT', path);
  }
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    jsonFail('KNOWLEDGE_JSON_BOM_FORBIDDEN', path);
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    jsonFail('KNOWLEDGE_JSON_UTF8_INVALID', path);
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
        jsonFail('KNOWLEDGE_JSON_RESOURCE_LIMIT', path);
      }
    } else if ((code === 0x7d || code === 0x5d) && lexicalDepth > 0) {
      lexicalDepth -= 1;
    }
  }

  let index = 0;
  let nodeUnits = 0;
  const syntaxFail = () => jsonFail(syntaxCode, path);
  const unicodeFail = () => jsonFail('KNOWLEDGE_JSON_UNICODE_INVALID', path);
  const resourceFail = () => jsonFail('KNOWLEDGE_JSON_RESOURCE_LIMIT', path);
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
      if (seen.has(key)) jsonFail('KNOWLEDGE_JSON_DUPLICATE_KEY', path + keyPointer);
      if (!allowDangerousKeys && DANGEROUS_JSON_KEYS.has(key)) {
        jsonFail('KNOWLEDGE_JSON_DANGEROUS_KEY', path + keyPointer);
      }
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

const fail = (code) => {
  const error = new TypeError(code);
  error.code = code;
  throw error;
};

export const parseArtifactJson = (bytes, path) => {
  try {
    return parseKnowledgeJson(bytes, path, 'ARTIFACT_JSON_INVALID');
  } catch {
    fail('ARTIFACT_VERIFICATION_FAILED');
  }
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

const safeArrayForEach = function (callback) {
  for (let index = 0; index < this.length; index += 1) {
    callback(this[index], index, this);
  }
};

const createSafeArray = () => {
  const value = [];
  Object.setPrototypeOf(value, null);
  Object.defineProperties(value, {
    toJSON: { value: undefined, enumerable: false },
    forEach: { value: safeArrayForEach, enumerable: false },
  });
  return value;
};

const snapshotArray = (value, active) => {
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

  const snapshot = createSafeArray();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail('IJSON_SPARSE_ARRAY');
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('IJSON_NON_JSON_PROPERTY');
    }
    snapshot[index] = snapshotIJson(descriptor.value, active);
  }
  return snapshot;
};

const snapshotObject = (value, active) => {
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('IJSON_NON_PLAIN_OBJECT');

  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('IJSON_NON_JSON_PROPERTY');
    assertScalarString(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('IJSON_NON_JSON_PROPERTY');
    }
    snapshot[key] = snapshotIJson(descriptor.value, active);
  }
  return snapshot;
};

const snapshotIJson = (value, active) => {
  if (value === null || typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    assertScalarString(value);
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('IJSON_NON_FINITE_NUMBER');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail('IJSON_UNSAFE_INTEGER');
    return value;
  }

  if (typeof value !== 'object') fail('IJSON_NON_JSON_VALUE');
  if (utilTypes.isProxy(value)) fail('IJSON_NON_PLAIN_OBJECT');
  if (active.has(value)) fail('IJSON_CYCLE');

  active.add(value);
  try {
    return Array.isArray(value)
      ? snapshotArray(value, active)
      : snapshotObject(value, active);
  } finally {
    active.delete(value);
  }
};

const safeSnapshot = (value) => snapshotIJson(value, new WeakSet());

export const assertIJson = (value) => {
  safeSnapshot(value);
  return value;
};

const validateNfc = (value) => {
  if (typeof value === 'string') {
    if (value.normalize('NFC') !== value) fail('UNICODE_NOT_NFC');
    return;
  }
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) validateNfc(value[index]);
    return;
  }

  for (const key of Object.keys(value)) {
    if (key.normalize('NFC') !== key) fail('UNICODE_NOT_NFC');
    validateNfc(value[key]);
  }
};

export const assertNfc = (value) => {
  const snapshot = safeSnapshot(value);
  validateNfc(snapshot);
  return value;
};

const shieldCanonicalizerToJsonProbe = (value) => {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = shieldCanonicalizerToJsonProbe(value[index]);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    value[key] = shieldCanonicalizerToJsonProbe(descriptor.value);
  }

  const toJsonDescriptor = Object.getOwnPropertyDescriptor(value, 'toJSON');
  if (!toJsonDescriptor || toJsonDescriptor.value === null) return value;

  // json-canonicalize@2.0.0 bypasses JCS sorting when its initial
  // object.toJSON probe is non-null. Hide only that pinned upstream probe;
  // the later sorted-property read returns the snapshotted JSON data field.
  let hideInitialProbe = true;
  return new Proxy(value, {
    get(target, property, receiver) {
      if (property === 'toJSON' && hideInitialProbe) {
        hideInitialProbe = false;
        return null;
      }
      return Reflect.get(target, property, receiver);
    },
  });
};

export const jcsBytes = (value) => {
  const snapshot = safeSnapshot(value);
  validateNfc(snapshot);
  const canonicalizerInput = shieldCanonicalizerToJsonProbe(snapshot);
  return Buffer.from(canonicalize(canonicalizerInput), 'utf8');
};

export const canonicalSet = (items, keyOf) => {
  assertIJson(items);
  if (!Array.isArray(items)) fail('IJSON_NON_JSON_VALUE');
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
