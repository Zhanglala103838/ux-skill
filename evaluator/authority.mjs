import {readFileSync} from 'node:fs';

const registries=JSON.parse(readFileSync(new URL('../knowledge/registries.json',import.meta.url),'utf8'));
const policies=JSON.parse(readFileSync(new URL('../knowledge/decision-policies.json',import.meta.url),'utf8'));
const invalidAuthority=()=>({status:'invalid_input',reason_code:'AUTHORITY_INPUT_INVALID'});
const invalidCandidates=()=>({selection_status:'invalid_input',selected_solution_id:null,feasible_solution_ids:[],next_action:'fix_input',release_recommendation:'escalation',reason_code:'CANDIDATE_INPUT_INVALID'});
const isRecord=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isStringArray=(value)=>Array.isArray(value)&&value.every((item)=>typeof item==='string'&&item.length>0);
const instant=(value)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const actorFields=['namespace_uri','issuer_id','subject_id','kind'];
const validActor=(value)=>isRecord(value)&&actorFields.every((key)=>typeof value[key]==='string'&&value[key].length>0);
const sameActor=(left,right)=>validActor(left)&&validActor(right)&&actorFields.every((key)=>left[key]===right[key]);

export function derivePartyInventory(graph,proof,effectiveAt){
 if(!isRecord(graph)||!Array.isArray(graph.affected_party_ids)||!isStringArray(graph.affected_party_ids)&&graph.affected_party_ids.length>0)return {status:'unknown',party_ids:[],reason_code:'PARTY_GRAPH_INVALID'};
 if(!isRecord(proof))return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_REQUIRED'};
 if(proof.verification_status==='rejected')return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_INVALID'};
 if(proof.verification_status!=='verified')return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_UNKNOWN'};
 const at=instant(effectiveAt);
 const starts=instant(proof.effective_at);
 const expires=proof.expires_at===null?Infinity:instant(proof.expires_at);
 if(at!==null&&(starts===null||expires===null))return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_INVALID'};
 if(at!==null&&starts>at)return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_NOT_EFFECTIVE'};
 if(at!==null&&expires<=at)return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_EXPIRED'};
 if(graph.snapshot_status!=='closed'||graph.refs_closed!==true||graph.closure_complete!==true)return {status:'unknown',party_ids:[],reason_code:'PARTY_GRAPH_INCOMPLETE'};
 const party_ids=[...new Set(graph.affected_party_ids)].sort();
 return party_ids.length===0?{status:'verified_no_affected_party',party_ids}:{status:'verified_complete',party_ids};
}

function evaluateActing(context){
 const edges=context.acting_edges;
 if(!Array.isArray(edges))return invalidAuthority();
 for(const edge of edges){
  if(!isRecord(edge)||!validActor(edge.from)||!validActor(edge.to)||!['verified','rejected','unknown'].includes(edge.validity))return invalidAuthority();
  if(edge.validity==='rejected')return {status:'block',reason_code:'ACTING_EDGE_INVALID'};
  if(edge.validity==='unknown')return {status:'escalation',reason_code:'ACTING_EDGE_UNKNOWN'};
 }
 for(let index=0;index+1<edges.length;index++)if(!sameActor(edges[index].to,edges[index+1].from))return {status:'block',reason_code:'ACTING_CHAIN_DISJOINT'};
 if(edges.length>0&&validActor(context.authenticated_principal)&&!sameActor(edges[0].from,context.authenticated_principal))return {status:'block',reason_code:'ACTING_CHAIN_START_MISMATCH'};
 if(edges.length>0&&validActor(context.effective_actor)&&!sameActor(edges.at(-1).to,context.effective_actor))return {status:'block',reason_code:'ACTING_CHAIN_END_MISMATCH'};
 return null;
}

function evaluateTenant(context){
 const tenant=context.tenant_bindings;
 if(!isRecord(tenant))return {status:'escalation',reason_code:'TENANT_COVERAGE_UNKNOWN',coverage_gap_id:'tenant-join-proof-v1'};
 if(!['verified','rejected','unknown'].includes(tenant.status))return invalidAuthority();
 if(tenant.status==='unknown')return {status:'escalation',reason_code:'TENANT_COVERAGE_UNKNOWN'};
 if(tenant.status==='rejected')return {status:'block',reason_code:'TENANT_SCOPE_NOT_COVERED'};
 if(!isStringArray(tenant.required)||!isStringArray(tenant.covered)||!isStringArray(tenant.extra_effects))return invalidAuthority();
 if(tenant.extra_effects.length>0)return {status:'block',reason_code:'TENANT_EXTRA_EFFECT'};
 const covered=new Set(tenant.covered);
 if(tenant.required.some((id)=>!covered.has(id)))return {status:'block',reason_code:'TENANT_SCOPE_NOT_COVERED'};
 return null;
}

function evaluateGrant(context){
 const grant=context.grant;
 if(!isRecord(grant))return {status:'escalation',reason_code:'GRANT_VALIDITY_UNKNOWN',coverage_gap_id:'grant-chain-proof-v1'};
 if(grant.revoked===true||grant.status==='revoked')return {status:'block',reason_code:'GRANT_REVOKED'};
 if(grant.status==='rejected')return {status:'block',reason_code:'GRANT_INVALID'};
 if(grant.status!=='active')return {status:'escalation',reason_code:'GRANT_VALIDITY_UNKNOWN'};
 if(grant.scope_coverage==='rejected')return {status:'block',reason_code:'GRANT_SCOPE_NOT_COVERED'};
 if(grant.scope_coverage!=='verified')return {status:'escalation',reason_code:'GRANT_SCOPE_UNKNOWN'};
 const at=instant(context.evaluation_effective_at),starts=instant(grant.effective_at),expires=grant.expires_at===null?Infinity:instant(grant.expires_at);
 if(at===null||starts===null||expires===null)return invalidAuthority();
 if(starts>at)return {status:'block',reason_code:'GRANT_NOT_EFFECTIVE'};
 if(expires<=at)return {status:'block',reason_code:'GRANT_EXPIRED'};
 return null;
}

function prerequisite(value,{failed,unknown,gap}){
 if(!isRecord(value))return {status:'escalation',reason_code:unknown,coverage_gap_id:gap};
 if(value.status==='rejected')return {status:'block',reason_code:failed};
 if(value.status!=='verified')return {status:'escalation',reason_code:unknown};
 return null;
}

export function evaluateAuthority(context){
 if(!isRecord(context)||typeof context.action!=='string'||typeof context.resource_type!=='string'||typeof context.risk!=='string')return invalidAuthority();
 const supported=registries.action_policy_registry.some((row)=>row.action===context.action&&row.resource_type===context.resource_type);
 if(!supported)return {status:'escalation',reason_code:'AUTHORITY_COVERAGE_GAP',coverage_gap_id:'action-resource-policy-v1'};
 if(context.authority_root_id&& !registries.authority_root_registry.some((row)=>row.authority_root_id===context.authority_root_id&&!row.revoked))return {status:'block',reason_code:'AUTHORITY_ROOT_UNTRUSTED'};
 if(context.authority_root_membership==='rejected')return {status:'block',reason_code:'AUTHORITY_ROOT_UNTRUSTED'};
 if(context.authority_root_membership!=='verified')return {status:'escalation',reason_code:'AUTHORITY_ROOT_UNKNOWN',coverage_gap_id:'authority-root-proof-v1'};
 const acting=evaluateActing(context); if(acting)return acting;
 const tenant=evaluateTenant(context); if(tenant)return tenant;
 if(!isRecord(context.party_graph))return {status:'escalation',reason_code:'PARTY_INVENTORY_UNKNOWN',coverage_gap_id:'party-effect-graph-v1'};
 const inventory=derivePartyInventory(context.party_graph,context.party_proof,context.evaluation_effective_at);
 if(inventory.status==='unknown')return {status:'escalation',reason_code:'PARTY_INVENTORY_UNKNOWN'};
 if(context.acting_edges.length===0&&(!validActor(context.authenticated_principal)||!validActor(context.effective_actor)))return {status:'escalation',reason_code:'ACTING_ENDPOINT_UNKNOWN',coverage_gap_id:'acting-endpoint-proof-v1'};
 if(context.acting_edges.length===0&&!sameActor(context.authenticated_principal,context.effective_actor))return {status:'block',reason_code:'ACTING_CHAIN_END_MISMATCH'};
 const grant=evaluateGrant(context); if(grant)return grant;
 const approval=prerequisite(context.approval,{failed:'APPROVAL_PREREQUISITE_FAILED',unknown:'APPROVAL_PREREQUISITE_UNKNOWN',gap:'approval-envelope-binding-v1'}); if(approval)return approval;
 const capability=prerequisite(context.capability,{failed:'CAPABILITY_INVALID',unknown:'CAPABILITY_UNKNOWN',gap:'capability-ledger-proof-v1'}); if(capability)return capability;
 if(context.capability.ledger_status==='unavailable'||context.capability.ledger_status==='unknown')return {status:'escalation',reason_code:'CAPABILITY_LEDGER_UNAVAILABLE'};
 if(context.capability.ledger_status!=='unused')return {status:'block',reason_code:'CAPABILITY_INVALID'};
 for(const requirement of policies.required_runtime_features)if(!isRecord(context.authority_features)||context.authority_features[requirement.feature]!=='verified')return {status:'escalation',reason_code:'AUTHORITY_COVERAGE_GAP',coverage_gap_id:requirement.coverage_gap_id};
 return {status:'continue',reason_code:'AUTHORITY_VERIFIED'};
}

const setSubset=(left,right)=>left.every((value)=>right.includes(value));
const minimalCores=(candidates)=>{
 const cores=candidates.map((candidate)=>candidate.hard_constraints.filter((row)=>row.result==='F').map((row)=>row.id).sort()).filter((row)=>row.length>0);
 return cores.filter((core,index)=>!cores.some((other,otherIndex)=>otherIndex!==index&&other.length<core.length&&setSubset(other,core))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
};
const dominates=(left,right,dimensions)=>dimensions.every((key)=>left.soft_scores[key]>=right.soft_scores[key])&&dimensions.some((key)=>left.soft_scores[key]>right.soft_scores[key]);

export function solveCandidates(universe){
 if(!isRecord(universe)||!Array.isArray(universe.candidates)||universe.candidates.length===0)return invalidCandidates();
 const candidates=[...universe.candidates].sort((a,b)=>String(a?.solution_id).localeCompare(String(b?.solution_id)));
 const seen=new Set();
 for(const candidate of candidates){
  if(!isRecord(candidate)||typeof candidate.solution_id!=='string'||candidate.solution_id.length===0||seen.has(candidate.solution_id)||!Array.isArray(candidate.hard_constraints)||!isRecord(candidate.soft_scores))return invalidCandidates();
  seen.add(candidate.solution_id);
  if(!candidate.hard_constraints.every((row)=>isRecord(row)&&typeof row.id==='string'&&Object.hasOwn(policies.hard_constraint_result_table,row.result)))return invalidCandidates();
  if(!Object.values(candidate.soft_scores).every((value)=>typeof value==='number'&&Number.isFinite(value)))return invalidCandidates();
 }
 const feasible=candidates.filter((candidate)=>candidate.hard_constraints.every((row)=>row.result==='T'));
 const feasible_solution_ids=feasible.map((candidate)=>candidate.solution_id);
 if(candidates.some((candidate)=>candidate.hard_constraints.some((row)=>row.result==='E')))return {selection_status:'evaluation_error',selected_solution_id:null,feasible_solution_ids,next_action:'fix_evaluation_error',release_recommendation:'escalation',reason_code:'HARD_CONSTRAINT_EVALUATION_ERROR'};
 if(candidates.some((candidate)=>candidate.hard_constraints.some((row)=>row.result==='U')))return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids,next_action:'escalate_hard_constraint',release_recommendation:'escalation',reason_code:'HARD_CONSTRAINT_UNKNOWN'};
 if(feasible.length===0){
  const high=candidates.some((candidate)=>candidate.hard_constraints.some((row)=>row.result==='F'&&policies.zero_feasible_escalation_classes.includes(row.conflict_class)));
  return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:[],unsat_cores:minimalCores(candidates),next_action:high?'escalate_high_risk_conflict':'resolve_mandatory_constraint',release_recommendation:high?'escalation':'block',reason_code:high?'HARD_CONSTRAINT_HIGH_RISK_UNSAT':'HARD_CONSTRAINT_UNSAT'};
 }
 const dimensions=[...new Set(feasible.flatMap((candidate)=>Object.keys(candidate.soft_scores)))].sort();
 if(feasible.some((candidate)=>dimensions.some((key)=>typeof candidate.soft_scores[key]!=='number')))return invalidCandidates();
 const pareto=feasible.filter((candidate)=>!feasible.some((other)=>other!==candidate&&dominates(other,candidate,dimensions)));
 if(pareto.length===1)return {selection_status:'selected',selected_solution_id:pareto[0].solution_id,feasible_solution_ids,next_action:'proceed',release_recommendation:'continue',reason_code:'UNIQUE_PARETO_SOLUTION'};
 let branch='complete_safe',reason_code='SOFT_PARETO_TIE';
 if(universe.authority_status!=='complete'){branch='authority_incomplete';reason_code='SOFT_TIE_AUTHORITY_INCOMPLETE';}
 else if(!['verified_complete','verified_no_affected_party'].includes(universe.party_inventory_status)){branch='party_incomplete';reason_code='SOFT_TIE_PARTY_INCOMPLETE';}
 else if(universe.touches_safety_or_rights_floor===true){branch='safety_or_rights_floor';reason_code='SOFT_TIE_SAFETY_FLOOR';}
 const decision=policies.soft_tie_table[branch];
 return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids,next_action:decision.next_action,release_recommendation:decision.release_recommendation,reason_code};
}
