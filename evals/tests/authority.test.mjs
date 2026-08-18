import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateAuthority,derivePartyInventory,solveCandidates} from '../../evaluator/authority.mjs';

const vectorIds=['AUTH-ROOT-001','ACT-DISJOINT-001','TENANT-UNKNOWN-001','PARTY-COMPLETENESS-PROOF-001','SOFT-TIE-001','SOFT-TIE-AUTH-U-001'];
const fixtures=new Map(await Promise.all(vectorIds.map(async(id)=>[id,JSON.parse(await readFile(new URL(`../red/${id}.json`,import.meta.url),'utf8'))])));
const actor=(subject_id)=>({namespace_uri:'https://identity.example',issuer_id:'ux-skill',subject_id,kind:'human'});
const highRiskDelete=({partyProof='verified'}={})=>({action:'delete',resource_type:'admin_account',risk:'high',evaluation_effective_at:'2026-08-18T00:00:00Z',authenticated_principal:actor('admin'),effective_actor:actor('admin'),authority_root_membership:'verified',acting_edges:[],tenant_bindings:{status:'verified',required:['tenant-a'],covered:['tenant-a'],extra_effects:[]},party_graph:{snapshot_status:'closed',refs_closed:true,closure_complete:true,affected_party_ids:['party-a']},party_proof:partyProof==='verified'?{verification_status:'verified',effective_at:'2026-08-17T00:00:00Z',expires_at:'2026-08-19T00:00:00Z'}:null,grant:{status:'active',scope_coverage:'verified',effective_at:'2026-08-17T00:00:00Z',expires_at:'2026-08-19T00:00:00Z',revoked:false},approval:{status:'verified'},capability:{status:'verified'},authority_features:{execution_envelope:'verified',time_authority:'verified',commit_revalidation:'verified'}});
const twoSafeNonDominatedCandidates=()=>({authority_status:'complete',party_inventory_status:'verified_complete',touches_safety_or_rights_floor:false,candidates:[{solution_id:'a',hard_constraints:[{id:'h',result:'T'}],soft_scores:{quality:1,speed:0}},{solution_id:'b',hard_constraints:[{id:'h',result:'T'}],soft_scores:{quality:0,speed:1}}]});

test('unknown party closure escalates a high-risk delete', () => {
  const result = evaluateAuthority(highRiskDelete({partyProof:'unknown'}));
  assert.deepEqual(result, {status:'escalation',reason_code:'PARTY_INVENTORY_UNKNOWN'});
});

test('safe Pareto tie never selects a candidate', () => {
  const result = solveCandidates(twoSafeNonDominatedCandidates());
  assert.equal(result.selection_status, 'undecided');
  assert.equal(result.selected_solution_id, null);
  assert.equal(result.next_action, 'ask_decision_owner');
});

test('derivePartyInventory never trusts a caller-reported inventory',()=>{
 const result=derivePartyInventory({snapshot_status:'closed',refs_closed:true,closure_complete:true,affected_party_ids:['party-a']},null);
 assert.deepEqual(result,{status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_REQUIRED'});
});

test('all six fixed authority vectors are executable and contract-linked',()=>{
 for(const id of vectorIds){
  const vector=fixtures.get(id);
  assert.equal(vector.vector_id,id);
  assert.equal(vector.behavior_version,'0.1.0');
  assert.equal(vector.contract_linkage.design_commit,'f596998c88ca088a0c74160e55d54328f7123a49');
  assert.ok(vector.contract_linkage.design_sections.length>0);
  const actual=vector.operation==='solveCandidates'?solveCandidates(vector.input):evaluateAuthority(vector.input);
  assert.deepEqual(actual,vector.expected,id);
 }
});
