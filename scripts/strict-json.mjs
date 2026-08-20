import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';

export {KNOWLEDGE_JSON_LIMITS,parseKnowledgeJson} from '../evaluator/canonical.mjs';

export const RESPONSE_SCHEMA_MANIFEST_DIGEST='7c66ac79b3f6b820377b8d56eaa2e3a9b383f659e6cc3a54dbcf73a76a9622aa';

export function responseSchemaManifestDigest(manifest){
  return createHash('sha256').update('ux-skill:manifest:v1','utf8').update(canonicalize(manifest),'utf8').digest('hex');
}
