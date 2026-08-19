import { jcsBytes } from './canonical.mjs';

const TOOL_STATUSES=new Set(['success','partial','not_found','invalid_request','auth_error','timeout','server_error','incompatible_source','cancelled']);
const TOOL_DECISIONS=Object.freeze([
 ['invalid_request','tool_failed','evaluation_error','REQUIRED_TOOL_INVALID_REQUEST',true],
 ['auth_error','tool_failed','evaluation_error','REQUIRED_TOOL_AUTH_ERROR',true],
 ['incompatible_source','tool_failed','evaluation_error','REQUIRED_TOOL_INCOMPATIBLE_SOURCE',true],
 ['timeout','tool_failed','evaluation_error','REQUIRED_TOOL_TIMEOUT',true],
 ['server_error','tool_failed','evaluation_error','REQUIRED_TOOL_SERVER_ERROR',true],
 ['cancelled','cancelled','not_run','REQUIRED_TOOL_CANCELLED',false]
]);
const TOOL_ONLY_REASONS=new Set([...TOOL_DECISIONS.map((row)=>row[3]),'REQUIRED_INPUT_NOT_FOUND']);
const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));
const issue=(dependency_id)=>({code:'RULE_EVALUATION_ERROR',instance_pointer:'/required_dependencies',dependency_id});
const decision=(winner,terminal,outcome,reason_code,withIssue)=>({kind:'decision',winner_dependency_id:winner.dependency_id,terminal,outcome,reason_code,run_issue:withIssue?issue(winner.dependency_id):null});

export const isTask5ToolStatus=(status)=>TOOL_STATUSES.has(status);

export const analyzeTask5DependencyTrace=(trace)=>{
 if(!Array.isArray(trace))return{kind:'invalid',reason:'TRACE_NOT_ARRAY'};
 let previous=null;
 for(const item of trace){
  if(!exactKeys(item,['dependency_id','status','complete'])||typeof item.dependency_id!=='string'||item.dependency_id.length===0||!TOOL_STATUSES.has(item.status)||typeof item.complete!=='boolean')return{kind:'invalid',reason:'TRACE_ITEM_INVALID'};
  let bytes;try{bytes=jcsBytes(item.dependency_id);}catch{return{kind:'invalid',reason:'TRACE_ITEM_INVALID'};}
  if(previous){
   const order=Buffer.compare(previous.bytes,bytes);
   if(order===0)return{kind:'invalid',reason:'DUPLICATE_DEPENDENCY_ID'};
   if(order>0)return{kind:'invalid',reason:'NONCANONICAL_DEPENDENCY_ORDER'};
  }
  previous={bytes};
 }
 for(const [status,terminal,outcome,reason_code,withIssue] of TOOL_DECISIONS){
  const winner=trace.find((item)=>item.status===status);
  if(winner)return decision(winner,terminal,outcome,reason_code,withIssue);
 }
 const partial=trace.find((item)=>item.status==='partial'&&!item.complete);
 if(partial)return decision(partial,'completed','not_run','REQUIRED_INPUT_PARTIAL',false);
 const notFound=trace.find((item)=>item.status==='not_found');
 if(notFound)return decision(notFound,'completed','not_run','REQUIRED_INPUT_NOT_FOUND',false);
 return{kind:'ready'};
};

const exactIssue=(actual,expected)=>{
 if(expected===null)return actual===null;
 return exactKeys(actual,['code','instance_pointer','dependency_id'])&&actual.code===expected.code&&actual.instance_pointer===expected.instance_pointer&&actual.dependency_id===expected.dependency_id;
};

export const validateTask5DependencyEvaluation=(evaluation)=>{
 if(evaluation===null||typeof evaluation!=='object'||Array.isArray(evaluation))return{ok:false,reason:'EVALUATION_INVALID',field:''};
 if(evaluation.terminal==='invalid_input'||evaluation.terminal==='invalid_rule')return{ok:true};
 const analyzed=analyzeTask5DependencyTrace(evaluation.dependency_trace);
 if(analyzed.kind==='invalid')return{ok:false,reason:analyzed.reason,field:'dependency_trace'};
 if(analyzed.kind==='ready'){
  if(TOOL_ONLY_REASONS.has(evaluation.reason_code)||evaluation.terminal==='tool_failed'||evaluation.terminal==='cancelled'||(evaluation.reason_code==='REQUIRED_INPUT_PARTIAL'&&(!Array.isArray(evaluation.trace)||evaluation.trace.length===0)))return{ok:false,reason:'TOOL_REASON_WITHOUT_DECISION',field:'reason_code'};
  return{ok:true};
 }
 for(const field of ['terminal','outcome','reason_code'])if(evaluation[field]!==analyzed[field])return{ok:false,reason:'DECISION_MISMATCH',field};
 if(!Array.isArray(evaluation.trace)||evaluation.trace.length!==0)return{ok:false,reason:'DECISION_AST_TRACE_NOT_EMPTY',field:'trace'};
 if(!exactIssue(evaluation.run_issue,analyzed.run_issue))return{ok:false,reason:'DECISION_RUN_ISSUE_MISMATCH',field:'run_issue'};
 return{ok:true};
};
