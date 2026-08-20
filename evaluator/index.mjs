import{createHash}from'node:crypto';
import{readFile}from'node:fs/promises';
import'./authority.mjs';
import{canonicalSet,assertIJson,jcsBytes}from'./canonical.mjs';
import{digestJcs}from'./digests.mjs';
import{validateInput,validateBySchema}from'./validation.mjs';
import{evaluateRule,deriveFindingContext,emitFinding,reduceRunStatus}from'./rules-runtime.mjs';
import{materializeClaimAssessment,materializeRiskAssessment,materializeRecommendationAssessment,materializeReleaseRecommendation,verifyPublicMaterialization,createSemanticProjection}from'./projection.mjs';

const ROOT=new URL('../',import.meta.url);
const EXPECTED=Object.freeze(['evaluator/authority.mjs','evaluator/canonical.mjs','evaluator/claims.mjs','evaluator/dependency-decision.mjs','evaluator/digests.mjs','evaluator/index.mjs','evaluator/projection.mjs','evaluator/rules-runtime.mjs','evaluator/validation.mjs']);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const nfc=(value)=>{if(typeof value==='string')return value.normalize('NFC')===value;if(Array.isArray(value))return value.every(nfc);if(value&&typeof value==='object')return Object.entries(value).every(([key,child])=>key.normalize('NFC')===key&&nfc(child));return true;};
const artifactFailure=(reason,details=[])=>{const error=new TypeError(reason);error.code='ARTIFACT_VERIFICATION_FAILED';error.details=details;throw error;};
const inputFailure=(errors)=>{const error=new TypeError('INVALID_EVALUATION_INPUT');error.code='INVALID_EVALUATION_INPUT';error.errors=errors;throw error;};
const loadRaw=async(path)=>{const bytes=await readFile(new URL(path,ROOT));let value;try{value=JSON.parse(bytes.toString('utf8'));assertIJson(value);}catch{artifactFailure('ARTIFACT_JSON_INVALID:'+path);}if(!nfc(value))artifactFailure('ARTIFACT_NFC_INVALID:'+path);return{bytes,value};};
const verifyRows=async(rows,label)=>{if(!Array.isArray(rows))artifactFailure(label+'_ROWS_INVALID');const sorted=canonicalSet(rows,(row)=>row.path);if(!jcsBytes(sorted).equals(jcsBytes(rows)))artifactFailure(label+'_ORDER_INVALID');for(const row of rows){if(!exact(row,['path','file_digest'])||!/^[-a-z0-9_./]+$/.test(row.path)||!/^[0-9a-f]{64}$/.test(row.file_digest))artifactFailure(label+'_ROW_INVALID');const bytes=await readFile(new URL(row.path,ROOT));if(sha(bytes)!==row.file_digest)artifactFailure(label+'_DIGEST_MISMATCH:'+row.path);}};
const verifyArtifacts=async()=>{
 const[evaluator,schema,knowledge,policy,rules,decision]=await Promise.all(['evaluator/manifest.json','schemas/manifest.json','knowledge/manifest.json','knowledge/policy-manifest.json','knowledge/rules.json','knowledge/decision-policies.json'].map(loadRaw));
 if(!exact(evaluator.value,['behavior_version','evaluator_files','schema_manifest_digest','knowledge_manifest_digest','policy_manifest_digest']))artifactFailure('EVALUATOR_MANIFEST_SHAPE');
 if(!Array.isArray(schema.value)||!exact(knowledge.value,['manifest_version','files','dependency_graph','routes'])||!exact(policy.value,['policy_files']))artifactFailure('MANIFEST_SHAPE');
 await Promise.all([verifyRows(evaluator.value.evaluator_files,'EVALUATOR'),verifyRows(schema.value,'SCHEMA'),verifyRows(knowledge.value.files,'KNOWLEDGE'),verifyRows(policy.value.policy_files,'POLICY')]);
 if(!jcsBytes(evaluator.value.evaluator_files.map((row)=>row.path)).equals(jcsBytes(EXPECTED)))artifactFailure('EVALUATOR_CLOSURE_MISMATCH');
 const schemaDigest=digestJcs('ux-skill:manifest:v1',schema.value),knowledgeDigest=digestJcs('ux-skill:knowledge:v1',knowledge.value.files),policyDigest=digestJcs('ux-skill:manifest:v1',policy.value);
 if(evaluator.value.schema_manifest_digest!==schemaDigest||evaluator.value.knowledge_manifest_digest!==knowledgeDigest||evaluator.value.policy_manifest_digest!==policyDigest)artifactFailure('MANIFEST_PREIMAGE_MISMATCH');
 if(evaluator.value.behavior_version!==rules.value.behavior_version)artifactFailure('BEHAVIOR_VERSION_MISMATCH');
 return{evaluator:evaluator.value,evaluatorDigest:digestJcs('ux-skill:evaluator:v1',evaluator.value),schemaDigest,knowledgeDigest,policyDigest,rules:rules.value,decisionDigest:sha(decision.bytes),rulesDigest:sha(rules.bytes)};
};

const claimPolicy=(kind)=>({policy_id:'task10-'+kind+'-policy-v1',claim_kind:kind,required_checks:[
 {required_check_id:'validity',dimension:'validity',critical:true,evaluator_invariant:'bundle-evidence-reference'},
 {required_check_id:'directness',dimension:'directness',critical:true,evaluator_invariant:'bundle-evidence-reference'},
 {required_check_id:'precision',dimension:'precision',critical:false,evaluator_invariant:'bundle-evidence-reference'},
 {required_check_id:'transportability',dimension:'transportability',critical:false,evaluator_invariant:'bundle-evidence-reference'}
]});
const claimSource=(claim)=>{
 const refs=canonicalSet(claim.evidence_refs,(item)=>item);
 const checks=['validity','directness','precision','transportability'].map((id)=>({required_check_id:id,status:refs.length?'verified_with_limit':'unknown',dependency_cluster_id:'bundle-evidence',evidence_refs:refs}));
 return{claim,evidence:{checks,selection_status:refs.length?'verified':'unknown',contradiction_status:'resolved',measured_covariation:false,verifiable_observation:true,prediction_observed_outcome_pair:false,intervention_id:null,counterfactual_id:null,effect_estimand_id:null,future_target_id:null},policy:claimPolicy(claim.claim_kind)};
};
const executableRule=(row)=>({rule_id:row.rule_id,rule_version:row.rule_version,release_critical:true,finding_type:'escalation',required_dependencies:[],required_input_pointers:[],registered_input_pointers:['/research_state/status'],applicability:{node_id:'applicable',op:'literal',value:true},exclusion:{node_id:'excluded',op:'literal',value:false},precondition:{node_id:'ready',op:'literal',value:true},check:{node_id:'authorized',op:'eq',path:'/research_state/status',value:'authorized'}});
const riskContext=()=>({severity:'severe',likelihood:'unknown',exposure:'unknown',reversibility:'irreversible',key_factor_status:'unknown',purpose:'destructive_change',materially_relies_on:true,inference_kind:'observed_signal',prohibition_status:'unknown',mandatory_check_status:'unknown',other_hard_checks_status:'unknown',signal_policy_row:null});
const recommendationSource=(bundle,claimAssessment,riskAssessment)=>({parts:{action:{action_id:'require-delete-authorization',target_id:bundle.target_snapshot.target_snapshot_id,scope_id:bundle.scenario_profile_id},authority:{prohibition:'not_applicable',applicability:'known',conflict:'none',requirement_kind:'none',required_action:null,outcome_equivalent_verified:false},evidence:{admissible_conclusion:claimAssessment?.admissible_conclusion??'unresolved',overall:claimAssessment?.evidence_grade?.overall??'insufficient',assessed_action:null},risk_decision:riskAssessment?.decision??'escalation',reversibility:'irreversible',exact_mandatory_action:false,hard_decision:'escalation',sensitive_decision:'continue'},selected_policy_registry_row:{policy_id:'task10-recommendation-policy',version:'1.0.0',status:'effective'}});
const releaseSource=(incomplete,riskAssessments)=>({derived_gates:incomplete?['no_release']:canonicalSet(riskAssessments.length?riskAssessments.map((row)=>row.decision):['clear'],(item)=>item),selection:{status:'decided'},authority:{complete:true},critical_tail_evidence:{critical_status:'pass',tail_unknown:false},conditions:[]});
const evaluateCore=(normalized,artifacts)=>{
 const registryRow=artifacts.rules.rules.filter((row)=>row.rule_id==='delete-safety'&&row.rule_version==='1.0.0');
 if(registryRow.length!==1)artifactFailure('RULE_REGISTRY_ROW_INVALID');
 const rule=executableRule(registryRow[0]),ruleValid=validateBySchema('Rule',rule);if(!ruleValid.ok)artifactFailure('EXECUTABLE_RULE_INVALID');
 const ruleEvaluations=[evaluateRule(rule,normalized,[])];
 const context=deriveFindingContext(normalized);
 const findings=canonicalSet(ruleEvaluations.map((row)=>emitFinding(row,context)).filter(Boolean),(row)=>row.fingerprint);const replayRules=[evaluateRule(rule,normalized,[])],replayFindings=canonicalSet(replayRules.map((row)=>emitFinding(row,context)).filter(Boolean),(row)=>row.fingerprint);if(!jcsBytes(ruleEvaluations).equals(jcsBytes(replayRules))||!jcsBytes(findings).equals(jcsBytes(replayFindings)))artifactFailure('TASK5_PROVENANCE_REPLAY_MISMATCH');
 const incomplete=normalized.research_state.status==='blocked'||(normalized.target_snapshot.target_kind==='hulianui_contract'&&normalized.adapter_evidence.length===0);
 const runIssues=incomplete?[{code:'RULE_EVALUATION_ERROR',instance_pointer:'/snapshot_closure',dependency_id:null}]:[];
 let runStatus=reduceRunStatus([...ruleEvaluations,...findings]);if(incomplete&&runStatus==='completed_clear')runStatus='completed_with_gaps';
 const claimSources=normalized.claims.map(claimSource),claimAssessments=canonicalSet(claimSources.map(materializeClaimAssessment),(row)=>row.claim_assessment_id);
 const findingOwner={findings};
 const riskSources=findings.map((finding)=>({finding_id:finding.finding_id,finding,context:riskContext()}));
 const riskAssessments=canonicalSet(riskSources.map((source)=>materializeRiskAssessment(source,findingOwner)),(row)=>row.risk_assessment_id);
 const recSources=[recommendationSource(normalized,claimAssessments[0],riskAssessments[0])];
 const recommendationAssessments=canonicalSet(recSources.map(materializeRecommendationAssessment),(row)=>row.recommendation_assessment_id);
 const relSource=releaseSource(incomplete,riskAssessments),releaseRecommendation=materializeReleaseRecommendation(relSource);
 const inquiryValidation={authoritative:false,gap_ids:incomplete?['snapshot-closure-unavailable']:[],status:incomplete?'incomplete':(normalized.inquiry_draft?.authoritative?'invalid':'valid')};
 const coverageGaps=incomplete?[{coverage_gap_id:'snapshot-closure-unavailable',reason_code:'SNAPSHOT_CLOSURE_UNAVAILABLE',release_critical:true}]:[];
 const output={schema_version:'evaluation-output-v1',behavior_version:normalized.behavior_version,input_digest:digestJcs('ux-skill:input:v1',normalized),evaluator_digest:artifacts.evaluatorDigest,run_status:runStatus,validation_errors:[],rule_evaluations:canonicalSet(ruleEvaluations,(row)=>row.rule_id),findings,run_issues:canonicalSet(runIssues,(row)=>[row.code,row.instance_pointer,row.dependency_id]),claim_assessments:claimAssessments,risk_assessments:riskAssessments,recommendation_assessments:recommendationAssessments,release_recommendation:releaseRecommendation,resolution_traces:[],inquiry_validation:inquiryValidation,coverage_gaps:canonicalSet(coverageGaps,(row)=>row.coverage_gap_id)};
 const validated=validateBySchema('EvaluationOutput',output);if(!validated.ok)artifactFailure('OUTPUT_SCHEMA_INVALID',validated.errors);
 const replayChecks=[...claimSources.map((source)=>{const id=materializeClaimAssessment(source).claim_assessment_id;return verifyPublicMaterialization('claim',source,validated.value.claim_assessments.find((row)=>row.claim_assessment_id===id));}),...riskSources.map((source)=>{const id=materializeRiskAssessment(source,findingOwner).risk_assessment_id;return verifyPublicMaterialization('risk',source,validated.value.risk_assessments.find((row)=>row.risk_assessment_id===id),findingOwner);}),...recSources.map((source)=>{const id=materializeRecommendationAssessment(source).recommendation_assessment_id;return verifyPublicMaterialization('recommendation',source,validated.value.recommendation_assessments.find((row)=>row.recommendation_assessment_id===id));}),verifyPublicMaterialization('release',relSource,validated.value.release_recommendation)];
 if(replayChecks.some((ok)=>!ok))artifactFailure('PUBLIC_MATERIALIZATION_REPLAY_MISMATCH');
 const semantic=createSemanticProjection(validated.value),semanticValid=validateBySchema('SemanticProjection',semantic);if(!semanticValid.ok)artifactFailure('SEMANTIC_SCHEMA_INVALID',semanticValid.errors);
 return{semantic:semanticValid.value,audit:{rule_sources:[rule.rule_id+'@'+rule.rule_version],claim_source_digests:claimAssessments.map((row)=>row.source_material_digest),risk_source_digests:riskAssessments.map((row)=>row.source_material_digest),recommendation_source_digests:recommendationAssessments.map((row)=>row.source_material_digest),release_source_digest:releaseRecommendation.source_material_digest,replay_verification:'byte_equal',materialization_verification:'byte_equal'}};
};

export async function evaluate(bundle){
 if(arguments.length!==1){const error=new TypeError('OUT_OF_BAND_EVIDENCE_FORBIDDEN');error.code='OUT_OF_BAND_EVIDENCE_FORBIDDEN';throw error;}
 const input=validateInput(bundle);if(!input.ok)inputFailure(input.errors);
 const artifacts=await verifyArtifacts(),normalized=input.value;
 const expected={decision_policy_digest:artifacts.decisionDigest,claim_policy_digest:artifacts.policyDigest,rule_registry_digest:artifacts.rulesDigest};
 if(!jcsBytes(normalized.policy_digests).equals(jcsBytes(expected)))inputFailure([{stage:'policy',code:'POLICY_DIGEST_MISMATCH',instance_pointer:'/policy_digests',invariant_or_schema_id:'Task10PolicyDigest-v1',params_jcs:jcsBytes({expected}).toString('utf8')}]);
 const {semantic,audit}=evaluateCore(normalized,artifacts);
 return{assurance:{warning:'Zero findings does not mean UX is good, compliant, successful, or satisfying.',run_status:semantic.run_status,release_status:semantic.release_recommendation?.status??'no_release'},inquiry:{authoritative:false,status:semantic.inquiry_validation?.status??'incomplete',gap_ids:semantic.inquiry_validation?.gap_ids??[],scaffold:[]},semantic_projection:semantic,semantic_digest:semantic.semantic_digest,audit_sidecar:{manifest_verification:'verified',input_normalization:'verified',policy_manifest_digest:artifacts.policyDigest,knowledge_manifest_digest:artifacts.knowledgeDigest,schema_manifest_digest:artifacts.schemaDigest,...audit,localized_messages:[],mcp_text:null}};
}
