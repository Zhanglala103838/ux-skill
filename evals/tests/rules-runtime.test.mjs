import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { jcsBytes } from '../../evaluator/canonical.mjs';
import * as rulesRuntime from '../../evaluator/rules-runtime.mjs';
import { deleteBundle } from '../helpers/fixtures.mjs';
import { evaluateRule, emitFinding as rawEmitFinding, reduceRunStatus } from '../../evaluator/rules-runtime.mjs';

const lit=(node_id,value)=>({node_id,op:'literal',value});
const eq=(node_id,path,value)=>({node_id,op:'eq',path,value});
const baseRule=(overrides={})=>({
 rule_id:'rule-1',rule_version:'1.0.0',release_critical:false,finding_type:'usability',
 required_dependencies:[],registered_input_pointers:['/target/enabled','/target/excluded','/target/ready','/target/passes','/target/tags','/target/score'],required_input_pointers:[],
 applicability:lit('app',true),exclusion:lit('exc',false),precondition:lit('pre',true),check:lit('check',true),...overrides
});
const evalRule=(overrides={},input={target:{}},tools=[])=>evaluateRule(baseRule(overrides),input,tools);
const state=(result)=>({terminal:result.terminal,outcome:result.outcome,reason_code:result.reason_code});
const expectState=(actual,expected)=>assert.deepEqual(state(actual),expected);
const findingContext=(overrides={})=>({
 schema_version:'finding-v1',behavior_version:'0.1.0',canonical_target_locator:'ui/delete-button',
 target_snapshot_digest:'1'.repeat(64),scenario_binding_ids:['a','z'],claim_key:null,...overrides
});
const emitExplicit=(evaluation,context)=>rawEmitFinding(evaluation,context);

const historicalFixtureIds=['AST-APP-FE-001','TOOL-MULTI-CANCEL-TIMEOUT-001','FIND-INC-001','EMISSION-REASON-001'];
const currentFindingFixtureIds=['FIND-INC-002','EMISSION-REASON-002'];
const loadHistoricalFixture=async(id)=>JSON.parse(await readFile(new URL(`../red/${id}.json`,import.meta.url),'utf8'));
const loadCurrentFixture=async(id)=>JSON.parse(await readFile(new URL(`../fixtures/${id}.json`,import.meta.url),'utf8'));

const fixtureRuleKeys=['dependency_trace','finding_type','outcome','reason_code','release_critical','rule_id','rule_version','run_issue','terminal','trace'];
const fixtureContextKeys=['behavior_version','canonical_target_locator','claim_key','scenario_binding_ids','schema_version','target_snapshot_digest'];
const legacyMixedKeys=['behavior_version','canonical_target_locator','claim_key','finding_type','outcome','reason_code','release_critical','rule_id','rule_version','scenario_binding_ids','schema_version','target_snapshot_digest','terminal'];
const legacyFindingParts=(row)=>({
 evaluation:{
  rule_id:row.rule_id,rule_version:row.rule_version,release_critical:row.release_critical,finding_type:row.finding_type,
  terminal:row.terminal,outcome:row.outcome,reason_code:row.reason_code,trace:[],dependency_trace:[],run_issue:null
 },
 context:{
  schema_version:row.schema_version,behavior_version:row.behavior_version,
  canonical_target_locator:row.canonical_target_locator,target_snapshot_digest:row.target_snapshot_digest,
  scenario_binding_ids:row.scenario_binding_ids,claim_key:row.claim_key
 }
});
test('TASK5_FIXTURE_CONTRACT_RED versioned Finding fixtures preserve legacy and enforce current contract',async()=>{
 for(const id of historicalFixtureIds){
  const vector=await loadHistoricalFixture(id);
  assert.equal(vector.vector_id,id);
  assert.ok(Array.isArray(vector.contract_sections)&&vector.contract_sections.length>0);
  let actual;
  if(vector.operation==='evaluateRule')actual=state(evaluateRule(vector.rule,vector.input,vector.tool_results));
  else if(vector.operation==='emitFinding'){
   assert.equal(Object.hasOwn(vector,'finding_context'),false);
   assert.deepEqual(Object.keys(vector.rule_evaluation).sort(),legacyMixedKeys);
   const {evaluation,context}=legacyFindingParts(vector.rule_evaluation);
   const finding=rawEmitFinding(evaluation,context);
   actual=finding===null?null:{finding_type:finding.finding_type,emission_reason_code:finding.emission_reason_code};
  }else assert.fail(`unsupported vector operation ${vector.operation}`);
  assert.deepEqual(actual,vector.expected);
 }
 for(const id of currentFindingFixtureIds){
  const vector=await loadCurrentFixture(id);
  assert.equal(vector.vector_id,id);
  assert.ok(Array.isArray(vector.contract_sections)&&vector.contract_sections.length>0);
  assert.equal(vector.operation,'emitFinding');
  assert.deepEqual(Object.keys(vector.rule_evaluation).sort(),fixtureRuleKeys);
  assert.deepEqual(Object.keys(vector.finding_context).sort(),fixtureContextKeys);
  const finding=rawEmitFinding(vector.rule_evaluation,vector.finding_context);
  const actual=finding===null?null:{finding_type:finding.finding_type,emission_reason_code:finding.emission_reason_code};
  assert.deepEqual(actual,vector.expected);
 }
});

test('applicability and exclusion are eager and map effective E/F/U/T exactly',()=>{
 const hostile=evalRule({applicability:lit('z-app',false),exclusion:eq('a-exc','/target/excluded',true)},{target:{excluded:{bad:true}}});
 expectState(hostile,{terminal:'completed',outcome:'evaluation_error',reason_code:'APPLICABILITY_EVALUATION_ERROR'});
 expectState(evalRule({applicability:lit('app',false)}),{terminal:'completed',outcome:'not_applicable',reason_code:'APPLICABILITY_FALSE'});
 expectState(evalRule({exclusion:lit('exc',true)}),{terminal:'completed',outcome:'not_applicable',reason_code:'EXCLUSION_TRUE'});
 expectState(evalRule({applicability:eq('app','/target/enabled',true)}),{terminal:'completed',outcome:'unknown',reason_code:'APPLICABILITY_UNKNOWN'});
 expectState(evalRule(),{terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS'});
});

test('precondition and check preserve F/U/E/T without coercion',()=>{
 expectState(evalRule({precondition:lit('pre',false)}),{terminal:'completed',outcome:'not_run',reason_code:'PRECONDITION_FALSE'});
 expectState(evalRule({precondition:eq('pre','/target/ready',true)}),{terminal:'completed',outcome:'not_run',reason_code:'PRECONDITION_UNKNOWN'});
 expectState(evalRule({check:lit('check',false)}),{terminal:'completed',outcome:'fail',reason_code:'CHECK_FAILED'});
 expectState(evalRule({check:eq('check','/target/passes',true)}),{terminal:'completed',outcome:'unknown',reason_code:'CHECK_UNKNOWN'});
 expectState(evalRule({check:eq('check','/target/passes',true)},{target:{passes:[]}}),{terminal:'completed',outcome:'evaluation_error',reason_code:'CHECK_EVALUATION_ERROR'});
});

test('all and any evaluate every child in node_id byte order with fixed precedence',()=>{
 const all=evalRule({applicability:{node_id:'root',op:'all',children:[lit('z-f',false),eq('a-e','/target/enabled',true),eq('m-u','/target/ready',true)]}},{target:{enabled:[]}});
 expectState(all,{terminal:'completed',outcome:'evaluation_error',reason_code:'APPLICABILITY_EVALUATION_ERROR'});
 assert.deepEqual(all.trace.filter(x=>x.parent_node_id==='root').map(x=>[x.node_id,x.value]),[['a-e','E'],['m-u','U'],['z-f','F']]);
 const any=evalRule({applicability:{node_id:'root',op:'any',children:[lit('z-t',true),eq('a-e','/target/enabled',true),lit('m-f',false)]}},{target:{enabled:[]}});
 expectState(any,{terminal:'completed',outcome:'evaluation_error',reason_code:'APPLICABILITY_EVALUATION_ERROR'});
 assert.deepEqual(any.trace.filter(x=>x.parent_node_id==='root').map(x=>x.node_id),['a-e','m-f','z-t']);
 assert.equal(evalRule({applicability:{node_id:'root',op:'all',children:[]}}).outcome,'pass');
 assert.equal(evalRule({applicability:{node_id:'root',op:'any',children:[]}}).outcome,'not_applicable');
});

test('invalid operators, unregistered paths, static operand types and runtime type conflicts fail closed',()=>{
 for(const rule of [
  baseRule({applicability:{node_id:'x',op:'script'}}),
  baseRule({applicability:eq('x','/not/registered',true)}),
  baseRule({applicability:{node_id:'x',op:'eq',path:'/target/enabled',value:{}}})
 ])expectState(evaluateRule(rule,{target:{}},[]),{terminal:'invalid_rule',outcome:'evaluation_error',reason_code:'INVALID_RULE'});
 expectState(evalRule({applicability:{node_id:'x',op:'compare',path:'/target/score',operator:'gt',value:1}},{target:{score:'2'}}),{terminal:'completed',outcome:'evaluation_error',reason_code:'APPLICABILITY_EVALUATION_ERROR'});
});

const dependencyRule=(required_dependencies)=>baseRule({required_dependencies});
const dep=(dependency_id,status,complete=true)=>({dependency_id,status,complete});
test('required tool terminal mapping is total and optional failures are ignored',()=>{
 const cases=[
  ['invalid_request','tool_failed','evaluation_error','REQUIRED_TOOL_INVALID_REQUEST'],
  ['auth_error','tool_failed','evaluation_error','REQUIRED_TOOL_AUTH_ERROR'],
  ['incompatible_source','tool_failed','evaluation_error','REQUIRED_TOOL_INCOMPATIBLE_SOURCE'],
  ['timeout','tool_failed','evaluation_error','REQUIRED_TOOL_TIMEOUT'],
  ['server_error','tool_failed','evaluation_error','REQUIRED_TOOL_SERVER_ERROR'],
  ['cancelled','cancelled','not_run','REQUIRED_TOOL_CANCELLED'],
  ['not_found','completed','not_run','REQUIRED_INPUT_NOT_FOUND']
 ];
 for(const [toolStatus,terminal,outcome,reason_code] of cases)expectState(evaluateRule(dependencyRule([{dependency_id:'a',required:true}]),{target:{}},[dep('a',toolStatus)]),{terminal,outcome,reason_code});
 expectState(evaluateRule(dependencyRule([{dependency_id:'a',required:true}]),{target:{}},[dep('a','partial',false)]),{terminal:'completed',outcome:'not_run',reason_code:'REQUIRED_INPUT_PARTIAL'});
 assert.equal(evaluateRule(dependencyRule([{dependency_id:'a',required:true}]),{target:{}},[dep('a','partial',true)]).outcome,'pass');
 assert.equal(evaluateRule(dependencyRule([{dependency_id:'a',required:false}]),{target:{}},[dep('a','timeout')]).outcome,'pass');
});

test('required dependency first-match picks timeout over cancellation and traces same-layer ids canonically',()=>{
 const rule=dependencyRule([{dependency_id:'z',required:true},{dependency_id:'a',required:true},{dependency_id:'m',required:true}]);
 const result=evaluateRule(rule,{target:{}},[dep('z','cancelled'),dep('m','timeout'),dep('a','timeout')]);
 expectState(result,{terminal:'tool_failed',outcome:'evaluation_error',reason_code:'REQUIRED_TOOL_TIMEOUT'});
 assert.deepEqual(result.dependency_trace.map(x=>x.dependency_id),['a','m','z']);
});

const findingReason={
 pass:'CHECK_PASS',fail:'CHECK_FAILED',partial:'CHECK_PARTIAL',not_run:'PRECONDITION_FALSE',
 not_applicable:'APPLICABILITY_FALSE',unknown:'CHECK_UNKNOWN',evaluation_error:'CHECK_EVALUATION_ERROR'
};
const findingEval=(outcome,critical,extra={})=>({
 terminal:'completed',outcome,reason_code:findingReason[outcome],release_critical:critical,
 rule_id:'delete-safety',rule_version:'1.0.0',finding_type:'safety',trace:[],dependency_trace:[],
 run_issue:outcome==='evaluation_error'?{code:'RULE_EVALUATION_ERROR',instance_pointer:'/check',dependency_id:null}:null,...extra
});
const emissionCases=[
 ['pass',false,null,'NONE'],['not_applicable',true,null,'NONE'],['fail',false,'safety','RULE_CHECK_FAILED'],
 ['partial',false,'unknown','RULE_PARTIAL'],['partial',true,'escalation','RELEASE_CRITICAL_PARTIAL'],
 ['not_run',false,'unknown','RULE_NOT_RUN'],['not_run',true,'escalation','RELEASE_CRITICAL_NOT_RUN'],
 ['unknown',false,'unknown','RULE_UNKNOWN'],['unknown',true,'escalation','RELEASE_CRITICAL_UNKNOWN'],
 ['evaluation_error',false,null,'NONE'],['evaluation_error',true,'escalation','RELEASE_CRITICAL_EVALUATION_ERROR']
];
test('finding emission table is exact and evaluation errors remain RunIssues',()=>{
 for(const [outcome,critical,type,reason] of emissionCases){
  const finding=emitExplicit(findingEval(outcome,critical),findingContext());
  if(type===null)assert.equal(finding,null,`${outcome}/${critical}`);
  else assert.deepEqual({type:finding.finding_type,reason:finding.emission_reason_code},{type,reason});
 }
 const noncritical=evalRule({check:eq('check','/target/passes',true)},{target:{passes:[]}});
 assert.equal(emitExplicit({...findingEval('evaluation_error',false),run_issue:noncritical.run_issue},findingContext()),null);
 assert.deepEqual(noncritical.run_issue,{code:'RULE_EVALUATION_ERROR',instance_pointer:'/check',dependency_id:null});
});

test('finding fingerprints canonicalize scenario ids and are deterministic',()=>{
 const a=emitExplicit(findingEval('fail',false),findingContext());
 const b=emitExplicit(findingEval('fail',false),findingContext({scenario_binding_ids:['a','z']}));
 assert.equal(a.fingerprint_full_digest,b.fingerprint_full_digest);
 assert.equal(a.finding_id,b.finding_id);
 assert.deepEqual(a.fingerprint.scenario_binding_ids,['a','z']);
 const expected=createHash('sha256').update('ux-skill:finding:v1').update(jcsBytes(a.fingerprint)).digest('hex');
 assert.equal(a.fingerprint_full_digest,expected);
 assert.equal(a.finding_id,`f_${expected.slice(0,32)}`);
});
test('RunStatus uses complete producer results, fixed priority, and rejects unregistered reasons',()=>{
 const context=findingContext({canonical_target_locator:'ui/target',target_snapshot_digest:'3'.repeat(64)});
 const pass=evalRule();
 const gap=evalRule({registered_input_pointers:['/target/enabled'],required_input_pointers:[],applicability:eq('app','/target/enabled',true)},{target:{}});
 const escalationEvaluation=evalRule({release_critical:true,registered_input_pointers:['/target/enabled'],required_input_pointers:[],applicability:eq('app','/target/enabled',true)},{target:{}});
 const escalation=emitExplicit(escalationEvaluation,context);
 const blockEvaluation=evalRule({finding_type:'block',check:lit('check',false)});
 const block=emitExplicit(blockEvaluation,context);
 const criticalError=evalRule({release_critical:true,check:eq('check','/target/passes',true)},{target:{passes:[]}});
 assert.equal(reduceRunStatus([pass]),'completed_clear');
 assert.equal(reduceRunStatus([pass,gap]),'completed_with_gaps');
 assert.equal(reduceRunStatus([pass,escalationEvaluation,escalation]),'completed_escalated');
 assert.equal(reduceRunStatus([pass,blockEvaluation,block]),'completed_blocked');
 assert.equal(reduceRunStatus([criticalError,criticalError.run_issue]),'failed');
 assert.equal(reduceRunStatus([{terminal:'completed',outcome:'pass',reason_code:'UNREGISTERED'}]),'failed');
});

test('public reducers are total and fail closed for hostile inputs',()=>{
 assert.equal(reduceRunStatus([]),'completed_clear');
 for(const hostile of [null,undefined,42,'rule',{},Object.create(null)]){
  assert.doesNotThrow(()=>evaluateRule(hostile,hostile,hostile));
  assert.equal(evaluateRule(hostile,hostile,hostile).outcome,'evaluation_error');
  assert.doesNotThrow(()=>emitExplicit(hostile));
  assert.equal(emitExplicit(hostile),null);
  assert.doesNotThrow(()=>reduceRunStatus(hostile));
  assert.equal(reduceRunStatus(hostile),'failed');
 }
});test('TASK5_REVIEW_RED_REQUIRED_INPUT_COMPLETENESS',()=>{
 const noToolRule=baseRule({
  required_input_pointers:['/target/passes'],
  check:eq('check','/target/passes',true)
 });
 expectState(evaluateRule(noToolRule,{target:{}},[]),{
  terminal:'completed',outcome:'not_run',reason_code:'REQUIRED_INPUT_PARTIAL'
 });
 expectState(evaluateRule(noToolRule,{target:{passes:true}},[]),{
  terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS'
 });
 const readyToolRule={...noToolRule,required_dependencies:[{dependency_id:'ready',required:true}]};
 expectState(evaluateRule(readyToolRule,{target:{}},[dep('ready','success',true)]),{
  terminal:'completed',outcome:'not_run',reason_code:'REQUIRED_INPUT_PARTIAL'
 });
 expectState(evaluateRule(readyToolRule,{target:{passes:true}},[dep('ready','success',true)]),{
  terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS'
 });
});

test('TASK5_REVIEW_RED_RUN_PART_CLOSED_UNION',()=>{
 assert.equal(reduceRunStatus([]),'completed_clear');
 const invalidParts=[
  {},
  {terminal:'completed',outcome:'invented',reason_code:'NONE',release_critical:false},
  {outcome:'pass',reason_code:'CHECK_PASS',release_critical:false},
  {terminal:'completed',reason_code:'CHECK_PASS',release_critical:false},
  {terminal:'completed',outcome:'pass',release_critical:false},
  {terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS'},
  {terminal:'tool_failed',outcome:'pass',reason_code:'CHECK_PASS',release_critical:false},
  {terminal:'completed',outcome:'evaluation_error',reason_code:'CHECK_PASS',release_critical:false},
  {terminal:'completed',outcome:'fail',reason_code:'NONE',release_critical:false},
  {terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS',release_critical:'false'}
 ];
 for(const invalid of invalidParts)assert.equal(reduceRunStatus([invalid]),'failed',JSON.stringify(invalid));
});test('registered input pointers are a closed allowlist and required pointers are its subset',()=>{
 const valid=baseRule({registered_input_pointers:['/target/passes'],required_input_pointers:['/target/passes'],check:eq('check','/target/passes',true)});
 expectState(evaluateRule(valid,{target:{passes:true}},[]),{terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS'});
 const outside=baseRule({registered_input_pointers:['/target/enabled'],required_input_pointers:['/target/passes'],check:lit('check',true)});
 expectState(evaluateRule(outside,{target:{passes:true}},[]),{terminal:'invalid_rule',outcome:'evaluation_error',reason_code:'INVALID_RULE'});
});

test('registered but nonrequired missing eq in and compare paths remain reachable U',()=>{
 const registered=['/target/enabled','/target/tags','/target/score'];
 for(const applicability of [
  eq('eq-missing','/target/enabled',true),
  {node_id:'in-missing',op:'in',path:'/target/tags',value:'admin'},
  {node_id:'compare-missing',op:'compare',path:'/target/score',operator:'gte',value:1}
 ]){
  const rule=baseRule({registered_input_pointers:registered,required_input_pointers:[],applicability});
  expectState(evaluateRule(rule,{target:{}},[]),{terminal:'completed',outcome:'unknown',reason_code:'APPLICABILITY_UNKNOWN'});
 }
});

test('applicability and precondition outcomes precede required input completeness',()=>{
 const missingRequired={registered_input_pointers:['/target/passes'],required_input_pointers:['/target/passes']};
 expectState(evaluateRule(baseRule({...missingRequired,applicability:lit('app',false)}),{target:{}},[]),{terminal:'completed',outcome:'not_applicable',reason_code:'APPLICABILITY_FALSE'});
 expectState(evaluateRule(baseRule({...missingRequired,precondition:lit('pre',false)}),{target:{}},[]),{terminal:'completed',outcome:'not_run',reason_code:'PRECONDITION_FALSE'});
 expectState(evaluateRule(baseRule({...missingRequired,applicability:lit('app',true),precondition:lit('pre',true)}),{target:{}},[]),{terminal:'completed',outcome:'not_run',reason_code:'REQUIRED_INPUT_PARTIAL'});
});

test('unregistered AST paths and required pointers outside registry are invalid rules',()=>{
 const unregistered=baseRule({registered_input_pointers:['/target/enabled'],required_input_pointers:[],check:eq('check','/target/passes',true)});
 expectState(evaluateRule(unregistered,{target:{passes:true}},[]),{terminal:'invalid_rule',outcome:'evaluation_error',reason_code:'INVALID_RULE'});
 const outside=baseRule({registered_input_pointers:['/target/enabled'],required_input_pointers:['/target/passes'],check:lit('check',true)});
 expectState(evaluateRule(outside,{target:{passes:true}},[]),{terminal:'invalid_rule',outcome:'evaluation_error',reason_code:'INVALID_RULE'});
});test('TASK5_FINAL_RED_RUN_ISSUE_CODE_DOMAIN',()=>{
 const issue=(code)=>({code,instance_pointer:'/check',dependency_id:null});
 for(const code of ['CHECK_PASS','RULE_CHECK_FAILED','FINDING_REASON_INVALID'])assert.equal(reduceRunStatus([issue(code)]),'failed',code);
 const validIssue=issue('RULE_EVALUATION_ERROR');
 assert.equal(reduceRunStatus([validIssue]),'completed_clear');
 const noncritical=evalRule({check:eq('check','/target/passes',true)},{target:{passes:[]}});
 assert.equal(reduceRunStatus([noncritical.run_issue,noncritical]),'completed_with_gaps');
 const critical=evalRule({release_critical:true,check:eq('check','/target/passes',true)},{target:{passes:[]}});
 assert.equal(reduceRunStatus([critical.run_issue,critical]),'failed');
});
test('TASK5_FULL_PART_UNION_RED',()=>{
 const context=findingContext({canonical_target_locator:'ui/target',target_snapshot_digest:'4'.repeat(64)});
 const issue={code:'RULE_EVALUATION_ERROR',instance_pointer:'/check',dependency_id:null};
 const passBlock=evalRule({finding_type:'block'});
 const failBlock=evalRule({finding_type:'block',check:lit('check',false)});
 const blockFinding=emitExplicit(failBlock,context);
 const criticalUnknown=evalRule({release_critical:true,registered_input_pointers:['/target/enabled'],required_input_pointers:[],applicability:eq('app','/target/enabled',true)},{target:{}});
 const escalationFinding=emitExplicit(criticalUnknown,context);
 const criticalError=evalRule({release_critical:true,check:eq('check','/target/passes',true)},{target:{passes:[]}});
 const criticalErrorFinding=emitExplicit(criticalError,context);
 const noncriticalError=evalRule({check:eq('check','/target/passes',true)},{target:{passes:[]}});
 const invalidInput=evaluateRule(baseRule(),null,[]);
 const invalidRule=evaluateRule(baseRule({registered_input_pointers:['/target/enabled'],required_input_pointers:[],check:eq('check','/target/passes',true)}),{target:{passes:true}},[]);
 assert.equal(reduceRunStatus([passBlock]),'completed_clear');
 assert.equal(reduceRunStatus([failBlock,blockFinding]),'completed_blocked');
 assert.equal(reduceRunStatus([criticalUnknown,escalationFinding]),'completed_escalated');
 assert.equal(reduceRunStatus([criticalError,criticalErrorFinding,criticalError.run_issue]),'failed');
 assert.equal(reduceRunStatus([noncriticalError,noncriticalError.run_issue]),'completed_with_gaps');
 assert.equal(reduceRunStatus([invalidInput,invalidInput.run_issue]),'failed');
 assert.equal(reduceRunStatus([invalidRule,invalidRule.run_issue]),'failed');
 assert.equal(reduceRunStatus([issue]),'completed_clear');
 assert.equal(reduceRunStatus([]),'completed_clear');

 const ruleKeys=['dependency_trace','finding_type','outcome','reason_code','release_critical','rule_id','rule_version','run_issue','terminal','trace'];
 const findingKeys=['emission_reason_code','finding_id','finding_type','fingerprint','fingerprint_full_digest','rule_id','rule_version'];
 const issueKeys=['code','dependency_id','instance_pointer'];
 assert.deepEqual(Object.keys(passBlock).sort(),ruleKeys);
 assert.deepEqual(Object.keys(blockFinding).sort(),findingKeys);
 assert.deepEqual(Object.keys(issue).sort(),issueKeys);
 const missingOne=(value,key)=>{const copy=structuredClone(value);delete copy[key];return copy;};
 for(const key of ruleKeys)assert.equal(reduceRunStatus([missingOne(passBlock,key)]),'failed',`rule missing ${key}`);
 for(const key of findingKeys)assert.equal(reduceRunStatus([missingOne(blockFinding,key)]),'failed',`finding missing ${key}`);
 for(const key of issueKeys)assert.equal(reduceRunStatus([missingOne(issue,key)]),'failed',`issue missing ${key}`);
 assert.equal(reduceRunStatus([{...passBlock,unexpected:true}]),'failed');
 assert.equal(reduceRunStatus([{...blockFinding,unexpected:true}]),'failed');
 assert.equal(reduceRunStatus([{...issue,unexpected:true}]),'failed');
 assert.equal(reduceRunStatus([{...passBlock,...blockFinding}]),'failed');
 assert.equal(reduceRunStatus([{...blockFinding,...issue}]),'failed');
 assert.equal(reduceRunStatus([{terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS',release_critical:false}]),'failed');
 assert.equal(reduceRunStatus([{finding_type:'block',emission_reason_code:'RULE_CHECK_FAILED'}]),'failed');
 assert.equal(reduceRunStatus([{rule_id:'r',terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS'}]),'failed');

 for(const code of ['CHECK_PASS','RULE_CHECK_FAILED','FINDING_REASON_INVALID'])assert.equal(reduceRunStatus([{...issue,code}]),'failed',code);
 assert.equal(reduceRunStatus([{...issue,dependency_id:''}]),'failed');
 assert.equal(reduceRunStatus([{...issue,note:'extra'}]),'failed');
 const seal=(finding)=>{const copy=structuredClone(finding);const digest=createHash('sha256').update('ux-skill:finding:v1').update(jcsBytes(copy.fingerprint)).digest('hex');copy.fingerprint_full_digest=digest;copy.finding_id=`f_${digest.slice(0,32)}`;return copy;};
 assert.equal(reduceRunStatus([{...blockFinding,finding_type:'unknown'}]),'failed');
 assert.equal(reduceRunStatus([{...blockFinding,rule_id:'tampered'}]),'failed');
 assert.equal(reduceRunStatus([{...blockFinding,fingerprint_full_digest:'0'.repeat(64)}]),'failed');
 assert.equal(reduceRunStatus([{...blockFinding,finding_id:'f_deadbeef'}]),'failed');
 const noncanonical=structuredClone(blockFinding);noncanonical.fingerprint.scenario_binding_ids=['z','a'];assert.equal(reduceRunStatus([seal(noncanonical)]),'failed');
 const duplicateScenario=structuredClone(blockFinding);duplicateScenario.fingerprint.scenario_binding_ids=['a','a'];assert.equal(reduceRunStatus([seal(duplicateScenario)]),'failed');
 const badPair=structuredClone(blockFinding);badPair.finding_type='unknown';badPair.emission_reason_code='RELEASE_CRITICAL_UNKNOWN';badPair.fingerprint.finding_type='unknown';badPair.fingerprint.emission_reason_code='RELEASE_CRITICAL_UNKNOWN';assert.equal(reduceRunStatus([seal(badPair)]),'failed');

 const fullRule=(terminal,outcome,reason_code,release_critical=false,run_issue_value=outcome==='evaluation_error'?issue:null)=>({...passBlock,terminal,outcome,reason_code,release_critical,run_issue:run_issue_value,trace:[],dependency_trace:[]});
 const legalRows=[
  ['invalid_input','evaluation_error','INVALID_INPUT','failed'],['invalid_rule','evaluation_error','INVALID_RULE','failed'],
  ['completed','pass','CHECK_PASS','completed_clear'],['completed','fail','CHECK_FAILED','completed_clear'],['completed','partial','CHECK_PARTIAL','completed_with_gaps'],['completed','not_run','PRECONDITION_FALSE','completed_with_gaps'],['completed','not_run','PRECONDITION_UNKNOWN','completed_with_gaps'],['completed','not_applicable','APPLICABILITY_FALSE','completed_clear'],['completed','not_applicable','EXCLUSION_TRUE','completed_clear'],['completed','unknown','APPLICABILITY_UNKNOWN','completed_with_gaps'],['completed','unknown','EXCLUSION_UNKNOWN','completed_with_gaps'],['completed','unknown','CHECK_UNKNOWN','completed_with_gaps'],['completed','evaluation_error','APPLICABILITY_EVALUATION_ERROR','completed_with_gaps'],['completed','evaluation_error','PRECONDITION_EVALUATION_ERROR','completed_with_gaps'],['completed','evaluation_error','CHECK_EVALUATION_ERROR','completed_with_gaps']
 ];
 for(const [terminal,outcome,reason,status] of legalRows)assert.equal(reduceRunStatus([fullRule(terminal,outcome,reason)]),status,`${terminal}/${outcome}/${reason}`);
 const toolRows=[
  ['invalid_request',true,'completed_with_gaps'],['auth_error',true,'completed_with_gaps'],['incompatible_source',true,'completed_with_gaps'],
  ['timeout',true,'completed_with_gaps'],['server_error',true,'completed_with_gaps'],['cancelled',true,'completed_with_gaps'],
  ['partial',false,'completed_with_gaps'],['not_found',true,'completed_with_gaps'],
  ['success',false,'completed_clear'],['partial',true,'completed_clear']
 ];
 for(const [toolStatus,complete,status] of toolRows){
  const produced=evaluateRule(dependencyRule([{dependency_id:'a',required:true}]),{target:{}},[dep('a',toolStatus,complete)]);
  assert.equal(reduceRunStatus([produced]),status,`${toolStatus}/${complete}`);
 }
 for(const invalid of [fullRule('completed','pass','CHECK_FAILED'),fullRule('cancelled','evaluation_error','REQUIRED_TOOL_CANCELLED'),fullRule('tool_failed','evaluation_error','CHECK_EVALUATION_ERROR'),fullRule('completed','evaluation_error','CHECK_EVALUATION_ERROR',false,null),fullRule('completed','pass','CHECK_PASS',false,issue)])assert.equal(reduceRunStatus([invalid]),'failed');

 const traced=evalRule({applicability:{node_id:'root',op:'all',children:[lit('a',true),lit('b',true)]}});
 assert.ok(traced.trace.length>0);
 for(const traceRow of traced.trace)assert.deepEqual(Object.keys(traceRow).sort(),['node_id','parent_node_id','value']);
 const badTraceAdditional=structuredClone(traced);badTraceAdditional.trace[0].extra=true;assert.equal(reduceRunStatus([badTraceAdditional]),'failed');
 const badTraceMissing=structuredClone(traced);delete badTraceMissing.trace[0].node_id;assert.equal(reduceRunStatus([badTraceMissing]),'failed');
 const badTraceValue=structuredClone(traced);badTraceValue.trace[0].value='X';assert.equal(reduceRunStatus([badTraceValue]),'failed');
 const depended=evaluateRule(baseRule({required_dependencies:[{dependency_id:'ready',required:true}]}),{target:{}},[dep('ready','success',true)]);
 assert.deepEqual(Object.keys(depended.dependency_trace[0]).sort(),['complete','dependency_id','status']);
 const badDepAdditional=structuredClone(depended);badDepAdditional.dependency_trace[0].extra=true;assert.equal(reduceRunStatus([badDepAdditional]),'failed');
 const badDepStatus=structuredClone(depended);badDepStatus.dependency_trace[0].status='invented';assert.equal(reduceRunStatus([badDepStatus]),'failed');
 const badDepType=structuredClone(depended);badDepType.dependency_trace[0].complete='true';assert.equal(reduceRunStatus([badDepType]),'failed');

 const cycle={};cycle.self=cycle;
 const accessor={};Object.defineProperty(accessor,'terminal',{enumerable:true,get(){throw new Error('getter');}});
 const proxy=new Proxy({}, {ownKeys(){throw new Error('proxy');}});
 for(const hostile of [cycle,accessor,proxy,{...issue,dependency_id:'e\u0301'},{...issue,dependency_id:'\ud800'}]){assert.doesNotThrow(()=>reduceRunStatus([hostile]));assert.equal(reduceRunStatus([hostile]),'failed');}
 const parts=[failBlock,blockFinding,issue];
 assert.equal(reduceRunStatus(parts),reduceRunStatus([...parts].reverse()));
});

test('TASK5_CONTEXT_TRACE_RED FIND-CONTEXT-COMPOSE-001',()=>{
 const derive=rulesRuntime.deriveFindingContext;
 const bundle=structuredClone(deleteBundle());
 const expected={
  schema_version:'finding-v1',
  behavior_version:bundle.behavior_version,
  canonical_target_locator:bundle.target_snapshot.canonical_locator,
  target_snapshot_digest:bundle.target_snapshot.snapshot_digest,
  scenario_binding_ids:[bundle.scenario_profile_id],
  claim_key:null
 };
 assert.deepEqual(derive(bundle),expected);
 for(const claims of [[],bundle.claims,[...bundle.claims,{...bundle.claims[0],claim_id:'claim-2'}]]){
  const varied=structuredClone(bundle);varied.claims=claims;
  assert.equal(derive(varied).claim_key,null);
 }
 const fail=evalRule({finding_type:'block',check:lit('check',false)});
 assert.equal(rawEmitFinding(fail),null);
 const finding=rawEmitFinding(fail,derive(bundle));
 assert.deepEqual(Object.keys(finding).sort(),['emission_reason_code','finding_id','finding_type','fingerprint','fingerprint_full_digest','rule_id','rule_version']);
 assert.equal(finding.finding_type,'block');
 const variants=[];
 const behavior=structuredClone(bundle);behavior.behavior_version='0.1.1';variants.push(behavior);
 const locator=structuredClone(bundle);locator.target_snapshot.canonical_locator='components/button';variants.push(locator);
 const digest=structuredClone(bundle);digest.target_snapshot.snapshot_digest='9'.repeat(64);variants.push(digest);
 const scenario=structuredClone(bundle);scenario.scenario_profile_id='brand-site';scenario.scenario_profiles=[{scenario_profile_id:'brand-site',scenario_family_id:'brand-marketing-website'}];variants.push(scenario);
 for(const varied of variants){
  const changed=rawEmitFinding(fail,derive(varied));
  assert.notEqual(changed.fingerprint_full_digest,finding.fingerprint_full_digest);
  assert.notEqual(changed.finding_id,finding.finding_id);
 }
 const criticalUnknown=evalRule({release_critical:true,registered_input_pointers:['/target/enabled'],required_input_pointers:[],applicability:eq('app','/target/enabled',true)},{target:{}});
 const unknownFinding=rawEmitFinding(criticalUnknown,derive(bundle));
 assert.equal(unknownFinding.finding_type,'escalation');
 assert.equal(reduceRunStatus([criticalUnknown,unknownFinding]),'completed_escalated');
 const noncriticalError=evalRule({check:eq('check','/target/passes',true)},{target:{passes:[]}});
 assert.equal(rawEmitFinding(noncriticalError,derive(bundle)),null);
 assert.equal(reduceRunStatus([noncriticalError,noncriticalError.run_issue]),'completed_with_gaps');
 const criticalError=evalRule({release_critical:true,check:eq('check','/target/passes',true)},{target:{passes:[]}});
 const criticalErrorFinding=rawEmitFinding(criticalError,derive(bundle));
 assert.equal(criticalErrorFinding.finding_type,'escalation');
 assert.equal(reduceRunStatus([criticalError,criticalErrorFinding,criticalError.run_issue]),'failed');
 const invalidInput=evaluateRule(baseRule(),null,[]);
 const invalidRule=evaluateRule(baseRule({registered_input_pointers:['/target/enabled'],check:eq('check','/target/passes',true)}),{target:{passes:true}},[]);
 for(const invalid of [invalidInput,invalidRule]){
  assert.deepEqual(Object.keys(invalid).sort(),['dependency_trace','finding_type','outcome','reason_code','release_critical','rule_id','rule_version','run_issue','terminal','trace']);
  assert.equal(reduceRunStatus([invalid,invalid.run_issue]),'failed');
  assert.equal(rawEmitFinding(invalid,derive(bundle)),null);
 }
 for(const bad of [
  undefined,
  {...expected,extra:true},
  (({claim_key,...rest})=>rest)(expected),
  {...expected,schema_version:'self-reported'},
  {...expected,scenario_binding_ids:['z','a']},
  {...expected,claim_key:'caller-claim'}
 ])assert.equal(rawEmitFinding(fail,bad),null);
});

test('TASK5_CONTEXT_TRACE_RED dependency decision coherence',()=>{
 const required=(status,complete=true,check=true)=>evaluateRule(
  dependencyRule([{dependency_id:'a',required:true}]),{target:{}},[dep('a',status,complete)]
 );
 expectState(required('partial',true),{terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS'});
 expectState(required('partial',false),{terminal:'completed',outcome:'not_run',reason_code:'REQUIRED_INPUT_PARTIAL'});
 const successFalse=evaluateRule(dependencyRule([{dependency_id:'a',required:true}]),{target:{}},[dep('a','success',false)]);
 expectState(successFalse,{terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS'});
 expectState(required('timeout',true),{terminal:'tool_failed',outcome:'evaluation_error',reason_code:'REQUIRED_TOOL_TIMEOUT'});
 const multi=evaluateRule(dependencyRule([{dependency_id:'z',required:true},{dependency_id:'a',required:true}]),{target:{}},[dep('z','cancelled'),dep('a','timeout')]);
 assert.equal(reduceRunStatus([multi,multi.run_issue]),'completed_with_gaps');
 assert.deepEqual(multi.dependency_trace.map(x=>x.dependency_id),['a','z']);
 assert.equal(multi.run_issue.dependency_id,'a');
 for(const badTrace of [
  [dep('z','cancelled'),dep('a','timeout')],
  [dep('a','timeout'),dep('a','timeout')],
  [{dependency_id:'',status:'timeout',complete:true}],
  [{dependency_id:'e\u0301',status:'timeout',complete:true}]
 ]){
  const bad=structuredClone(multi);bad.dependency_trace=badTrace;
  assert.equal(reduceRunStatus([bad]),'failed');
 }
 for(const bad of [
  {...multi,terminal:'cancelled'},
  {...multi,outcome:'not_run'},
  {...multi,reason_code:'REQUIRED_TOOL_CANCELLED'},
  {...multi,run_issue:{...multi.run_issue,instance_pointer:'/check'}},
  {...multi,run_issue:{...multi.run_issue,dependency_id:'z'}},
  {...multi,run_issue:null},
  {...multi,terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS',run_issue:null}
 ])assert.equal(reduceRunStatus([bad]),'failed');
 const decisionStatuses=['invalid_request','auth_error','incompatible_source','timeout','server_error','cancelled','not_found'];
 for(const status of decisionStatuses){
  const result=required(status);
  const wrongTerminal={...result,terminal:status==='not_found'?'cancelled':'completed'};
  const wrongOutcome={...result,outcome:'pass'};
  const wrongReason={...result,reason_code:'CHECK_PASS'};
  assert.equal(reduceRunStatus([wrongTerminal]),'failed',status);
  assert.equal(reduceRunStatus([wrongOutcome]),'failed',status);
  assert.equal(reduceRunStatus([wrongReason]),'failed',status);
  const wrongIssue=result.run_issue===null
   ? {...result,run_issue:{code:'RULE_EVALUATION_ERROR',instance_pointer:'/required_dependencies',dependency_id:'a'}}
   : {...result,run_issue:{...result.run_issue,dependency_id:'z'}};
  assert.equal(reduceRunStatus([wrongIssue]),'failed',status);
 }
 const toolWithAst=structuredClone(multi);toolWithAst.trace=[{node_id:'x',parent_node_id:null,value:'T'}];
 assert.equal(reduceRunStatus([toolWithAst]),'failed');
 for(const invalid of [evaluateRule(baseRule(),null,[]),evaluateRule(baseRule({registered_input_pointers:['/target/enabled'],check:eq('check','/target/passes',true)}),{target:{passes:true}},[])]){
  assert.equal(reduceRunStatus([invalid,invalid.run_issue]),'failed');
  const withTrace=structuredClone(invalid);withTrace.trace=[{node_id:'x',parent_node_id:null,value:'T'}];assert.equal(reduceRunStatus([withTrace]),'failed');
  const withDep=structuredClone(invalid);withDep.dependency_trace=[dep('a','success')];assert.equal(reduceRunStatus([withDep]),'failed');
 }
 const partial={...evalRule(),outcome:'partial',reason_code:'CHECK_PARTIAL'};
 assert.equal(reduceRunStatus([partial]),'completed_with_gaps');
 const traced=evalRule({applicability:{node_id:'root',op:'all',children:[lit('a',true),lit('b',true)]}});
 assert.equal(reduceRunStatus([traced]),'completed_clear');
 const parts=[multi,multi.run_issue,partial,traced];
 assert.equal(reduceRunStatus(parts),reduceRunStatus([...parts].reverse()));
});


test('TASK5_INTERNAL_BOUNDARY_RED critical invalid emission and Task10 provenance gate',async()=>{
 const context=rulesRuntime.deriveFindingContext(structuredClone(deleteBundle()));
 assert.notEqual(context,null);
 const criticalInput=evaluateRule(baseRule({release_critical:true}),null,[]);
 const criticalRule=evaluateRule(baseRule({
  release_critical:true,
  registered_input_pointers:['/target/enabled'],
  required_input_pointers:[],
  check:eq('check','/target/passes',true)
 }),{target:{passes:true}},[]);
 for(const evaluation of [criticalInput,criticalRule]){
  assert.deepEqual(Object.keys(evaluation).sort(),['dependency_trace','finding_type','outcome','reason_code','release_critical','rule_id','rule_version','run_issue','terminal','trace']);
  const finding=rawEmitFinding(evaluation,context);
  assert.deepEqual({type:finding.finding_type,reason:finding.emission_reason_code},{type:'escalation',reason:'RELEASE_CRITICAL_EVALUATION_ERROR'});
  assert.equal(reduceRunStatus([evaluation,finding,evaluation.run_issue]),'failed');
 }
 const noncriticalInput=evaluateRule(baseRule(),null,[]);
 const noncriticalRule=evaluateRule(baseRule({
  registered_input_pointers:['/target/enabled'],
  required_input_pointers:[],
  check:eq('check','/target/passes',true)
 }),{target:{passes:true}},[]);
 for(const evaluation of [noncriticalInput,noncriticalRule]){
  assert.equal(rawEmitFinding(evaluation,context),null);
  assert.equal(reduceRunStatus([evaluation,evaluation.run_issue]),'failed');
 }
 const invalidBundle=structuredClone(deleteBundle());
 invalidBundle.schema_version='invented';
 assert.equal(rulesRuntime.deriveFindingContext(invalidBundle),null);

 const pkg=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.private,true);
 assert.equal(Object.hasOwn(pkg,'exports'),false);
 const design=await readFile(new URL('../../docs/superpowers/specs/2026-08-18-evidence-aware-product-ux-skill-design.md',import.meta.url),'utf8');
 const plan=await readFile(new URL('../../docs/superpowers/plans/2026-08-18-evidence-aware-product-ux-skill-v0.1-vertical-slice.md',import.meta.url),'utf8');
 const designContract=[
  'Task 5 primitives are internal, diagnostic, and non-authoritative.',
  'A structurally valid FindingContextV1 does not prove provenance.',
  'The sole authority-bearing public gate is Task 10 evaluate(bundle).',
  'Digests provide identity and integrity, not authenticity.',
  'Task 5 acceptance is semantic; provenance closure is deferred to Task 10.'
 ];
 for(const sentence of designContract)assert.ok(design.includes(sentence),sentence);
 const planContract=[
  'Task 5 interfaces are internal diagnostic primitives, not public authority-bearing APIs.',
  'Task 10 evaluate(bundle) is the sole authority-bearing public evaluation gate.',
  'verifyRunArtifact deterministically replays from the raw normalized bundle and fixed evaluator artifacts, then byte-compares the result.',
  'Digests provide identity and integrity, not authenticity.'
 ];
 for(const sentence of planContract)assert.ok(plan.includes(sentence),sentence);
});
