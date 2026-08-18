import { createHash } from 'node:crypto';
import { assertIJson, assertNfc, jcsBytes } from './canonical.mjs';

const fail = (code) => {
  const error = new TypeError(code);
  error.code = code;
  throw error;
};

export const digest = (domain, preimage) => {
  if (typeof domain !== 'string') fail('DIGEST_DOMAIN_INVALID');
  assertIJson(domain);
  assertNfc(domain);
  if (!(preimage instanceof Uint8Array)) fail('DIGEST_BYTES_REQUIRED');

  return createHash('sha256')
    .update(Buffer.from(domain, 'utf8'))
    .update(preimage)
    .digest('hex');
};

export const digestJcs = (domain, value) => digest(domain, jcsBytes(value));
