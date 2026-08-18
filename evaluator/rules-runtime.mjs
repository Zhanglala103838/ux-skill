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
const ruleMetadata=(rule)=>{
 try{
  const value=snapshot(rule);
  if(!object(value))throw new Error('RULE_METADATA');
  return{
   rule_id:typeof value.rule_id==='string'&&value.rule_id.length>0?value.rule_id:'invalid-rule',
   rule_version:typeof value.rule_version==='string'&&value.rule_version.length>0?value.rule_version:'invalid',
   release_critical:value.release_critical===true,
   finding_type:typeof value.finding_type==='string'&&value.finding_type.length>0?value.finding_type:'unknown'
  };
 }catch{return{rule_id:'invalid-rule',rule_version:'invalid',release_critical:false,finding_type:'unknown'};}
};
const row=(rule,terminal,outcome,reason_code,trace=[],dependency_trace=[],run_issue=null)=>({...ruleMetadata(rule),terminal,outcome,reason_code,trace,dependency_trace,run_issue});
const exactIssue=(pointer='',dependency_id=null)=>({code:'RULE_EVALUATION_ERROR',instance_pointer:pointer,dependency_id});
const errorRow=(rule,terminal,reason,pointer='')=>row(rule,terminal,'evaluation_error',reason,[],[],exactIssue(pointer));
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
 const registry=new Set(rule.registered_input_pointers??rule.required_input_pointers);for(const pointer of registry)tokens(pointer);for(const pointer of rule.required_input_pointers)if(!registry.has(pointer))throw new Error('REQUIRED_PATH_OUTSIDE_REGISTRY');
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
 const byId=new Map();
 for(const result of toolResults){if(!object(result)||!text(result.dependency_id)||!TOOL_STATUSES.has(result.status)||typeof result.complete!=='boolean'||byId.has(result.dependency_id))throw new Error('TOOL');byId.set(result.dependency_id,result);}
 const required=rule.required_dependencies.filter(item=>item.required).sort((a,b)=>compareId(a.dependency_id,b.dependency_id)),seen=new Set();
 return required.map(item=>{if(!text(item.dependency_id)||seen.has(item.dependency_id))throw new Error('DEPENDENCY');seen.add(item.dependency_id);const result=byId.get(item.dependency_id)??{dependency_id:item.dependency_id,status:'not_found',complete:false};return{dependency_id:item.dependency_id,status:result.status,complete:result.complete};});
}
function dependencyDecision(trace){
 const decision=(winner,terminal,outcome,reason_code)=>({winner,terminal,outcome,reason_code,run_issue:outcome==='evaluation_error'?exactIssue('/required_dependencies',winner.dependency_id):null});
 for(const [status,terminal,outcome,reason_code] of TOOL_PRIORITY){const winner=trace.find(item=>item.status===status);if(winner)return decision(winner,terminal,outcome,reason_code);}
 const partial=trace.find(item=>item.status==='partial'&&!item.complete);if(partial)return decision(partial,'completed','not_run','REQUIRED_INPUT_PARTIAL');
 const notFound=trace.find(item=>item.status==='not_found');if(notFound)return decision(notFound,'completed','not_run','REQUIRED_INPUT_NOT_FOUND');
 return null;
}
const combined=(left,right,rank,identity)=>[left,right].reduce((best,item)=>rank[item]>rank[best]?item:best,identity);

export function evaluateRule(rule,input,toolResults){
 try{
  let safeInput,safeTools;try{safeInput=snapshot(input);safeTools=snapshot(toolResults);}catch{return errorRow(rule,'invalid_input','INVALID_INPUT');}
  if(!object(safeInput)||!Array.isArray(safeTools))return errorRow(rule,'invalid_input','INVALID_INPUT');
  const valid=validateBySchema('Rule',rule);if(!valid.ok)return errorRow(rule,'invalid_rule','INVALID_RULE');const safeRule=valid.value;
  try{validateRegistry(safeRule);}catch{return errorRow(safeRule,'invalid_rule','INVALID_RULE');}
  let dependency_trace;try{dependency_trace=dependencyTrace(safeRule,safeTools);}catch{return errorRow(safeRule,'invalid_input','INVALID_INPUT');}
  const decision=dependencyDecision(dependency_trace);if(decision)return row(safeRule,decision.terminal,decision.outcome,decision.reason_code,[],dependency_trace,decision.run_issue);
  const trace=[];let app,exclusion;try{app=ast(safeRule.applicability,safeInput,trace);exclusion=ast(safeRule.exclusion,safeInput,trace);}catch{return errorRow(safeRule,'invalid_rule','INVALID_RULE');}
  const notExclusion=exclusion==='T'?'F':exclusion==='F'?'T':exclusion,effective=combined(app,notExclusion,ALL,'T');
  if(effective==='E')return row(safeRule,'completed','evaluation_error','APPLICABILITY_EVALUATION_ERROR',trace,dependency_trace,{code:'RULE_EVALUATION_ERROR',instance_pointer:'/applicability',dependency_id:null});
  if(effective==='F')return row(safeRule,'completed','not_applicable',app==='F'?'APPLICABILITY_FALSE':'EXCLUSION_TRUE',trace,dependency_trace);
  if(effective==='U')return row(safeRule,'completed','unknown',app==='U'?'APPLICABILITY_UNKNOWN':'EXCLUSION_UNKNOWN',trace,dependency_trace);
  let pre;try{pre=ast(safeRule.precondition,safeInput,trace);}catch{return errorRow(safeRule,'invalid_rule','INVALID_RULE');}
  if(pre==='E')return row(safeRule,'completed','evaluation_error','PRECONDITION_EVALUATION_ERROR',trace,dependency_trace,{code:'RULE_EVALUATION_ERROR',instance_pointer:'/precondition',dependency_id:null});
  if(pre==='F')return row(safeRule,'completed','not_run','PRECONDITION_FALSE',trace,dependency_trace);
  if(pre==='U')return row(safeRule,'completed','not_run','PRECONDITION_UNKNOWN',trace,dependency_trace);
  if(safeRule.required_input_pointers.some(pointer=>at(safeInput,pointer)===MISSING))return row(safeRule,'completed','not_run','REQUIRED_INPUT_PARTIAL',trace,dependency_trace);
  let check;try{check=ast(safeRule.check,safeInput,trace);}catch{return errorRow(safeRule,'invalid_rule','INVALID_RULE');}
  if(check==='E')return row(safeRule,'completed','evaluation_error','CHECK_EVALUATION_ERROR',trace,dependency_trace,{code:'RULE_EVALUATION_ERROR',instance_pointer:'/check',dependency_id:null});
  if(check==='F')return row(safeRule,'completed','fail','CHECK_FAILED',trace,dependency_trace);
  if(check==='U')return row(safeRule,'completed','unknown','CHECK_UNKNOWN',trace,dependency_trace);
  return row(safeRule,'completed','pass','CHECK_PASS',trace,dependency_trace);
 }catch{return errorRow(rule,'invalid_input','INVALID_INPUT');}
}

export function deriveFindingContext(bundle){
 try{const valid=validateBySchema('EvaluationInputBundle',bundle);if(!valid.ok)return null;const value=valid.value;return snapshot({schema_version:'finding-v1',behavior_version:value.behavior_version,canonical_target_locator:value.target_snapshot.canonical_locator,target_snapshot_digest:value.target_snapshot.snapshot_digest,scenario_binding_ids:[value.scenario_profile_id],claim_key:null});}catch{return null;}
}
const EMISSION=Object.freeze({pass:{false:[null,'NONE'],true:[null,'NONE']},not_applicable:{false:[null,'NONE'],true:[null,'NONE']},fail:{false:['rule','RULE_CHECK_FAILED'],true:['rule','RULE_CHECK_FAILED']},partial:{false:['unknown','RULE_PARTIAL'],true:['escalation','RELEASE_CRITICAL_PARTIAL']},not_run:{false:['unknown','RULE_NOT_RUN'],true:['escalation','RELEASE_CRITICAL_NOT_RUN']},unknown:{false:['unknown','RULE_UNKNOWN'],true:['escalation','RELEASE_CRITICAL_UNKNOWN']},evaluation_error:{false:[null,'NONE'],true:['escalation','RELEASE_CRITICAL_EVALUATION_ERROR']}});
function fingerprint(ruleValue,context,finding_type,emission_reason_code){
 const value={schema_version:context.schema_version,behavior_version:context.behavior_version,rule_id:ruleValue.rule_id,rule_version:ruleValue.rule_version,finding_type,emission_reason_code,canonical_target_locator:context.canonical_target_locator,target_snapshot_digest:context.target_snapshot_digest,scenario_binding_ids:context.scenario_binding_ids,claim_key:null};
 const full=createHash('sha256').update('ux-skill:finding:v1').update(jcsBytes(value)).digest('hex');return{fingerprint:value,fingerprint_full_digest:full,finding_id:`f_${full.slice(0,32)}`};
}
export function emitFinding(ruleEvaluation,context){
 try{const value=snapshot(ruleEvaluation),safeContext=snapshot(context);if(ruleSignal(value)===null||!validFindingContext(safeContext)||value.terminal==='invalid_input'||value.terminal==='invalid_rule')return null;const [kind,emission_reason_code]=EMISSION[value.outcome][String(value.release_critical)];if(kind===null)return null;const finding_type=kind==='rule'?value.finding_type:kind;if(!text(finding_type))return null;return{...fingerprint(value,safeContext,finding_type,emission_reason_code),finding_type,emission_reason_code,rule_id:value.rule_id,rule_version:value.rule_version};}catch{return null;}
}
const RULE_PAIRS=Object.freeze({
 invalid_input:Object.freeze({evaluation_error:new Set(['INVALID_INPUT'])}),
 invalid_rule:Object.freeze({evaluation_error:new Set(['INVALID_RULE'])}),
 tool_failed:Object.freeze({evaluation_error:new Set(['REQUIRED_TOOL_INVALID_REQUEST','REQUIRED_TOOL_AUTH_ERROR','REQUIRED_TOOL_INCOMPATIBLE_SOURCE','REQUIRED_TOOL_TIMEOUT','REQUIRED_TOOL_SERVER_ERROR'])}),
 cancelled:Object.freeze({not_run:new Set(['REQUIRED_TOOL_CANCELLED'])}),
 completed:Object.freeze({
  pass:new Set(['CHECK_PASS']),fail:new Set(['CHECK_FAILED']),partial:new Set(['CHECK_PARTIAL']),
  not_run:new Set(['REQUIRED_INPUT_PARTIAL','REQUIRED_INPUT_NOT_FOUND','PRECONDITION_FALSE','PRECONDITION_UNKNOWN']),
  not_applicable:new Set(['APPLICABILITY_FALSE','EXCLUSION_TRUE']),
  unknown:new Set(['APPLICABILITY_UNKNOWN','EXCLUSION_UNKNOWN','CHECK_UNKNOWN']),
  evaluation_error:new Set(['APPLICABILITY_EVALUATION_ERROR','PRECONDITION_EVALUATION_ERROR','CHECK_EVALUATION_ERROR'])
 })
});
const FINDING_PAIRS=Object.freeze({RULE_CHECK_FAILED:null,RULE_PARTIAL:'unknown',RELEASE_CRITICAL_PARTIAL:'escalation',RULE_NOT_RUN:'unknown',RELEASE_CRITICAL_NOT_RUN:'escalation',RULE_UNKNOWN:'unknown',RELEASE_CRITICAL_UNKNOWN:'escalation',RELEASE_CRITICAL_EVALUATION_ERROR:'escalation'});
const RULE_KEYS=['dependency_trace','finding_type','outcome','reason_code','release_critical','rule_id','rule_version','run_issue','terminal','trace'];
const FINDING_KEYS=['emission_reason_code','finding_id','finding_type','fingerprint','fingerprint_full_digest','rule_id','rule_version'];
const ISSUE_KEYS=['code','dependency_id','instance_pointer'];
const FINGERPRINT_KEYS=['behavior_version','canonical_target_locator','claim_key','emission_reason_code','finding_type','rule_id','rule_version','scenario_binding_ids','schema_version','target_snapshot_digest'];
const FINDING_CONTEXT_KEYS=['behavior_version','canonical_target_locator','claim_key','scenario_binding_ids','schema_version','target_snapshot_digest'];
const CLAIM_KEYS=['context_id','population_id','predicate_id','time_scope_id'];
const TRACE_KEYS=['node_id','parent_node_id','value'];
const DEPENDENCY_KEYS=['complete','dependency_id','status'];
const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const wellFormed=(value)=>{for(let i=0;i<value.length;i+=1){const code=value.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(i+1);if(!(next>=0xdc00&&next<=0xdfff))return false;i+=1;}else if(code>=0xdc00&&code<=0xdfff)return false;}return true;};
const text=(value)=>typeof value==='string'&&value.length>0&&wellFormed(value)&&value.normalize('NFC')===value;
const lowerHex64=(value)=>{
 if(typeof value!=='string'||value.length!==64)return false;
 for(const char of value)if(!'0123456789abcdef'.includes(char))return false;
 return true;
};
const validIssue=(value)=>exactKeys(value,ISSUE_KEYS)&&value.code==='RULE_EVALUATION_ERROR'&&typeof value.instance_pointer==='string'&&(value.dependency_id===null||text(value.dependency_id));
const validTrace=(value)=>Array.isArray(value)&&value.every(item=>exactKeys(item,TRACE_KEYS)&&text(item.node_id)&&(item.parent_node_id===null||text(item.parent_node_id))&&['T','F','U','E'].includes(item.value));
function validDependencyTrace(value){
 if(!Array.isArray(value))return false;const seen=new Set();let previous=null;
 for(const item of value){if(!exactKeys(item,DEPENDENCY_KEYS)||!text(item.dependency_id)||!TOOL_STATUSES.has(item.status)||typeof item.complete!=='boolean'||seen.has(item.dependency_id))return false;if(previous!==null&&compareId(previous,item.dependency_id)>=0)return false;seen.add(item.dependency_id);previous=item.dependency_id;}
 return true;
}
function validFindingContext(value){
 if(!exactKeys(value,FINDING_CONTEXT_KEYS)||value.schema_version!=='finding-v1'||!text(value.behavior_version)||!text(value.canonical_target_locator)||!lowerHex64(value.target_snapshot_digest)||value.claim_key!==null)return false;
 if(!Array.isArray(value.scenario_binding_ids)||value.scenario_binding_ids.length===0||value.scenario_binding_ids.some(item=>!text(item)))return false;
 try{return jcsBytes(canonicalSet(value.scenario_binding_ids,item=>item)).equals(jcsBytes(value.scenario_binding_ids));}catch{return false;}
}
function ruleSignal(value){
 if(!exactKeys(value,RULE_KEYS)||!text(value.rule_id)||!text(value.rule_version)||!text(value.finding_type)||typeof value.release_critical!=='boolean'||!validTrace(value.trace)||!validDependencyTrace(value.dependency_trace))return null;
 const outcomes=Object.hasOwn(RULE_PAIRS,value.terminal)?RULE_PAIRS[value.terminal]:null;if(outcomes===null||!Object.hasOwn(outcomes,value.outcome)||!outcomes[value.outcome].has(value.reason_code))return null;
 if(value.outcome==='evaluation_error'){if(!validIssue(value.run_issue))return null;}else if(value.run_issue!==null)return null;
 if(value.terminal==='invalid_input'||value.terminal==='invalid_rule'){if(value.trace.length!==0||value.dependency_trace.length!==0||value.run_issue.instance_pointer!==''||value.run_issue.dependency_id!==null)return null;}
 else{const decision=dependencyDecision(value.dependency_trace);if(decision!==null){if(value.trace.length!==0||value.terminal!==decision.terminal||value.outcome!==decision.outcome||value.reason_code!==decision.reason_code)return null;if(!jcsBytes(value.run_issue).equals(jcsBytes(decision.run_issue)))return null;}else if(value.terminal==='tool_failed'||value.terminal==='cancelled'||value.reason_code==='REQUIRED_INPUT_NOT_FOUND')return null;}
 return{kind:'rule',failed:value.terminal==='invalid_input'||value.terminal==='invalid_rule'||(value.outcome==='evaluation_error'&&value.release_critical),gap:['partial','unknown','not_run','evaluation_error'].includes(value.outcome)};
}
function validClaimKey(value){return value===null||(exactKeys(value,CLAIM_KEYS)&&CLAIM_KEYS.every(key=>text(value[key])));}
function findingSignal(value){
 if(!exactKeys(value,FINDING_KEYS)||!text(value.rule_id)||!text(value.rule_version)||!text(value.finding_type)||!Object.hasOwn(FINDING_PAIRS,value.emission_reason_code))return null;
 const requiredType=FINDING_PAIRS[value.emission_reason_code];if(requiredType!==null&&value.finding_type!==requiredType)return null;
 const fp=value.fingerprint;
 if(!exactKeys(fp,FINGERPRINT_KEYS)||!text(fp.schema_version)||!text(fp.behavior_version)||!text(fp.rule_id)||!text(fp.rule_version)||!text(fp.finding_type)||!text(fp.canonical_target_locator)||!lowerHex64(fp.target_snapshot_digest)||!Array.isArray(fp.scenario_binding_ids)||fp.scenario_binding_ids.some(item=>!text(item))||!validClaimKey(fp.claim_key))return null;
 if(fp.rule_id!==value.rule_id||fp.rule_version!==value.rule_version||fp.finding_type!==value.finding_type||fp.emission_reason_code!==value.emission_reason_code)return null;
 let canonicalScenarios;try{canonicalScenarios=canonicalSet(fp.scenario_binding_ids,item=>item);}catch{return null;}
 if(!jcsBytes(canonicalScenarios).equals(jcsBytes(fp.scenario_binding_ids)))return null;
 const digest=createHash('sha256').update('ux-skill:finding:v1').update(jcsBytes(fp)).digest('hex');
 if(value.fingerprint_full_digest!==digest||value.finding_id!==`f_${digest.slice(0,32)}`)return null;
 return{kind:'finding',block:value.finding_type==='block',escalation:value.finding_type==='escalation'};
}
const issueSignal=(value)=>validIssue(value)?{kind:'issue'}:null;
function normalizePart(value){
 if(!object(value))return null;
 const variants=[exactKeys(value,RULE_KEYS),exactKeys(value,FINDING_KEYS),exactKeys(value,ISSUE_KEYS)];
 if(variants.filter(Boolean).length!==1)return null;
 if(variants[0])return ruleSignal(value);
 if(variants[1])return findingSignal(value);
 return issueSignal(value);
}
export function reduceRunStatus(parts){
 try{
  const values=snapshot(parts);if(!Array.isArray(values))return'failed';
  const signals=values.map(normalizePart);if(signals.some(signal=>signal===null))return'failed';
  if(signals.some(signal=>signal.failed))return'failed';
  if(signals.some(signal=>signal.block))return'completed_blocked';
  if(signals.some(signal=>signal.escalation))return'completed_escalated';
  if(signals.some(signal=>signal.gap))return'completed_with_gaps';
  return'completed_clear';
 }catch{return'failed';}
}