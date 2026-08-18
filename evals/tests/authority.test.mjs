import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canonicalSet,jcsBytes} from '../../evaluator/canonical.mjs';
import {evaluateAuthority,derivePartyInventory,solveCandidates} from '../../evaluator/authority.mjs';

const vectorIds=['AUTH-ROOT-001','ACT-DISJOINT-001','TENANT-UNKNOWN-001','PARTY-COMPLETENESS-PROOF-001','SOFT-TIE-001','SOFT-TIE-AUTH-U-001'];
const fixtures=new Map(await Promise.all(vectorIds.map(async(id)=>[id,JSON.parse(await readFile(new URL(`../red/${id}.json`,import.meta.url),'utf8'))])));
const registries=JSON.parse(await readFile(new URL('../../knowledge/registries.json',import.meta.url),'utf8'));
const policies=JSON.parse(await readFile(new URL('../../knowledge/decision-policies.json',import.meta.url),'utf8'));
const provenanceSignatureGolden=JSON.parse(await readFile(new URL('../golden/evaluator-gate-signatures.json',import.meta.url),'utf8'));
const actor=(subject_id,namespace_uri='https://identity.example')=>({namespace_uri,issuer_id:'ux-skill',subject_id,kind:'human'});
const verifiedProof=()=>({proof_id:'proof-1',effect_scope_digest:'e'.repeat(64),resource_scope_digest:'d'.repeat(64),data_source_ids:['directory'],snapshot_digest:'c'.repeat(64),snapshot_version:'v1',verification_status:'verified',effective_at:'2026-08-17T00:00:00Z',expires_at:'2026-08-19T00:00:00Z',closure_algorithm_id:'party-closure',closure_algorithm_version:'1'});
const boundGraph=(affected_party_ids)=>({snapshot_status:'closed',refs_closed:true,closure_complete:true,affected_party_ids,effect_scope_digest:'e'.repeat(64),resource_scope_digest:'d'.repeat(64),data_source_ids:['directory'],snapshot_digest:'c'.repeat(64),snapshot_version:'v1',closure_algorithm_id:'party-closure',closure_algorithm_version:'1'});
const highRiskDelete=({partyProof='verified'}={})=>({action:'delete',resource_type:'admin_account',risk:'high',authorization_purpose:'account_deletion',evaluation_effective_at:'2026-08-18T00:00:00Z',tenant_ids:['tenant-a'],tenant_join_proof_id:'ux-skill-tenant-a-admin-delete-v1',authenticated_principal:actor('admin'),effective_actor:actor('admin'),authority_root_id:'ux-skill-local-admin-root-v1',authority_root_membership:'verified',acting_edges:[],tenant_bindings:{status:'verified',required:['target','controller'],covered:['target','controller'],extra_effects:[]},party_graph:boundGraph(['party-a']),party_proof:partyProof==='verified'?verifiedProof():null,grant:{status:'active',scope_coverage:'verified',effective_at:'2026-08-17T00:00:00Z',expires_at:'2026-08-19T00:00:00Z',revoked:false},approval:{status:'verified'},capability:{status:'verified',ledger_status:'unused'},authority_features:{execution_envelope:'verified',time_authority:'verified',commit_revalidation:'verified'}});
const twoSafeNonDominatedCandidates=()=>completeUniverse([{solution_id:'a',hard_constraints:[{id:'h',result:'T'}],soft_dimensions:[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:1,floor_result:'T'},{party_or_cohort_id:'party-a',criterion:'speed',tier:0,value:0,floor_result:'T'}]},{solution_id:'b',hard_constraints:[{id:'h',result:'T'}],soft_dimensions:[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:0,floor_result:'T'},{party_or_cohort_id:'party-a',criterion:'speed',tier:0,value:1,floor_result:'T'}]}]);
const clone=(value)=>structuredClone(value);

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

test('derivePartyInventory requires verified, current, closed proof instead of caller assertions',()=>{
 assert.deepEqual(derivePartyInventory({snapshot_status:'closed',refs_closed:true,closure_complete:true,affected_party_ids:['party-a'],status:'verified_complete'},null),{status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_REQUIRED'});
 assert.deepEqual(derivePartyInventory(boundGraph(['b','a','a']),verifiedProof(),'2026-08-18T00:00:00Z'),{status:'verified_complete',party_ids:['a','b']});
 assert.deepEqual(derivePartyInventory(boundGraph([]),verifiedProof(),'2026-08-18T00:00:00Z'),{status:'verified_no_affected_party',party_ids:[]});
 for(const [graph,proof,reason] of [[{snapshot_status:'closed',refs_closed:false,closure_complete:true,affected_party_ids:[]},verifiedProof(),'PARTY_GRAPH_INCOMPLETE'],[{snapshot_status:'closed',refs_closed:true,closure_complete:true,affected_party_ids:[]},{...verifiedProof(),expires_at:'2026-08-18T00:00:00Z'},'PARTY_COMPLETENESS_PROOF_EXPIRED'],[{snapshot_status:'closed',refs_closed:true,closure_complete:true,affected_party_ids:[]},{...verifiedProof(),verification_status:'rejected'},'PARTY_COMPLETENESS_PROOF_INVALID']]) assert.equal(derivePartyInventory(graph,proof,'2026-08-18T00:00:00Z').reason_code,reason);
});

test('all six fixed authority vectors are executable and contract-linked',()=>{
 for(const id of vectorIds){
  const vector=fixtures.get(id);
  assert.equal(vector.vector_id,id);
  assert.equal(vector.behavior_version,'0.1.0');
  assert.equal(vector.contract_linkage.design_commit,'f596998c88ca088a0c74160e55d54328f7123a49');
  assert.ok(vector.contract_linkage.design_sections.length>0);
  const actual=vector.operation==='solveCandidates'?solveCandidates(withGateBinding(vector.input)):evaluateAuthority(vector.input);
  assert.deepEqual(actual,vector.expected,id);
 }
});

test('closed registries and policies are the runtime authority tables',()=>{
 assert.equal(registries.registry_version,'authority-registries-v1');
 assert.deepEqual(registries.authority_root_registry.map((row)=>row.authority_root_id),['ux-skill-expired-admin-root-v1','ux-skill-local-admin-root-v1','ux-skill-revoked-admin-root-v1']);
 assert.deepEqual(registries.action_policy_registry[0].required_tenant_relationships,['target','controller']);
 assert.deepEqual(policies.hard_constraint_result_table,{E:'evaluation_error',F:'infeasible',T:'feasible',U:'indeterminate'});
 assert.deepEqual(policies.authority_decision_statuses,['block','continue','escalation','invalid_input']);
});

test('trusted-root membership is checked against the closed registry and never defaulted',()=>{
 assert.deepEqual(evaluateAuthority(highRiskDelete()),{status:'escalation',reason_code:'GRANT_VALIDITY_UNKNOWN',coverage_gap_id:'grant-contract-v1'});
 const absent=highRiskDelete(); absent.authority_root_id='unregistered-root';
 assert.deepEqual(evaluateAuthority(absent),{status:'block',reason_code:'AUTHORITY_ROOT_UNTRUSTED'});
 const unknown=highRiskDelete(); delete unknown.authority_root_id; delete unknown.authority_root_membership;
 assert.deepEqual(evaluateAuthority(unknown),{status:'escalation',reason_code:'AUTHORITY_ROOT_UNKNOWN',coverage_gap_id:'authority-root-proof-v1'});
});

test('acting chains require exact byte-equal continuity and verified edges',()=>{
 const value=highRiskDelete(); value.authenticated_principal=actor('a'); value.effective_actor=actor('c'); value.acting_edges=[{from:actor('a'),to:actor('b'),validity:'verified'},{from:actor('b'),to:actor('c'),validity:'verified'}];
 assert.deepEqual(evaluateAuthority(value),{status:'escalation',reason_code:'ACTING_EDGE_UNKNOWN',coverage_gap_id:'acting-edge-proof-v1'});
 const disjoint=clone(value); disjoint.acting_edges[1].from=actor('b','https://other.example');
 assert.deepEqual(evaluateAuthority(disjoint),{status:'block',reason_code:'ACTING_CHAIN_DISJOINT'});
 const rejected=clone(value); rejected.acting_edges[0].validity='rejected';
 assert.deepEqual(evaluateAuthority(rejected),{status:'block',reason_code:'ACTING_EDGE_INVALID'});
 const unknown=clone(value); unknown.acting_edges[0].validity='unknown';
 assert.deepEqual(evaluateAuthority(unknown),{status:'escalation',reason_code:'ACTING_EDGE_UNKNOWN'});
});

test('tenant coverage derives only from the closed proof registry',()=>{
 const absent=highRiskDelete(); delete absent.tenant_join_proof_id;
 assert.deepEqual(evaluateAuthority(absent),{status:'escalation',reason_code:'TENANT_COVERAGE_UNKNOWN',coverage_gap_id:'tenant-join-proof-v1'});
 const unknown=highRiskDelete(); unknown.tenant_join_proof_id='unknown-proof';
 assert.deepEqual(evaluateAuthority(unknown),{status:'escalation',reason_code:'TENANT_COVERAGE_UNKNOWN',coverage_gap_id:'tenant-join-proof-v1'});
 const asserted=highRiskDelete(); asserted.tenant_bindings={status:'verified',required:[],covered:['unregistered'],extra_effects:['tenant-b']};
 assert.deepEqual(evaluateAuthority(asserted),{status:'escalation',reason_code:'GRANT_VALIDITY_UNKNOWN',coverage_gap_id:'grant-contract-v1'});
});

test('grant validity blocks false prerequisites and escalates unknown prerequisites',()=>{
 const revoked=highRiskDelete(); revoked.grant.revoked=true;
 assert.deepEqual(evaluateAuthority(revoked),{status:'block',reason_code:'GRANT_REVOKED'});
 const expired=highRiskDelete(); expired.grant.expires_at='2026-08-18T00:00:00Z';
 assert.deepEqual(evaluateAuthority(expired),{status:'block',reason_code:'GRANT_EXPIRED'});
 const scope=highRiskDelete(); scope.grant.scope_coverage='rejected';
 assert.deepEqual(evaluateAuthority(scope),{status:'block',reason_code:'GRANT_SCOPE_NOT_COVERED'});
 const unknown=highRiskDelete(); unknown.grant.status='unknown';
 assert.deepEqual(evaluateAuthority(unknown),{status:'escalation',reason_code:'GRANT_VALIDITY_UNKNOWN'});
 const absent=highRiskDelete(); delete absent.grant;
 assert.deepEqual(evaluateAuthority(absent),{status:'escalation',reason_code:'GRANT_VALIDITY_UNKNOWN',coverage_gap_id:'grant-chain-proof-v1'});
});

test('approval, capability, and Task 3 authority prerequisites fail closed',()=>{
 const approval=highRiskDelete(); approval.approval.status='rejected';
 assert.deepEqual(evaluateAuthority(approval),{status:'block',reason_code:'APPROVAL_PREREQUISITE_FAILED'});
 const approvalUnknown=highRiskDelete(); approvalUnknown.approval.status='unknown';
 assert.deepEqual(evaluateAuthority(approvalUnknown),{status:'escalation',reason_code:'APPROVAL_PREREQUISITE_UNKNOWN'});
 const capability=highRiskDelete(); capability.capability.status='rejected';
 assert.deepEqual(evaluateAuthority(capability),{status:'block',reason_code:'CAPABILITY_INVALID'});
 const ledger=highRiskDelete(); ledger.capability.ledger_status='unavailable';
 assert.deepEqual(evaluateAuthority(ledger),{status:'escalation',reason_code:'CAPABILITY_LEDGER_UNAVAILABLE'});
 const missingFeature=highRiskDelete(); delete missingFeature.authority_features.time_authority;
 assert.deepEqual(evaluateAuthority(missingFeature),{status:'escalation',reason_code:'AUTHORITY_COVERAGE_GAP',coverage_gap_id:'time-authority-commit-v1'});
});

test('hard solver follows E then U then feasible then zero-feasible priority',()=>{
 const candidate=(solution_id,result,conflict_class='ordinary')=>({solution_id,hard_constraints:[{id:`h-${solution_id}`,result,conflict_class}],soft_dimensions:[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:1,floor_result:'T'}]});
 assert.deepEqual(solveCandidates(completeUniverse([candidate('a','E')])),{selection_status:'evaluation_error',selected_solution_id:null,feasible_solution_ids:[],next_action:'fix_evaluation_error',release_recommendation:'escalation',reason_code:'HARD_CONSTRAINT_EVALUATION_ERROR'});
 assert.deepEqual(solveCandidates(completeUniverse([candidate('a','T'),candidate('b','U')])),{selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:['a'],next_action:'escalate_hard_constraint',release_recommendation:'escalation',reason_code:'HARD_CONSTRAINT_UNKNOWN'});
 const ordinary=solveCandidates(completeUniverse([candidate('a','F')]));
 assert.equal(ordinary.release_recommendation,'block'); assert.deepEqual(ordinary.unsat_cores,[['h-a']]);
 const rights=solveCandidates(completeUniverse([candidate('a','F','rights')]));
 assert.equal(rights.release_recommendation,'escalation'); assert.equal(rights.reason_code,'HARD_CONSTRAINT_HIGH_RISK_UNSAT');
 assert.equal(solveCandidates(completeUniverse([candidate('b','F'),candidate('a','T')])).selected_solution_id,'a');
});

test('soft ties escalate when authority, party closure, or a safety floor is incomplete',()=>{
 for(const patch of [{authority_status:'unknown'},{party_inventory_status:'unknown'},{safety_or_rights_floor_status:'triggered'}]){
  const result=solveCandidates(completeUniverse(twoSafeNonDominatedCandidates().candidate_evaluations.map((row)=>({solution_id:row.solution_id,hard_constraints:row.hard_constraints.map((item)=>({id:item.constraint_id,result:item.result,conflict_class:item.conflict_class})),soft_dimensions:row.soft_dimensions})),patch));
  assert.equal(result.selection_status,'undecided'); assert.equal(result.selected_solution_id,null); assert.equal(result.release_recommendation,'escalation');
 }
});

test('candidate and score ordering are deterministic',()=>{
 const firstBase=twoSafeNonDominatedCandidates();
 delete firstBase.evaluator_gate_binding;
 for(const candidate of firstBase.candidate_universe)candidate.option_ids=[candidate.solution_id+'-option-1',candidate.solution_id+'-option-2'];
 for(const candidate of firstBase.candidate_evaluations)candidate.hard_constraints.push({constraint_id:'h-secondary',result:'T',conflict_class:'ordinary'});
 const first=withGateBinding(firstBase);
 const second=clone(first);
 second.candidate_universe.reverse();
 second.candidate_evaluations.reverse();
 for(const candidate of second.candidate_universe)candidate.option_ids.reverse();
 for(const candidate of second.candidate_evaluations){candidate.hard_constraints.reverse();candidate.soft_dimensions.reverse();}
 assert.deepEqual(solveCandidates(first),solveCandidates(second));
});

test('authority and candidate APIs reject malformed input without authorizing',()=>{
 for(const value of [null,{}, {action:'delete',resource_type:'admin_account',risk:'high',authority_root_membership:'verified',acting_edges:'not-an-array'}]) assert.deepEqual(evaluateAuthority(value),{status:'invalid_input',reason_code:'AUTHORITY_INPUT_INVALID'});
 assert.deepEqual(solveCandidates({candidates:[]}),{selection_status:'invalid_input',selected_solution_id:null,feasible_solution_ids:[],next_action:'fix_input',release_recommendation:'escalation',reason_code:'CANDIDATE_INPUT_INVALID'});
});


test("closed root and policy lookup cannot be bypassed by caller assertions",()=>{
 const missing=highRiskDelete(); delete missing.authority_root_id;
 assert.deepEqual(evaluateAuthority(missing),{status:"escalation",reason_code:"AUTHORITY_ROOT_UNKNOWN",coverage_gap_id:"authority-root-proof-v1"});
 const unknown=highRiskDelete(); unknown.authority_root_id="unknown-root";
 assert.deepEqual(evaluateAuthority(unknown),{status:"block",reason_code:"AUTHORITY_ROOT_UNTRUSTED"});
 const expired=highRiskDelete(); expired.authority_root_id="ux-skill-expired-admin-root-v1";
 assert.deepEqual(evaluateAuthority(expired),{status:"block",reason_code:"AUTHORITY_ROOT_EXPIRED"});
 const revoked=highRiskDelete(); revoked.authority_root_id="ux-skill-revoked-admin-root-v1";
 assert.deepEqual(evaluateAuthority(revoked),{status:"block",reason_code:"AUTHORITY_ROOT_REVOKED"});
 const purpose=highRiskDelete(); purpose.authorization_purpose="bulk-marketing";
 assert.deepEqual(evaluateAuthority(purpose),{status:"block",reason_code:"AUTHORITY_ROOT_SCOPE_NOT_COVERED"});
 const risk=highRiskDelete(); risk.risk="unregistered-risk";
 assert.deepEqual(evaluateAuthority(risk),{status:"escalation",reason_code:"AUTHORITY_COVERAGE_GAP",coverage_gap_id:"action-resource-purpose-risk-policy-v1"});
});

test("acting chains reject self-support cycles repeated nodes and incomplete Task 3 edges",()=>{
 const self=highRiskDelete(); self.authenticated_principal=actor("a"); self.effective_actor=actor("a"); self.acting_edges=[{from:actor("a"),to:actor("a"),validity:"verified"}];
 assert.deepEqual(evaluateAuthority(self),{status:"block",reason_code:"ACTING_CHAIN_CYCLE"});
 const cycle=highRiskDelete(); cycle.authenticated_principal=actor("a"); cycle.effective_actor=actor("a"); cycle.acting_edges=[{from:actor("a"),to:actor("b"),validity:"verified"},{from:actor("b"),to:actor("a"),validity:"verified"}];
 assert.deepEqual(evaluateAuthority(cycle),{status:"block",reason_code:"ACTING_CHAIN_CYCLE"});
 const repeated=highRiskDelete(); repeated.authenticated_principal=actor("a"); repeated.effective_actor=actor("b"); repeated.acting_edges=[{from:actor("a"),to:actor("b"),validity:"verified"},{from:actor("b"),to:actor("c"),validity:"verified"},{from:actor("c"),to:actor("b"),validity:"verified"}];
 assert.deepEqual(evaluateAuthority(repeated),{status:"block",reason_code:"ACTING_CHAIN_CYCLE"});
 const incomplete=highRiskDelete(); incomplete.authenticated_principal=actor("a"); incomplete.effective_actor=actor("b"); incomplete.acting_edges=[{from:actor("a"),to:actor("b"),validity:"verified"}];
 assert.deepEqual(evaluateAuthority(incomplete),{status:"escalation",reason_code:"ACTING_EDGE_UNKNOWN",coverage_gap_id:"acting-edge-proof-v1"});
});

test("tenant all-join cannot be synthesized by exact empty or superset caller arrays",()=>{
 for(const tenant_bindings of [{status:"verified",required:[],covered:[],extra_effects:[]},{status:"verified",required:["target","controller"],covered:["target","controller","unregistered"],extra_effects:[]}]){
  const value=highRiskDelete(); delete value.tenant_join_proof_id; value.tenant_bindings=tenant_bindings;
  assert.deepEqual(evaluateAuthority(value),{status:"escalation",reason_code:"TENANT_COVERAGE_UNKNOWN",coverage_gap_id:"tenant-join-proof-v1"});
 }
});

test("caller verified strings and abbreviated authority objects never authorize deletion",()=>{
 assert.deepEqual(evaluateAuthority(highRiskDelete()),{status:"escalation",reason_code:"GRANT_VALIDITY_UNKNOWN",coverage_gap_id:"grant-contract-v1"});
});

test("party completeness proof is bound to effect resource source snapshot and algorithm",()=>{
 assert.deepEqual(derivePartyInventory(boundGraph(["b","a","a"]),verifiedProof(),"2026-08-18T00:00:00Z"),{status:"verified_complete",party_ids:["a","b"]});
 for(const field of ["effect_scope_digest","resource_scope_digest","snapshot_digest","snapshot_version","closure_algorithm_id","closure_algorithm_version"]){
  const proof=verifiedProof(); proof[field]=field.endsWith("digest")?"f".repeat(64):"other";
  assert.equal(derivePartyInventory(boundGraph(["a"]),proof,"2026-08-18T00:00:00Z").status,"unknown",field);
 }
 const sources=verifiedProof(); sources.data_source_ids=["other"];
 assert.equal(derivePartyInventory(boundGraph(["a"]),sources,"2026-08-18T00:00:00Z").status,"unknown");
 const bare={verification_status:"verified",effective_at:"2026-08-17T00:00:00Z",expires_at:"2026-08-19T00:00:00Z"};
 assert.deepEqual(derivePartyInventory(boundGraph(["a"]),bare,"2026-08-18T00:00:00Z"),{status:"unknown",party_ids:[],reason_code:"PARTY_COMPLETENESS_PROOF_INVALID"});
});

test("acting edge scope time and caller verified proof are fail closed",()=>{
 const scope={actions:["delete"],resource_types:["admin_account"],tenant_ids:["tenant-a"],purposes:["account_deletion"]};
 const edge=(from,to)=>({edge_id:`${from.subject_id}-${to.subject_id}`,sequence:0,from,to,basis_ref:"grant-1",scope,effective_at:"2026-08-17T00:00:00Z",expires_at:"2026-08-19T00:00:00Z",version:"1",validity:"verified"});
 const unsupported=highRiskDelete(); unsupported.authenticated_principal=actor("a"); unsupported.effective_actor=actor("b"); unsupported.acting_edges=[edge(actor("a"),actor("b"))];
 assert.deepEqual(evaluateAuthority(unsupported),{status:"escalation",reason_code:"ACTING_EDGE_UNKNOWN",coverage_gap_id:"acting-edge-proof-v1"});
 const expired=clone(unsupported); expired.acting_edges[0].expires_at="2026-08-18T00:00:00Z";
 assert.deepEqual(evaluateAuthority(expired),{status:"block",reason_code:"ACTING_EDGE_EXPIRED"});
 const scopeMiss=clone(unsupported); scopeMiss.acting_edges[0].scope.actions=[];
 assert.deepEqual(evaluateAuthority(scopeMiss),{status:"block",reason_code:"ACTING_SCOPE_NOT_COVERED"});
});

const dimension=(party_or_cohort_id,criterion,tier,value,floor_result="T")=>({party_or_cohort_id,criterion,tier,value,floor_result});
const solution=(solution_id,soft_dimensions,hard_constraints=[{id:"hard",result:"T"}])=>({solution_id,hard_constraints,soft_dimensions});
const gateDigest=(domain,value)=>createHash("sha256").update(domain,"utf8").update(jcsBytes(value)).digest("hex");
const canonicalGateCandidateUniverse=(candidateUniverse)=>canonicalSet(candidateUniverse.map((solution)=>({...solution,option_ids:canonicalSet(solution.option_ids,(optionId)=>optionId)})),(solution)=>solution.solution_id);
const canonicalGateCandidateEvaluations=(candidateEvaluations)=>canonicalSet(candidateEvaluations.map((evaluation)=>({...evaluation,hard_constraints:canonicalSet(evaluation.hard_constraints,(row)=>row.constraint_id),soft_dimensions:canonicalSet(evaluation.soft_dimensions,(row)=>[row.party_or_cohort_id,row.criterion])})),(evaluation)=>evaluation.solution_id);

const withGateBinding=(input,statuses={})=>{
 const authority_status=statuses.authority_status??input.authority_status;
 const party_inventory_status=statuses.party_inventory_status??input.party_inventory_status;
 const safety_or_rights_floor_status=statuses.safety_or_rights_floor_status??input.safety_or_rights_floor_status;
 const evaluation_effective_at="2026-08-18T00:00:00Z",policy_version="solver-gate-policy-v1";
 const candidateUniverse=canonicalGateCandidateUniverse(input.candidate_universe);
 const candidateEvaluations=canonicalGateCandidateEvaluations(input.candidate_evaluations);
 const candidate_universe_digest=gateDigest("ux-skill:candidate-universe:v1",candidateUniverse);
 const candidate_evaluations_digest=gateDigest("ux-skill:candidate-evaluations:v1",candidateEvaluations);
 const authorityBody={authorization_decision_id:"solver-authority-decision-v1",status:authority_status,candidate_universe_digest,evaluation_effective_at,policy_version,proof_trace_digest:gateDigest("ux-skill:authority-proof-trace:v1",[candidate_universe_digest,evaluation_effective_at,policy_version])};
 const proofBody={proof_id:"solver-party-completeness-v1",effect_scope_digest:"e".repeat(64),resource_scope_digest:"d".repeat(64),data_source_ids:["directory"],snapshot_digest:"c".repeat(64),snapshot_version:"v1",effective_at:"2026-08-17T00:00:00Z",expires_at:"2026-08-19T00:00:00Z",closure_algorithm_id:"party-closure",closure_algorithm_version:"1",verification_status:party_inventory_status==="unknown"?"unknown":"verified"};
 const completeness_proof={...proofBody,completeness_proof_digest:gateDigest("ux-skill:party-completeness-proof:v1",proofBody)};
 const partyBody={party_inventory_id:"solver-party-inventory-v1",status:party_inventory_status,party_ids:party_inventory_status==="verified_no_affected_party"?[]:["party-a"],candidate_universe_digest,evaluation_effective_at,policy_version,completeness_proof_digest:completeness_proof.completeness_proof_digest};
 const floorBody={assessment_id:"solver-floor-assessment-v1",status:safety_or_rights_floor_status,candidate_universe_digest,candidate_evaluations_digest,evaluation_effective_at,policy_version};
 const signedBody={binding_version:"EvaluatorGateBindingV1",issuer_id:"ux-skill-fixture-evaluator-v1",key_version:"1",algorithm:"Ed25519",evaluation_effective_at,policy_version,candidate_universe_digest,candidate_evaluations_digest,authority_decision:{...authorityBody,authority_decision_digest:gateDigest("ux-skill:authority-decision:v1",authorityBody)},party_inventory:{...partyBody,party_inventory_digest:gateDigest("ux-skill:party-inventory:v1",partyBody),completeness_proof},safety_or_rights_floor_assessment:{...floorBody,assessment_digest:gateDigest("ux-skill:safety-rights-floor-assessment:v1",floorBody)}};
 const bodyDigest=createHash("sha256").update(jcsBytes(signedBody)).digest("hex");
 const signature_base64=provenanceSignatureGolden.signature_by_body_digest[bodyDigest];
 if(typeof signature_base64!=="string")throw new Error("PROVENANCE_SIGNATURE_GOLDEN_MISSING:"+bodyDigest);
 return {...input,evaluator_gate_binding:{...signedBody,signature_base64}};
};
const completeUniverse=(candidates,statuses={})=>withGateBinding({authority_status:"complete",party_inventory_status:"verified_complete",safety_or_rights_floor_status:"resolved",candidate_universe:candidates.map((candidate)=>({solution_id:candidate.solution_id,option_ids:[]})),candidate_evaluations:candidates.map((candidate)=>({solution_id:candidate.solution_id,hard_constraints:candidate.hard_constraints.map((row)=>({constraint_id:row.id,result:row.result,conflict_class:row.conflict_class??"ordinary"})),soft_dimensions:candidate.soft_dimensions}))},statuses);

test("unsat cores are unique inclusion-minimal canonical sets",()=>{
 const candidates=[
  solution("a",[],[{id:"same",result:"F",conflict_class:"ordinary"}]),
  solution("b",[],[{id:"same",result:"F",conflict_class:"ordinary"}]),
  solution("c",[],[{id:"same",result:"F",conflict_class:"ordinary"},{id:"larger",result:"F",conflict_class:"ordinary"}])
 ];
 assert.deepEqual(solveCandidates(completeUniverse(candidates)).unsat_cores,[["same"]]);
});

test("soft safety and rights floors run before preference selection",()=>{
 const result=solveCandidates(completeUniverse([
  solution("unsafe",[dimension("party-a","safety",0,100,"F")]),
  solution("safe",[dimension("party-a","safety",0,0,"T")])
 ]));
 assert.equal(result.selection_status,"selected");
 assert.equal(result.selected_solution_id,"safe");
 const unknown=solveCandidates(completeUniverse([solution("u",[dimension("cohort-a","rights",0,1,"U")])]));
 assert.equal(unknown.selection_status,"undecided");
 assert.equal(unknown.release_recommendation,"escalation");
});

test("lexicographic tiers dominate lower tiers before Pareto comparison",()=>{
 const result=solveCandidates(completeUniverse([
  solution("tier-zero-winner",[dimension("party-a","quality",0,2),dimension("party-a","speed",1,0)]),
  solution("lower-tier-winner",[dimension("party-a","quality",0,1),dimension("party-a","speed",1,100)])
 ]));
 assert.equal(result.selection_status,"selected");
 assert.equal(result.selected_solution_id,"tier-zero-winner");
});

test("Pareto comparison is party and cohort keyed with no cross-party aggregation",()=>{
 const result=solveCandidates(completeUniverse([
  solution("a",[dimension("party-a","quality",0,2),dimension("party-b","quality",0,0),dimension("cohort-x","access",0,1)]),
  solution("b",[dimension("party-a","quality",0,0),dimension("party-b","quality",0,2),dimension("cohort-x","access",0,1)])
 ]));
 assert.equal(result.selection_status,"undecided");
 assert.equal(result.selected_solution_id,null);
 assert.equal(result.next_action,"ask_decision_owner");
});

test("multiple nondominated candidates never select and incomplete authority escalates",()=>{
 const candidates=[solution("a",[dimension("party-a","quality",0,1),dimension("party-a","speed",0,0)]),solution("b",[dimension("party-a","quality",0,0),dimension("party-a","speed",0,1)])];
 const safe=solveCandidates(completeUniverse(candidates));
 assert.equal(safe.selection_status,"undecided"); assert.equal(safe.selected_solution_id,null); assert.equal(safe.release_recommendation,"undecided");
 const incomplete=solveCandidates(completeUniverse(candidates,{authority_status:"unknown"}));
 assert.equal(incomplete.selection_status,"undecided"); assert.equal(incomplete.selected_solution_id,null); assert.equal(incomplete.release_recommendation,"escalation");
});

test("candidate and core order use unsigned UTF8 JCS bytes",()=>{
 const tie=solveCandidates(completeUniverse([solution("😀",[dimension("party-a","quality",0,1)]),solution("",[dimension("party-a","quality",0,1)])]));
 assert.deepEqual(tie.feasible_solution_ids,["","😀"]);
 const unsat=solveCandidates(completeUniverse([
  solution("x",[],[{id:"😀",result:"F",conflict_class:"ordinary"},{id:"",result:"F",conflict_class:"ordinary"}])
 ]));
 assert.deepEqual(unsat.unsat_cores,[[""],["😀"]]);
});

const fullContractDelete=()=>{
 const value=highRiskDelete();
 const scope={actions:["delete"],resource_types:["admin_account"],tenant_ids:["tenant-a"],purposes:["account_deletion"]};
 const envelopeDigest="a".repeat(64),capabilityDigest="b".repeat(64);
 value.grant={grant_id:"grant-1",issuer:actor("authority-root"),subject:actor("admin"),parent_grant_id:null,scope,effective_at:"2026-08-17T00:00:00Z",expires_at:"2026-08-19T00:00:00Z",status:"active",delegable:false,remaining_depth:0,epoch:1,version:"1",proof_digest:"f".repeat(64)};
 value.execution_envelope={envelope_digest:envelopeDigest};
 value.approval={approval_decision_id:"approval-1",sequence:1,approver_context_digest:"c".repeat(64),approver_authority_ref:"approver-grant",envelope_digest:envelopeDigest,decision:"approved",effective_at:"2026-08-17T00:00:00Z",expires_at:"2026-08-19T00:00:00Z",consumed:false};
 value.capability={capability_id:"cap-1",capability_digest:capabilityDigest,body:{run_id:"run-1",step_id:"step-1",acting_chain_digest:"d".repeat(64),session_id:"session-1",channel:"admin",audience:"operator",tenant_set_digest:"e".repeat(64),resource_versions:[{resource_id:"admin-1",version:"1"}],authorization_purpose:"account_deletion",envelope_digest:envelopeDigest,nonce:"nonce-1",expires_at:"2026-08-19T00:00:00Z",issuer_id:"ux-skill",key_version:"1",capability_use:"execute"},authenticator:"not-executable",ledger_ref:"ledger-1"};
 value.capability_ledger_entry={capability_digest:capabilityDigest,status:"unused",consumed_at:null,consumption_effect_digest:null};
 return value;
};

test("grant approval capability and envelope bindings each fail closed in isolation",()=>{
 const full=fullContractDelete();
 assert.deepEqual(evaluateAuthority(full),{status:"escalation",reason_code:"GRANT_VALIDITY_UNKNOWN",coverage_gap_id:"grant-chain-verification-v1"});
 const grant=fullContractDelete(); grant.grant={status:"active",scope_coverage:"verified",effective_at:"2026-08-17T00:00:00Z",expires_at:"2026-08-19T00:00:00Z"};
 assert.deepEqual(evaluateAuthority(grant),{status:"escalation",reason_code:"GRANT_VALIDITY_UNKNOWN",coverage_gap_id:"grant-contract-v1"});
 const approval=fullContractDelete(); approval.approval={status:"verified"};
 assert.deepEqual(evaluateAuthority(approval),{status:"escalation",reason_code:"APPROVAL_PREREQUISITE_UNKNOWN",coverage_gap_id:"approval-envelope-binding-v1"});
 const approvalUnbound=fullContractDelete(); approvalUnbound.approval.envelope_digest="0".repeat(64);
 assert.deepEqual(evaluateAuthority(approvalUnbound),{status:"escalation",reason_code:"APPROVAL_PREREQUISITE_UNKNOWN",coverage_gap_id:"approval-envelope-binding-v1"});
 const capability=fullContractDelete(); capability.capability={status:"verified",ledger_status:"unused"};
 assert.deepEqual(evaluateAuthority(capability),{status:"escalation",reason_code:"CAPABILITY_UNKNOWN",coverage_gap_id:"capability-contract-v1"});
 const capabilityUnbound=fullContractDelete(); capabilityUnbound.capability.body.envelope_digest="0".repeat(64);
 assert.deepEqual(evaluateAuthority(capabilityUnbound),{status:"escalation",reason_code:"CAPABILITY_UNKNOWN",coverage_gap_id:"capability-envelope-binding-v1"});
 const party=fullContractDelete(); party.party_proof={verification_status:"verified",effective_at:"2026-08-17T00:00:00Z",expires_at:"2026-08-19T00:00:00Z"};
 assert.deepEqual(evaluateAuthority(party),{status:"escalation",reason_code:"PARTY_INVENTORY_UNKNOWN"});
});

const closedSolverInput=({candidate_universe,candidate_evaluations,authority_status,party_inventory_status,safety_or_rights_floor_status})=>({candidate_universe,candidate_evaluations,authority_status,party_inventory_status,safety_or_rights_floor_status});
const closedSolution=(solution_id,option_ids,hard_constraints,soft_dimensions)=>({solution:{solution_id,option_ids},evaluation:{solution_id,hard_constraints,soft_dimensions}});

test('TASK4_RED_SOLVER_CLOSED_CONTRACT schema-aligned CandidateUniverse and matrices are one production input',()=>{
 const only=closedSolution('only',['option-safe'],[{constraint_id:'h',result:'T',conflict_class:'ordinary'}],[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:1,floor_result:'T'}]);
 const input=closedSolverInput({candidate_universe:[only.solution],candidate_evaluations:[only.evaluation],authority_status:'complete',party_inventory_status:'verified_complete',safety_or_rights_floor_status:'resolved'});
 assert.deepEqual(solveCandidates(input),{selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:['only'],next_action:'bind_evaluator_gate',release_recommendation:'escalation',reason_code:'SOLVER_GATE_EVIDENCE_REQUIRED'},'TASK4_RED_SOLVER_CLOSED_CONTRACT');
});

test('TASK4_RED_AUTHORITY_PRECEDENCE gates every unique and dominant selection path',()=>{
 const a=closedSolution('a',['option-a'],[{constraint_id:'h',result:'T',conflict_class:'ordinary'}],[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:10,floor_result:'T'}]);
 const b=closedSolution('b',['option-b'],[{constraint_id:'h',result:'T',conflict_class:'ordinary'}],[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:0,floor_result:'T'}]);
 const uniqueBase={candidate_universe:[a.solution],candidate_evaluations:[a.evaluation],authority_status:'complete',party_inventory_status:'verified_complete',safety_or_rights_floor_status:'resolved'};
 const dominantBase={candidate_universe:[a.solution,b.solution],candidate_evaluations:[a.evaluation,b.evaluation],authority_status:'complete',party_inventory_status:'verified_complete',safety_or_rights_floor_status:'resolved'};
 const cases=[{...uniqueBase,authority_status:'unknown'},{...dominantBase,party_inventory_status:'unknown'},{...uniqueBase,safety_or_rights_floor_status:'unresolved'},{...dominantBase,safety_or_rights_floor_status:'triggered'}];
 const actual=cases.map((input)=>{const result=solveCandidates(input); return [result.selection_status,result.selected_solution_id,result.release_recommendation];});
 assert.deepEqual(actual,Array(4).fill(['undecided',null,'escalation']),'TASK4_RED_AUTHORITY_PRECEDENCE');
 const missing=clone(uniqueBase); delete missing.authority_status;
 assert.deepEqual(solveCandidates(missing),{selection_status:'invalid_input',selected_solution_id:null,feasible_solution_ids:[],next_action:'fix_input',release_recommendation:'escalation',reason_code:'CANDIDATE_INPUT_INVALID'},'TASK4_RED_AUTHORITY_PRECEDENCE');
});

test('TASK4_RED_MINIMAL_UNSAT_CORES returns exact inclusion-minimal hitting sets',()=>{
 const a=closedSolution('a',[],[{constraint_id:'x',result:'F',conflict_class:'ordinary'},{constraint_id:'y',result:'F',conflict_class:'ordinary'},{constraint_id:'z',result:'T',conflict_class:'ordinary'}],[]);
 const b=closedSolution('b',[],[{constraint_id:'x',result:'F',conflict_class:'ordinary'},{constraint_id:'y',result:'T',conflict_class:'ordinary'},{constraint_id:'z',result:'F',conflict_class:'ordinary'}],[]);
 const input=closedSolverInput({candidate_universe:[b.solution,a.solution],candidate_evaluations:[b.evaluation,a.evaluation],authority_status:'complete',party_inventory_status:'verified_complete',safety_or_rights_floor_status:'resolved'});
 assert.deepEqual(solveCandidates(input).unsat_cores,[['x'],['y','z']],'TASK4_RED_MINIMAL_UNSAT_CORES');
});

test('TASK4_RED_LEXICOGRAPHIC_PARETO keeps a plural higher-tier Pareto set undecided',()=>{
 const a=closedSolution('a',[],[{constraint_id:'h',result:'T',conflict_class:'ordinary'}],[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:10,floor_result:'T'},{party_or_cohort_id:'party-a',criterion:'speed',tier:0,value:0,floor_result:'T'},{party_or_cohort_id:'party-a',criterion:'comfort',tier:1,value:0,floor_result:'T'}]);
 const b=closedSolution('b',[],[{constraint_id:'h',result:'T',conflict_class:'ordinary'}],[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:0,floor_result:'T'},{party_or_cohort_id:'party-a',criterion:'speed',tier:0,value:10,floor_result:'T'},{party_or_cohort_id:'party-a',criterion:'comfort',tier:1,value:100,floor_result:'T'}]);
 const input=withGateBinding(closedSolverInput({candidate_universe:[a.solution,b.solution],candidate_evaluations:[a.evaluation,b.evaluation],authority_status:'complete',party_inventory_status:'verified_complete',safety_or_rights_floor_status:'resolved'}));
 const result=solveCandidates(input);
 assert.deepEqual([result.selection_status,result.selected_solution_id,result.next_action,result.release_recommendation],['undecided',null,'ask_decision_owner','undecided'],'TASK4_RED_LEXICOGRAPHIC_PARETO');
});

test('TASK4_RED_TOTAL_FAIL_CLOSED public reducers never throw or consume hostile object graphs',()=>{
 const capture=(operation)=>{try{return operation();}catch(error){return {threw:error?.code??error?.message};}};
 const nonNfc=highRiskDelete(); nonNfc.authenticated_principal=actor('e\u0301'); nonNfc.effective_actor=actor('b'); nonNfc.acting_edges=[{from:nonNfc.authenticated_principal,to:nonNfc.effective_actor,validity:'verified'}];
 const lone=completeUniverse([solution('a',[dimension('party-a','quality',0,1)])]); lone.candidate_evaluations[0].soft_dimensions[0].party_or_cohort_id='\uD800';
 const inherited=Object.create(highRiskDelete());
 const shared=highRiskDelete(); shared.effective_actor=shared.authenticated_principal;
 const actual=[capture(()=>evaluateAuthority(nonNfc)),capture(()=>solveCandidates(lone)),capture(()=>evaluateAuthority(new Date(0))),capture(()=>evaluateAuthority(inherited)),capture(()=>evaluateAuthority(shared)),capture(()=>derivePartyInventory(boundGraph([]),new Date(0),'2026-08-18T00:00:00Z'))];
 const expected=[invalidAuthorityResult(),invalidCandidateResult(),invalidAuthorityResult(),invalidAuthorityResult(),invalidAuthorityResult(),{status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_INVALID'}];
 assert.deepEqual(actual,expected,'TASK4_RED_TOTAL_FAIL_CLOSED');
 function invalidAuthorityResult(){return {status:'invalid_input',reason_code:'AUTHORITY_INPUT_INVALID'};}
 function invalidCandidateResult(){return {selection_status:'invalid_input',selected_solution_id:null,feasible_solution_ids:[],next_action:'fix_input',release_recommendation:'escalation',reason_code:'CANDIDATE_INPUT_INVALID'};}
});

test('TASK4_RED_TENANT_PROOF_AND_SCOPE rejects caller assertions and includes tenant ids in scope',()=>{
 const asserted=highRiskDelete(); asserted.tenant_ids=['tenant-a']; delete asserted.tenant_join_proof_id;
 assert.deepEqual(evaluateAuthority(asserted),{status:'escalation',reason_code:'TENANT_COVERAGE_UNKNOWN',coverage_gap_id:'tenant-join-proof-v1'},'TASK4_RED_TENANT_PROOF_AND_SCOPE');
 const outOfScope=highRiskDelete(); outOfScope.tenant_ids=['tenant-b'];
 assert.deepEqual(evaluateAuthority(outOfScope),{status:'block',reason_code:'AUTHORITY_ROOT_SCOPE_NOT_COVERED'},'TASK4_RED_TENANT_PROOF_AND_SCOPE');
});
import * as authorityModule from '../../evaluator/authority.mjs';


test('TASK4_PROVENANCE_RED_CALLER_FORGERY rejects caller-minted self-hash gate evidence',()=>{
 const only=closedSolution('forged',['option-safe'],[{constraint_id:'h',result:'T',conflict_class:'ordinary'}],[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:1,floor_result:'T'}]);
 const forged=withGateBinding(closedSolverInput({candidate_universe:[only.solution],candidate_evaluations:[only.evaluation],authority_status:'complete',party_inventory_status:'verified_complete',safety_or_rights_floor_status:'resolved'}));
 forged.evaluator_gate_binding.signature_base64=Buffer.alloc(64).toString('base64');
 assert.deepEqual(solveCandidates(forged),{selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:['forged'],next_action:'bind_evaluator_gate',release_recommendation:'escalation',reason_code:'SOLVER_GATE_EVIDENCE_REQUIRED'},'TASK4_PROVENANCE_RED_CALLER_FORGERY');
});

test('TASK4_SECURITY_RED_EVALUATOR_BOUND_GATES rejects unbound positive proof labels',()=>{
 const only=closedSolution('bare',['option-safe'],[{constraint_id:'h',result:'T',conflict_class:'ordinary'}],[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:1,floor_result:'T'}]);
 const input=closedSolverInput({candidate_universe:[only.solution],candidate_evaluations:[only.evaluation],authority_status:'complete',party_inventory_status:'verified_complete',safety_or_rights_floor_status:'resolved'});
 assert.deepEqual(solveCandidates(input),{selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:['bare'],next_action:'bind_evaluator_gate',release_recommendation:'escalation',reason_code:'SOLVER_GATE_EVIDENCE_REQUIRED'},'TASK4_SECURITY_RED_EVALUATOR_BOUND_GATES');
});

test('TASK4_SECURITY_RED_MINIMAL_CORE_BOUNDS bounds exact independent-pair core work before search',()=>{
 const independentPairs=(count)=>completeUniverse(Array.from({length:count},(_,index)=>solution(`pair-${index}`,[],[{id:`a-${index}`,result:'F',conflict_class:'ordinary'},{id:`b-${index}`,result:'F',conflict_class:'ordinary'}])));
 assert.equal(solveCandidates(independentPairs(8)).unsat_cores.length,256,'TASK4_SECURITY_RED_MINIMAL_CORE_BOUNDS');
 assert.deepEqual(solveCandidates(independentPairs(9)),{selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:[],next_action:'reduce_candidate_complexity',release_recommendation:'escalation',reason_code:'MINIMAL_CORE_COMPLEXITY_LIMIT'},'TASK4_SECURITY_RED_MINIMAL_CORE_BOUNDS');
});

test('TASK4_SECURITY_RED_TENANT_SET_CANONICALIZATION hashes tenant bindings as canonical sets',()=>{
 assert.equal(typeof authorityModule.tenantBindingSetDigest,'function','TASK4_SECURITY_RED_TENANT_SET_CANONICALIZATION');
 const tenants=['tenant-b','tenant-a'];
 const bindings=[{relationship:'target',tenant_id:'tenant-a'},{relationship:'controller',tenant_id:'tenant-b'}];
 const forward=authorityModule.tenantBindingSetDigest(tenants,bindings);
 const permuted=authorityModule.tenantBindingSetDigest([...tenants].reverse(),[...bindings].reverse());
 assert.equal(forward,permuted,'TASK4_SECURITY_RED_TENANT_SET_CANONICALIZATION');
});


test('EvaluatorGateBindingV1 requires a closed canonical signature field',()=>{
 const valid=twoSafeNonDominatedCandidates();
 const missing=clone(valid); delete missing.evaluator_gate_binding.signature_base64;
 assert.deepEqual(solveCandidates(missing),invalidCandidateResult());
 const malformed=clone(valid); malformed.evaluator_gate_binding.signature_base64='AA==';
 assert.deepEqual(solveCandidates(malformed),invalidCandidateResult());
 function invalidCandidateResult(){return {selection_status:'invalid_input',selected_solution_id:null,feasible_solution_ids:[],next_action:'fix_input',release_recommendation:'escalation',reason_code:'CANDIDATE_INPUT_INVALID'};}
});

test('EvaluatorGateBindingV1 rejects untrusted revoked expired and future issuer keys',()=>{
 const valid=twoSafeNonDominatedCandidates();
 for(const issuer_id of ['unknown-evaluator','ux-skill-revoked-evaluator-v1','ux-skill-expired-evaluator-v1','ux-skill-future-evaluator-v1']){
  const value=clone(valid); value.evaluator_gate_binding.issuer_id=issuer_id;
  assert.equal(solveCandidates(value).reason_code,'SOLVER_GATE_EVIDENCE_REQUIRED',issuer_id);
 }
 const version=clone(valid); version.evaluator_gate_binding.key_version='unknown';
 assert.equal(solveCandidates(version).reason_code,'SOLVER_GATE_EVIDENCE_REQUIRED');
});

test('EvaluatorGateBindingV1 signature binds policy time body candidates evaluations and signature bytes',()=>{
 const valid=twoSafeNonDominatedCandidates();
 const mutations=[
  (value)=>{value.evaluator_gate_binding.policy_version='tampered-policy';},
  (value)=>{value.evaluator_gate_binding.evaluation_effective_at='2026-08-18T00:00:01Z';},
  (value)=>{value.evaluator_gate_binding.authority_decision.status='unknown';},
  (value)=>{value.candidate_universe[0].option_ids.push('tampered-option');},
  (value)=>{value.candidate_evaluations[0].soft_dimensions[0].value+=1;},
  (value)=>{value.evaluator_gate_binding.signature_base64=Buffer.alloc(64).toString('base64');}
 ];
 for(const mutate of mutations){const value=clone(valid);mutate(value);assert.equal(solveCandidates(value).reason_code,'SOLVER_GATE_EVIDENCE_REQUIRED');}
});

test('EvaluatorGateBindingV1 valid signatures preserve safe ties and unique selection',()=>{
 assert.equal(solveCandidates(twoSafeNonDominatedCandidates()).reason_code,'SOFT_PARETO_TIE');
 const unique=completeUniverse([solution("unsafe",[dimension("party-a","safety",0,100,"F")]),solution("safe",[dimension("party-a","safety",0,0,"T")])]);
 assert.deepEqual(solveCandidates(unique),{selection_status:'selected',selected_solution_id:'safe',feasible_solution_ids:['safe','unsafe'],next_action:'proceed',release_recommendation:'continue',reason_code:'UNIQUE_PARETO_SOLUTION'});
});

test('EvaluatorGateBindingV1 preserves safe tie and fails closed on missing mismatch or digest tamper',()=>{
 const valid=twoSafeNonDominatedCandidates();
 assert.deepEqual(solveCandidates(valid),{selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:['a','b'],next_action:'ask_decision_owner',release_recommendation:'undecided',reason_code:'SOFT_PARETO_TIE'});
 const missing=clone(valid); delete missing.evaluator_gate_binding;
 assert.equal(solveCandidates(missing).reason_code,'SOLVER_GATE_EVIDENCE_REQUIRED');
 const mismatch=clone(valid); mismatch.evaluator_gate_binding.candidate_universe_digest='0'.repeat(64);
 assert.equal(solveCandidates(mismatch).reason_code,'SOLVER_GATE_EVIDENCE_REQUIRED');
 const tampered=clone(valid); tampered.evaluator_gate_binding.authority_decision.authority_decision_digest='0'.repeat(64);
 assert.equal(solveCandidates(tampered).reason_code,'SOLVER_GATE_EVIDENCE_REQUIRED');
 const valueTampered=clone(valid); valueTampered.candidate_evaluations[0].soft_dimensions[0].value+=1;
 assert.equal(solveCandidates(valueTampered).reason_code,'SOLVER_GATE_EVIDENCE_REQUIRED');
});
