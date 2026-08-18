import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalSet,jcsBytes} from './canonical.mjs';
import {validateBySchema} from './validation.mjs';

const registries=JSON.parse(readFileSync(new URL('../knowledge/registries.json',import.meta.url),'utf8'));
const policies=JSON.parse(readFileSync(new URL('../knowledge/decision-policies.json',import.meta.url),'utf8'));
const invalidAuthority=()=>({status:'invalid_input',reason_code:'AUTHORITY_INPUT_INVALID'});
const invalidCandidates=()=>({selection_status:'invalid_input',selected_solution_id:null,feasible_solution_ids:[],next_action:'fix_input',release_recommendation:'escalation',reason_code:'CANDIDATE_INPUT_INVALID'});
const isRecord=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isStringArray=(value)=>Array.isArray(value)&&value.every((item)=>typeof item==='string'&&item.length>0);
const instant=(value)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const exactKeys=(value,keys)=>isRecord(value)&&Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));
const actorFields=['namespace_uri','issuer_id','subject_id','kind'];
const validActor=(value)=>exactKeys(value,actorFields)&&actorFields.every((key)=>typeof value[key]==='string'&&value[key].length>0)&&['human','service','organization','agent'].includes(value.kind);
const sameActor=(left,right)=>validActor(left)&&validActor(right)&&actorFields.every((key)=>left[key]===right[key]);
const actorKey=(value)=>jcsBytes(value).toString('hex');
const canonicalStrings=(values)=>canonicalSet(values,(value)=>value);
const sameStringSet=(left,right)=>left.length===right.length&&canonicalStrings(left).every((value,index)=>value===canonicalStrings(right)[index]);
const validScope=(value)=>exactKeys(value,['actions','resource_types','tenant_ids','purposes'])&&['actions','resource_types','tenant_ids','purposes'].every((key)=>isStringArray(value[key])||Array.isArray(value[key])&&value[key].length===0);
const scopeCovers=(scope,context)=>validScope(scope)&&isStringArray(context.tenant_ids)&&scope.actions.includes(context.action)&&scope.resource_types.includes(context.resource_type)&&scope.purposes.includes(context.authorization_purpose)&&context.tenant_ids.every((tenantId)=>scope.tenant_ids.includes(tenantId));
const gap=(reason_code,coverage_gap_id)=>({status:'escalation',reason_code,coverage_gap_id});
const rejectSharedReferences=(value,seen=new WeakSet())=>{
 if(value===null||typeof value!=='object')return;
 if(seen.has(value))throw new TypeError('IJSON_SHARED_REFERENCE');
 seen.add(value);
 for(const key of Reflect.ownKeys(value)){
  if(Array.isArray(value)&&key==='length')continue;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(descriptor&&Object.hasOwn(descriptor,'value'))rejectSharedReferences(descriptor.value,seen);
 }
};
const reducerSnapshot=(value)=>{
 const bytes=jcsBytes(value);
 rejectSharedReferences(value);
 return JSON.parse(Buffer.from(bytes).toString('utf8'));
};
export function tenantBindingSetDigest(tenantIds,relationshipBindings){
 try{
  const canonicalTenantIds=canonicalStrings(tenantIds);
  const canonicalBindings=canonicalSet(relationshipBindings,(row)=>[row.tenant_id,row.relationship]);
  return createHash('sha256').update('ux-skill:tenant-binding-set:v1','utf8').update(jcsBytes({relationship_bindings:canonicalBindings,tenant_ids:canonicalTenantIds})).digest('hex');
 }catch{return null;}
}

function derivePartyInventorySnapshot(graph,proof,effectiveAt){
 if(!isRecord(graph)||!Array.isArray(graph.affected_party_ids)||!graph.affected_party_ids.every((id)=>typeof id==='string'&&id.length>0))return {status:'unknown',party_ids:[],reason_code:'PARTY_GRAPH_INVALID'};
 if(!isRecord(proof))return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_REQUIRED'};
 if(proof.verification_status==='rejected')return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_INVALID'};
 if(proof.verification_status!=='verified')return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_UNKNOWN'};
 const proofKeys=['proof_id','effect_scope_digest','resource_scope_digest','data_source_ids','snapshot_digest','snapshot_version','effective_at','expires_at','closure_algorithm_id','closure_algorithm_version','verification_status'];
 if(!exactKeys(proof,proofKeys)||!isStringArray(proof.data_source_ids)||!['effect_scope_digest','resource_scope_digest','snapshot_digest'].every((key)=>typeof proof[key]==='string'&&/^[0-9a-f]{64}$/.test(proof[key]))||!['proof_id','snapshot_version','closure_algorithm_id','closure_algorithm_version'].every((key)=>typeof proof[key]==='string'&&proof[key].length>0))return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_INVALID'};
 const at=instant(effectiveAt),starts=instant(proof.effective_at),expires=proof.expires_at===null?Infinity:instant(proof.expires_at);
 if(at===null||starts===null||expires===null)return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_INVALID'};
 if(starts>at)return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_NOT_EFFECTIVE'};
 if(expires<=at)return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_EXPIRED'};
 if(graph.snapshot_status!=='closed'||graph.refs_closed!==true||graph.closure_complete!==true)return {status:'unknown',party_ids:[],reason_code:'PARTY_GRAPH_INCOMPLETE'};
 const boundFields=['effect_scope_digest','resource_scope_digest','snapshot_digest','snapshot_version','closure_algorithm_id','closure_algorithm_version'];
 if(boundFields.some((key)=>graph[key]!==proof[key])||!isStringArray(graph.data_source_ids)||!sameStringSet(graph.data_source_ids,proof.data_source_ids))return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_INVALID'};
 const party_ids=canonicalStrings(graph.affected_party_ids);
 return party_ids.length===0?{status:'verified_no_affected_party',party_ids}:{status:'verified_complete',party_ids};
}

export function derivePartyInventory(graphInput,proofInput,effectiveAtInput){
 let values;
 try{values=reducerSnapshot([graphInput,proofInput,effectiveAtInput===undefined?null:effectiveAtInput]);}catch{return {status:'unknown',party_ids:[],reason_code:'PARTY_COMPLETENESS_PROOF_INVALID'};}
 return derivePartyInventorySnapshot(values[0],values[1],values[2]);
}

function evaluateRoot(context){
 if(context.authority_root_membership==='rejected')return {status:'block',reason_code:'AUTHORITY_ROOT_UNTRUSTED'};
 if(typeof context.authority_root_id!=='string'||context.authority_root_id.length===0)return gap('AUTHORITY_ROOT_UNKNOWN','authority-root-proof-v1');
 const root=registries.authority_root_registry.find((row)=>row.authority_root_id===context.authority_root_id);
 if(!root)return {status:'block',reason_code:'AUTHORITY_ROOT_UNTRUSTED'};
 if(root.revoked)return {status:'block',reason_code:'AUTHORITY_ROOT_REVOKED'};
 const at=instant(context.evaluation_effective_at),starts=instant(root.effective_at),expires=root.expires_at===null?Infinity:instant(root.expires_at);
 if(at===null||starts===null||expires===null)return invalidAuthority();
 if(starts>at)return {status:'block',reason_code:'AUTHORITY_ROOT_NOT_EFFECTIVE'};
 if(expires<=at)return {status:'block',reason_code:'AUTHORITY_ROOT_EXPIRED'};
 if(!Array.isArray(root.allowed_grant_scopes)||!root.allowed_grant_scopes.some((scope)=>scopeCovers(scope,context)))return {status:'block',reason_code:'AUTHORITY_ROOT_SCOPE_NOT_COVERED'};
 return null;
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
 if(edges.length>0){
  const seenNodes=new Set([actorKey(edges[0].from)]),seenEdges=new Set();
  for(const edge of edges){
   const node=actorKey(edge.to),edgeKey=jcsBytes([edge.from,edge.to]).toString('hex');
   if(seenNodes.has(node)||seenEdges.has(edgeKey))return {status:'block',reason_code:'ACTING_CHAIN_CYCLE'};
   seenNodes.add(node); seenEdges.add(edgeKey);
  }
 }
 const edgeKeys=['edge_id','sequence','from','to','basis_ref','scope','effective_at','expires_at','version','validity'];
 for(const edge of edges){
  if(!exactKeys(edge,edgeKeys))return gap('ACTING_EDGE_UNKNOWN','acting-edge-proof-v1');
  if(typeof edge.edge_id!=='string'||edge.edge_id.length===0||!Number.isInteger(edge.sequence)||edge.sequence<0||typeof edge.basis_ref!=='string'||edge.basis_ref.length===0||typeof edge.version!=='string'||edge.version.length===0||!validScope(edge.scope))return invalidAuthority();
  const at=instant(context.evaluation_effective_at),starts=instant(edge.effective_at),expires=edge.expires_at===null?Infinity:instant(edge.expires_at);
  if(at===null||starts===null||expires===null)return invalidAuthority();
  if(starts>at)return {status:'block',reason_code:'ACTING_EDGE_NOT_EFFECTIVE'};
  if(expires<=at)return {status:'block',reason_code:'ACTING_EDGE_EXPIRED'};
  if(!scopeCovers(edge.scope,context))return {status:'block',reason_code:'ACTING_SCOPE_NOT_COVERED'};
 }
 return edges.length>0?gap('ACTING_EDGE_UNKNOWN','acting-edge-proof-v1'):null;
}

function evaluateTenant(context,policy){
 if(typeof context.tenant_join_proof_id!=='string'||context.tenant_join_proof_id.length===0)return gap('TENANT_COVERAGE_UNKNOWN','tenant-join-proof-v1');
 const proof=registries.tenant_join_proof_registry?.find((row)=>row.tenant_join_proof_id===context.tenant_join_proof_id);
 if(!proof)return gap('TENANT_COVERAGE_UNKNOWN','tenant-join-proof-v1');
 if(proof.verification_status==='rejected')return {status:'block',reason_code:'TENANT_SCOPE_NOT_COVERED'};
 if(proof.verification_status!=='verified')return gap('TENANT_COVERAGE_UNKNOWN','tenant-join-proof-v1');
 if(policy.tenant_join!=='all'||!isStringArray(proof.tenant_ids)||!sameStringSet(proof.tenant_ids,context.tenant_ids))return {status:'block',reason_code:'TENANT_SCOPE_NOT_COVERED'};
 if(!Array.isArray(proof.relationship_bindings)||!proof.relationship_bindings.every((row)=>exactKeys(row,['relationship','tenant_id'])&&typeof row.relationship==='string'&&row.relationship.length>0&&typeof row.tenant_id==='string'&&proof.tenant_ids.includes(row.tenant_id)))return invalidAuthority();
 const relationships=proof.relationship_bindings.map((row)=>row.relationship);
 if(!sameStringSet(relationships,policy.required_tenant_relationships))return {status:'block',reason_code:'TENANT_SCOPE_NOT_COVERED'};
 if(!isStringArray(proof.extra_effect_tenant_ids)&&!(Array.isArray(proof.extra_effect_tenant_ids)&&proof.extra_effect_tenant_ids.length===0))return invalidAuthority();
 if(proof.extra_effect_tenant_ids.length>0)return {status:'block',reason_code:'TENANT_EXTRA_EFFECT'};
 if(typeof proof.tenant_binding_set_digest!=='string'||proof.tenant_binding_set_digest!==tenantBindingSetDigest(proof.tenant_ids,proof.relationship_bindings))return invalidAuthority();
 return null;
}

function explicitPrerequisiteFailure(context){
 const grant=context.grant,approval=context.approval,capability=context.capability;
 if(isRecord(grant)&&(grant.revoked===true||grant.status==='revoked'))return {status:'block',reason_code:'GRANT_REVOKED'};
 if(isRecord(grant)&&grant.status==='rejected')return {status:'block',reason_code:'GRANT_INVALID'};
 if(isRecord(grant)&&grant.status==='unknown')return {status:'escalation',reason_code:'GRANT_VALIDITY_UNKNOWN'};
 if(isRecord(grant)&&grant.scope_coverage==='rejected')return {status:'block',reason_code:'GRANT_SCOPE_NOT_COVERED'};
 if(isRecord(grant)&&grant.status==='active'){
  const at=instant(context.evaluation_effective_at),starts=instant(grant.effective_at),expires=grant.expires_at===null?Infinity:instant(grant.expires_at);
  if(at!==null&&starts!==null&&starts>at)return {status:'block',reason_code:'GRANT_NOT_EFFECTIVE'};
  if(at!==null&&expires!==null&&expires<=at)return {status:'block',reason_code:'GRANT_EXPIRED'};
 }
 if(isRecord(approval)&&(approval.status==='rejected'||approval.decision==='rejected'))return {status:'block',reason_code:'APPROVAL_PREREQUISITE_FAILED'};
 if(isRecord(approval)&&approval.status==='unknown')return {status:'escalation',reason_code:'APPROVAL_PREREQUISITE_UNKNOWN'};
 if(isRecord(capability)&&capability.status==='rejected')return {status:'block',reason_code:'CAPABILITY_INVALID'};
 if(isRecord(capability)&&['unavailable','unknown'].includes(capability.ledger_status))return {status:'escalation',reason_code:'CAPABILITY_LEDGER_UNAVAILABLE'};
 if(isRecord(capability)&&Object.hasOwn(capability,'ledger_status')&&!['unused','unavailable','unknown'].includes(capability.ledger_status))return {status:'block',reason_code:'CAPABILITY_INVALID'};
 return null;
}

function evaluateGrant(context){
 const grant=context.grant;
 if(!isRecord(grant))return gap('GRANT_VALIDITY_UNKNOWN','grant-chain-proof-v1');
 const keys=['grant_id','issuer','subject','parent_grant_id','scope','effective_at','expires_at','status','delegable','remaining_depth','epoch','version','proof_digest'];
 if(!exactKeys(grant,keys))return gap('GRANT_VALIDITY_UNKNOWN','grant-contract-v1');
 if(!validActor(grant.issuer)||!validActor(grant.subject)||!validScope(grant.scope)||typeof grant.proof_digest!=='string'||!/^[0-9a-f]{64}$/.test(grant.proof_digest)||!Number.isInteger(grant.remaining_depth)||!Number.isInteger(grant.epoch))return invalidAuthority();
 const at=instant(context.evaluation_effective_at),starts=instant(grant.effective_at),expires=grant.expires_at===null?Infinity:instant(grant.expires_at);
 if(at===null||starts===null||expires===null)return invalidAuthority();
 if(starts>at)return {status:'block',reason_code:'GRANT_NOT_EFFECTIVE'};
 if(expires<=at)return {status:'block',reason_code:'GRANT_EXPIRED'};
 if(!scopeCovers(grant.scope,context))return {status:'block',reason_code:'GRANT_SCOPE_NOT_COVERED'};
 return null;
}

function validateApprovalCapabilityShapes(context){
 const approval=context.approval;
 const approvalKeys=['approval_decision_id','sequence','approver_context_digest','approver_authority_ref','envelope_digest','decision','effective_at','expires_at','consumed'];
 if(!exactKeys(approval,approvalKeys))return gap('APPROVAL_PREREQUISITE_UNKNOWN','approval-envelope-binding-v1');
 const envelope=context.execution_envelope;
 if(!isRecord(envelope)||typeof envelope.envelope_digest!=='string'||approval.envelope_digest!==envelope.envelope_digest)return gap('APPROVAL_PREREQUISITE_UNKNOWN','approval-envelope-binding-v1');
 const capability=context.capability;
 const capabilityKeys=['capability_id','capability_digest','body','authenticator','ledger_ref'];
 if(!exactKeys(capability,capabilityKeys))return gap('CAPABILITY_UNKNOWN','capability-contract-v1');
 const capabilityBodyKeys=['run_id','step_id','acting_chain_digest','session_id','channel','audience','tenant_set_digest','resource_versions','authorization_purpose','envelope_digest','nonce','expires_at','issuer_id','key_version','capability_use'];
 if(!exactKeys(capability.body,capabilityBodyKeys))return gap('CAPABILITY_UNKNOWN','capability-contract-v1');
 if(capability.body.envelope_digest!==envelope.envelope_digest)return gap('CAPABILITY_UNKNOWN','capability-envelope-binding-v1');
 const ledger=context.capability_ledger_entry;
 const ledgerKeys=['capability_digest','status','consumed_at','consumption_effect_digest'];
 if(!exactKeys(ledger,ledgerKeys))return gap('CAPABILITY_LEDGER_UNAVAILABLE','capability-ledger-proof-v1');
 if(ledger.capability_digest!==capability.capability_digest)return gap('CAPABILITY_UNKNOWN','capability-ledger-proof-v1');
 return null;
}

function evaluateAuthoritySnapshot(context){
 if(!isRecord(context)||typeof context.action!=='string'||typeof context.resource_type!=='string'||typeof context.risk!=='string'||typeof context.authorization_purpose!=='string'||!isStringArray(context.tenant_ids)||new Set(context.tenant_ids).size!==context.tenant_ids.length)return invalidAuthority();
 const root=evaluateRoot(context); if(root)return root;
 const policy=registries.action_policy_registry.find((row)=>row.action===context.action&&row.resource_type===context.resource_type&&row.authorization_purpose===context.authorization_purpose&&row.risk===context.risk);
 if(!policy)return gap('AUTHORITY_COVERAGE_GAP','action-resource-purpose-risk-policy-v1');
 const acting=evaluateActing(context); if(acting)return acting;
 const tenant=evaluateTenant(context,policy); if(tenant)return tenant;
 if(!isRecord(context.party_graph))return gap('PARTY_INVENTORY_UNKNOWN','party-effect-graph-v1');
 const inventory=derivePartyInventorySnapshot(context.party_graph,context.party_proof,context.evaluation_effective_at);
 if(inventory.status==='unknown')return {status:'escalation',reason_code:'PARTY_INVENTORY_UNKNOWN'};
 if(context.acting_edges.length===0&&(!validActor(context.authenticated_principal)||!validActor(context.effective_actor)))return gap('ACTING_ENDPOINT_UNKNOWN','acting-endpoint-proof-v1');
 if(context.acting_edges.length===0&&!sameActor(context.authenticated_principal,context.effective_actor))return {status:'block',reason_code:'ACTING_CHAIN_END_MISMATCH'};
 const failed=explicitPrerequisiteFailure(context); if(failed)return failed;
 for(const requirement of policies.required_runtime_features)if(!isRecord(context.authority_features)||!Object.hasOwn(context.authority_features,requirement.feature))return gap('AUTHORITY_COVERAGE_GAP',requirement.coverage_gap_id);
 const grant=evaluateGrant(context); if(grant)return grant;
 const shapes=validateApprovalCapabilityShapes(context); if(shapes)return shapes;
 return gap('GRANT_VALIDITY_UNKNOWN','grant-chain-verification-v1');
}


export function evaluateAuthority(contextInput){
 let context;
 try{context=reducerSnapshot(contextInput);}catch{return invalidAuthority();}
 return evaluateAuthoritySnapshot(context);
}
const setSubset=(left,right)=>left.every((value)=>right.includes(value));
const MAX_EXACT_MINIMAL_CORES=256;
const minimalCoreSearchWithinBounds=(candidates)=>{
 let upperBound=1;
 for(const candidate of candidates){
  const falseCount=new Set(candidate.hard_constraints.filter((row)=>row.result==='F').map((row)=>row.constraint_id)).size;
  upperBound*=falseCount;
  if(upperBound>MAX_EXACT_MINIMAL_CORES)return false;
 }
 return true;
};
const minimalCores=(candidates)=>{
 const falseSets=candidates.map((candidate)=>canonicalStrings(candidate.hard_constraints.filter((row)=>row.result==='F').map((row)=>row.constraint_id)));
 const cores=[];
 const search=(chosen)=>{
  const canonicalChosen=canonicalStrings(chosen);
  if(cores.some((core)=>setSubset(core,canonicalChosen)))return;
  const uncovered=falseSets.find((set)=>!set.some((id)=>canonicalChosen.includes(id)));
  if(!uncovered){
   for(let index=cores.length-1;index>=0;index--)if(setSubset(canonicalChosen,cores[index]))cores.splice(index,1);
   cores.push(canonicalChosen); return;
  }
  for(const id of uncovered)search([...canonicalChosen,id]);
 };
 search([]);
 return canonicalSet(cores,(core)=>core);
};
const dimensionKey=(row)=>[row.party_or_cohort_id,row.criterion];
const dominates=(left,right,keys)=>keys.every((key)=>left.get(key)>=right.get(key))&&keys.some((key)=>left.get(key)>right.get(key));
const tieDecision=(universe,feasible_solution_ids)=>{
 let branch='complete_safe',reason_code='SOFT_PARETO_TIE';
 if(universe.authority_status!=='complete'){branch='authority_incomplete';reason_code='SOFT_TIE_AUTHORITY_INCOMPLETE';}
 else if(!['verified_complete','verified_no_affected_party'].includes(universe.party_inventory_status)){branch='party_incomplete';reason_code='SOFT_TIE_PARTY_INCOMPLETE';}
 else if(['unresolved','triggered'].includes(universe.safety_or_rights_floor_status)){branch='safety_or_rights_floor';reason_code='SOFT_TIE_SAFETY_FLOOR';}
 const decision=policies.soft_tie_table[branch];
 return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids,next_action:decision.next_action,release_recommendation:decision.release_recommendation,reason_code};
};
const selectionGate=(universe,feasible_solution_ids)=>{
 if(universe.authority_status!=='complete'||!['verified_complete','verified_no_affected_party'].includes(universe.party_inventory_status)||['unresolved','triggered'].includes(universe.safety_or_rights_floor_status))return tieDecision(universe,feasible_solution_ids);
 return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids,next_action:'bind_evaluator_gate',release_recommendation:'escalation',reason_code:'SOLVER_GATE_EVIDENCE_REQUIRED'};
};

export function solveCandidates(universeInput){
 let universe;
 try{universe=reducerSnapshot(universeInput);}catch{return invalidCandidates();}
 const schemaResult=validateBySchema('CandidateSolverInput',universe);
 if(!schemaResult.ok)return invalidCandidates();
 universe=schemaResult.value;
 const universeKeys=['candidate_universe','candidate_evaluations','authority_status','party_inventory_status','safety_or_rights_floor_status'];
 if(!exactKeys(universe,universeKeys)||!Array.isArray(universe.candidate_universe)||universe.candidate_universe.length===0||!Array.isArray(universe.candidate_evaluations)||!['complete','unknown'].includes(universe.authority_status)||!['unknown','verified_complete','verified_no_affected_party'].includes(universe.party_inventory_status)||!['not_applicable','resolved','unresolved','triggered'].includes(universe.safety_or_rights_floor_status))return invalidCandidates();
 const solutionSeen=new Set();
 for(const solution of universe.candidate_universe){
  if(!exactKeys(solution,['solution_id','option_ids'])||typeof solution.solution_id!=='string'||solution.solution_id.length===0||solutionSeen.has(solution.solution_id)||!isStringArray(solution.option_ids)&&!(Array.isArray(solution.option_ids)&&solution.option_ids.length===0)||new Set(solution.option_ids).size!==solution.option_ids.length)return invalidCandidates();
  solutionSeen.add(solution.solution_id);
 }
 const evaluationSeen=new Set();
 for(const evaluation of universe.candidate_evaluations){
  if(!exactKeys(evaluation,['solution_id','hard_constraints','soft_dimensions'])||typeof evaluation.solution_id!=='string'||!solutionSeen.has(evaluation.solution_id)||evaluationSeen.has(evaluation.solution_id)||!Array.isArray(evaluation.hard_constraints)||!Array.isArray(evaluation.soft_dimensions))return invalidCandidates();
  evaluationSeen.add(evaluation.solution_id);
  const constraintSeen=new Set();
  for(const row of evaluation.hard_constraints){
   if(!exactKeys(row,['constraint_id','result','conflict_class'])||typeof row.constraint_id!=='string'||row.constraint_id.length===0||constraintSeen.has(row.constraint_id)||!Object.hasOwn(policies.hard_constraint_result_table,row.result)||typeof row.conflict_class!=='string'||row.conflict_class.length===0)return invalidCandidates();
   constraintSeen.add(row.constraint_id);
  }
  const dimensionSeen=new Set();
  for(const row of evaluation.soft_dimensions){
   if(!exactKeys(row,['party_or_cohort_id','criterion','tier','value','floor_result'])||typeof row.party_or_cohort_id!=='string'||row.party_or_cohort_id.length===0||typeof row.criterion!=='string'||row.criterion.length===0||!Number.isInteger(row.tier)||row.tier<0||typeof row.value!=='number'||!Number.isFinite(row.value)||!Object.hasOwn(policies.soft_floor_result_table,row.floor_result))return invalidCandidates();
   const key=jcsBytes(dimensionKey(row)).toString('hex'); if(dimensionSeen.has(key))return invalidCandidates(); dimensionSeen.add(key);
  }
 }
 if(evaluationSeen.size!==solutionSeen.size)return invalidCandidates();
 let solutions,evaluations;
 try{solutions=canonicalSet(universe.candidate_universe,(solution)=>solution.solution_id); evaluations=new Map(universe.candidate_evaluations.map((evaluation)=>[evaluation.solution_id,evaluation]));}catch{return invalidCandidates();}
 const candidates=solutions.map((solution)=>({...solution,...evaluations.get(solution.solution_id)}));
 const feasible=candidates.filter((candidate)=>candidate.hard_constraints.every((row)=>row.result==='T'));
 const feasible_solution_ids=feasible.map((candidate)=>candidate.solution_id);
 if(candidates.some((candidate)=>candidate.hard_constraints.some((row)=>row.result==='E')))return {selection_status:'evaluation_error',selected_solution_id:null,feasible_solution_ids,next_action:'fix_evaluation_error',release_recommendation:'escalation',reason_code:'HARD_CONSTRAINT_EVALUATION_ERROR'};
 if(candidates.some((candidate)=>candidate.hard_constraints.some((row)=>row.result==='U')))return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids,next_action:'escalate_hard_constraint',release_recommendation:'escalation',reason_code:'HARD_CONSTRAINT_UNKNOWN'};
 if(feasible.length===0){
  if(!minimalCoreSearchWithinBounds(candidates))return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:[],next_action:'reduce_candidate_complexity',release_recommendation:'escalation',reason_code:'MINIMAL_CORE_COMPLEXITY_LIMIT'};
  const high=candidates.some((candidate)=>candidate.hard_constraints.some((row)=>row.result==='F'&&policies.zero_feasible_escalation_classes.includes(row.conflict_class)));
  return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids:[],unsat_cores:minimalCores(candidates),next_action:high?'escalate_high_risk_conflict':'resolve_mandatory_constraint',release_recommendation:high?'escalation':'block',reason_code:high?'HARD_CONSTRAINT_HIGH_RISK_UNSAT':'HARD_CONSTRAINT_UNSAT'};
 }
 if(feasible.some((candidate)=>candidate.soft_dimensions.some((row)=>row.floor_result==='E')))return {selection_status:'evaluation_error',selected_solution_id:null,feasible_solution_ids,next_action:'fix_evaluation_error',release_recommendation:'escalation',reason_code:'SOFT_FLOOR_EVALUATION_ERROR'};
 if(feasible.some((candidate)=>candidate.soft_dimensions.some((row)=>row.floor_result==='U')))return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids,next_action:'escalate_safety_or_rights',release_recommendation:'escalation',reason_code:'SOFT_FLOOR_UNKNOWN'};
 let eligible=feasible.filter((candidate)=>candidate.soft_dimensions.every((row)=>row.floor_result==='T'));
 if(eligible.length===0)return {selection_status:'undecided',selected_solution_id:null,feasible_solution_ids,next_action:'escalate_safety_or_rights',release_recommendation:'escalation',reason_code:'SOFT_FLOOR_UNSAT'};
 const gate=selectionGate(universe,feasible_solution_ids); if(gate)return gate;
 if(eligible.length===1)return {selection_status:'selected',selected_solution_id:eligible[0].solution_id,feasible_solution_ids,next_action:'proceed',release_recommendation:'continue',reason_code:'UNIQUE_PARETO_SOLUTION'};
 const signature=(candidate)=>canonicalSet(candidate.soft_dimensions.map((row)=>({key:dimensionKey(row),tier:row.tier})),(row)=>row.key);
 const expected=jcsBytes(signature(eligible[0]));
 if(eligible.some((candidate)=>!jcsBytes(signature(candidate)).equals(expected)))return invalidCandidates();
 const tiers=[...new Set(eligible.flatMap((candidate)=>candidate.soft_dimensions.map((row)=>row.tier)))].sort((a,b)=>a-b);
 for(const tier of tiers){
  const keys=canonicalStrings(eligible[0].soft_dimensions.filter((row)=>row.tier===tier).map((row)=>jcsBytes(dimensionKey(row)).toString('hex')));
  const scoreMap=(candidate)=>new Map(candidate.soft_dimensions.filter((row)=>row.tier===tier).map((row)=>[jcsBytes(dimensionKey(row)).toString('hex'),row.value]));
  const maps=new Map(eligible.map((candidate)=>[candidate.solution_id,scoreMap(candidate)]));
  const pareto=eligible.filter((candidate)=>!eligible.some((other)=>other!==candidate&&dominates(maps.get(other.solution_id),maps.get(candidate.solution_id),keys)));
  if(pareto.length===1)return {selection_status:'selected',selected_solution_id:pareto[0].solution_id,feasible_solution_ids,next_action:'proceed',release_recommendation:'continue',reason_code:'UNIQUE_PARETO_SOLUTION'};
  const firstVector=keys.map((key)=>maps.get(pareto[0].solution_id).get(key));
  if(pareto.some((candidate)=>!jcsBytes(keys.map((key)=>maps.get(candidate.solution_id).get(key))).equals(jcsBytes(firstVector))))return tieDecision(universe,feasible_solution_ids);
  eligible=pareto;
 }
 return tieDecision(universe,feasible_solution_ids);
}