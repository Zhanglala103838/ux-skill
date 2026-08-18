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

test('valid evaluation fixture passes every validation stage',()=>{assert.deepEqual(validateInput(deleteBundle()),{ok:true,value:deleteBundle()});});
