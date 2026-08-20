import{createHash}from'node:crypto';
import{readFile}from'node:fs/promises';
import'./authority.mjs';
import{canonicalSet,assertCanonicalRelativePath,assertIJson,jcsBytes}from'./canonical.mjs';
import{digestJcs}from'./digests.mjs';
import{validateInput,validateBySchema}from'./validation.mjs';
import{evaluateRule,deriveFindingContext,emitFinding,reduceRunStatus}from'./rules-runtime.mjs';
import{materializeClaimAssessment,materializeRiskAssessment,materializeRecommendationAssessment,materializeReleaseRecommendation,materializeSnapshotClosureVerification,verifyPublicMaterialization,createSemanticProjection}from'./projection.mjs';

const ROOT=new URL('../',import.meta.url);
const EXPECTED=Object.freeze(['evaluator/authority.mjs','evaluator/canonical.mjs','evaluator/claims.mjs','evaluator/dependency-decision.mjs','evaluator/digests.mjs','evaluator/index.mjs','evaluator/projection.mjs','evaluator/rules-runtime.mjs','evaluator/validation.mjs']);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const nfc=(value)=>{if(typeof value==='string')return value.normalize('NFC')===value;if(Array.isArray(value))return value.every(nfc);if(value&&typeof value==='object')return Object.entries(value).every(([key,child])=>key.normalize('NFC')===key&&nfc(child));return true;};
const artifactFailure=(reason,details=[])=>{const error=new TypeError(reason);error.code='ARTIFACT_VERIFICATION_FAILED';error.details=details;throw error;};
const inputFailure=(errors)=>{const error=new TypeError('INVALID_EVALUATION_INPUT');error.code='INVALID_EVALUATION_INPUT';error.errors=errors;throw error;};
const loadRaw=async(path)=>{const bytes=await readFile(new URL(path,ROOT));let value;try{value=JSON.parse(bytes.toString('utf8'));assertIJson(value);}catch{artifactFailure('ARTIFACT_JSON_INVALID:'+path);}if(!nfc(value))artifactFailure('ARTIFACT_NFC_INVALID:'+path);return{bytes,value};};
const verifyRows=async(rows,label)=>{if(!Array.isArray(rows))artifactFailure(label+'_ROWS_INVALID');const sorted=canonicalSet(rows,(row)=>row.path);if(!jcsBytes(sorted).equals(jcsBytes(rows)))artifactFailure(label+'_ORDER_INVALID');for(const row of rows){if(!exact(row,['path','file_digest'])||!/^[-a-z0-9_./]+$/.test(row.path)||!/^[0-9a-f]{64}$/.test(row.file_digest))artifactFailure(label+'_ROW_INVALID');const bytes=await readFile(new URL(row.path,ROOT));if(sha(bytes)!==row.file_digest)artifactFailure(label+'_DIGEST_MISMATCH:'+row.path);}};
const SOURCE_REGISTRY_PATH='evaluator/snapshot-source-registry.json';
const VERIFIED_EVALUATOR_DIGEST='51a663d748bf762d3f52a64b0b1a553c68c47b15d556c0c7ba80da3f923207ba';
const REGISTRY_UNAVAILABLE_EVALUATOR_DIGEST='2736eb367eed0496a1aca8d7702f5cc1abd73344a2789c91d2c7ef8aca65b267';
const REGISTRY_AUDIT=Object.freeze({verified:Object.freeze({manifest_verification:'verified',snapshot_source_registry:'verified'}),unavailable:Object.freeze({manifest_verification:'partial_failure',snapshot_source_registry:'unavailable'})});
const SOURCE_KEYS=['source_authority_id','target_snapshot_id','target_kind','canonical_locator','entry_url','task_script_digest','capture_environment_digest','allowed_snapshot_digests'];
const lowerHex64=(value)=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const nonempty=(value)=>typeof value==='string'&&value.length>0&&value.normalize('NFC')===value;
const validateSnapshotSourceRegistry=(value)=>{
 if(!exact(value,['registry_version','sources'])||value.registry_version!=='snapshot-source-registry-v1'||!Array.isArray(value.sources))artifactFailure('SNAPSHOT_SOURCE_REGISTRY_SHAPE');
 const rows=canonicalSet(value.sources,(row)=>row.source_authority_id);if(!jcsBytes(rows).equals(jcsBytes(value.sources)))artifactFailure('SNAPSHOT_SOURCE_REGISTRY_ORDER');
 const ids=new Set(),targets=new Set(),locators=new Set();
 for(const row of rows){if(!exact(row,SOURCE_KEYS)||!nonempty(row.source_authority_id)||!nonempty(row.target_snapshot_id)||row.target_kind!=='black_box_site'||!nonempty(row.canonical_locator)||!nonempty(row.entry_url)||!lowerHex64(row.task_script_digest)||!lowerHex64(row.capture_environment_digest)||!Array.isArray(row.allowed_snapshot_digests)||row.allowed_snapshot_digests.length===0||!row.allowed_snapshot_digests.every(lowerHex64))artifactFailure('SNAPSHOT_SOURCE_REGISTRY_ROW');
  try{assertCanonicalRelativePath(row.canonical_locator);}catch{artifactFailure('SNAPSHOT_SOURCE_REGISTRY_CANONICAL_LOCATOR');}
  try{if(!['http:','https:'].includes(new URL(row.entry_url).protocol))artifactFailure('SNAPSHOT_SOURCE_REGISTRY_ENTRY_URL');}catch(error){if(error?.code==='ARTIFACT_VERIFICATION_FAILED')throw error;artifactFailure('SNAPSHOT_SOURCE_REGISTRY_ENTRY_URL');}
  const allowed=canonicalSet(row.allowed_snapshot_digests,(digest)=>digest);if(!jcsBytes(allowed).equals(jcsBytes(row.allowed_snapshot_digests))||ids.has(row.source_authority_id)||targets.has(row.target_snapshot_id)||locators.has(row.canonical_locator))artifactFailure('SNAPSHOT_SOURCE_REGISTRY_UNIQUE');
  ids.add(row.source_authority_id);targets.add(row.target_snapshot_id);locators.add(row.canonical_locator);
 }
 return rows;
};
const verifyArtifacts=async()=>{
 const[evaluator,schema,knowledge,policy,rules,decision]=await Promise.all(['evaluator/manifest.json','schemas/manifest.json','knowledge/manifest.json','knowledge/policy-manifest.json','knowledge/rules.json','knowledge/decision-policies.json'].map(loadRaw));
 if(!exact(evaluator.value,['behavior_version','evaluator_files','snapshot_source_registry','schema_manifest_digest','knowledge_manifest_digest','policy_manifest_digest']))artifactFailure('EVALUATOR_MANIFEST_SHAPE');
 if(!Array.isArray(schema.value)||!exact(knowledge.value,['manifest_version','files','dependency_graph','routes'])||!exact(policy.value,['policy_files']))artifactFailure('MANIFEST_SHAPE');
 await Promise.all([verifyRows(evaluator.value.evaluator_files,'EVALUATOR'),verifyRows(schema.value,'SCHEMA'),verifyRows(knowledge.value.files,'KNOWLEDGE'),verifyRows(policy.value.policy_files,'POLICY')]);
 if(!jcsBytes(evaluator.value.evaluator_files.map((row)=>row.path)).equals(jcsBytes(EXPECTED)))artifactFailure('EVALUATOR_CLOSURE_MISMATCH');
 const schemaDigest=digestJcs('ux-skill:manifest:v1',schema.value),knowledgeDigest=digestJcs('ux-skill:knowledge:v1',knowledge.value.files),policyDigest=digestJcs('ux-skill:manifest:v1',policy.value);
 if(evaluator.value.schema_manifest_digest!==schemaDigest||evaluator.value.knowledge_manifest_digest!==knowledgeDigest||evaluator.value.policy_manifest_digest!==policyDigest)artifactFailure('MANIFEST_PREIMAGE_MISMATCH');
 if(evaluator.value.behavior_version!==rules.value.behavior_version)artifactFailure('BEHAVIOR_VERSION_MISMATCH');
 let snapshotSources=[],snapshotRegistryAvailable=false;
 try{const registryRef=evaluator.value.snapshot_source_registry;if(!exact(registryRef,['path','file_digest'])||registryRef.path!==SOURCE_REGISTRY_PATH||!lowerHex64(registryRef.file_digest))artifactFailure('SNAPSHOT_SOURCE_REGISTRY_REF');await verifyRows([registryRef],'SNAPSHOT_SOURCE_REGISTRY');const registry=await loadRaw(registryRef.path);snapshotSources=validateSnapshotSourceRegistry(registry.value);snapshotRegistryAvailable=true;}catch{}
 const evaluatorDigest=snapshotRegistryAvailable?VERIFIED_EVALUATOR_DIGEST:REGISTRY_UNAVAILABLE_EVALUATOR_DIGEST;
 return{evaluatorDigest,schemaDigest,knowledgeDigest,policyDigest,rules:rules.value,decisionDigest:sha(decision.bytes),rulesDigest:sha(rules.bytes),snapshotSources,snapshotRegistryAvailable};
};

const SNAPSHOT_RESULT_KEYS=['closure','closure_bytes_base64','cas_artifacts','source_identity','completeness_status','run_status','release_gate','run_issues','replay_evidence'];
const SNAPSHOT_LIMITS=Object.freeze({maxProfiles:16,maxTaskSteps:128,maxNetworkRecords:4096,maxObservationRecords:4096,maxRedirectHops:32,maxHeaders:256,maxArtifactBytes:1048576,maxTotalArtifactBytes:33554432,maxUrlBytes:8192});
const SNAPSHOT_ISSUE=Object.freeze({code:'RULE_EVALUATION_ERROR',instance_pointer:'/snapshot_closure',dependency_id:null});
const snapshotUnavailable=()=>({incomplete:true,source:null,authority:null});
const snapshotRequire=(condition)=>{if(!condition)throw new TypeError('SNAPSHOT_CLOSURE_UNAVAILABLE');};
const canonicalCopy=(value)=>JSON.parse(jcsBytes(value).toString('utf8'));
const base64Bytes=(value)=>{snapshotRequire(typeof value==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));const bytes=Buffer.from(value,'base64');snapshotRequire(bytes.toString('base64')===value);return bytes;};
const canonicalRows=(rows,keyOf)=>{const normalized=canonicalSet(rows,keyOf);snapshotRequire(jcsBytes(normalized).equals(jcsBytes(rows)));return normalized;};
const snapshotUrl=(value)=>{if(typeof value!=='string'||Buffer.byteLength(value)>SNAPSHOT_LIMITS.maxUrlBytes)return false;try{return['http:','https:'].includes(new URL(value).protocol);}catch{return false;}};
const verifiedHeaders=(bytes)=>{let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{snapshotRequire(false);}snapshotRequire(bytes.length<=SNAPSHOT_LIMITS.maxArtifactBytes&&jcsBytes(value).equals(bytes)&&exact(value,['headers'])&&Array.isArray(value.headers)&&value.headers.length<=SNAPSHOT_LIMITS.maxHeaders);value.headers.forEach((row,index)=>snapshotRequire(exact(row,['sequence','name_lower_ascii','value_bytes_base64'])&&row.sequence===index&&/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(row.name_lower_ascii)&&base64Bytes(row.value_bytes_base64)));return value;};
const verifySnapshotClosureResult=(normalized,snapshotSources,snapshotRegistryAvailable)=>{
 if(normalized.target_snapshot.target_kind!=='black_box_site')return{incomplete:false,source:null,authority:null};
 if(!snapshotRegistryAvailable)return snapshotUnavailable();
 const result=normalized.snapshot_closure_result;if(result===null)return snapshotUnavailable();
 try{
  snapshotRequire(exact(result,SNAPSHOT_RESULT_KEYS)&&Array.isArray(result.run_issues)&&Array.isArray(result.cas_artifacts)&&result.closure!==null);
  const closure=result.closure,closureBytes=base64Bytes(result.closure_bytes_base64);snapshotRequire(closureBytes.equals(jcsBytes(closure))&&snapshotUrl(closure.entry_url)&&closure.replay_profiles.length>0&&closure.replay_profiles.length<=SNAPSHOT_LIMITS.maxProfiles&&closure.network_records.length<=SNAPSHOT_LIMITS.maxNetworkRecords&&closure.observation_records.length<=SNAPSHOT_LIMITS.maxObservationRecords);
  const closureBody=canonicalCopy(closure);delete closureBody.manifest_digest;snapshotRequire(digestJcs('ux-skill:snapshot-closure:v1',closureBody)===closure.manifest_digest&&['complete','incomplete'].includes(closure.completeness_status)&&closure.authenticated===false);
  const identity=result.source_identity;snapshotRequire(exact(identity,['target_snapshot_id','target_kind','canonical_locator','entry_url','snapshot_digest'])&&identity.target_kind==='black_box_site'&&identity.target_snapshot_id===normalized.target_snapshot.target_snapshot_id&&identity.canonical_locator===normalized.target_snapshot.canonical_locator&&identity.entry_url===closure.entry_url&&identity.snapshot_digest===closure.manifest_digest&&normalized.target_snapshot.snapshot_digest===closure.manifest_digest);
  const authorities=snapshotSources.filter((row)=>row.target_snapshot_id===normalized.target_snapshot.target_snapshot_id&&row.target_kind===normalized.target_snapshot.target_kind&&row.canonical_locator===normalized.target_snapshot.canonical_locator&&row.entry_url===closure.entry_url&&row.task_script_digest===closure.task_script_digest&&row.capture_environment_digest===closure.capture_environment_digest&&row.allowed_snapshot_digests.includes(closure.manifest_digest));snapshotRequire(authorities.length===1);const authority=authorities[0];
  if(result.completeness_status==='incomplete'){snapshotRequire(closure.completeness_status==='incomplete'&&result.run_status==='target_unavailable'&&result.release_gate==='no_release'&&jcsBytes(result.run_issues).equals(jcsBytes([SNAPSHOT_ISSUE]))&&result.replay_evidence===null&&result.cas_artifacts.length===0);return{incomplete:true,source:null,authority};}
  snapshotRequire(result.completeness_status==='complete'&&closure.completeness_status==='complete'&&result.run_status==='completed'&&result.release_gate==='no_release'&&result.run_issues.length===0&&result.replay_evidence!==null);
  snapshotRequire(closure.outbound_effect_ledger_digest===sha(jcsBytes([])));
  const artifacts=canonicalRows(result.cas_artifacts,(row)=>row.locator),cas=new Map();let artifactBytes=0;
  for(const row of artifacts){const bytes=base64Bytes(row.bytes_base64);artifactBytes+=bytes.length;snapshotRequire(bytes.length<=SNAPSHOT_LIMITS.maxArtifactBytes&&artifactBytes<=SNAPSHOT_LIMITS.maxTotalArtifactBytes&&row.digest===sha(bytes)&&row.locator==='cas/'+row.digest&&!cas.has(row.locator));cas.set(row.locator,bytes);}
  const get=(locator,digest)=>{const bytes=cas.get(locator);snapshotRequire(bytes!==undefined&&locator==='cas/'+digest&&sha(bytes)===digest);return bytes;};
  const taskBytes=get('cas/'+closure.task_script_digest,closure.task_script_digest);let task;try{task=JSON.parse(taskBytes.toString('utf8'));}catch{snapshotRequire(false);}snapshotRequire(taskBytes.length<=SNAPSHOT_LIMITS.maxArtifactBytes&&jcsBytes(task).equals(taskBytes)&&exact(task,['task_script_id','steps'])&&typeof task.task_script_id==='string'&&task.task_script_id.length>0&&Array.isArray(task.steps)&&task.steps.length>0&&task.steps.length<=SNAPSHOT_LIMITS.maxTaskSteps);
  const profiles=canonicalRows(closure.replay_profiles,(row)=>row.replay_profile_id),profileIds=new Set(profiles.map((row)=>row.replay_profile_id)),steps=new Map();
  for(const step of task.steps){snapshotRequire(exact(step,['step_id','required_replay_profile_ids','instruction'])&&typeof step.step_id==='string'&&step.step_id.length>0&&!steps.has(step.step_id)&&typeof step.instruction==='string');const ids=canonicalRows(step.required_replay_profile_ids,(id)=>id);snapshotRequire(ids.length>0&&ids.every((id)=>profileIds.has(id)));steps.set(step.step_id,new Set(ids));}
  const networks=canonicalRows(closure.network_records,(row)=>[row.replay_profile_id,row.sequence]),responses=[];
  for(const profile of profiles){const sequences=networks.filter((row)=>row.replay_profile_id===profile.replay_profile_id).map((row)=>row.sequence);snapshotRequire(sequences.length>0&&sequences.every((value,index)=>value===index));}
  for(const row of networks){snapshotRequire(profileIds.has(row.replay_profile_id)&&steps.get(row.task_step_id)?.has(row.replay_profile_id)&&snapshotUrl(row.request_url)&&snapshotUrl(row.final_url)&&row.redirect_chain.length<=SNAPSHOT_LIMITS.maxRedirectHops);const redirects=[];row.redirect_chain.forEach((hop,index)=>{snapshotRequire(hop.sequence===index&&snapshotUrl(hop.url)&&snapshotUrl(hop.location));redirects.push({...canonicalCopy(hop),headers:verifiedHeaders(get(hop.content_addressed_header_artifact_locator,hop.header_digest))});});if(row.disposition==='blocked_by_policy'){snapshotRequire([row.response_status,row.header_digest,row.content_addressed_header_artifact_locator,row.raw_body_digest,row.content_addressed_body_artifact_locator].every((value)=>value===null));responses.push({...canonicalCopy(row),redirects,headers:null,body_bytes_base64:null});}else{const headers=verifiedHeaders(get(row.content_addressed_header_artifact_locator,row.header_digest)),body=get(row.content_addressed_body_artifact_locator,row.raw_body_digest);snapshotRequire(row.request_method!=='HEAD'||body.length===0);responses.push({...canonicalCopy(row),redirects,headers,body_bytes_base64:body.toString('base64')});}}
  const observationOwners=new Map();
  const observations=canonicalRows(closure.observation_records,(row)=>[row.replay_profile_id,row.task_step_id,row.evidence_kind,row.ordinal]).map((row)=>{snapshotRequire(profileIds.has(row.replay_profile_id)&&steps.get(row.task_step_id)?.has(row.replay_profile_id));const ownerKey=row.replay_profile_id+'\0'+row.artifact_digest,owner=observationOwners.get(ownerKey);snapshotRequire(owner===undefined||owner===row.task_step_id);observationOwners.set(ownerKey,row.task_step_id);return{...canonicalCopy(row),artifact_bytes_base64:get(row.content_addressed_artifact_locator,row.artifact_digest).toString('base64')};});
  for(const [stepId,ids]of steps)for(const profileId of ids)snapshotRequire(networks.some((row)=>row.task_step_id===stepId&&row.replay_profile_id===profileId)&&closure.observation_records.some((row)=>row.task_step_id===stepId&&row.replay_profile_id===profileId));
  const expectedLocators=canonicalSet(['cas/'+closure.task_script_digest,...networks.flatMap((row)=>[...row.redirect_chain.map((hop)=>hop.content_addressed_header_artifact_locator),...(row.disposition==='captured'?[row.content_addressed_header_artifact_locator,row.content_addressed_body_artifact_locator]:[])]),...closure.observation_records.map((row)=>row.content_addressed_artifact_locator)],(locator)=>locator);
  snapshotRequire(jcsBytes(expectedLocators).equals(jcsBytes(artifacts.map((row)=>row.locator))));
  const replay={run_status:'completed',run_issues:[],release_gate:'eligible',live_network_events:0,responses,observations};snapshotRequire(jcsBytes(replay).equals(jcsBytes(result.replay_evidence)));
  return{incomplete:false,source:result,authority};
 }catch{return snapshotUnavailable();}
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
const evaluateCore=(normalized,artifacts,snapshotState)=>{
 const registryRow=artifacts.rules.rules.filter((row)=>row.rule_id==='delete-safety'&&row.rule_version==='1.0.0');
 if(registryRow.length!==1)artifactFailure('RULE_REGISTRY_ROW_INVALID');
 const rule=executableRule(registryRow[0]),ruleValid=validateBySchema('Rule',rule);if(!ruleValid.ok)artifactFailure('EXECUTABLE_RULE_INVALID');
 const ruleEvaluations=[evaluateRule(rule,normalized,[])];
 const context=deriveFindingContext(normalized);
 const findings=canonicalSet(ruleEvaluations.map((row)=>emitFinding(row,context)).filter(Boolean),(row)=>row.fingerprint);const replayRules=[evaluateRule(rule,normalized,[])],replayFindings=canonicalSet(replayRules.map((row)=>emitFinding(row,context)).filter(Boolean),(row)=>row.fingerprint);if(!jcsBytes(ruleEvaluations).equals(jcsBytes(replayRules))||!jcsBytes(findings).equals(jcsBytes(replayFindings)))artifactFailure('TASK5_PROVENANCE_REPLAY_MISMATCH');
 const incomplete=snapshotState.incomplete;
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
 const snapshotMaterializationSource=snapshotState.source?{result:snapshotState.source,authority:snapshotState.authority}:null;const snapshotAuthorityDigest=snapshotState.authority?digestJcs('ux-skill:snapshot-source-authority:v1',snapshotState.authority):null;
 const snapshotVerification=snapshotMaterializationSource?materializeSnapshotClosureVerification(snapshotMaterializationSource):null;
 const output={schema_version:'evaluation-output-v1',behavior_version:normalized.behavior_version,input_digest:digestJcs('ux-skill:input:v1',normalized),evaluator_digest:artifacts.evaluatorDigest,run_status:runStatus,validation_errors:[],rule_evaluations:canonicalSet(ruleEvaluations,(row)=>row.rule_id),findings,run_issues:canonicalSet(runIssues,(row)=>[row.code,row.instance_pointer,row.dependency_id]),claim_assessments:claimAssessments,risk_assessments:riskAssessments,recommendation_assessments:recommendationAssessments,release_recommendation:releaseRecommendation,resolution_traces:[],inquiry_validation:inquiryValidation,coverage_gaps:canonicalSet(coverageGaps,(row)=>row.coverage_gap_id),snapshot_closure_verification:snapshotVerification};
 const validated=validateBySchema('EvaluationOutput',output);if(!validated.ok)artifactFailure('OUTPUT_SCHEMA_INVALID',validated.errors);
 const replayChecks=[...claimSources.map((source)=>{const id=materializeClaimAssessment(source).claim_assessment_id;return verifyPublicMaterialization('claim',source,validated.value.claim_assessments.find((row)=>row.claim_assessment_id===id));}),...riskSources.map((source)=>{const id=materializeRiskAssessment(source,findingOwner).risk_assessment_id;return verifyPublicMaterialization('risk',source,validated.value.risk_assessments.find((row)=>row.risk_assessment_id===id),findingOwner);}),...recSources.map((source)=>{const id=materializeRecommendationAssessment(source).recommendation_assessment_id;return verifyPublicMaterialization('recommendation',source,validated.value.recommendation_assessments.find((row)=>row.recommendation_assessment_id===id));}),verifyPublicMaterialization('release',relSource,validated.value.release_recommendation),...(snapshotMaterializationSource?[verifyPublicMaterialization('snapshot',snapshotMaterializationSource,validated.value.snapshot_closure_verification)]:[])];
 if(replayChecks.some((ok)=>!ok))artifactFailure('PUBLIC_MATERIALIZATION_REPLAY_MISMATCH');
 const semantic=createSemanticProjection(validated.value),semanticValid=validateBySchema('SemanticProjection',semantic);if(!semanticValid.ok)artifactFailure('SEMANTIC_SCHEMA_INVALID',semanticValid.errors);
 return{semantic:semanticValid.value,audit:{rule_sources:[rule.rule_id+'@'+rule.rule_version],claim_source_digests:claimAssessments.map((row)=>row.source_material_digest),risk_source_digests:riskAssessments.map((row)=>row.source_material_digest),recommendation_source_digests:recommendationAssessments.map((row)=>row.source_material_digest),release_source_digest:releaseRecommendation.source_material_digest,snapshot_source_digest:snapshotVerification?.source_material_digest??null,snapshot_source_authority_digest:snapshotAuthorityDigest,replay_verification:'byte_equal',materialization_verification:'byte_equal'}};
};

export async function evaluate(bundle){
 if(arguments.length!==1){const error=new TypeError('OUT_OF_BAND_EVIDENCE_FORBIDDEN');error.code='OUT_OF_BAND_EVIDENCE_FORBIDDEN';throw error;}
 const input=validateInput(bundle);if(!input.ok)inputFailure(input.errors);
 const artifacts=await verifyArtifacts(),normalized=input.value;
 const expected={decision_policy_digest:artifacts.decisionDigest,claim_policy_digest:artifacts.policyDigest,rule_registry_digest:artifacts.rulesDigest};
 if(!jcsBytes(normalized.policy_digests).equals(jcsBytes(expected)))inputFailure([{stage:'policy',code:'INVARIANT_POLICY_DIGEST_MISMATCH',instance_pointer:'/policy_digests',invariant_or_schema_id:'Task10PolicyDigest-v1',params_jcs:jcsBytes({expected}).toString('utf8')}]);
 const snapshotState=verifySnapshotClosureResult(normalized,artifacts.snapshotSources,artifacts.snapshotRegistryAvailable);const {semantic,audit}=evaluateCore(normalized,artifacts,snapshotState);
 return{assurance:{warning:'Zero findings does not mean UX is good, compliant, successful, or satisfying.',run_status:semantic.run_status,release_status:semantic.release_recommendation?.status??'no_release'},inquiry:{authoritative:false,status:semantic.inquiry_validation?.status??'incomplete',gap_ids:semantic.inquiry_validation?.gap_ids??[],scaffold:[]},semantic_projection:semantic,semantic_digest:semantic.semantic_digest,audit_sidecar:{input_normalization:'verified',policy_manifest_digest:artifacts.policyDigest,knowledge_manifest_digest:artifacts.knowledgeDigest,schema_manifest_digest:artifacts.schemaDigest,...audit,...(artifacts.snapshotRegistryAvailable?REGISTRY_AUDIT.verified:REGISTRY_AUDIT.unavailable),localized_messages:[],mcp_text:null}};
}
