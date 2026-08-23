import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluate} from '../../evaluator/index.mjs';
import {deleteBundle,hulianDeleteBundle} from '../helpers/fixtures.mjs';

const WARNING='Zero findings does not mean UX is good, compliant, successful, or satisfying.';
const currentPolicyDigests=JSON.parse(await readFile(new URL('../golden/high-risk-delete.json',import.meta.url),'utf8')).bundle.policy_digests;
const prepared=(factory)=>{
 const bundle=structuredClone(factory());
 bundle.policy_digests=structuredClone(currentPolicyDigests);
 for(const claim of bundle.claims)claim.relation_kind=claim.claim_kind;
 return bundle;
};

test('implemented delete and Hulian fixtures respect evidence ceilings',async()=>{
 const outputs=[await evaluate(prepared(deleteBundle)),await evaluate(prepared(hulianDeleteBundle))];
 for(const output of outputs){
  const actual=JSON.stringify({assurance:output.assurance,semantic_projection:output.semantic_projection});
  for(const prohibited of ['wcag_conformant','user_success','ux_good'])assert.equal(actual.includes(JSON.stringify(prohibited)),false);
  assert.equal(output.assurance.release_status,'no_release');
  assert.equal(output.assurance.warning,WARNING);
 }
});
