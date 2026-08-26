import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';

export {KNOWLEDGE_JSON_LIMITS,parseKnowledgeJson} from '../evaluator/canonical.mjs';

export const RESPONSE_SCHEMA_MANIFEST_DIGEST='87897057a4305f592ec8a5d54ef1f8763805e40b6e4b516e6a560c30770cc075';

export function responseSchemaManifestDigest(manifest){
  return createHash('sha256').update('ux-skill:manifest:v1','utf8').update(canonicalize(manifest),'utf8').digest('hex');
}
