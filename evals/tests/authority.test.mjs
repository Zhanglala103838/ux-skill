import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateAuthority,derivePartyInventory,solveCandidates} from '../../evaluator/authority.mjs';

const vectorIds=['AUTH-ROOT-001','ACT-DISJOINT-001','TENANT-UNKNOWN-001','PARTY-COMPLETENESS-PROOF-001','SOFT-TIE-001','SOFT-TIE-AUTH-U-001'];
const fixtures=new Map(await Promise.all(vectorIds.map(async(id)=>[id,JSON.parse(await readFile(new URL(`../red/${id}.json`,import.meta.url),'utf8'))])));
const registries=JSON.parse(await readFile(new URL('../../knowledge/registries.json',import.meta.url),'utf8'));
const policies=JSON.parse(await readFile(new URL('../../knowledge/decision-policies.json',import.meta.url),'utf8'));
const actor=(subject_id,namespace_uri='https://identity.example')=>({namespace_uri,issuer_id:'ux-skill',subject_id,kind:'human'});
const verifiedProof=()=>({proof_id:'proof-1',effect_scope_digest:'e'.repeat(64),resource_scope_digest:'d'.repeat(64),data_source_ids:['directory'],snapshot_digest:'c'.repeat(64),snapshot_version:'v1',verification_status:'verified',effective_at:'2026-08-17T00:00:00Z',expires_at:'2026-08-19T00:00:00Z',closure_algorithm_id:'party-closure',closure_algorithm_version:'1'});
const boundGraph=(affected_party_ids)=>({snapshot_status:'closed',refs_closed:true,closure_complete:true,affected_party_ids,effect_scope_digest:'e'.repeat(64),resource_scope_digest:'d'.repeat(64),data_source_ids:['directory'],snapshot_digest:'c'.repeat(64),snapshot_version:'v1',closure_algorithm_id:'party-closure',closure_algorithm_version:'1'});
const highRiskDelete=({partyProof='verified'}={})=>({action:'delete',resource_type:'admin_account',risk:'high',authorization_purpose:'account_deletion',evaluation_effective_at:'2026-08-18T00:00:00Z',authenticated_principal:actor('admin'),effective_actor:actor('admin'),authority_root_id:'ux-skill-local-admin-root-v1',authority_root_membership:'verified',acting_edges:[],tenant_bindings:{status:'verified',required:['target','controller'],covered:['target','controller'],extra_effects:[]},party_graph:boundGraph(['party-a']),party_proof:partyProof==='verified'?verifiedProof():null,grant:{status:'active',scope_coverage:'verified',effective_at:'2026-08-17T00:00:00Z',expires_at:'2026-08-19T00:00:00Z',revoked:false},approval:{status:'verified'},capability:{status:'verified',ledger_status:'unused'},authority_features:{execution_envelope:'verified',time_authority:'verified',commit_revalidation:'verified'}});
const twoSafeNonDominatedCandidates=()=>({authority_status:'complete',party_inventory_status:'verified_complete',candidates:[{solution_id:'a',hard_constraints:[{id:'h',result:'T'}],soft_dimensions:[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:1,floor_result:'T'},{party_or_cohort_id:'party-a',criterion:'speed',tier:0,value:0,floor_result:'T'}]},{solution_id:'b',hard_constraints:[{id:'h',result:'T'}],soft_dimensions:[{party_or_cohort_id:'party-a',criterion:'quality',tier:0,value:0,floor_result:'T'},{party_or_cohort_id:'party-a',criterion:'speed',tier:0,value:1,floor_result:'T'}]}]});
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
  const actual=vector.operation==='solveCandidates'?solveCandidates(vector.input):evaluateAuthority(vector.input);
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

test('tenant coverage implements block, escalation, exact all-join, and invalid input branches',()=>{
 const missing=highRiskDelete(); missing.tenant_bindings.covered=[];
 assert.deepEqual(evaluateAuthority(missing),{status:'block',reason_code:'TENANT_SCOPE_NOT_COVERED'});
 const extra=highRiskDelete(); extra.tenant_bindings.extra_effects=['tenant-b'];
 assert.deepEqual(evaluateAuthority(extra),{status:'block',reason_code:'TENANT_EXTRA_EFFECT'});
 const unknown=highRiskDelete(); unknown.tenant_bindings.status='unknown';
 assert.deepEqual(evaluateAuthority(unknown),{status:'escalation',reason_code:'TENANT_COVERAGE_UNKNOWN'});
 const malformed=highRiskDelete(); malformed.tenant_bindings.required=[42];
 assert.deepEqual(evaluateAuthority(malformed),{status:'invalid_input',reason_code:'AUTHORITY_INPUT_INVALID'});
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
 assert.deepEqual(solveCandidates({candidates:[candidate('a','E')],authority_status:'complete',party_inventory_status:'verified_complete'}),{selection_status:'evaluation_error',selected_solution_id:null,feasible_solution_ids:[],next_action:'fix_evaluation_error',release_recommendation:'escalation',reason_code:'HARD_CONSTRAINT_EVALUATION_ERROR'});
 assert.deepEqual(solveCandidates({candidates:[candidate('a','T'),candidate('b','U')],authority_status:'complete',party_inventory_status:'verified_complete'}),{selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:['a'],next_action:'escalate_hard_constraint',release_recommendation:'escalation',reason_code:'HARD_CONSTRAINT_UNKNOWN'});
 const ordinary=solveCandidates({candidates:[candidate('a','F')],authority_status:'complete',party_inventory_status:'verified_complete'});
 assert.equal(ordinary.release_recommendation,'block'); assert.deepEqual(ordinary.unsat_cores,[['h-a']]);
 const rights=solveCandidates({candidates:[candidate('a','F','rights')],authority_status:'complete',party_inventory_status:'verified_complete'});
 assert.equal(rights.release_recommendation,'escalation'); assert.equal(rights.reason_code,'HARD_CONSTRAINT_HIGH_RISK_UNSAT');
 assert.equal(solveCandidates({candidates:[candidate('b','F'),candidate('a','T')],authority_status:'complete',party_inventory_status:'verified_complete'}).selected_solution_id,'a');
});

test('soft ties escalate when authority, party closure, or a safety floor is incomplete',()=>{
 for(const patch of [{authority_status:'unknown'},{party_inventory_status:'unknown'},{touches_safety_or_rights_floor:true}]){
  const result=solveCandidates({...twoSafeNonDominatedCandidates(),...patch});
  assert.equal(result.selection_status,'undecided'); assert.equal(result.selected_solution_id,null); assert.equal(result.release_recommendation,'escalation');
 }
});

test('candidate and score ordering are deterministic',()=>{
 const first=twoSafeNonDominatedCandidates();
 const second=clone(first); second.candidates.reverse(); for(const candidate of second.candidates) candidate.soft_dimensions.reverse();
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

test("tenant all-join obligations come from the closed policy and require exact coverage",()=>{
 const erased=highRiskDelete(); erased.tenant_bindings={status:"verified",required:[],covered:[],extra_effects:[]};
 assert.deepEqual(evaluateAuthority(erased),{status:"block",reason_code:"TENANT_SCOPE_NOT_COVERED"});
 const superset=highRiskDelete(); superset.tenant_bindings={status:"verified",required:["target","controller"],covered:["target","controller","unregistered"],extra_effects:[]};
 assert.deepEqual(evaluateAuthority(superset),{status:"block",reason_code:"TENANT_SCOPE_NOT_COVERED"});
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
 const scope={actions:["delete"],resource_types:["admin_account"],tenant_ids:["target","controller"],purposes:["account_deletion"]};
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
const completeUniverse=(candidates)=>({authority_status:"complete",party_inventory_status:"verified_complete",candidates});

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
 const incomplete=solveCandidates({...completeUniverse(candidates),authority_status:"unknown"});
 assert.equal(incomplete.selection_status,"undecided"); assert.equal(incomplete.selected_solution_id,null); assert.equal(incomplete.release_recommendation,"escalation");
});

test("candidate and core order use unsigned UTF8 JCS bytes",()=>{
 const tie=solveCandidates(completeUniverse([solution("😀",[dimension("party-a","quality",0,1)]),solution("",[dimension("party-a","quality",0,1)])]));
 assert.deepEqual(tie.feasible_solution_ids,["","😀"]);
 const unsat=solveCandidates(completeUniverse([
  solution("x",[],[{id:"😀",result:"F",conflict_class:"ordinary"},{id:"",result:"F",conflict_class:"ordinary"}])
 ]));
 assert.deepEqual(unsat.unsat_cores,[["","😀"]]);
});