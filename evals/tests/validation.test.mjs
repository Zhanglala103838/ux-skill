import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalSet } from '../../evaluator/canonical.mjs';
import { validateBySchema, validateInput } from '../../evaluator/validation.mjs';
import { fixtureWithRedirectHop, deleteBundle } from '../helpers/fixtures.mjs';

const paths=['schemas/adapters/hulian-component-doc-v1.schema.json','schemas/adapters/hulian-evaluation-request-v1.schema.json','schemas/core/authority.schema.json','schemas/core/claims.schema.json','schemas/core/evaluation-input.schema.json','schemas/core/real-world-case.schema.json','schemas/core/snapshot-closure.schema.json','schemas/evaluator/output.schema.json','schemas/evaluator/rule.schema.json','schemas/evaluator/semantic-projection.schema.json'];

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

const inspect=(node,path='')=>{if(!node||typeof node!=='object')return;if(node.type==='object'){assert.equal(node.additionalProperties,false,`${path||'/'} is open`);assert.ok(Array.isArray(node.required),`${path||'/'} lacks required`);}for(const [key,value] of Object.entries(node))inspect(value,`${path}/${key}`);};

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
 assert.ok(claims.$defs.ClaimAssessment.required.includes('assessed_predicate'));
 assert.ok(claims.$defs.ClaimAssessment.required.includes('checks'));
 assert.ok(claims.$defs.ClaimAssessment.required.includes('dimension_scores'));
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
});