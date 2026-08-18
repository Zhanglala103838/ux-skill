import {createHash} from 'node:crypto';
import {canonicalSet,jcsBytes} from './canonical.mjs';
import {validateBySchema} from './validation.mjs';

const OUTCOMES=new Set(['pass','fail','partial','not_run','not_applicable','unknown','evaluation_error']);
const TOOL_STATUSES=new Set(['success','partial','not_found','invalid_request','auth_error','timeout','server_error','incompatible_source','cancelled']);
const REASONS=new Set(['INVALID_INPUT','INVALID_RULE','REQUIRED_TOOL_INVALID_REQUEST','REQUIRED_TOOL_AUTH_ERROR','REQUIRED_TOOL_INCOMPATIBLE_SOURCE','REQUIRED_TOOL_TIMEOUT','REQUIRED_TOOL_SERVER_ERROR','REQUIRED_TOOL_CANCELLED','REQUIRED_INPUT_PARTIAL','REQUIRED_INPUT_NOT_FOUND','APPLICABILITY_EVALUATION_ERROR','APPLICABILITY_FALSE','APPLICABILITY_UNKNOWN','EXCLUSION_TRUE','EXCLUSION_UNKNOWN','PRECONDITION_EVALUATION_ERROR','PRECONDITION_FALSE','PRECONDITION_UNKNOWN','CHECK_PASS','CHECK_FAILED','CHECK_PARTIAL','CHECK_UNKNOWN','CHECK_EVALUATION_ERROR','NONE','RULE_CHECK_FAILED','RULE_PARTIAL','RELEASE_CRITICAL_PARTIAL','RULE_NOT_RUN','RELEASE_CRITICAL_NOT_RUN','RULE_UNKNOWN','RELEASE_CRITICAL_UNKNOWN','RELEASE_CRITICAL_EVALUATION_ERROR','RULE_EVALUATION_ERROR','FINDING_REASON_INVALID']);
const TOOL_PRIORITY=[['invalid_request','tool_failed','evaluation_error','REQUIRED_TOOL_INVALID_REQUEST'],['auth_error','tool_failed','evaluation_error','REQUIRED_TOOL_AUTH_ERROR'],['incompatible_source','tool_failed','evaluation_error','REQUIRED_TOOL_INCOMPATIBLE_SOURCE'],['timeout','tool_failed','evaluation_error','REQUIRED_TOOL_TIMEOUT'],['server_error','tool_failed','evaluation_error','REQUIRED_TOOL_SERVER_ERROR'],['cancelled','cancelled','not_run','REQUIRED_TOOL_CANCELLED']];
const BUILTINS=Object.freeze({'always-true.v1':()=>true,'always-false.v1':()=>false});
const ALL=Object.freeze({T:0,U:1,F:2,E:3}),ANY=Object.freeze({F:0,U:1,T:2,E:3}),MISSING=Symbol('missing');
const object=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const snapshot=(value)=>JSON.parse(jcsBytes(value).toString('utf8'));
const compareId=(a,b)=>Buffer.compare(jcsBytes(a),jcsBytes(b));
const scalar=(value)=>value===null||typeof value==='boolean'||typeof value==='string'||(typeof value==='number'&&Number.isFinite(value));
const scalarType=(value)=>value===null?'null':typeof value;
const row=(rule,terminal,outcome,reason_code,trace=[],dependency_trace=[],run_issue=null)=>({rule_id:typeof rule?.rule_id==='string'?rule.rule_id:'invalid-rule',rule_version:typeof rule?.rule_version==='string'?rule.rule_version:'invalid',release_critical:rule?.release_critical===true,finding_type:typeof rule?.finding_type==='string'?rule.finding_type:'unknown',terminal,outcome,reason_code,trace,dependency_trace,run_issue});
const errorRow=(rule,terminal,reason,pointer='')=>row(rule,terminal,'evaluation_error',reason,[],[],{code:'RULE_EVALUATION_ERROR',instance_pointer:pointer,dependency_id:null});

function tokens(pointer){
 if(typeof pointer!=='string'||pointer.length<2||pointer[0]!=='/')throw new Error('PATH');
 const result=[];
 for(const part of pointer.slice(1).split('/')){
  let token='';
  for(let i=0;i<part.length;i+=1){if(part[i]!=='~')token+=part[i];else{if(part[i+1]==='0')token+='~';else if(part[i+1]==='1')token+='/';else throw new Error('PATH');i+=1;}}
  if(token===''||token==='__proto__'||token==='prototype'||token==='constructor')throw new Error('PATH');
  result.push(token);
 }
 return result;
}
function at(root,pointer){
 let value=root;
 for(const token of tokens(pointer)){if(value===null||typeof value!=='object')return MISSING;const descriptor=Object.getOwnPropertyDescriptor(value,token);if(!descriptor||!Object.hasOwn(descriptor,'value'))return MISSING;value=descriptor.value;}
 return value;
}
function validateRegistry(rule){
 const registry=new Set(rule.required_input_pointers);for(const pointer of registry)tokens(pointer);
 const visit=(node)=>{if(['exists','eq','in','compare'].includes(node.op)){tokens(node.path);if(!registry.has(node.path))throw new Error('PATH');}if(node.op==='all'||node.op==='any')for(const child of node.children)visit(child);if(node.op==='not')visit(node.child);if(node.op==='builtin'&&!Object.hasOwn(BUILTINS,node.invariant_id))throw new Error('BUILTIN');};
 for(const field of ['applicability','exclusion','precondition','check'])visit(rule[field]);
}
function ast(node,input,trace,parent_node_id=null){
 let value;
 if(node.op==='literal')value=node.value?'T':'F';
 else if(node.op==='exists')value=at(input,node.path)===MISSING?'F':'T';
 else if(node.op==='eq'){const actual=at(input,node.path);value=actual===MISSING?'U':!scalar(actual)||scalarType(actual)!==scalarType(node.value)?'E':Object.is(actual,node.value)?'T':'F';}
 else if(node.op==='in'){const actual=at(input,node.path);value=actual===MISSING?'U':!Array.isArray(actual)||actual.some(item=>!scalar(item)||scalarType(item)!==scalarType(node.value))?'E':actual.some(item=>Object.is(item,node.value))?'T':'F';}
 else if(node.op==='compare'){const actual=at(input,node.path);if(actual===MISSING)value='U';else if(typeof actual!=='number'||!Number.isFinite(actual))value='E';else if(node.operator==='lt')value=actual<node.value?'T':'F';else if(node.operator==='lte')value=actual<=node.value?'T':'F';else if(node.operator==='gt')value=actual>node.value?'T':'F';else value=actual>=node.value?'T':'F';}
 else if(node.op==='not'){const child=ast(node.child,input,trace,node.node_id);value=child==='T'?'F':child==='F'?'T':child;}
 else if(node.op==='all'||node.op==='any'){const children=[...node.children].sort((a,b)=>compareId(a.node_id,b.node_id)),seen=new Set(),values=[];for(const child of children){if(seen.has(child.node_id))throw new Error('DUPLICATE_NODE');seen.add(child.node_id);values.push(ast(child,input,trace,node.node_id));}const rank=node.op==='all'?ALL:ANY,identity=node.op==='all'?'T':'F';value=values.reduce((best,item)=>rank[item]>rank[best]?item:best,identity);}
 else if(node.op==='builtin')value=BUILTINS[node.invariant_id](snapshot(node.params))?'T':'F';else throw new Error('OP');
 trace.push({node_id:node.node_id,parent_node_id,value});return value;
}
function dependencyTrace(rule,toolResults){
 const byId=new Map();for(const result of toolResults){if(!object(result)||typeof result.dependency_id!=='string'||!TOOL_STATUSES.has(result.status)||typeof result.complete!=='boolean'||byId.has(result.dependency_id))throw new Error('TOOL');byId.set(result.dependency_id,result);}
 const required=rule.required_dependencies.filter(item=>item.required).sort((a,b)=>compareId(a.dependency_id,b.dependency_id)),seen=new Set();
 return required.map(item=>{if(seen.has(item.dependency_id))throw new Error('DEPENDENCY');seen.add(item.dependency_id);const result=byId.get(item.dependency_id)??{dependency_id:item.dependency_id,status:'not_found',complete:false};return{dependency_id:item.dependency_id,status:result.status,complete:result.complete};});
}
function dependencyDecision(trace){for(const [status,terminal,outcome,reason_code] of TOOL_PRIORITY)if(trace.some(item=>item.status===status))return{status,terminal,outcome,reason_code};if(trace.some(item=>item.status==='partial'&&!item.complete))return{terminal:'completed',outcome:'not_run',reason_code:'REQUIRED_INPUT_PARTIAL'};if(trace.some(item=>item.status==='not_found'))return{terminal:'completed',outcome:'not_run',reason_code:'REQUIRED_INPUT_NOT_FOUND'};return null;}
const combined=(left,right,rank,identity)=>[left,right].reduce((best,item)=>rank[item]>rank[best]?item:best,identity);

export function evaluateRule(rule,input,toolResults){
 try{
  let safeInput,safeTools;try{safeInput=snapshot(input);safeTools=snapshot(toolResults);}catch{return errorRow(rule,'invalid_input','INVALID_INPUT');}
  if(!object(safeInput)||!Array.isArray(safeTools))return errorRow(rule,'invalid_input','INVALID_INPUT');
  const valid=validateBySchema('Rule',rule);if(!valid.ok)return errorRow(rule,'invalid_rule','INVALID_RULE');const safeRule=valid.value;
  try{validateRegistry(safeRule);}catch{return errorRow(safeRule,'invalid_rule','INVALID_RULE');}
  let dependency_trace;try{dependency_trace=dependencyTrace(safeRule,safeTools);}catch{return errorRow(safeRule,'invalid_input','INVALID_INPUT');}
  const decision=dependencyDecision(dependency_trace);if(decision){const dependency_id=decision.status?dependency_trace.find(item=>item.status===decision.status)?.dependency_id??null:null;return row(safeRule,decision.terminal,decision.outcome,decision.reason_code,[],dependency_trace,decision.outcome==='evaluation_error'?{code:'RULE_EVALUATION_ERROR',instance_pointer:'/required_dependencies',dependency_id}:null);}
  if(safeRule.required_input_pointers.some(pointer=>at(safeInput,pointer)===MISSING))return row(safeRule,'completed','not_run','REQUIRED_INPUT_PARTIAL',[],dependency_trace);
  const trace=[];let app,exclusion;try{app=ast(safeRule.applicability,safeInput,trace);exclusion=ast(safeRule.exclusion,safeInput,trace);}catch{return errorRow(safeRule,'invalid_rule','INVALID_RULE');}
  const notExclusion=exclusion==='T'?'F':exclusion==='F'?'T':exclusion,effective=combined(app,notExclusion,ALL,'T');
  if(effective==='E')return row(safeRule,'completed','evaluation_error','APPLICABILITY_EVALUATION_ERROR',trace,dependency_trace,{code:'RULE_EVALUATION_ERROR',instance_pointer:'/applicability',dependency_id:null});
  if(effective==='F')return row(safeRule,'completed','not_applicable',app==='F'?'APPLICABILITY_FALSE':'EXCLUSION_TRUE',trace,dependency_trace);
  if(effective==='U')return row(safeRule,'completed','unknown',app==='U'?'APPLICABILITY_UNKNOWN':'EXCLUSION_UNKNOWN',trace,dependency_trace);
  let pre;try{pre=ast(safeRule.precondition,safeInput,trace);}catch{return errorRow(safeRule,'invalid_rule','INVALID_RULE');}
  if(pre==='E')return row(safeRule,'completed','evaluation_error','PRECONDITION_EVALUATION_ERROR',trace,dependency_trace,{code:'RULE_EVALUATION_ERROR',instance_pointer:'/precondition',dependency_id:null});
  if(pre==='F')return row(safeRule,'completed','not_run','PRECONDITION_FALSE',trace,dependency_trace);
  if(pre==='U')return row(safeRule,'completed','not_run','PRECONDITION_UNKNOWN',trace,dependency_trace);
  let check;try{check=ast(safeRule.check,safeInput,trace);}catch{return errorRow(safeRule,'invalid_rule','INVALID_RULE');}
  if(check==='E')return row(safeRule,'completed','evaluation_error','CHECK_EVALUATION_ERROR',trace,dependency_trace,{code:'RULE_EVALUATION_ERROR',instance_pointer:'/check',dependency_id:null});
  if(check==='F')return row(safeRule,'completed','fail','CHECK_FAILED',trace,dependency_trace);
  if(check==='U')return row(safeRule,'completed','unknown','CHECK_UNKNOWN',trace,dependency_trace);
  return row(safeRule,'completed','pass','CHECK_PASS',trace,dependency_trace);
 }catch{return errorRow(rule,'invalid_input','INVALID_INPUT');}
}

const EMISSION=Object.freeze({pass:{false:[null,'NONE'],true:[null,'NONE']},not_applicable:{false:[null,'NONE'],true:[null,'NONE']},fail:{false:['rule','RULE_CHECK_FAILED'],true:['rule','RULE_CHECK_FAILED']},partial:{false:['unknown','RULE_PARTIAL'],true:['escalation','RELEASE_CRITICAL_PARTIAL']},not_run:{false:['unknown','RULE_NOT_RUN'],true:['escalation','RELEASE_CRITICAL_NOT_RUN']},unknown:{false:['unknown','RULE_UNKNOWN'],true:['escalation','RELEASE_CRITICAL_UNKNOWN']},evaluation_error:{false:[null,'NONE'],true:['escalation','RELEASE_CRITICAL_EVALUATION_ERROR']}});
function fingerprint(rowValue,finding_type,emission_reason_code){
 for(const key of ['schema_version','behavior_version','rule_id','rule_version','canonical_target_locator','target_snapshot_digest'])if(typeof rowValue[key]!=='string')throw new Error('FINGERPRINT');
 if(!Array.isArray(rowValue.scenario_binding_ids)||rowValue.scenario_binding_ids.some(item=>typeof item!=='string'))throw new Error('FINGERPRINT');
 const scenario_binding_ids=canonicalSet(rowValue.scenario_binding_ids,item=>item);let claim_key=rowValue.claim_key;
 if(claim_key!==null){if(!object(claim_key)||Object.keys(claim_key).sort().join(',')!=='context_id,population_id,predicate_id,time_scope_id'||Object.values(claim_key).some(value=>typeof value!=='string'))throw new Error('FINGERPRINT');claim_key=snapshot(claim_key);}
 const value={schema_version:rowValue.schema_version,behavior_version:rowValue.behavior_version,rule_id:rowValue.rule_id,rule_version:rowValue.rule_version,finding_type,emission_reason_code,canonical_target_locator:rowValue.canonical_target_locator,target_snapshot_digest:rowValue.target_snapshot_digest,scenario_binding_ids,claim_key};
 const full=createHash('sha256').update('ux-skill:finding:v1').update(jcsBytes(value)).digest('hex');return{fingerprint:value,fingerprint_full_digest:full,finding_id:`f_${full.slice(0,32)}`};
}
export function emitFinding(ruleEvaluation){try{const value=snapshot(ruleEvaluation);if(!object(value)||!OUTCOMES.has(value.outcome)||typeof value.release_critical!=='boolean')return null;const [kind,emission_reason_code]=EMISSION[value.outcome][String(value.release_critical)];if(kind===null)return null;const finding_type=kind==='rule'?value.finding_type:kind;if(typeof finding_type!=='string'||finding_type.length===0)return null;return{...fingerprint(value,finding_type,emission_reason_code),finding_type,emission_reason_code,rule_id:value.rule_id,rule_version:value.rule_version};}catch{return null;}}
const RULE_PAIRS=Object.freeze({
 invalid_input:Object.freeze({evaluation_error:new Set(['INVALID_INPUT'])}),
 invalid_rule:Object.freeze({evaluation_error:new Set(['INVALID_RULE'])}),
 tool_failed:Object.freeze({evaluation_error:new Set(['REQUIRED_TOOL_INVALID_REQUEST','REQUIRED_TOOL_AUTH_ERROR','REQUIRED_TOOL_INCOMPATIBLE_SOURCE','REQUIRED_TOOL_TIMEOUT','REQUIRED_TOOL_SERVER_ERROR'])}),
 cancelled:Object.freeze({not_run:new Set(['REQUIRED_TOOL_CANCELLED'])}),
 completed:Object.freeze({
  pass:new Set(['CHECK_PASS']),
  fail:new Set(['CHECK_FAILED']),
  partial:new Set(['CHECK_PARTIAL']),
  not_run:new Set(['REQUIRED_INPUT_PARTIAL','REQUIRED_INPUT_NOT_FOUND','PRECONDITION_FALSE','PRECONDITION_UNKNOWN']),
  not_applicable:new Set(['APPLICABILITY_FALSE','EXCLUSION_TRUE']),
  unknown:new Set(['APPLICABILITY_UNKNOWN','EXCLUSION_UNKNOWN','CHECK_UNKNOWN']),
  evaluation_error:new Set(['APPLICABILITY_EVALUATION_ERROR','PRECONDITION_EVALUATION_ERROR','CHECK_EVALUATION_ERROR'])
 })
});
const FINDING_PAIRS=Object.freeze({
 RULE_CHECK_FAILED:null,
 RULE_PARTIAL:'unknown',
 RELEASE_CRITICAL_PARTIAL:'escalation',
 RULE_NOT_RUN:'unknown',
 RELEASE_CRITICAL_NOT_RUN:'escalation',
 RULE_UNKNOWN:'unknown',
 RELEASE_CRITICAL_UNKNOWN:'escalation',
 RELEASE_CRITICAL_EVALUATION_ERROR:'escalation'
});
function validRulePart(value){
 if(typeof value.terminal!=='string'||typeof value.outcome!=='string'||typeof value.reason_code!=='string'||typeof value.release_critical!=='boolean')return false;
 const outcomes=Object.hasOwn(RULE_PAIRS,value.terminal)?RULE_PAIRS[value.terminal]:null;
 return outcomes!==null&&Object.hasOwn(outcomes,value.outcome)&&outcomes[value.outcome].has(value.reason_code);
}
function validFindingPart(value){
 if(typeof value.finding_type!=='string'||value.finding_type.length===0||typeof value.emission_reason_code!=='string'||!Object.hasOwn(FINDING_PAIRS,value.emission_reason_code))return false;
 const requiredType=FINDING_PAIRS[value.emission_reason_code];
 return requiredType===null||value.finding_type===requiredType;
}
function validRunIssuePart(value){return typeof value.code==='string'&&REASONS.has(value.code)&&typeof value.instance_pointer==='string'&&(value.dependency_id===null||typeof value.dependency_id==='string');}
function validRunPart(value){
 if(!object(value))return false;
 if(Object.hasOwn(value,'terminal')||Object.hasOwn(value,'outcome')||Object.hasOwn(value,'reason_code')||Object.hasOwn(value,'release_critical'))return validRulePart(value);
 if(Object.hasOwn(value,'finding_type')||Object.hasOwn(value,'emission_reason_code'))return validFindingPart(value);
 if(Object.hasOwn(value,'code')||Object.hasOwn(value,'instance_pointer')||Object.hasOwn(value,'dependency_id'))return validRunIssuePart(value);
 return false;
}
export function reduceRunStatus(parts){
 try{
  const values=snapshot(parts);
  if(!Array.isArray(values)||values.some(value=>!validRunPart(value)))return'failed';
  if(values.some(value=>value.terminal==='invalid_input'||value.terminal==='invalid_rule'))return'failed';
  if(values.some(value=>value.outcome==='evaluation_error'&&value.release_critical===true))return'failed';
  if(values.some(value=>value.finding_type==='block'))return'completed_blocked';
  if(values.some(value=>value.finding_type==='escalation'))return'completed_escalated';
  if(values.some(value=>value.outcome==='partial'||value.outcome==='unknown'||value.outcome==='not_run'||value.outcome==='evaluation_error'))return'completed_with_gaps';
  return'completed_clear';
 }catch{return'failed';}
}