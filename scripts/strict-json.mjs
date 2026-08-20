import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {canonicalize} from 'json-canonicalize';

export const KNOWLEDGE_JSON_LIMITS = Object.freeze({
  MAX_BYTES: 1_048_576,
  MAX_DEPTH: 128,
  MAX_NODES: 100_000,
  MAX_STRING_UTF8_BYTES: 262_144,
});
function fail(code, detail = '') {
  const error = new Error(detail === '' ? code : `${code}:${detail}`);
  error.code = code;
  throw error;
}
const DANGEROUS_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseKnowledgeJson(bytes, path, syntaxCode, options = {}) {
  const allowDangerousKeys = options?.allowDangerousKeys === true;
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
      if (!allowDangerousKeys && DANGEROUS_JSON_KEYS.has(key)) {
        fail('KNOWLEDGE_JSON_DANGEROUS_KEY', path + keyPointer);
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

export function responseSchemaManifestDigest(manifest){
  return createHash('sha256').update('ux-skill:manifest:v1','utf8').update(canonicalize(manifest),'utf8').digest('hex');
}
