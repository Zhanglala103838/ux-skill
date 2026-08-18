import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { jcsBytes } from '../../evaluator/canonical.mjs';
import { evaluateRule, emitFinding, reduceRunStatus } from '../../evaluator/rules-runtime.mjs';

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

const fixtureIds=['AST-APP-FE-001','TOOL-MULTI-CANCEL-TIMEOUT-001','FIND-INC-001','EMISSION-REASON-001'];
const loadFixture=async(id)=>JSON.parse(await readFile(new URL(`../red/${id}.json`,import.meta.url),'utf8'));

test('four Task 5 vectors are executable and contract-linked',async()=>{
 for(const id of fixtureIds){
  const vector=await loadFixture(id);
  assert.equal(vector.vector_id,id);
  assert.ok(Array.isArray(vector.contract_sections)&&vector.contract_sections.length>0);
  let actual;
  if(vector.operation==='evaluateRule')actual=state(evaluateRule(vector.rule,vector.input,vector.tool_results));
  else if(vector.operation==='emitFinding'){
   const finding=emitFinding(vector.rule_evaluation);
   actual=finding===null?null:{finding_type:finding.finding_type,emission_reason_code:finding.emission_reason_code};
  }else assert.fail(`unsupported vector operation ${vector.operation}`);
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

const findingEval=(outcome,critical,extra={})=>({
 terminal:'completed',outcome,reason_code:`CHECK_${outcome.toUpperCase()}`,release_critical:critical,
 rule_id:'delete-safety',rule_version:'1.0.0',finding_type:'safety',schema_version:'finding-v1',behavior_version:'0.1.0',
 canonical_target_locator:'ui/delete-button',target_snapshot_digest:'1'.repeat(64),scenario_binding_ids:['z','a','a'],claim_key:null,...extra
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
  const finding=emitFinding(findingEval(outcome,critical));
  if(type===null)assert.equal(finding,null,`${outcome}/${critical}`);
  else assert.deepEqual({type:finding.finding_type,reason:finding.emission_reason_code},{type,reason});
 }
 const noncritical=evalRule({check:eq('check','/target/passes',true)},{target:{passes:[]}});
 assert.equal(emitFinding({...findingEval('evaluation_error',false),run_issue:noncritical.run_issue}),null);
 assert.deepEqual(noncritical.run_issue,{code:'RULE_EVALUATION_ERROR',instance_pointer:'/check',dependency_id:null});
});

test('finding fingerprints canonicalize scenario ids and are deterministic',()=>{
 const a=emitFinding(findingEval('fail',false));
 const b=emitFinding(findingEval('fail',false,{scenario_binding_ids:['a','z']}));
 assert.equal(a.fingerprint_full_digest,b.fingerprint_full_digest);
 assert.equal(a.finding_id,b.finding_id);
 assert.deepEqual(a.fingerprint.scenario_binding_ids,['a','z']);
 const expected=createHash('sha256').update('ux-skill:finding:v1').update(jcsBytes(a.fingerprint)).digest('hex');
 assert.equal(a.fingerprint_full_digest,expected);
 assert.equal(a.finding_id,`f_${expected.slice(0,32)}`);
});

test('RunStatus uses fixed priority and rejects unregistered reason codes',()=>{
 const pass={terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS',release_critical:false};
 assert.equal(reduceRunStatus([pass]),'completed_clear');
 assert.equal(reduceRunStatus([pass,{terminal:'completed',outcome:'unknown',reason_code:'CHECK_UNKNOWN',release_critical:false}]),'completed_with_gaps');
 assert.equal(reduceRunStatus([pass,{finding_type:'escalation',emission_reason_code:'RELEASE_CRITICAL_UNKNOWN'}]),'completed_escalated');
 assert.equal(reduceRunStatus([pass,{finding_type:'block',emission_reason_code:'RULE_CHECK_FAILED'}]),'completed_blocked');
 assert.equal(reduceRunStatus([{terminal:'completed',outcome:'evaluation_error',reason_code:'CHECK_EVALUATION_ERROR',release_critical:true},{finding_type:'block',emission_reason_code:'RULE_CHECK_FAILED'}]),'failed');
 assert.equal(reduceRunStatus([{terminal:'completed',outcome:'pass',reason_code:'UNREGISTERED'}]),'failed');
});

test('public reducers are total and fail closed for hostile inputs',()=>{
 assert.equal(reduceRunStatus([]),'completed_clear');
 for(const hostile of [null,undefined,42,'rule',{},Object.create(null)]){
  assert.doesNotThrow(()=>evaluateRule(hostile,hostile,hostile));
  assert.equal(evaluateRule(hostile,hostile,hostile).outcome,'evaluation_error');
  assert.doesNotThrow(()=>emitFinding(hostile));
  assert.equal(emitFinding(hostile),null);
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
 const noncritical={terminal:'completed',outcome:'evaluation_error',reason_code:'CHECK_EVALUATION_ERROR',release_critical:false};
 assert.equal(reduceRunStatus([validIssue,noncritical]),'completed_with_gaps');
 const critical={...noncritical,release_critical:true};
 assert.equal(reduceRunStatus([validIssue,critical]),'failed');
});