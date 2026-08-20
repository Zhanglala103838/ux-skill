import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalSet } from '../../evaluator/canonical.mjs';
import { validateBySchema, validateInput } from '../../evaluator/validation.mjs';
import { fixtureWithRedirectHop, deleteBundle } from '../helpers/fixtures.mjs';

const paths=['schemas/adapters/hulian-component-doc-v1.schema.json','schemas/adapters/hulian-evaluation-request-v1.schema.json','schemas/core/authority.schema.json','schemas/core/candidate-solver-input.schema.json','schemas/core/claims.schema.json','schemas/core/evaluation-input.schema.json','schemas/core/real-world-case.schema.json','schemas/core/snapshot-closure.schema.json','schemas/evaluator/output.schema.json','schemas/evaluator/rule.schema.json','schemas/evaluator/semantic-projection.schema.json'];

test('headers is required and nested objects reject unknown fields',()=>{
 const missing=validateBySchema('CanonicalResponseHeaders',{});
 assert.deepEqual(missing.errors.map((e)=>[e.code,e.instance_pointer]),[['REQUIRED_MISSING','/headers']]);
 const extra=validateBySchema('RedirectHop',fixtureWithRedirectHop({note:'x'}));
 assert.deepEqual(extra.errors.map((e)=>e.code),['ADDITIONAL_PROPERTY']);
});

test('NFC-stage errors prevent schema diagnostics',()=>{
 const value={replay_profile_id:'p',viewport_width_css_px:1,viewport_height_css_px:1,device_scale_factor:1,input_modality:'keyboard',prefers_reduced_motion:'no-preference',prefers_contrast:'no-preference',color_scheme:'light',locale:'e\u0301',timezone:'UTC',assistive_technology_id:'none',browser_engine_digest:'a'.repeat(64)};
 assert.deepEqual(validateBySchema('ReplayProfile',value).errors,[{stage:'nfc',code:'UNICODE_NOT_NFC',instance_pointer:'/locale',invariant_or_schema_id:'IJSON-NFC-v1',params_jcs:'{}'}]);
});

test('duplicate IDs and missing references are collection errors',()=>{
 const value=deleteBundle();
 const duplicate=validateInput({...value,claims:[value.claims[0],{...value.claims[0],relation_kind:'causal'}]});
 assert.deepEqual(duplicate.errors.filter((e)=>e.code==='DUPLICATE_ID_CONFLICT'),[{stage:'collections',code:'DUPLICATE_ID_CONFLICT',instance_pointer:'/claims/1/claim_id',invariant_or_schema_id:'InputCollectionRegistry-v1',params_jcs:'{"key":"claim-delete-impact"}'}]);
 const ref=validateInput({...value,scenario_profile_id:'absent'});
 assert.deepEqual(ref.errors.filter((e)=>e.code==='REF_MISSING'),[{stage:'collections',code:'REF_MISSING',instance_pointer:'/scenario_profile_id',invariant_or_schema_id:'ScenarioProfileRef-v1',params_jcs:'{"ref":"absent"}'}]);
});

test('tagged unions emit only discriminator errors',()=>{
 assert.deepEqual(validateBySchema('AstNode',{node_id:'n'}).errors.map((e)=>e.code),['AST_OP_REQUIRED']);
 assert.deepEqual(validateBySchema('AstNode',{node_id:'n',op:'script'}).errors.map((e)=>e.code),['AST_OP_UNKNOWN']);
 const selected=validateBySchema('AstNode',{node_id:'n',op:'literal',path:'/not-allowed'});
 assert.deepEqual(selected.errors.map((e)=>[e.code,e.instance_pointer]),[['ADDITIONAL_PROPERTY','/path'],['REQUIRED_MISSING','/value']]);
});

test('later ref validation is suppressed when schema prerequisite is absent',()=>{
 const {scenario_profile_id,...value}=deleteBundle();
 const errors=validateInput(value).errors;
 assert.deepEqual(errors.filter((e)=>e.code==='SUPPRESSED_BY_STAGE'),[{stage:'collections',code:'SUPPRESSED_BY_STAGE',instance_pointer:'/scenario_profile_id',invariant_or_schema_id:'ScenarioProfileRef-v1',params_jcs:'{"prerequisite_stage":"schema"}'}]);
});

const inspect=(node,path='')=>{if(!node||typeof node!=='object')return;if(node.type==='object'||(Array.isArray(node.type)&&node.type.includes('object'))){assert.equal(node.additionalProperties,false,`${path||'/'} is open`);assert.ok(Array.isArray(node.required),`${path||'/'} lacks required`);}for(const [key,value] of Object.entries(node))inspect(value,`${path}/${key}`);};

test('all domain schema objects are explicitly closed',async()=>{for(const path of paths)inspect(JSON.parse(await readFile(path,'utf8')));});

test('manifest recomputes from exact raw bytes',async()=>{
 const manifest=JSON.parse(await readFile('schemas/manifest.json','utf8'));const actual=[];
 for(const path of paths)actual.push({path,file_digest:createHash('sha256').update(await readFile(path)).digest('hex')});
 assert.deepEqual(manifest,canonicalSet(actual,(row)=>row.path));
 assert.deepEqual(manifest.map((row)=>row.path),paths);
});

test('valid evaluation fixture passes every validation stage',()=>{assert.deepEqual(validateInput(deleteBundle()),{ok:true,value:deleteBundle()});});const exactRootTypeError={stage:'schema',code:'TYPE_MISMATCH',instance_pointer:'',invariant_or_schema_id:'EvaluationInputBundle',params_jcs:'{"expected":"object"}'};

test('JSON-valid non-object roots fail closed without throwing',()=>{
 for(const value of [null,42,[]])assert.deepEqual(validateInput(value),{ok:false,errors:[exactRootTypeError]});
});

const validRule=()=>({
 rule_id:'branch-contract',rule_version:'1',release_critical:true,finding_type:'escalation',
 required_dependencies:[],required_input_pointers:[],
 applicability:{node_id:'app',op:'literal',value:true},
 exclusion:{node_id:'ex',op:'literal',value:false},
 precondition:{node_id:'pre',op:'exists',path:'/target'},
 check:{node_id:'check',op:'literal',value:true}
});

test('direct and Rule-nested AST discriminators short-circuit generic diagnostics',()=>{
 const directMissing=validateBySchema('AstNode',{node_id:'n'});
 assert.deepEqual(directMissing.errors,[{stage:'schema',code:'AST_OP_REQUIRED',instance_pointer:'/op',invariant_or_schema_id:'AST-v1',params_jcs:'{"missingProperty":"op"}'}]);
 const directUnknown=validateBySchema('AstNode',{node_id:'n',op:'script'});
 assert.deepEqual(directUnknown.errors,[{stage:'schema',code:'AST_OP_UNKNOWN',instance_pointer:'/op',invariant_or_schema_id:'AST-v1',params_jcs:'{"op":"script"}'}]);
 const nestedMissing=validateBySchema('Rule',{...validRule(),applicability:{node_id:'app'}});
 assert.deepEqual(nestedMissing.errors,[{stage:'schema',code:'AST_OP_REQUIRED',instance_pointer:'/applicability/op',invariant_or_schema_id:'AST-v1',params_jcs:'{"missingProperty":"op"}'}]);
 const nestedUnknown=validateBySchema('Rule',{...validRule(),applicability:{node_id:'app',op:'script'}});
 assert.deepEqual(nestedUnknown.errors,[{stage:'schema',code:'AST_OP_UNKNOWN',instance_pointer:'/applicability/op',invariant_or_schema_id:'AST-v1',params_jcs:'{"op":"script"}'}]);
 const recursiveUnknown=validateBySchema('Rule',{...validRule(),applicability:{node_id:'app',op:'all',children:[{node_id:'child',op:'script'}]}});
 assert.deepEqual(recursiveUnknown.errors,[{stage:'schema',code:'AST_OP_UNKNOWN',instance_pointer:'/applicability/children/0/op',invariant_or_schema_id:'AST-v1',params_jcs:'{"op":"script"}'}]);
});

test('every recognized AST operator rejects its selected-branch type violations',()=>{
 const cases=[
  [{node_id:'n',op:'literal',value:'true'},'/value','TYPE_MISMATCH'],
  [{node_id:'n',op:'exists',path:1},'/path','TYPE_MISMATCH'],
  [{node_id:'n',op:'eq',path:'/x',value:{}},'/value','TYPE_MISMATCH'],
  [{node_id:'n',op:'in',path:'/x',value:[]},'/value','TYPE_MISMATCH'],
  [{node_id:'n',op:'compare',path:'/x',operator:'lt',value:'1'},'/value','TYPE_MISMATCH'],
  [{node_id:'n',op:'compare',path:'/x',operator:'before',value:1},'/operator','ENUM_MISMATCH'],
  [{node_id:'n',op:'all',children:{}},'/children','TYPE_MISMATCH'],
  [{node_id:'n',op:'any',children:[true]},'/children/0','TYPE_MISMATCH'],
  [{node_id:'n',op:'not',child:[]},'/child','TYPE_MISMATCH'],
  [{node_id:'n',op:'builtin',invariant_id:1,params:{}},'/invariant_id','TYPE_MISMATCH'],
  [{node_id:'n',op:'builtin',invariant_id:'known',params:[]},'/params','TYPE_MISMATCH']
 ];
 for(const [node,pointer,code] of cases){const result=validateBySchema('AstNode',node);assert.equal(result.ok,false,JSON.stringify(node));assert.ok(result.errors.some((row)=>row.instance_pointer===pointer&&row.code===code),JSON.stringify(result));}
 const recursive=validateBySchema('Rule',{...validRule(),applicability:{node_id:'app',op:'all',children:[{node_id:'child',op:'literal',value:'true'}]}});
 assert.ok(recursive.errors.some((row)=>row.instance_pointer==='/applicability/children/0/value'&&row.code==='TYPE_MISMATCH'));
});

const unfrozenDeleteBundle=()=>structuredClone(deleteBundle());
const digest=(char)=>char.repeat(64);
const replayProfile=(id)=>({replay_profile_id:id,viewport_width_css_px:100,viewport_height_css_px:100,device_scale_factor:1,input_modality:'keyboard',prefers_reduced_motion:'no-preference',prefers_contrast:'no-preference',color_scheme:'light',locale:'zh-CN',timezone:'Asia/Shanghai',assistive_technology_id:'none',browser_engine_digest:digest('a')});
const blockedNetwork=(profile,sequence,redirect_chain=[])=>({replay_profile_id:profile,sequence,task_step_id:'step',request_method:'GET',request_url:'https://example.test',redirect_chain,final_url:'https://example.test',network_kind:'document',disposition:'blocked_by_policy',response_status:null,header_digest:null,content_addressed_header_artifact_locator:null,raw_body_digest:null,content_addressed_body_artifact_locator:null});
const hop=(sequence)=>({sequence,status:301,url:'https://example.test/a',location:'https://example.test/b',header_digest:digest('b'),content_addressed_header_artifact_locator:'cas/header'});
const closure=(network_records)=>({closure_version:'snapshot-closure-v1',entry_url:'https://example.test',task_script_digest:digest('1'),capture_environment_digest:digest('2'),captured_at:'2026-08-18T00:00:00Z',authenticated:false,replay_profiles:[replayProfile('z'),replayProfile('a')],network_records,observation_records:[],outbound_effect_ledger_digest:digest('3'),completeness_status:'complete',manifest_digest:digest('4')});

test('canonical collections sort, collapse identical rows, and preserve conflict rejection',()=>{
 const value=unfrozenDeleteBundle();
 const claimA={...value.claims[0],claim_id:'a'};
 const claimZ={...value.claims[0],claim_id:'z'};
 const sortedResult=validateInput({...value,claims:[claimZ,claimA]});
 assert.equal(sortedResult.ok,true);
 assert.deepEqual(sortedResult.value.claims.map((row)=>row.claim_id),['a','z']);
 const collapsed=validateInput({...value,claims:[claimA,structuredClone(claimA)]});
 assert.equal(collapsed.ok,true);
 assert.deepEqual(collapsed.value.claims,[claimA]);
 const conflict=validateInput({...value,claims:[claimA,{...claimA,relation_kind:'causal'}]});
 assert.deepEqual(conflict.errors.filter((row)=>row.code==='DUPLICATE_ID_CONFLICT'),[{stage:'collections',code:'DUPLICATE_ID_CONFLICT',instance_pointer:'/claims/1/claim_id',invariant_or_schema_id:'InputCollectionRegistry-v1',params_jcs:'{"key":"a"}'}]);
});

test('composite-key nested registries normalize and ordered lists require contiguous sequence',()=>{
 const normalized=validateBySchema('SnapshotClosureManifest',closure([blockedNetwork('z',0),blockedNetwork('a',0)]));
 assert.equal(normalized.ok,true);
 assert.deepEqual(normalized.value.replay_profiles.map((row)=>row.replay_profile_id),['a','z']);
 assert.deepEqual(normalized.value.network_records.map((row)=>[row.replay_profile_id,row.sequence]),[['a',0],['z',0]]);
 const discontinuous=validateBySchema('NetworkRecord',blockedNetwork('a',0,[hop(0),hop(2)]));
 assert.deepEqual(discontinuous.errors.filter((row)=>row.code==='INVARIANT_SEQUENCE_CONTIGUOUS'),[{stage:'collections',code:'INVARIANT_SEQUENCE_CONTIGUOUS',instance_pointer:'/redirect_chain/1/sequence',invariant_or_schema_id:'InputCollectionRegistry-v1',params_jcs:'{"actual":2,"expected":1}'}]);
});

test('invalid and missing reference prerequisites suppress later checks deterministically',()=>{
 const invalid=unfrozenDeleteBundle();
 invalid.claims[0].evidence_refs=[42];
 const invalidResult=validateInput(invalid);
 assert.equal(invalidResult.errors.some((row)=>row.code==='REF_MISSING'),false);
 assert.deepEqual(invalidResult.errors.filter((row)=>row.code==='SUPPRESSED_BY_STAGE'),[{stage:'collections',code:'SUPPRESSED_BY_STAGE',instance_pointer:'/claims/0/evidence_refs/0',invariant_or_schema_id:'EvidenceRef-v1',params_jcs:'{"prerequisite_stage":"schema"}'}]);
 const missing=unfrozenDeleteBundle();
 delete missing.evidence;
 const missingResult=validateInput(missing);
 assert.equal(missingResult.errors.some((row)=>row.code==='REF_MISSING'),false);
 assert.deepEqual(missingResult.errors.filter((row)=>row.code==='SUPPRESSED_BY_STAGE'),[{stage:'collections',code:'SUPPRESSED_BY_STAGE',instance_pointer:'/claims/0/evidence_refs',invariant_or_schema_id:'EvidenceRef-v1',params_jcs:'{"prerequisite_stage":"schema"}'}]);
});

test('nullable diagnostics coalesce by property and mapped code without combinator leakage',()=>{
 const value=unfrozenDeleteBundle();
 value.inquiry_draft=42;
 const rows=validateInput(value).errors.filter((row)=>row.instance_pointer==='/inquiry_draft');
 assert.deepEqual(rows,[{stage:'schema',code:'TYPE_MISMATCH',instance_pointer:'/inquiry_draft',invariant_or_schema_id:'EvaluationInputBundle',params_jcs:'{"expected":["object","null"]}'}]);
 assert.equal(rows.some((row)=>/anyOf|oneOf/.test(row.params_jcs)),false);
});

test('fixed-design schema domains expose authority, assessment, fingerprint, inquiry, and real-world contracts',async()=>{
 const [authority,claims,output,projection,evaluationInput,realWorld]=await Promise.all([
  'schemas/core/authority.schema.json','schemas/core/claims.schema.json','schemas/evaluator/output.schema.json','schemas/evaluator/semantic-projection.schema.json','schemas/core/evaluation-input.schema.json','schemas/core/real-world-case.schema.json'
 ].map(async(schemaFile)=>JSON.parse(await readFile(schemaFile,'utf8'))));
 for(const name of ['ExecutionEnvelope','ApprovalDecision','TimeAuthorityPolicy','Capability','CapabilityLedgerEntry','InvalidationRecord','ExecutionLease','ExternalEffectConnector'])assert.ok(authority.$defs[name],`missing authority definition ${name}`);
 assert.deepEqual(authority.$defs.ExecutionEnvelope.required,['envelope_id','envelope_digest','body']);
 assert.deepEqual(authority.$defs.ApprovalDecision.required,['approval_decision_id','sequence','approver_context_digest','approver_authority_ref','envelope_digest','decision','effective_at','expires_at','consumed']);
 assert.deepEqual(authority.$defs.TimeAuthorityPolicy.required,['time_authority_policy_id','authority','key_version','clock_profile','monotonic_profile','effective_at','expires_at','policy_digest']);
 for(const name of ['AssessedPredicate','ClaimAssessmentPolicy','ClaimCheckResult','EvidenceDimensionScore'])assert.ok(claims.$defs[name],`missing claims definition ${name}`);
 assert.ok(claims.$defs.ClaimAssessmentCoreV1.required.includes('assessed_predicate'));
 assert.ok(claims.$defs.ClaimAssessmentCoreV1.required.includes('checks'));
 assert.ok(claims.$defs.ClaimAssessmentCoreV1.required.includes('dimension_scores'));
 assert.deepEqual(claims.$defs.ClaimCheckResult.properties.status.enum,['rejected','unknown','verified_with_limit','verified']);
 const fingerprint=['schema_version','behavior_version','rule_id','rule_version','finding_type','emission_reason_code','canonical_target_locator','target_snapshot_digest','scenario_binding_ids','claim_key'];
 assert.deepEqual(output.$defs.FindingFingerprintV1.required,fingerprint);
 assert.deepEqual(projection.$defs.FindingFingerprintV1.required,fingerprint);
 for(const schema of [output,projection])for(const name of ['ClaimAssessment','RiskAssessment','RecommendationAssessment'])assert.ok(schema.$defs[name],`missing dedicated ${name}`);
 assert.equal(evaluationInput.required.includes('inquiry_draft'),false);
 assert.equal(evaluationInput.properties.inquiry_draft.anyOf.some((branch)=>branch.type==='null'),true);
 assert.ok(realWorld.allOf.some((branch)=>branch.if?.properties?.target_kind?.const==='black_box_site'&&branch.then?.required?.includes('snapshot_closure_digest')));
 assert.ok(realWorld.allOf.some((branch)=>branch.if?.properties?.target_kind?.enum?.includes('pinned_repository')&&branch.then?.required?.includes('immutable_ref')));
 assert.ok(realWorld.required.includes('negative_controls'));
 assert.ok(realWorld.$defs.NegativeControlGateSpec);
 assert.ok(realWorld.$defs.Measure.required.includes('measure_role'));
 assert.deepEqual(realWorld.$defs.Measure.properties.measure_role.enum,['success','guardrail']);
});

test('unknown schema IDs, including prototype names, fail closed deterministically',()=>{
 for(const schemaId of ['missing-schema','__proto__'])assert.deepEqual(validateBySchema(schemaId,{}),{ok:false,errors:[{stage:'schema',code:'INVARIANT_SCHEMA_ID_UNKNOWN',instance_pointer:'',invariant_or_schema_id:'SchemaRegistry-v1',params_jcs:`{"schema_id":"${schemaId}"}`}]});
});const registryMemberCases=[
 ['EvaluationInputBundle','scenario_profiles'],['EvaluationInputBundle','candidate_universe'],['EvaluationInputBundle','journeys'],['EvaluationInputBundle','source_registry_refs'],['EvaluationInputBundle','evidence'],['EvaluationInputBundle','studies'],['EvaluationInputBundle','claims'],['EvaluationInputBundle','adapter_evidence'],
 ['AuthorityBundle','authority_roots'],['AuthorityBundle','acting_edges'],['AuthorityBundle','grants'],['AuthorityBundle','control_principal_edges'],['AuthorityBundle','party_graph_proofs'],['AuthorityBundle','party_inventories'],['AuthorityBundle','authorization_decisions'],['AuthorityBundle','execution_envelopes'],['AuthorityBundle','approval_decisions'],['AuthorityBundle','time_authority_policies'],['AuthorityBundle','capabilities'],['AuthorityBundle','capability_ledger_entries'],['AuthorityBundle','invalidations'],['AuthorityBundle','execution_leases'],['AuthorityBundle','external_effect_connectors'],
 ['ClaimsBundle','sources'],['ClaimsBundle','fragments'],['ClaimsBundle','proposition_assessments'],['ClaimsBundle','policy_adoptions'],['ClaimsBundle','claims'],['ClaimsBundle','claim_assessments'],['ClaimsBundle','claim_assessment_policies'],
 ['SnapshotClosureManifest','replay_profiles'],['SnapshotClosureManifest','network_records'],['SnapshotClosureManifest','observation_records'],
 ['EvaluationOutput','rule_evaluations'],['EvaluationOutput','findings'],['EvaluationOutput','run_issues'],['EvaluationOutput','claim_assessments'],['EvaluationOutput','risk_assessments'],['EvaluationOutput','recommendation_assessments'],['EvaluationOutput','alternatives'],['EvaluationOutput','solutions'],['EvaluationOutput','unsat_cores'],['EvaluationOutput','resolution_traces'],['EvaluationOutput','coverage_gaps'],
 ['SemanticProjection','rule_evaluations'],['SemanticProjection','findings'],['SemanticProjection','run_issues'],['SemanticProjection','claim_assessments'],['SemanticProjection','risk_assessments'],['SemanticProjection','recommendation_assessments'],['SemanticProjection','resolution_traces'],['SemanticProjection','coverage_gaps'],
 ['RealWorldRegressionCase','hypotheses'],['RealWorldRegressionCase','measures'],['RealWorldRegressionCase','negative_controls']
];
for(const [schemaId,field] of registryMemberCases)test(`registry ${schemaId}.${field} preserves schema-invalid members without throwing`,()=>{
 let result;assert.doesNotThrow(()=>{result=validateBySchema(schemaId,{[field]:[null]});});
 assert.equal(result.ok,false);
 assert.deepEqual(result.errors.filter((row)=>row.instance_pointer===`/${field}/0`).map((row)=>[row.stage,row.code]),[['schema','TYPE_MISMATCH']]);
});

test('valid control-principal edges normalize by control_edge_id',()=>{
 const actor={namespace_uri:'https://identity.example',issuer_id:'issuer',subject_id:'subject',kind:'human'};
 const edge={control_edge_id:'edge-1',from:actor,to:{...actor,subject_id:'controller'},basis_ref:'basis-1',effective_at:'2026-08-18T00:00:00Z',expires_at:null,status:'verified'};
 const value={authority_roots:[],acting_edges:[],grants:[],control_principal_edges:[edge],party_graph_proofs:[],party_inventories:[],authorization_decisions:[],execution_envelopes:[],approval_decisions:[],time_authority_policies:[],capabilities:[],capability_ledger_entries:[],invalidations:[],execution_leases:[],external_effect_connectors:[]};
 assert.deepEqual(validateBySchema('AuthorityBundle',value),{ok:true,value});
});

const branchNodes=[
 {node_id:'',op:'literal',value:true},
 {node_id:'',op:'exists',path:'/x'},
 {node_id:'',op:'eq',path:'/x',value:null},
 {node_id:'',op:'in',path:'/x',value:'x'},
 {node_id:'',op:'compare',path:'/x',operator:'lt',value:1},
 {node_id:'',op:'all',children:[]},
 {node_id:'',op:'any',children:[]},
 {node_id:'',op:'not',child:{node_id:'child',op:'literal',value:true}},
 {node_id:'',op:'builtin',invariant_id:'known',params:{}}
];
test('every AST branch applies its declared non-type constraints',()=>{
 for(const node of branchNodes){
  const direct=validateBySchema('AstNode',node);
  assert.deepEqual(direct.errors.filter((row)=>row.instance_pointer==='/node_id'),[{stage:'schema',code:'FORMAT_INVALID',instance_pointer:'/node_id',invariant_or_schema_id:'AstNode',params_jcs:'{"constraint":"minLength"}'}]);
  const nested=validateBySchema('Rule',{...validRule(),applicability:node});
  assert.deepEqual(nested.errors.filter((row)=>row.instance_pointer==='/applicability/node_id'),[{stage:'schema',code:'FORMAT_INVALID',instance_pointer:'/applicability/node_id',invariant_or_schema_id:'AstNode',params_jcs:'{"constraint":"minLength"}'}]);
 }
});

test('selected path and builtin branches use the compiled branch schema',()=>{
 const invalidNodes=[
  [{node_id:'n',op:'exists',path:''},'/path','FORMAT_INVALID'],
  [{node_id:'n',op:'eq',path:'',value:null},'/path','FORMAT_INVALID'],
  [{node_id:'n',op:'in',path:'',value:'x'},'/path','FORMAT_INVALID'],
  [{node_id:'n',op:'compare',path:'',operator:'lt',value:1},'/path','FORMAT_INVALID'],
  [{node_id:'n',op:'builtin',invariant_id:'',params:{}},'/invariant_id','FORMAT_INVALID'],
  [{node_id:'n',op:'builtin',invariant_id:'known',params:{unexpected:true}},'/params/unexpected','ADDITIONAL_PROPERTY']
 ];
 for(const [node,pointer,code] of invalidNodes){
  const direct=validateBySchema('AstNode',node);assert.ok(direct.errors.some((row)=>row.instance_pointer===pointer&&row.code===code),JSON.stringify(direct));
  const nested=validateBySchema('Rule',{...validRule(),applicability:node});assert.ok(nested.errors.some((row)=>row.instance_pointer===`/applicability${pointer}`&&row.code===code),JSON.stringify(nested));
 }
});

const suppressionRows=(result)=>result.errors.filter((row)=>row.code==='SUPPRESSED_BY_STAGE');
const noReferenceLeak=(result)=>assert.equal(result.errors.some((row)=>row.code==='REF_MISSING'),false);
test('scenario reference relation suppresses every invalid source or target prerequisite',()=>{
 const cases=[];
 {const value=unfrozenDeleteBundle();delete value.scenario_profile_id;cases.push(value);}
 {const value=unfrozenDeleteBundle();value.scenario_profile_id=42;cases.push(value);}
 {const value=unfrozenDeleteBundle();delete value.scenario_profiles;cases.push(value);}
 {const value=unfrozenDeleteBundle();value.scenario_profiles=42;cases.push(value);}
 {const value=unfrozenDeleteBundle();value.scenario_profiles=[null];cases.push(value);}
 for(const value of cases){let result;assert.doesNotThrow(()=>{result=validateInput(value);});noReferenceLeak(result);assert.deepEqual(suppressionRows(result),[{stage:'collections',code:'SUPPRESSED_BY_STAGE',instance_pointer:'/scenario_profile_id',invariant_or_schema_id:'ScenarioProfileRef-v1',params_jcs:'{"prerequisite_stage":"schema"}'}]);}
});

test('evidence reference relation suppresses every invalid source or target prerequisite',()=>{
 const cases=[];
 {const value=unfrozenDeleteBundle();delete value.claims[0].evidence_refs;cases.push([value,'/claims/0/evidence_refs']);}
 {const value=unfrozenDeleteBundle();value.claims[0].evidence_refs=42;cases.push([value,'/claims/0/evidence_refs']);}
 {const value=unfrozenDeleteBundle();value.claims[0].evidence_refs=[null];cases.push([value,'/claims/0/evidence_refs/0']);}
 {const value=unfrozenDeleteBundle();delete value.evidence;cases.push([value,'/claims/0/evidence_refs']);}
 {const value=unfrozenDeleteBundle();value.evidence=42;cases.push([value,'/claims/0/evidence_refs']);}
 {const value=unfrozenDeleteBundle();value.evidence=[null];cases.push([value,'/claims/0/evidence_refs']);}
 for(const [value,pointer] of cases){let result;assert.doesNotThrow(()=>{result=validateInput(value);});noReferenceLeak(result);assert.deepEqual(suppressionRows(result),[{stage:'collections',code:'SUPPRESSED_BY_STAGE',instance_pointer:pointer,invariant_or_schema_id:'EvidenceRef-v1',params_jcs:'{"prerequisite_stage":"schema"}'}]);}
});

test('evidence source relation accepts a registered source and rejects an absent target',()=>{
 assert.equal(validateInput(unfrozenDeleteBundle()).ok,true);
 const value=unfrozenDeleteBundle();value.evidence[0].source_ref='absent';
 const result=validateInput(value);
 assert.deepEqual(result,{ok:false,errors:[{stage:'collections',code:'REF_MISSING',instance_pointer:'/evidence/0/source_ref',invariant_or_schema_id:'SourceRegistryRef-v1',params_jcs:'{"ref":"absent"}'}]});
});

test('evidence source relation suppresses every invalid source or target prerequisite',()=>{
 const cases=[];
 {const value=unfrozenDeleteBundle();delete value.evidence[0].source_ref;cases.push(value);}
 {const value=unfrozenDeleteBundle();value.evidence[0].source_ref=42;cases.push(value);}
 {const value=unfrozenDeleteBundle();delete value.source_registry_refs;cases.push(value);}
 {const value=unfrozenDeleteBundle();value.source_registry_refs=42;cases.push(value);}
 {const value=unfrozenDeleteBundle();value.source_registry_refs=[null];cases.push(value);}
 for(const value of cases){let result;assert.doesNotThrow(()=>{result=validateInput(value);});noReferenceLeak(result);assert.deepEqual(suppressionRows(result).filter((row)=>row.invariant_or_schema_id==='SourceRegistryRef-v1'),[{stage:'collections',code:'SUPPRESSED_BY_STAGE',instance_pointer:'/evidence/0/source_ref',invariant_or_schema_id:'SourceRegistryRef-v1',params_jcs:'{"prerequisite_stage":"schema"}'}]);}
});

const validOutput=()=>({schema_version:'evaluation-output-v1',behavior_version:'0.1.0',input_digest:digest('1'),evaluator_digest:digest('2'),run_status:'completed_clear',validation_errors:[],rule_evaluations:[],findings:[],run_issues:[],claim_assessments:[{claim_assessment_id:'ca_'+ 'a'.repeat(32),source_material_digest:'b'.repeat(64),claim_id:'claim-1',policy_id:'policy-1',admissible_conclusion:'descriptive',assessed_predicate:{relation_kind:'descriptive',context_id:'context-1',time_scope_id:'time-1',subject_id:'subject-1',value:'observed'},checks:[],dimension_scores:[{dimension:'directness',score:1,grade:'limited'},{dimension:'precision',score:1,grade:'limited'},{dimension:'transportability',score:1,grade:'limited'},{dimension:'validity',score:1,grade:'limited'}],evidence_grade:{validity:'limited',directness:'limited',precision:'limited',transportability:'limited',overall:'limited'},reason_codes:[]}],risk_assessments:[],recommendation_assessments:[],release_recommendation:null,resolution_traces:[],inquiry_validation:null,coverage_gaps:[],snapshot_closure_verification:null});
test('EvaluationOutput assessed predicate is a closed nullable definition',()=>{
 assert.equal(validateBySchema('EvaluationOutput',validOutput()).ok,true);
 const invalid=validOutput();invalid.claim_assessments[0].assessed_predicate.unexpected=true;
 const result=validateBySchema('EvaluationOutput',invalid);
 assert.deepEqual(result.errors.filter((row)=>row.code==='ADDITIONAL_PROPERTY'),[{stage:'schema',code:'ADDITIONAL_PROPERTY',instance_pointer:'/claim_assessments/0/assessed_predicate/unexpected',invariant_or_schema_id:'EvaluationOutput',params_jcs:'{"additionalProperty":"unexpected"}'}]);
 const missingC=validOutput();missingC.claim_assessments[0].admissible_conclusion='causal';missingC.claim_assessments[0].assessed_predicate={relation_kind:'causal',predicate_id:'predicate-1',population_id:'population-1',context_id:'context-1',time_scope_id:'time-1',subject_id:'subject-1',value:'observed'};
 const missingRows=validateBySchema('EvaluationOutput',missingC).errors.filter((row)=>row.code==='REQUIRED_MISSING').map((row)=>row.instance_pointer);
 assert.deepEqual(missingRows,['/claim_assessments/0/assessed_predicate/counterfactual_id','/claim_assessments/0/assessed_predicate/effect_estimand_id','/claim_assessments/0/assessed_predicate/intervention_id']);
 const mismatch=validOutput();mismatch.claim_assessments[0].admissible_conclusion='causal';
 assert.deepEqual(validateBySchema('EvaluationOutput',mismatch).errors.filter((row)=>row.instance_pointer.endsWith('/relation_kind')).map((row)=>row.code),['ENUM_MISMATCH']);
});

test('TASK5_PUBLIC_SHAPE_RED preserves full RuleEvaluation Finding and RunIssue across roots',async()=>{
 const [{default:Ajv2020},{evaluateRule,emitFinding},{materializeRiskAssessment}]=await Promise.all([
  import('ajv/dist/2020.js'),
  import('../../evaluator/rules-runtime.mjs'),
  import('../../evaluator/projection.mjs')
 ]);
 const [outputSchema,projectionSchema]=await Promise.all([
  readFile(new URL('../../schemas/evaluator/output.schema.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8').then(JSON.parse)
 ]);
 const expected={
  RuleEvaluation:['rule_id','rule_version','release_critical','finding_type','terminal','outcome','reason_code','trace','dependency_trace','run_issue'],
  Finding:['finding_id','fingerprint_full_digest','fingerprint','finding_type','emission_reason_code','rule_id','rule_version'],
  RunIssue:['code','instance_pointer','dependency_id']
 };
 for(const name of Object.keys(expected)){
  assert.deepEqual(projectionSchema.$defs[name],outputSchema.$defs[name],name+' differs across public schemas');
  assert.equal(outputSchema.$defs[name].additionalProperties,false);
  assert.deepEqual(outputSchema.$defs[name].required,expected[name]);
 }
 for(const schema of [outputSchema,projectionSchema]){
  for(const field of ['rule_evaluations','findings','run_issues'])assert.equal(schema.properties[field].items.$ref,'#/$defs/'+({rule_evaluations:'RuleEvaluation',findings:'Finding',run_issues:'RunIssue'}[field]));
 }
 const rule={
  rule_id:'task5-public-owner',rule_version:'1.0.0',release_critical:true,finding_type:'usability',
  required_dependencies:[],registered_input_pointers:['/target/passes'],required_input_pointers:[],
  applicability:{node_id:'app',op:'literal',value:true},exclusion:{node_id:'exc',op:'literal',value:false},
  precondition:{node_id:'pre',op:'literal',value:true},check:{node_id:'check',op:'eq',path:'/target/passes',value:true}
 };
 const ruleEvaluation=evaluateRule(rule,{target:{passes:[]} },[]);
 assert.deepEqual(Object.keys(ruleEvaluation).sort(),[...expected.RuleEvaluation].sort());
 assert.equal(ruleEvaluation.outcome,'evaluation_error');
 const finding=emitFinding(ruleEvaluation,{schema_version:'finding-v1',behavior_version:'0.1.0',canonical_target_locator:'admin/task5-owner',target_snapshot_digest:'3'.repeat(64),scenario_binding_ids:['admin-desktop'],claim_key:null});
 assert.ok(finding);
 assert.deepEqual(Object.keys(finding).sort(),[...expected.Finding].sort());
 assert.deepEqual(Object.keys(ruleEvaluation.run_issue).sort(),[...expected.RunIssue].sort());
 const riskContext={severity:'moderate',likelihood:'known',exposure:'known',reversibility:'reversible',key_factor_status:'verified',purpose:'other',materially_relies_on:false,inference_kind:'other',prohibition_status:'not_applicable',mandatory_check_status:'pass',other_hard_checks_status:'pass',signal_policy_row:null};
 const riskSource={finding_id:finding.finding_id,finding,context:riskContext};
 const risk=materializeRiskAssessment(riskSource,{findings:[finding]});
 assert.equal(risk.finding_id,finding.finding_id);
 const shortFinding={finding_id:finding.finding_id,fingerprint_full_digest:finding.fingerprint_full_digest,fingerprint:finding.fingerprint};
 assert.throws(()=>materializeRiskAssessment({finding_id:shortFinding.finding_id,finding:shortFinding,context:riskContext},{findings:[shortFinding]}));
 const shortRule={rule_id:ruleEvaluation.rule_id,outcome:ruleEvaluation.outcome,reason_code:ruleEvaluation.reason_code,release_critical:ruleEvaluation.release_critical};
 const ajv=new Ajv2020({strict:true,allErrors:true});
 for(const schema of [outputSchema,projectionSchema]){
  const compile=(name)=>ajv.compile({$schema:schema.$schema,$defs:schema.$defs,$ref:'#/$defs/'+name});
  const validateRule=compile('RuleEvaluation'),validateFinding=compile('Finding'),validateIssue=compile('RunIssue');
  assert.equal(validateRule(ruleEvaluation),true,JSON.stringify(validateRule.errors));
  assert.equal(validateRule(shortRule),false,'four-key RuleEvaluation remained public-valid');
  assert.equal(validateFinding(finding),true,JSON.stringify(validateFinding.errors));
  assert.equal(validateFinding(shortFinding),false,'three-key Finding remained public-valid');
  assert.equal(validateIssue(ruleEvaluation.run_issue),true,JSON.stringify(validateIssue.errors));
 }
 const common={schema_version:'evaluation-output-v1',behavior_version:'0.1.0',input_digest:'4'.repeat(64),evaluator_digest:'5'.repeat(64),run_status:'completed_escalated',rule_evaluations:[ruleEvaluation],findings:[finding],run_issues:[ruleEvaluation.run_issue],claim_assessments:[],risk_assessments:[risk],recommendation_assessments:[],release_recommendation:null,resolution_traces:[],inquiry_validation:null,coverage_gaps:[],snapshot_closure_verification:null};
 const output={...common,validation_errors:[]};
 const projection={...common,semantic_digest:'6'.repeat(64)};
 for(const [schemaId,value] of [['EvaluationOutput',output],['SemanticProjection',projection]]){
  const valid=validateBySchema(schemaId,value);
  assert.equal(valid.ok,true,schemaId+' rejects genuine Task5 root: '+JSON.stringify(valid.errors));
  assert.equal(validateBySchema(schemaId,{...value,rule_evaluations:[shortRule]}).ok,false,schemaId+' accepts four-key RuleEvaluation');
  assert.equal(validateBySchema(schemaId,{...value,findings:[shortFinding]}).ok,false,schemaId+' accepts three-key Finding');
 }
});

test('TASK5_RUN_ISSUE_CODE_RED closes public RunIssue code domain',async()=>{
 const [{default:Ajv2020},outputSchema,projectionSchema]=await Promise.all([
  import('ajv/dist/2020.js'),
  readFile(new URL('../../schemas/evaluator/output.schema.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8').then(JSON.parse)
 ]);
 assert.deepEqual(projectionSchema.$defs.RunIssue,outputSchema.$defs.RunIssue);
 assert.equal(outputSchema.$defs.RunIssue.properties.code.const,'RULE_EVALUATION_ERROR');
 const validIssue={code:'RULE_EVALUATION_ERROR',instance_pointer:'/check',dependency_id:null};
 const unknownIssue={...validIssue,code:'UNKNOWN_RUN_ISSUE'};
 const ajv=new Ajv2020({strict:true,allErrors:true});
 for(const schema of [outputSchema,projectionSchema]){
  const validate=ajv.compile({$schema:schema.$schema,$defs:schema.$defs,$ref:'#/$defs/RunIssue'});
  assert.equal(validate(validIssue),true,JSON.stringify(validate.errors));
  assert.equal(validate(unknownIssue),false,'unknown RunIssue code remains valid in isolation');
 }
 const common={schema_version:'evaluation-output-v1',behavior_version:'0.1.0',input_digest:'7'.repeat(64),evaluator_digest:'8'.repeat(64),run_status:'completed_with_gaps',rule_evaluations:[],findings:[],run_issues:[validIssue],claim_assessments:[],risk_assessments:[],recommendation_assessments:[],release_recommendation:null,resolution_traces:[],inquiry_validation:null,coverage_gaps:[],snapshot_closure_verification:null};
 const roots=[
  ['EvaluationOutput',{...common,validation_errors:[]}],
  ['SemanticProjection',{...common,semantic_digest:'9'.repeat(64)}]
 ];
 const nestedIssue={...validIssue,instance_pointer:'',dependency_id:null};
 const nested={rule_id:'issue-owner',rule_version:'1.0.0',release_critical:false,finding_type:'usability',terminal:'invalid_input',outcome:'evaluation_error',reason_code:'INVALID_INPUT',trace:[],dependency_trace:[],run_issue:nestedIssue};
 for(const [schemaId,root] of roots){
  assert.equal(validateBySchema(schemaId,root).ok,true,schemaId+' rejects legal orphan RunIssue');
  assert.equal(validateBySchema(schemaId,{...root,run_issues:[unknownIssue]}).ok,false,schemaId+' accepts unknown root RunIssue');
  assert.equal(validateBySchema(schemaId,{...root,rule_evaluations:[nested]}).ok,true,schemaId+' rejects valid nested RunIssue');
  assert.equal(validateBySchema(schemaId,{...root,rule_evaluations:[{...nested,run_issue:{...nestedIssue,code:unknownIssue.code}}]}).ok,false,schemaId+' accepts unknown nested RunIssue');
 }
});

test('TASK5_INVALID_TERMINAL_BRANCH_RED closes invalid input and invalid rule producer rows',async()=>{
 const [{default:Ajv2020},{evaluateRule},outputSchema,projectionSchema]=await Promise.all([
  import('ajv/dist/2020.js'),
  import('../../evaluator/rules-runtime.mjs'),
  readFile(new URL('../../schemas/evaluator/output.schema.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8').then(JSON.parse)
 ]);
 assert.deepEqual(projectionSchema.$defs.RuleEvaluation,outputSchema.$defs.RuleEvaluation);
 const baseRule={
  rule_id:'task5-invalid-terminal',rule_version:'1.0.0',release_critical:true,finding_type:'usability',
  required_dependencies:[],registered_input_pointers:['/target/enabled'],required_input_pointers:[],
  applicability:{node_id:'app',op:'literal',value:true},exclusion:{node_id:'exc',op:'literal',value:false},
  precondition:{node_id:'pre',op:'literal',value:true},check:{node_id:'check',op:'literal',value:true}
 };
 const rows=[
  evaluateRule(baseRule,null,[]),
  evaluateRule({...baseRule,applicability:{node_id:'bad-app',op:'script'}},{target:{}},[])
 ];
 assert.deepEqual(rows.map(({terminal,outcome,reason_code})=>({terminal,outcome,reason_code})),[
  {terminal:'invalid_input',outcome:'evaluation_error',reason_code:'INVALID_INPUT'},
  {terminal:'invalid_rule',outcome:'evaluation_error',reason_code:'INVALID_RULE'}
 ]);
 for(const row of rows){
  assert.deepEqual(row.trace,[]);
  assert.deepEqual(row.dependency_trace,[]);
  assert.deepEqual(row.run_issue,{code:'RULE_EVALUATION_ERROR',instance_pointer:'',dependency_id:null});
 }
 const invalidBranches=outputSchema.$defs.RuleEvaluation.oneOf.filter((branch)=>['invalid_input','invalid_rule'].includes(branch.properties.terminal.const));
 assert.deepEqual(invalidBranches.map((branch)=>branch.properties.terminal.const),['invalid_input','invalid_rule']);
 for(const branch of invalidBranches){
  assert.equal(branch.properties.trace.maxItems,0,branch.properties.terminal.const+' trace is not closed empty');
  assert.equal(branch.properties.dependency_trace.maxItems,0,branch.properties.terminal.const+' dependency trace is not closed empty');
 }
 const traceItem={node_id:'tamper',parent_node_id:null,value:'T'};
 const dependencyItem={dependency_id:'dependency-tamper',status:'success',complete:true};
 const tamper=(row)=>[
  ['trace',{...row,trace:[traceItem]}],
  ['dependency_trace',{...row,dependency_trace:[dependencyItem]}],
  ['instance_pointer',{...row,run_issue:{...row.run_issue,instance_pointer:'/check'}}],
  ['dependency_id',{...row,run_issue:{...row.run_issue,dependency_id:'dependency-tamper'}}]
 ];
 const root=(schemaId,row)=>{
  const common={schema_version:'evaluation-output-v1',behavior_version:'0.1.0',input_digest:'a'.repeat(64),evaluator_digest:'b'.repeat(64),run_status:'failed',rule_evaluations:[row],findings:[],run_issues:[row.run_issue],claim_assessments:[],risk_assessments:[],recommendation_assessments:[],release_recommendation:null,resolution_traces:[],inquiry_validation:null,coverage_gaps:[],snapshot_closure_verification:null};
  return schemaId==='EvaluationOutput'?{...common,validation_errors:[]}:{...common,semantic_digest:'c'.repeat(64)};
 };
 const ajv=new Ajv2020({strict:true,allErrors:true});
 for(const [schemaId,schema] of [['EvaluationOutput',outputSchema],['SemanticProjection',projectionSchema]]){
  const validate=ajv.compile({$schema:schema.$schema,$defs:schema.$defs,$ref:'#/$defs/RuleEvaluation'});
  for(const row of rows){
   assert.equal(validate(row),true,schemaId+' rejects genuine '+row.terminal+': '+JSON.stringify(validate.errors));
   assert.equal(validateBySchema(schemaId,root(schemaId,row)).ok,true,schemaId+' root rejects genuine '+row.terminal);
   for(const [field,value] of tamper(row)){
    assert.equal(validate(value),false,schemaId+' isolated accepts '+row.terminal+' '+field);
    assert.equal(validateBySchema(schemaId,root(schemaId,value)).ok,false,schemaId+' root accepts '+row.terminal+' '+field);
   }
  }
 }
});

test('TASK5_PUBLIC_DEPENDENCY_COHERENCE_RED reuses Task5 dependency decision semantics',async()=>{
 const {evaluateRule}=await import('../../evaluator/rules-runtime.mjs');
 const dep=(dependency_id,status,complete=true)=>({dependency_id,status,complete});
 const rule=(rule_id)=>({
  rule_id,rule_version:'1.0.0',release_critical:false,finding_type:'usability',
  required_dependencies:[{dependency_id:'dep-z',required:true},{dependency_id:'dep-a',required:true}],
  registered_input_pointers:[],required_input_pointers:[],
  applicability:{node_id:'app',op:'literal',value:true},exclusion:{node_id:'exc',op:'literal',value:false},
  precondition:{node_id:'pre',op:'literal',value:true},check:{node_id:'check',op:'literal',value:true}
 });
 const root=(schemaId,row)=>{
  const common={schema_version:'evaluation-output-v1',behavior_version:'0.1.0',input_digest:'d'.repeat(64),evaluator_digest:'e'.repeat(64),run_status:row.outcome==='pass'?'completed_clear':'completed_with_gaps',rule_evaluations:[row],findings:[],run_issues:row.run_issue?[row.run_issue]:[],claim_assessments:[],risk_assessments:[],recommendation_assessments:[],release_recommendation:null,resolution_traces:[],inquiry_validation:null,coverage_gaps:[],snapshot_closure_verification:null};
  return schemaId==='EvaluationOutput'?{...common,validation_errors:[]}:{...common,semantic_digest:'f'.repeat(64)};
 };
 const validEverywhere=(row,label)=>{for(const schemaId of ['EvaluationOutput','SemanticProjection'])assert.equal(validateBySchema(schemaId,root(schemaId,row)).ok,true,schemaId+' rejects '+label);};
 const invalidEverywhere=(row,label)=>{for(const schemaId of ['EvaluationOutput','SemanticProjection'])assert.equal(validateBySchema(schemaId,root(schemaId,row)).ok,false,schemaId+' accepts '+label);};
 const cases=[
  ['invalid_request','tool_failed','evaluation_error','REQUIRED_TOOL_INVALID_REQUEST',true],
  ['auth_error','tool_failed','evaluation_error','REQUIRED_TOOL_AUTH_ERROR',true],
  ['incompatible_source','tool_failed','evaluation_error','REQUIRED_TOOL_INCOMPATIBLE_SOURCE',true],
  ['timeout','tool_failed','evaluation_error','REQUIRED_TOOL_TIMEOUT',true],
  ['server_error','tool_failed','evaluation_error','REQUIRED_TOOL_SERVER_ERROR',true],
  ['cancelled','cancelled','not_run','REQUIRED_TOOL_CANCELLED',false],
  ['partial','completed','not_run','REQUIRED_INPUT_PARTIAL',false],
  ['not_found','completed','not_run','REQUIRED_INPUT_NOT_FOUND',false]
 ];
 const rows=[];
 for(const [status,terminal,outcome,reason_code,hasIssue] of cases){
  const tools=status==='not_found'?[dep('dep-z','success')]:[dep('dep-z','success'),dep('dep-a',status,status==='partial'?false:true)];
  const row=evaluateRule(rule('dependency-'+status),{target:{}},tools);
  assert.deepEqual({terminal:row.terminal,outcome:row.outcome,reason_code:row.reason_code},{terminal,outcome,reason_code});
  assert.deepEqual(row.dependency_trace.map(({dependency_id})=>dependency_id),['dep-a','dep-z']);
  assert.deepEqual(row.trace,[]);
  assert.deepEqual(row.run_issue,hasIssue?{code:'RULE_EVALUATION_ERROR',instance_pointer:'/required_dependencies',dependency_id:'dep-a'}:null);
  validEverywhere(row,'genuine '+status);
  rows.push({status,row,hasIssue});
 }
 const astTrace=[{node_id:'tamper',parent_node_id:null,value:'T'}];
 const alternateReason=(reason)=>reason==='REQUIRED_INPUT_PARTIAL'?'REQUIRED_INPUT_NOT_FOUND':reason==='REQUIRED_INPUT_NOT_FOUND'?'REQUIRED_INPUT_PARTIAL':reason==='REQUIRED_TOOL_INVALID_REQUEST'?'REQUIRED_TOOL_AUTH_ERROR':'REQUIRED_TOOL_INVALID_REQUEST';
 for(const {status,row,hasIssue} of rows){
  const [first,second]=row.dependency_trace;
  const invalid=[
   ['empty dependency trace',{...row,dependency_trace:[]}],
   ['reason mismatch',{...row,reason_code:alternateReason(row.reason_code)}],
   ['terminal mismatch',{...row,terminal:row.terminal==='completed'?'cancelled':'completed'}],
   ['outcome mismatch',{...row,outcome:row.outcome==='not_run'?'evaluation_error':'not_run'}],
   ['noncanonical dependency order',{...row,dependency_trace:[second,first]}],
   ['duplicate dependency id',{...row,dependency_trace:[first,{...first},second]}],
   ['invalid dependency status',{...row,dependency_trace:[{...first,status:'invalid'},second]}],
   ['invalid dependency complete',{...row,dependency_trace:[{...first,complete:'true'},second]}],
   ['nonempty AST trace',{...row,trace:astTrace}]
  ];
  if(hasIssue){
   invalid.push(
    ['winner mismatch',{...row,dependency_trace:[{...first,status:'success'},{...second,status}],run_issue:{...row.run_issue,dependency_id:'dep-a'}}],
    ['pointer mismatch',{...row,run_issue:{...row.run_issue,instance_pointer:'/check'}}],
    ['dependency id mismatch',{...row,run_issue:{...row.run_issue,dependency_id:'missing-dependency'}}]
   );
  }
  for(const [label,value] of invalid)invalidEverywhere(value,status+' '+label);
 }
 const ready=evaluateRule(rule('dependency-ready'),{target:{}},[dep('dep-z','success'),dep('dep-a','success')]);
 assert.equal(ready.outcome,'pass');
 assert.ok(ready.trace.length>0);
 validEverywhere(ready,'ready dependency AST result');
 invalidEverywhere({...ready,terminal:'tool_failed',outcome:'evaluation_error',reason_code:'REQUIRED_TOOL_TIMEOUT',trace:[],run_issue:{code:'RULE_EVALUATION_ERROR',instance_pointer:'/required_dependencies',dependency_id:'dep-a'}},'tool-derived reason when dependencyDecision is null');
 invalidEverywhere({...ready,dependency_trace:[...ready.dependency_trace].reverse()},'ready noncanonical dependency order');
 invalidEverywhere({...ready,dependency_trace:[ready.dependency_trace[0],{...ready.dependency_trace[0]},ready.dependency_trace[1]]},'ready duplicate dependency id');
});
