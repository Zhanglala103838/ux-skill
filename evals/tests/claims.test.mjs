import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const loadRuntime=()=>import('../../evaluator/claims.mjs');
const fixtureIds=['CLAIM-DOWNGRADE-001','REC-WEAK-001','REC-HIGH-NORMATIVE-NONENTAIL-001','REC-REDUCER-001','RELEASE-SOFT-TIE-001'];
const loadFixture=async(id)=>JSON.parse(await readFile(new URL('../fixtures/'+id+'.json',import.meta.url),'utf8'));
const baseClaim=(overrides={})=>({claim_id:'claim-1',claim_kind:'causal',relation_kind:'causal',predicate_id:'task-success',population_id:'operators',context_id:'admin',time_scope_id:'snapshot-1',subject_id:'completion',value:'improved',evidence_refs:['ev-1'],...overrides});
const policy=(claim_kind,ids)=>({policy_id:'policy-'+claim_kind,claim_kind,required_checks:ids.map(([required_check_id,dimension,critical=true])=>({required_check_id,dimension,critical,evaluator_invariant:'evaluator-owned:'+required_check_id}))});
const evidence=(rows,overrides={})=>({checks:rows.map(([required_check_id,status,dependency_cluster_id])=>({required_check_id,status,dependency_cluster_id,evidence_refs:['ev-'+required_check_id]})),selection_status:'verified',contradiction_status:'resolved',measured_covariation:false,verifiable_observation:false,prediction_observed_outcome_pair:false,intervention_id:null,counterfactual_id:null,effect_estimand_id:null,future_target_id:null,...overrides});
const action=(action_id='disable-submit')=>({action_id,target_id:'checkout',scope_id:'admin'});

test('TASK6_RED_FIXTURES execute all five planned current fixtures',async()=>{
 const runtime=await loadRuntime();
 for(const id of fixtureIds){
  const row=await loadFixture(id);assert.equal(row.vector_id,id);assert.equal(row.catalog_mutation,false);
  let actual;
  if(row.operation==='assessClaim')actual=runtime.assessClaim(row.input.claim,row.input.evidence,row.input.policy);
  else if(row.operation==='assessRecommendation')actual=runtime.assessRecommendation(row.input);
  else if(row.operation==='reduceRelease')actual=runtime.reduceRelease(row.input);
  else assert.fail('unsupported operation '+row.operation);
  for(const [pointer,expected] of Object.entries(row.expected)){
   const value=pointer.split('/').slice(1).reduce((current,key)=>current?.[key],actual);
   assert.deepEqual(value,expected,id+' '+pointer);
  }
 }
});

test('TASK6_RED_CLAIM grade is four-dimension min with caps, unique downgrade, and no semantic recovery',async()=>{
 const {assessClaim}=await loadRuntime();
 const ids=[['temporal','validity'],['comparator','directness'],['identification','validity'],['estimand','precision'],['transport','transportability']];
 const causalPolicy=policy('causal',ids);
 const associative=assessClaim(baseClaim(),evidence([['temporal','verified','cluster-t'],['comparator','verified_with_limit','cluster-c'],['identification','unknown','cluster-i'],['estimand','verified','cluster-e'],['transport','verified','cluster-x']],{measured_covariation:true,intervention_id:'do-x',counterfactual_id:'no-x',effect_estimand_id:'ate'}),causalPolicy);
 assert.equal(associative.status,'associational');assert.equal(associative.evidence_grade.overall,'limited');
 assert.deepEqual(Object.keys(associative.assessed_predicate).sort(),['context_id','population_id','predicate_id','relation_kind','subject_id','time_scope_id','value']);
 assert.equal(associative.assessed_predicate.relation_kind,'associational');
 const capped=assessClaim(baseClaim(),evidence(ids.map(([id])=>[id,'verified','cluster-'+id]),{selection_status:'unknown',measured_covariation:true,intervention_id:'do-x',counterfactual_id:'no-x',effect_estimand_id:'ate'}),causalPolicy);
 assert.equal(capped.evidence_grade.overall,'limited');
 const duplicateCluster=assessClaim(baseClaim(),evidence([['temporal','verified','shared'],['temporal','rejected','shared'],['comparator','verified','c'],['identification','verified','i'],['estimand','verified','e'],['transport','verified','x']],{measured_covariation:true}),causalPolicy);
 assert.equal(duplicateCluster.evidence_grade.validity,'insufficient');assert.notEqual(duplicateCluster.status,'causal');
 const missing=assessClaim(baseClaim({claim_kind:'normative',relation_kind:'normative'}),evidence([]),null);
 assert.equal(missing.status,'unresolved');assert.equal(missing.assessed_predicate,null);assert.deepEqual(missing.reason_codes,['POLICY_ROW_MISSING']);
});

test('TASK6_RED_PREDICATE tagged union omits non-applicable fields and rejects outer mismatch',async()=>{
 const {assessClaim}=await loadRuntime();
 const causalIds=[['temporal','validity'],['comparator','directness'],['identification','validity'],['estimand','precision'],['transport','transportability']];
 const causal=assessClaim(baseClaim(),evidence(causalIds.map(([id])=>[id,'verified','c-'+id]),{intervention_id:'do-x',counterfactual_id:'no-x',effect_estimand_id:'ate'}),policy('causal',causalIds));
 assert.equal(causal.status,'causal');
 assert.deepEqual(Object.keys(causal.assessed_predicate).sort(),['context_id','counterfactual_id','effect_estimand_id','intervention_id','population_id','predicate_id','relation_kind','subject_id','time_scope_id','value']);
 const descriptive=assessClaim(baseClaim(),evidence(causalIds.map(([id])=>[id,'unknown','d-'+id]),{verifiable_observation:true,intervention_id:'forbidden'}),policy('causal',causalIds));
 assert.equal(descriptive.status,'descriptive');
 assert.deepEqual(Object.keys(descriptive.assessed_predicate).sort(),['context_id','relation_kind','subject_id','time_scope_id','value']);
 const normIds=[['authority-entailment','validity'],['scope','directness'],['precision','precision'],['transport','transportability']];
 const normative=assessClaim(baseClaim({claim_kind:'normative',relation_kind:'normative'}),evidence(normIds.map(([id])=>[id,'verified','n-'+id])),policy('normative',normIds));
 assert.equal(normative.status,'normative');
 assert.deepEqual(Object.keys(normative.assessed_predicate).sort(),['context_id','population_id','predicate_id','relation_kind','subject_id','time_scope_id','value']);
 const predIds=[['independent_validation','validity'],['calibration','precision'],['baseline','directness'],['target_population','transportability'],['drift','validity']];
 const predictive=assessClaim(baseClaim({claim_kind:'predictive',relation_kind:'predictive'}),evidence(predIds.map(([id])=>[id,'verified_with_limit','p-'+id]),{future_target_id:'future-success'}),policy('predictive',predIds));
 assert.equal(predictive.status,'predictive');
 assert.deepEqual(Object.keys(predictive.assessed_predicate).sort(),['context_id','future_target_id','population_id','predicate_id','relation_kind','subject_id','time_scope_id','value']);
 const invalid=assessClaim(baseClaim({relation_kind:'normative'}),evidence([]),policy('causal',causalIds));
 assert.equal(invalid.status,'unresolved');assert.equal(invalid.assessed_predicate,null);assert.deepEqual(invalid.reason_codes,['INVALID_INPUT']);
});

test('TASK6_RED_RISK RiskDecisionPolicy and sensitive default matrix are first-match',async()=>{
 const {assessRisk}=await loadRuntime();
 const finding={mandatory_fail:true,hard_unsat:true,hard_decision:'block',release_critical:true,outcome:'unknown'};
 const context={severity:'severe',likelihood:'unknown',exposure:'unknown',reversibility:'irreversible',key_factor_status:'unknown',purpose:'eligibility',materially_relies_on:true,inference_kind:'observed_signal',prohibition_status:'unknown',mandatory_check_status:'unknown',other_hard_checks_status:'pass',signal_policy_row:null};
 assert.deepEqual(assessRisk(finding,context),{decision:'block',reason_code:'HARD_DECISION_BLOCK'});
 const sensitive=assessRisk({...finding,mandatory_fail:false,hard_unsat:false,hard_decision:'none',release_critical:false,outcome:'pass'},{...context,severity:'moderate',likelihood:'known',exposure:'known',reversibility:'reversible',key_factor_status:'verified',prohibition_status:'not_applicable'});
 assert.deepEqual(sensitive,{decision:'escalation',reason_code:'SENSITIVE_MATERIAL_DEFAULT'});
 const nonMaterial=assessRisk({...finding,mandatory_fail:false,hard_unsat:false,hard_decision:'none',release_critical:false,outcome:'pass'},{...context,severity:'moderate',likelihood:'known',exposure:'known',reversibility:'reversible',key_factor_status:'verified',materially_relies_on:false,prohibition_status:'not_applicable',mandatory_check_status:'pass'});
 assert.deepEqual(nonMaterial,{decision:'clear',reason_code:'RISK_CLEAR'});
});

test('TASK6_RED_RECOMMENDATION four ceilings use first-match, exact entailment, ordered min, and none only inquiry',async()=>{
 const {assessRecommendation}=await loadRuntime();const a=action();
 const weak=assessRecommendation({action:a,authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'none',required_action:null,outcome_equivalent_verified:false},evidence:{admissible_conclusion:'unresolved',overall:'limited',assessed_action:null},risk_decision:'clear',reversibility:'reversible',exact_mandatory_action:false,hard_decision:'clear',sensitive_decision:'continue'});
 assert.equal(weak.ceilings.evidence,'none');assert.equal(weak.strength,'none');assert.equal(weak.output_kind,'research_question');assert.equal(weak.recommendation,null);assert.equal(typeof weak.research_question.question_id,'string');
 const nonEntail=assessRecommendation({action:a,authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'exact_requires',required_action:a,outcome_equivalent_verified:false},evidence:{admissible_conclusion:'normative',overall:'high',assessed_action:action('different-action')},risk_decision:'clear',reversibility:'reversible',exact_mandatory_action:true,hard_decision:'clear',sensitive_decision:'continue'});
 assert.equal(nonEntail.ceilings.authority,'required');assert.equal(nonEntail.ceilings.evidence,'conditional_advice');assert.equal(nonEntail.strength,'conditional_advice');
 const blocked=assessRecommendation({action:a,authority:{prohibition:'applicable',applicability:'known',conflict:'none',requirement_kind:'none',required_action:null,outcome_equivalent_verified:false},evidence:{admissible_conclusion:'causal',overall:'high',assessed_action:a},risk_decision:'clear',reversibility:'reversible',exact_mandatory_action:false,hard_decision:'block',sensitive_decision:'continue'});
 assert.equal(blocked.strength,'none');assert.equal(blocked.output_kind,'research_question');assert.equal(blocked.recommendation,null);
});

test('TASK6_RED_RELEASE conditions canonicalize and first-match block escalation tie allow',async()=>{
 const {reduceRelease}=await loadRuntime();
 const condition=(predicate,status,owner='owner')=>({predicate,owner,deadline:'2026-09-01T00:00:00Z',verification_method:'test',status});
 const base={gates:['clear'],selection:'decided',authority_complete:true,critical_status:'pass',tail_unknown:false,conditions:[]};
 assert.equal(reduceRelease(base).status,'allow');
 assert.equal(reduceRelease({...base,conditions:[condition('b','verified_executable'),condition('a','verified_executable')]}).status,'allow_with_conditions');
 assert.deepEqual(reduceRelease({...base,conditions:[condition('b','verified_executable'),condition('a','verified_executable')]}).conditions.map(x=>x.predicate),['a','b']);
 assert.equal(reduceRelease({...base,gates:['clear','block'],selection:'undecided',conditions:[condition('x','unknown')]}).status,'block');
 assert.equal(reduceRelease({...base,selection:'undecided'}).status,'undecided');
 assert.equal(reduceRelease({...base,conditions:[condition('x','unknown')]}).status,'escalation');
 assert.equal(reduceRelease({...base,conditions:[condition('x','rejected_or_infeasible')]}).status,'block');
});

test('TASK6_RED_HOSTILE public reducers are total, closed, Unicode-safe, and fail closed',async()=>{
 const runtime=await loadRuntime();const hostile=[undefined,null,42,'x',[],{},Object.create(null),{unknown:true},{text:'e\\u0301'}];const cycle={};cycle.self=cycle;hostile.push(cycle);
 for(const value of hostile){
  assert.doesNotThrow(()=>runtime.assessClaim(value,value,value));assert.equal(runtime.assessClaim(value,value,value).status,'unresolved');
  assert.doesNotThrow(()=>runtime.assessRisk(value,value));assert.notEqual(runtime.assessRisk(value,value).decision,'clear');
  assert.doesNotThrow(()=>runtime.assessRecommendation(value));assert.equal(runtime.assessRecommendation(value).strength,'none');
  assert.doesNotThrow(()=>runtime.reduceRelease(value));assert.notEqual(runtime.reduceRelease(value).status,'allow');
 }
 const proto={claim_id:'x'};assert.equal(runtime.assessClaim(Object.assign(Object.create(proto),baseClaim()),evidence([]),policy('causal',[['x','validity']])).status,'unresolved');
});

test('TASK6_REVIEW_RED_INVALID_ASSESSMENT_ID binds complete body and avoids collection conflicts',async()=>{
 const {assessClaim}=await loadRuntime();
 const {validateBySchema}=await import('../../evaluator/validation.mjs');
 const validEvidence=evidence([]);
 const claimA=baseClaim({claim_id:'claim-gap-a',claim_kind:'normative',relation_kind:'normative'});
 const claimB=baseClaim({claim_id:'claim-gap-b',claim_kind:'normative',relation_kind:'normative'});
 const assessmentA=assessClaim(claimA,validEvidence,null);
 const assessmentB=assessClaim(claimB,validEvidence,null);
 const replayA=assessClaim(claimA,validEvidence,null);
 assert.notEqual(assessmentA.claim_assessment_id,assessmentB.claim_assessment_id);
 assert.equal(assessmentA.claim_assessment_id,replayA.claim_assessment_id);
 assert.deepEqual(assessmentA,replayA);
 const bundle={sources:[],fragments:[],proposition_assessments:[],policy_adoptions:[],claims:[claimA,claimB],claim_assessments:[assessmentA,assessmentB],claim_assessment_policies:[]};
 const result=validateBySchema('ClaimsBundle',bundle);
 assert.equal(result.ok,true);
});

test('TASK6_REVIEW_RED_RISK_COHERENCE mandatory and hard facts cannot clear through none',async()=>{
 const {assessRisk}=await loadRuntime();
 const context={severity:'moderate',likelihood:'known',exposure:'known',reversibility:'reversible',key_factor_status:'verified',purpose:'other',materially_relies_on:false,inference_kind:'other',prohibition_status:'not_applicable',mandatory_check_status:'pass',other_hard_checks_status:'pass',signal_policy_row:null};
 const finding=(mandatory_fail,hard_unsat,hard_decision)=>({mandatory_fail,hard_unsat,hard_decision,release_critical:false,outcome:'pass'});
 for(const flags of [[true,false],[false,true],[true,true]])assert.deepEqual(assessRisk(finding(flags[0],flags[1],'none'),context),{decision:'escalation',reason_code:'INVALID_INPUT'});
 assert.deepEqual(assessRisk(finding(true,false,'block'),context),{decision:'block',reason_code:'HARD_DECISION_BLOCK'});
 assert.deepEqual(assessRisk(finding(false,true,'escalation'),context),{decision:'escalation',reason_code:'HARD_DECISION_ESCALATION'});
 assert.deepEqual(assessRisk(finding(false,false,'none'),context),{decision:'clear',reason_code:'RISK_CLEAR'});
});

test('TASK6_REVIEW_RED_MANDATE_DERIVATION ignores caller exact-mandatory claims and derives exact entailment',async()=>{
 const {assessRecommendation}=await loadRuntime();
 const a=action();
 const base={action:a,evidence:{admissible_conclusion:'causal',overall:'high',assessed_action:a},risk_decision:'clear',reversibility:'irreversible',hard_decision:'clear',sensitive_decision:'continue'};
 const neutral=assessRecommendation({...base,authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'none',required_action:null,outcome_equivalent_verified:false},exact_mandatory_action:true});
 assert.equal(neutral.ceilings.reversibility,'conditional_advice');
 assert.equal(neutral.strength,'conditional_advice');
 const different=assessRecommendation({...base,authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'exact_requires',required_action:action('different'),outcome_equivalent_verified:false},exact_mandatory_action:true});
 assert.equal(different.ceilings.reversibility,'conditional_advice');
 assert.equal(different.strength,'conditional_advice');
 const derived=assessRecommendation({...base,authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'exact_requires',required_action:a,outcome_equivalent_verified:false},exact_mandatory_action:false});
 assert.equal(derived.ceilings.authority,'required');
 assert.equal(derived.ceilings.reversibility,'required');
 assert.equal(derived.strength,'strong_advice');
});

test('TASK6_AUTHORITY_UNION_RED requirement kinds form a closed authority material union',async()=>{
 const {assessRecommendation}=await loadRuntime();
 const a=action();
 const base={action:a,evidence:{admissible_conclusion:'causal',overall:'high',assessed_action:a},risk_decision:'clear',reversibility:'reversible',exact_mandatory_action:false,hard_decision:'clear',sensitive_decision:'continue'};
 const assess=(requirement_kind,required_action,outcome_equivalent_verified)=>assessRecommendation({...base,authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind,required_action,outcome_equivalent_verified}});
 const expectInvalid=(result)=>{assert.equal(result.strength,'none');assert.equal(result.output_kind,'research_question');assert.deepEqual(result.reason_codes,['INVALID_INPUT']);};

 const exactSame=assessRecommendation({...base,exact_mandatory_action:true,authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'exact_requires',required_action:a,outcome_equivalent_verified:false}});
 assert.equal(exactSame.ceilings.authority,'required');
 assert.equal(exactSame.strength,'strong_advice');
 const exactMismatch=assess('exact_requires',action('different'),false);
 assert.equal(exactMismatch.ceilings.authority,'required');
 assert.equal(exactMismatch.strength,'strong_advice');
 expectInvalid(assess('exact_requires',null,false));
 expectInvalid(assess('exact_requires',a,true));

 const outcomeVerified=assess('outcome_only',null,true);
 assert.equal(outcomeVerified.ceilings.authority,'conditional_advice');
 assert.equal(outcomeVerified.strength,'conditional_advice');
 const outcomeUnverified=assess('outcome_only',null,false);
 assert.equal(outcomeUnverified.ceilings.authority,'explore');
 assert.equal(outcomeUnverified.strength,'explore');
 expectInvalid(assess('outcome_only',a,true));

 const neutral=assess('none',null,false);
 assert.equal(neutral.ceilings.authority,'required');
 assert.equal(neutral.strength,'strong_advice');
 expectInvalid(assess('none',a,false));
 expectInvalid(assess('none',null,true));
});

test('TASK6_PARITY_RED reducers have closed CoreV1 contracts and Task10 public materializers',async()=>{
 const [{default:Ajv2020},runtime]=await Promise.all([import('ajv/dist/2020.js'),loadRuntime()]);
 const [coreSchema,outputSchema,projectionSchema,design,plan]=await Promise.all([
  readFile(new URL('../../schemas/core/claims.schema.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../../schemas/evaluator/output.schema.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../../docs/superpowers/specs/2026-08-18-evidence-aware-product-ux-skill-design.md',import.meta.url),'utf8'),
  readFile(new URL('../../docs/superpowers/plans/2026-08-18-evidence-aware-product-ux-skill-v0.1-vertical-slice.md',import.meta.url),'utf8')
 ]);
 const a=action();
 const claimIds=[['temporal','validity'],['comparator','directness'],['identification','validity'],['estimand','precision'],['transport','transportability']];
 const samples={
  ClaimAssessmentCoreV1:runtime.assessClaim(baseClaim(),evidence(claimIds.map(([id])=>[id,'verified','core-'+id]),{intervention_id:'do-x',counterfactual_id:'no-x',effect_estimand_id:'ate'}),policy('causal',claimIds)),
  RiskDecisionCoreV1:runtime.assessRisk({mandatory_fail:false,hard_unsat:false,hard_decision:'none',release_critical:false,outcome:'pass'},{severity:'moderate',likelihood:'known',exposure:'known',reversibility:'reversible',key_factor_status:'verified',purpose:'other',materially_relies_on:false,inference_kind:'other',prohibition_status:'not_applicable',mandatory_check_status:'pass',other_hard_checks_status:'pass',signal_policy_row:null}),
  RecommendationDecisionCoreV1:runtime.assessRecommendation({action:a,authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'none',required_action:null,outcome_equivalent_verified:false},evidence:{admissible_conclusion:'causal',overall:'high',assessed_action:a},risk_decision:'clear',reversibility:'reversible',exact_mandatory_action:false,hard_decision:'clear',sensitive_decision:'continue'}),
  ReleaseDecisionCoreV1:runtime.reduceRelease({gates:['clear'],selection:'decided',authority_complete:true,critical_status:'pass',tail_unknown:false,conditions:[]})
 };
 const coreNames=Object.keys(samples),publicNames=['ClaimAssessment','RiskAssessment','RecommendationAssessment','ReleaseRecommendation'];
 for(const name of coreNames)assert.ok(coreSchema.$defs[name],'missing internal '+name);
 for(const name of publicNames)assert.equal(coreSchema.$defs[name],undefined,'internal/public same-name ambiguity: '+name);
 assert.equal(coreSchema.properties.claim_assessments.items.$ref,'#/$defs/ClaimAssessmentCoreV1');
 const ajv=new Ajv2020({strict:true,allErrors:true});
 for(const [name,sample] of Object.entries(samples)){
  const validate=ajv.compile({$schema:coreSchema.$schema,$defs:coreSchema.$defs,$ref:'#/$defs/'+name});
  assert.equal(validate(sample),true,name+' rejects runtime result: '+JSON.stringify(validate.errors));
  assert.equal(validate({...sample,unexpected:true}),false,name+' is not closed');
  const missing=structuredClone(sample);delete missing[coreSchema.$defs[name].required[0]];assert.equal(validate(missing),false,name+' accepts missing required member');
  const wrong=structuredClone(sample);wrong[coreSchema.$defs[name].required.at(-1)]=42;assert.equal(validate(wrong),false,name+' accepts wrong type');
 }
 for(const name of publicNames)assert.deepEqual(projectionSchema.$defs[name],outputSchema.$defs[name],name+' differs between output and semantic projection');
 assert.deepEqual(outputSchema.$defs.RiskAssessment.properties.likelihood.enum,['known','unknown']);
 assert.deepEqual(outputSchema.$defs.RiskAssessment.properties.exposure.enum,['known','unknown']);
 assert.ok(outputSchema.$defs.RiskAssessment.required.includes('finding_id'));
 const recommendationDef=outputSchema.$defs.RecommendationAssessment;
 for(const key of ['action_id','output_kind','recommendation','research_question','policy_version'])assert.ok(recommendationDef.required.includes(key),'missing recommendation public member '+key);
 const validateRecommendation=ajv.compile({$schema:outputSchema.$schema,$defs:outputSchema.$defs,$ref:'#/$defs/RecommendationAssessment'});
 const recommendationBase={recommendation_assessment_id:'rma_1',status:'complete',action_id:a.action_id,authority_ceiling:'required',evidence_ceiling:'strong_advice',risk_ceiling:'required',reversibility_ceiling:'required',strength:'strong_advice',policy_version:'registry-v1',reason_codes:[]};
 const recommendation={...recommendationBase,output_kind:'recommendation',recommendation:{recommendation_id:'rec_1',action:a,strength:'strong_advice'},research_question:null};
 const inquiry={...recommendationBase,output_kind:'research_question',strength:'none',recommendation:null,research_question:{question_id:'rq_1',kind:'decision_gap',prompt_code:'EVIDENCE_OR_AUTHORITY_GAP'}};
 assert.equal(validateRecommendation(recommendation),true,JSON.stringify(validateRecommendation.errors));
 assert.equal(validateRecommendation(inquiry),true,JSON.stringify(validateRecommendation.errors));
 assert.equal(validateRecommendation({...recommendation,research_question:inquiry.research_question}),false,'public recommendation branches are not mutually exclusive');
 const releaseDef=outputSchema.$defs.ReleaseRecommendation;
 for(const key of ['condition_ids','conditions','reason_code'])assert.ok(releaseDef.required.includes(key),'missing release public member '+key);
 assert.equal(outputSchema.$defs.ReleaseCondition.additionalProperties,false);
 assert.deepEqual(outputSchema.$defs.ReleaseCondition.required,['condition_id','predicate','owner','deadline','verification_method','status']);
 const docs=design+plan;
 for(const text of ['ClaimAssessmentCoreV1','RiskDecisionCoreV1','RecommendationDecisionCoreV1','ReleaseDecisionCoreV1','ux-skill:risk-assessment:v1','ux-skill:recommendation:v1','ux-skill:recommendation-assessment:v1','ux-skill:release-condition:v1','required_check_id + ":" + status','validity,directness,precision,transportability','condition_ids 按 condition_id','Task 10 is the sole public materializer'])assert.ok(docs.includes(text),'Task10 materializer contract missing: '+text);
 assert.ok(plan.includes('Task 10 materializer acceptance'),'Task10 plan lacks materializer acceptance wording');
});


test('TASK10_PUBLIC_MATERIALIZATION_RED binds non-lossy public assessments to normalized source',async()=>{
 const [{default:Ajv2020},outputSchema,projectionSchema,design,plan]=await Promise.all([
  import('ajv/dist/2020.js'),
  readFile(new URL('../../schemas/evaluator/output.schema.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../../docs/superpowers/specs/2026-08-18-evidence-aware-product-ux-skill-design.md',import.meta.url),'utf8'),
  readFile(new URL('../../docs/superpowers/plans/2026-08-18-evidence-aware-product-ux-skill-v0.1-vertical-slice.md',import.meta.url),'utf8')
 ]);
 const names=['ClaimAssessment','RiskAssessment','RecommendationAssessment','ReleaseRecommendation'];
 for(const name of names)assert.deepEqual(projectionSchema.$defs[name],outputSchema.$defs[name],name+' public schema parity');
 const required={
  ClaimAssessment:['claim_assessment_id','source_material_digest','claim_id','policy_id','admissible_conclusion','assessed_predicate','checks','dimension_scores','evidence_grade','reason_codes'],
  RiskAssessment:['risk_assessment_id','source_material_digest','finding_id','status','decision','severity','likelihood','exposure','reversibility','reason_codes'],
  RecommendationAssessment:['recommendation_assessment_id','source_material_digest','status','action_id','authority_ceiling','evidence_ceiling','risk_ceiling','reversibility_ceiling','minimum_ceiling','strength','output_kind','recommendation','research_question','policy_version','reason_codes'],
  ReleaseRecommendation:['release_recommendation_id','source_material_digest','status','next_action','condition_ids','conditions','reason_code']
 };
 const idFields={ClaimAssessment:'claim_assessment_id',RiskAssessment:'risk_assessment_id',RecommendationAssessment:'recommendation_assessment_id',ReleaseRecommendation:'release_recommendation_id'};
 const idPatterns={ClaimAssessment:'^ca_[0-9a-f]{32}$',RiskAssessment:'^ra_[0-9a-f]{32}$',RecommendationAssessment:'^rma_[0-9a-f]{32}$',ReleaseRecommendation:'^rr_[0-9a-f]{32}$'};
 for(const name of names){
  const def=outputSchema.$defs[name];
  assert.deepEqual(def.required,required[name],name+' required public material');
  assert.equal(def.additionalProperties,false);
  assert.equal(def.properties[idFields[name]].pattern,idPatterns[name]);
  assert.equal(def.properties.source_material_digest.pattern,'^[0-9a-f]{64}$');
 }
 const claimDef=outputSchema.$defs.ClaimAssessment;
 assert.equal(Object.hasOwn(claimDef.properties,'check_results'),false);
 assert.equal(claimDef.properties.checks.items.$ref,'#/$defs/ClaimCheckResult');
 assert.equal(claimDef.properties.dimension_scores.items.$ref,'#/$defs/EvidenceDimensionScore');
 assert.equal(claimDef.properties.evidence_grade.$ref,'#/$defs/EvidenceGrade');
 const ajv=new Ajv2020({strict:true,allErrors:true});
 for(const name of names)assert.doesNotThrow(()=>ajv.compile({$schema:outputSchema.$schema,$defs:outputSchema.$defs,$ref:'#/$defs/'+name}));
 const docs=design+plan;
 for(const text of ['source_material_digest from exact validated normalized source objects','never trusts a caller-supplied source_material_digest','ux-skill:claim-assessment-public:v1','ux-skill:risk-assessment:v1','ux-skill:recommendation-assessment:v1','ux-skill:release-recommendation:v1','material integrity binding, not authenticity','re-derives the reducer core and byte-compares'])assert.ok(docs.includes(text),'missing Task10 source binding contract: '+text);
 const materializers=await import('../../evaluator/projection.mjs');
 for(const name of ['materializeClaimAssessment','materializeRiskAssessment','materializeRecommendationAssessment','materializeReleaseRecommendation','verifyPublicMaterialization'])assert.equal(typeof materializers[name],'function','missing '+name);
 const claimIds=[['temporal','validity'],['comparator','directness'],['identification','validity'],['estimand','precision'],['transport','transportability']];
 const claimSource={
  claim:baseClaim({evidence_refs:['ev-1','ev-2']}),
  evidence:evidence(claimIds.map(([id])=>[id,'verified','cluster-'+id]),{intervention_id:'do-x',counterfactual_id:'no-x',effect_estimand_id:'ate'}),
  policy:policy('causal',claimIds)
 };
 const riskFinding={mandatory_fail:false,hard_unsat:false,hard_decision:'none',release_critical:false,outcome:'pass'};
 const riskContext={severity:'moderate',likelihood:'known',exposure:'known',reversibility:'reversible',key_factor_status:'verified',purpose:'other',materially_relies_on:false,inference_kind:'other',prohibition_status:'not_applicable',mandatory_check_status:'pass',other_hard_checks_status:'pass',signal_policy_row:null};
 const riskSource={finding:riskFinding,context:riskContext};
 const recParts={action:action(),authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'none',required_action:null,outcome_equivalent_verified:false},evidence:{admissible_conclusion:'causal',overall:'high',assessed_action:action()},risk_decision:'clear',reversibility:'reversible',exact_mandatory_action:false,hard_decision:'clear',sensitive_decision:'continue'};
 const recSource={parts:recParts,selected_policy_registry_row:{policy_id:'recommendation-policy',version:'registry-v1',status:'effective'}};
 const releaseConditions=[
  {predicate:'confirm-owner',owner:'ux-owner',deadline:'2026-09-01T00:00:00Z',verification_method:'test-owner',status:'verified_executable'},
  {predicate:'confirm-copy',owner:'content-owner',deadline:'2026-09-02T00:00:00Z',verification_method:'test-copy',status:'verified_executable'}
 ];
 const releaseSource={derived_gates:['clear'],selection:{status:'decided'},authority:{complete:true},critical_tail_evidence:{critical_status:'pass',tail_unknown:false},conditions:releaseConditions};
 const claimPublic=materializers.materializeClaimAssessment(claimSource);
 const riskPublic=materializers.materializeRiskAssessment(riskSource);
 const recPublic=materializers.materializeRecommendationAssessment(recSource);
 const releasePublic=materializers.materializeReleaseRecommendation(releaseSource);
 for(const [name,value] of Object.entries({ClaimAssessment:claimPublic,RiskAssessment:riskPublic,RecommendationAssessment:recPublic,ReleaseRecommendation:releasePublic})){
  const validate=ajv.compile({$schema:outputSchema.$schema,$defs:outputSchema.$defs,$ref:'#/$defs/'+name});
  assert.equal(validate(value),true,name+' invalid: '+JSON.stringify(validate.errors));
  assert.match(value[idFields[name]],new RegExp(idPatterns[name]));
  assert.match(value.source_material_digest,/^[0-9a-f]{64}$/);
 }
 assert.deepEqual(claimPublic.checks,materializers.materializeClaimAssessment(claimSource).checks);
 assert.equal(claimPublic.checks.length,claimSource.policy.required_checks.length);
 assert.deepEqual(claimPublic.dimension_scores.map((row)=>row.dimension),['directness','precision','transportability','validity']);
 assert.equal(typeof claimPublic.evidence_grade,'object');
 const changesBoth=(baseline,next,idField)=>{assert.notEqual(next.source_material_digest,baseline.source_material_digest);assert.notEqual(next[idField],baseline[idField]);};
 const claimVariants=[
  {...claimSource,policy:{...claimSource.policy,policy_id:'policy-causal-v2'}},
  {...claimSource,evidence:{...claimSource.evidence,checks:claimSource.evidence.checks.map((row,index)=>index?row:{...row,status:'verified_with_limit'})}},
  {...claimSource,evidence:{...claimSource.evidence,checks:claimSource.evidence.checks.map((row,index)=>index?row:{...row,evidence_refs:['ev-changed']})}},
  {...claimSource,policy:{...claimSource.policy,required_checks:claimSource.policy.required_checks.map((row,index)=>index===0?{...row,dimension:'directness'}:index===1?{...row,dimension:'validity'}:row)}}
 ];
 for(const source of claimVariants)changesBoth(claimPublic,materializers.materializeClaimAssessment(source),'claim_assessment_id');
 for(const context of [{...riskContext,purpose:'marketing'},{...riskContext,materially_relies_on:true}])changesBoth(riskPublic,materializers.materializeRiskAssessment({finding:riskFinding,context}),'risk_assessment_id');
 const recVariants=[
  {...recSource,parts:{...recParts,authority:{...recParts.authority,applicability:'unknown'}}},
  {...recSource,parts:{...recParts,evidence:{...recParts.evidence,overall:'adequate'}}},
  {...recSource,parts:{...recParts,risk_decision:'escalation'}}
 ];
 for(const source of recVariants)changesBoth(recPublic,materializers.materializeRecommendationAssessment(source),'recommendation_assessment_id');
 const releaseVariants=[
  {...releaseSource,derived_gates:['escalation']},
  {...releaseSource,selection:{status:'undecided'}},
  {...releaseSource,authority:{complete:false}},
  {...releaseSource,critical_tail_evidence:{critical_status:'pass',tail_unknown:true}}
 ];
 for(const source of releaseVariants)changesBoth(releasePublic,materializers.materializeReleaseRecommendation(source),'release_recommendation_id');
 const claimPermutation={claim:{...claimSource.claim,evidence_refs:[...claimSource.claim.evidence_refs].reverse()},evidence:{...claimSource.evidence,checks:[...claimSource.evidence.checks].reverse()},policy:{...claimSource.policy,required_checks:[...claimSource.policy.required_checks].reverse()}};
 assert.deepEqual(materializers.materializeClaimAssessment(claimPermutation),claimPublic);
 const releasePermutation={...releaseSource,derived_gates:[...releaseSource.derived_gates].reverse(),conditions:[...releaseSource.conditions].reverse()};
 assert.deepEqual(materializers.materializeReleaseRecommendation(releasePermutation),releasePublic);
 for(const [kind,source,value] of [['claim',claimSource,claimPublic],['risk',riskSource,riskPublic],['recommendation',recSource,recPublic],['release',releaseSource,releasePublic]]){
  assert.equal(materializers.verifyPublicMaterialization(kind,source,value),true);
  assert.equal(materializers.verifyPublicMaterialization(kind,source,{...value,source_material_digest:'0'.repeat(64)}),false);
 }
});
