import { createHash } from 'node:crypto';
import { canonicalSet, jcsBytes } from './canonical.mjs';

const text=(v)=>typeof v==='string'&&v.length>0&&v.normalize('NFC')===v;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every((key)=>Object.hasOwn(v,key));
const copy=(value)=>JSON.parse(jcsBytes(value).toString('utf8'));
const oneOf=(v,values)=>values.includes(v);
const hash=(domain,value)=>createHash('sha256').update(domain).update(jcsBytes(value)).digest('hex');
const SCORES=Object.freeze({rejected:0,unknown:1,verified_with_limit:2,verified:3});
const GRADES=Object.freeze(['insufficient','limited','adequate','high']);
const DIMS=Object.freeze(['directness','precision','transportability','validity']);
const CONCLUSIONS=Object.freeze(['normative','causal','associational','predictive','descriptive','reported_experience','observed_signal','unresolved']);
const CLAIM_KINDS=Object.freeze(['normative','causal','predictive','reported_experience','observed_signal']);
const CLAIM_KEYS=Object.freeze(['claim_id','claim_kind','relation_kind','predicate_id','population_id','context_id','time_scope_id','subject_id','value','evidence_refs']);
const EVIDENCE_KEYS=Object.freeze(['checks','selection_status','contradiction_status','measured_covariation','verifiable_observation','prediction_observed_outcome_pair','intervention_id','counterfactual_id','effect_estimand_id','future_target_id']);
const CHECK_KEYS=Object.freeze(['required_check_id','status','dependency_cluster_id','evidence_refs']);
const POLICY_KEYS=Object.freeze(['policy_id','claim_kind','required_checks']);
const POLICY_CHECK_KEYS=Object.freeze(['required_check_id','dimension','critical','evaluator_invariant']);
const invalidClaim=(claim,reason='INVALID_INPUT')=>{
 const body={
  claim_id:claim&&text(claim.claim_id)?claim.claim_id:'invalid',
  policy_id:'unresolved',status:'unresolved',assessed_predicate:null,checks:[],
  dimension_scores:DIMS.map((dimension)=>({dimension,score:0,grade:'insufficient'})),
  evidence_grade:{validity:'insufficient',directness:'insufficient',precision:'insufficient',transportability:'insufficient',overall:'insufficient'},
  reason_codes:[reason]
 };
 return{claim_assessment_id:'ca_'+hash('ux-skill:claim-assessment:v1',body).slice(0,32),...body};
};
const validClaim=(claim)=>exact(claim,CLAIM_KEYS)&&text(claim.claim_id)&&oneOf(claim.claim_kind,CLAIM_KINDS)&&claim.relation_kind===claim.claim_kind&&text(claim.predicate_id)&&text(claim.population_id)&&text(claim.context_id)&&text(claim.time_scope_id)&&text(claim.subject_id)&&text(claim.value)&&Array.isArray(claim.evidence_refs)&&claim.evidence_refs.every(text);
const validEvidence=(evidence)=>exact(evidence,EVIDENCE_KEYS)&&Array.isArray(evidence.checks)&&oneOf(evidence.selection_status,['verified','incomplete','unknown'])&&oneOf(evidence.contradiction_status,['resolved','unresolved','unknown'])&&['measured_covariation','verifiable_observation','prediction_observed_outcome_pair'].every((key)=>typeof evidence[key]==='boolean')&&['intervention_id','counterfactual_id','effect_estimand_id','future_target_id'].every((key)=>evidence[key]===null||text(evidence[key]))&&evidence.checks.every((row)=>exact(row,CHECK_KEYS)&&text(row.required_check_id)&&Object.hasOwn(SCORES,row.status)&&text(row.dependency_cluster_id)&&Array.isArray(row.evidence_refs)&&row.evidence_refs.every(text));
const validPolicy=(policy,kind)=>exact(policy,POLICY_KEYS)&&text(policy.policy_id)&&policy.claim_kind===kind&&Array.isArray(policy.required_checks)&&policy.required_checks.length>0&&policy.required_checks.every((row)=>exact(row,POLICY_CHECK_KEYS)&&text(row.required_check_id)&&oneOf(row.dimension,DIMS)&&typeof row.critical==='boolean'&&text(row.evaluator_invariant))&&new Set(policy.required_checks.map((row)=>row.required_check_id)).size===policy.required_checks.length&&DIMS.every((dimension)=>policy.required_checks.some((row)=>row.dimension===dimension));
const predicate=(kind,claim,evidence)=>{
 const observed={relation_kind:kind,subject_id:claim.subject_id,value:claim.value,context_id:claim.context_id,time_scope_id:claim.time_scope_id};
 if(['normative','causal','associational','predictive','reported_experience','observed_signal'].includes(kind)){observed.predicate_id=claim.predicate_id;observed.population_id=claim.population_id;}
 if(kind==='causal'){observed.intervention_id=evidence.intervention_id;observed.counterfactual_id=evidence.counterfactual_id;observed.effect_estimand_id=evidence.effect_estimand_id;}
 if(kind==='predictive')observed.future_target_id=evidence.future_target_id;
 return observed;
};
export function assessClaim(claim,evidence,policy){
 try{
  const c=copy(claim),e=copy(evidence);if(!validClaim(c)||!validEvidence(e))return invalidClaim(c);
  if(policy===null||policy===undefined)return invalidClaim(c,'POLICY_ROW_MISSING');
  const p=copy(policy);if(!validPolicy(p,c.claim_kind))return invalidClaim(c);
  const policyIds=new Set(p.required_checks.map((row)=>row.required_check_id));
  if(e.checks.some((row)=>!policyIds.has(row.required_check_id)))return invalidClaim(c);
  const clusterMin=new Map();
  for(const row of e.checks){const current=clusterMin.get(row.dependency_cluster_id);clusterMin.set(row.dependency_cluster_id,current===undefined?SCORES[row.status]:Math.min(current,SCORES[row.status]));}
  const checks=p.required_checks.map((required)=>{
   const rows=e.checks.filter((row)=>row.required_check_id===required.required_check_id);
   const score=rows.length?Math.min(...rows.map((row)=>clusterMin.get(row.dependency_cluster_id))):1;
   const evidence_refs=canonicalSet(rows.flatMap((row)=>row.evidence_refs),(item)=>item);
   return{required_check_id:required.required_check_id,dimension:required.dimension,critical:required.critical,status:Object.keys(SCORES).find((key)=>SCORES[key]===score),score,evidence_refs,reason_codes:rows.length?[]:['CHECK_MISSING']};
  });
  const dimension_scores=DIMS.map((dimension)=>{const values=checks.filter((row)=>row.dimension===dimension).map((row)=>row.score);const score=Math.min(...values);return{dimension,score,grade:GRADES[score]};});
  const grade={};for(const row of dimension_scores)grade[row.dimension]=row.grade;
  let overall=Math.min(...dimension_scores.map((row)=>row.score));if(e.selection_status!=='verified'||e.contradiction_status!=='resolved')overall=Math.min(overall,1);grade.overall=GRADES[overall];
  const score=(id)=>checks.find((row)=>row.required_check_id===id)?.score??-1;
  const critical=checks.filter((row)=>row.critical);
  let status='unresolved';
  if(c.claim_kind==='normative'){if(critical.every((row)=>row.score===3))status='normative';}
  else if(c.claim_kind==='causal'){
   const strong=['temporal','comparator','identification','estimand'].every((id)=>score(id)===3)&&critical.every((row)=>row.score>=2)&&text(e.intervention_id)&&text(e.counterfactual_id)&&text(e.effect_estimand_id);
   if(strong)status='causal';else if(score('temporal')>=2&&score('comparator')>=2&&e.measured_covariation)status='associational';else if(e.verifiable_observation)status='descriptive';
  }else if(c.claim_kind==='predictive'){
   const strong=['independent_validation','calibration','baseline','target_population','drift'].every((id)=>score(id)>=2)&&critical.every((row)=>row.score>=2)&&text(e.future_target_id);
   if(strong)status='predictive';else if(e.prediction_observed_outcome_pair)status='descriptive';
  }else status=c.claim_kind;
  const assessed_predicate=status==='unresolved'?null:predicate(status,c,e);
  const reason_codes=status==='unresolved'?['CLAIM_UNRESOLVED']:(status===c.claim_kind?[]:['CLAIM_DOWNGRADED']);
  const body={claim_id:c.claim_id,policy_id:p.policy_id,status,assessed_predicate,checks,dimension_scores,evidence_grade:grade,reason_codes};
  return{claim_assessment_id:'ca_'+hash('ux-skill:claim-assessment:v1',body).slice(0,32),...body};
 }catch{return invalidClaim(null);}
}
const FINDING_KEYS=Object.freeze(['mandatory_fail','hard_unsat','hard_decision','release_critical','outcome']);
const CONTEXT_KEYS=Object.freeze(['severity','likelihood','exposure','reversibility','key_factor_status','purpose','materially_relies_on','inference_kind','prohibition_status','mandatory_check_status','other_hard_checks_status','signal_policy_row']);
const sensitivePurposes=new Set(['eligibility','pricing','employment','education','health','insurance','credit','vulnerability_targeting','manipulative_intervention']);
export function assessRisk(finding,context){
 try{
  const f=copy(finding),c=copy(context);
  if(!exact(f,FINDING_KEYS)||!exact(c,CONTEXT_KEYS)||!['block','escalation','none'].includes(f.hard_decision)||typeof f.mandatory_fail!=='boolean'||typeof f.hard_unsat!=='boolean'||typeof f.release_critical!=='boolean'||!['pass','fail','partial','not_run','unknown','evaluation_error'].includes(f.outcome)||!['low','moderate','severe','catastrophic','unknown'].includes(c.severity)||!['known','unknown'].includes(c.likelihood)||!['known','unknown'].includes(c.exposure)||!['reversible','irreversible','unknown'].includes(c.reversibility)||!['verified','unknown'].includes(c.key_factor_status)||!text(c.purpose)||typeof c.materially_relies_on!=='boolean'||!['observed_signal','reported_experience','derived','other'].includes(c.inference_kind)||!['applicable','not_applicable','unknown'].includes(c.prohibition_status)||!['pass','fail','unknown'].includes(c.mandatory_check_status)||!['pass','fail','unknown'].includes(c.other_hard_checks_status)||c.signal_policy_row!==null)return{decision:'escalation',reason_code:'INVALID_INPUT'};
  if((f.mandatory_fail||f.hard_unsat)&&f.hard_decision==='none')return{decision:'escalation',reason_code:'INVALID_INPUT'};
  if(f.hard_decision==='block')return{decision:'block',reason_code:'HARD_DECISION_BLOCK'};
  if(f.hard_decision==='escalation')return{decision:'escalation',reason_code:'HARD_DECISION_ESCALATION'};
  if(f.release_critical&&['evaluation_error','not_run','unknown','partial'].includes(f.outcome))return{decision:'escalation',reason_code:'RELEASE_CRITICAL_GAP'};
  if(['catastrophic','severe'].includes(c.severity)&&(c.likelihood==='unknown'||c.exposure==='unknown'))return{decision:'investigate_immediately',reason_code:'SEVERE_FACTOR_UNKNOWN'};
  if(c.reversibility==='irreversible'&&c.key_factor_status==='unknown')return{decision:'investigate_immediately',reason_code:'IRREVERSIBLE_FACTOR_UNKNOWN'};
  const sensitive=sensitivePurposes.has(c.purpose),derived=['observed_signal','reported_experience','derived'].includes(c.inference_kind);
  if(sensitive&&c.materially_relies_on&&derived){
   if(c.prohibition_status==='applicable'||c.mandatory_check_status==='fail')return{decision:'block',reason_code:'SENSITIVE_MATERIAL_PROHIBITED'};
   return{decision:'escalation',reason_code:'SENSITIVE_MATERIAL_DEFAULT'};
  }
  if(sensitive&&!c.materially_relies_on&&c.other_hard_checks_status!=='pass')return{decision:'escalation',reason_code:'SENSITIVE_HARD_CHECK_GAP'};
  return{decision:'clear',reason_code:'RISK_CLEAR'};
 }catch{return{decision:'escalation',reason_code:'INVALID_INPUT'};}
}
const ACTION_KEYS=Object.freeze(['action_id','target_id','scope_id']);
const AUTH_KEYS=Object.freeze(['prohibition','applicability','conflict','requirement_kind','required_action','outcome_equivalent_verified']);
const REC_EVIDENCE_KEYS=Object.freeze(['admissible_conclusion','overall','assessed_action']);
const REC_KEYS=Object.freeze(['action','authority','evidence','risk_decision','reversibility','exact_mandatory_action','hard_decision','sensitive_decision']);
const validAction=(v)=>exact(v,ACTION_KEYS)&&ACTION_KEYS.every((key)=>text(v[key]));
const sameAction=(a,b)=>validAction(a)&&validAction(b)&&jcsBytes(a).equals(jcsBytes(b));
const invalidRecommendation=()=>({ceilings:{authority:'none',evidence:'none',risk:'none',reversibility:'none'},minimum_ceiling:'none',strength:'none',output_kind:'research_question',recommendation:null,research_question:{question_id:'rq_invalid',kind:'decision_gap',prompt_code:'INVALID_INPUT'},reason_codes:['INVALID_INPUT']});
const order=['none','explore','conditional_advice','strong_advice','required'];
export function assessRecommendation(parts){
 try{
  const p=copy(parts);if(!exact(p,REC_KEYS)||!validAction(p.action)||!exact(p.authority,AUTH_KEYS)||!exact(p.evidence,REC_EVIDENCE_KEYS)||!['applicable','not_applicable'].includes(p.authority.prohibition)||!['known','unknown'].includes(p.authority.applicability)||!['none','unknown'].includes(p.authority.conflict)||!['none','exact_requires','outcome_only'].includes(p.authority.requirement_kind)||(p.authority.required_action!==null&&!validAction(p.authority.required_action))||typeof p.authority.outcome_equivalent_verified!=='boolean'||!CONCLUSIONS.includes(p.evidence.admissible_conclusion)||!GRADES.includes(p.evidence.overall)||(p.evidence.assessed_action!==null&&!validAction(p.evidence.assessed_action))||!['clear','block','escalation','investigate_immediately'].includes(p.risk_decision)||!['reversible','irreversible','unknown'].includes(p.reversibility)||typeof p.exact_mandatory_action!=='boolean'||!['clear','block','escalation'].includes(p.hard_decision)||!['continue','block','escalation'].includes(p.sensitive_decision))return invalidRecommendation();
  const exactMandatoryAction=p.authority.requirement_kind==='exact_requires'&&sameAction(p.authority.required_action,p.action);
  let authority;
  if(p.authority.prohibition==='applicable')authority='none';
  else if(p.authority.applicability==='unknown'||p.authority.conflict==='unknown')authority='explore';
  else if(p.authority.requirement_kind==='exact_requires'&&sameAction(p.authority.required_action,p.action))authority='required';
  else if(p.authority.requirement_kind==='outcome_only'&&p.authority.outcome_equivalent_verified)authority='conditional_advice';
  else authority='required';
  let evidenceCeiling;
  if(p.evidence.admissible_conclusion==='unresolved'||p.evidence.overall==='insufficient')evidenceCeiling='none';
  else if(p.evidence.overall==='limited')evidenceCeiling='explore';
  else if(p.evidence.overall==='adequate')evidenceCeiling='conditional_advice';
  else if(p.evidence.admissible_conclusion==='causal')evidenceCeiling='strong_advice';
  else if(p.evidence.admissible_conclusion==='normative'&&sameAction(p.evidence.assessed_action,p.action))evidenceCeiling='required';
  else evidenceCeiling='conditional_advice';
  const risk=p.risk_decision==='block'?'none':(['escalation','investigate_immediately'].includes(p.risk_decision)?'explore':'required');
  const reversibility=p.reversibility==='irreversible'&&!exactMandatoryAction?'conditional_advice':(p.reversibility==='unknown'?'explore':'required');
  const ceilings={authority,evidence:evidenceCeiling,risk,reversibility};
  let strength;
  if(p.hard_decision==='block'||p.sensitive_decision==='block'||authority==='none'||risk==='none')strength='none';
  else{const cap=(p.hard_decision==='escalation'||p.sensitive_decision==='escalation'||['escalation','investigate_immediately'].includes(p.risk_decision))?'explore':'required';strength=[...Object.values(ceilings),cap].reduce((a,b)=>order[Math.min(order.indexOf(a),order.indexOf(b))]);}
  if(strength==='required'&&authority!=='required')strength='strong_advice';
  const base={ceilings,minimum_ceiling:strength,strength,reason_codes:[]};
  if(strength==='none'){const question_id='rq_'+hash('ux-skill:research-question:v1',{action:p.action,ceilings}).slice(0,32);return{...base,output_kind:'research_question',recommendation:null,research_question:{question_id,kind:'decision_gap',prompt_code:'EVIDENCE_OR_AUTHORITY_GAP'}};}
  return{...base,output_kind:'recommendation',recommendation:{action:p.action,strength},research_question:null};
 }catch{return invalidRecommendation();}
}
const RELEASE_KEYS=Object.freeze(['gates','selection','authority_complete','critical_status','tail_unknown','conditions']);
const CONDITION_KEYS=Object.freeze(['predicate','owner','deadline','verification_method','status']);
const invalidRelease=()=>({status:'escalation',next_action:'fix_invalid_input',conditions:[],reason_code:'INVALID_INPUT'});
export function reduceRelease(parts){
 try{
  const p=copy(parts);if(!exact(p,RELEASE_KEYS)||!Array.isArray(p.gates)||p.gates.length===0||p.gates.some((g)=>!['clear','block','escalation','investigate_immediately'].includes(g))||!['decided','undecided'].includes(p.selection)||typeof p.authority_complete!=='boolean'||!['pass','not_applicable','fail'].includes(p.critical_status)||typeof p.tail_unknown!=='boolean'||!Array.isArray(p.conditions)||p.conditions.some((row)=>!exact(row,CONDITION_KEYS)||!text(row.predicate)||!text(row.owner)||!text(row.deadline)||!text(row.verification_method)||!['verified_executable','unknown','rejected_or_infeasible'].includes(row.status)))return invalidRelease();
  const gates=canonicalSet(p.gates,(item)=>item),conditions=canonicalSet(p.conditions,(row)=>[row.predicate,row.owner,row.deadline,row.verification_method]);
  if(gates.includes('block')||p.critical_status==='fail'||conditions.some((row)=>row.status==='rejected_or_infeasible'))return{status:'block',next_action:'stop',conditions,reason_code:'RELEASE_BLOCKED'};
  if(gates.some((g)=>['escalation','investigate_immediately'].includes(g))||!p.authority_complete||p.tail_unknown||conditions.some((row)=>row.status==='unknown'))return{status:'escalation',next_action:'escalate',conditions,reason_code:'RELEASE_ESCALATED'};
  if(p.selection==='undecided')return{status:'undecided',next_action:'ask_decision_owner',conditions,reason_code:'SOFT_SELECTION_UNDECIDED'};
  if(p.critical_status!=='pass'&&p.critical_status!=='not_applicable')return invalidRelease();
  if(conditions.length===0)return{status:'allow',next_action:'release',conditions,reason_code:'RELEASE_CLEAR'};
  return{status:'allow_with_conditions',next_action:'verify_and_release',conditions,reason_code:'RELEASE_CONDITIONAL'};
 }catch{return invalidRelease();}
}