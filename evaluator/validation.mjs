import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { assertIJson, assertCanonicalRelativePath, canonicalSet, jcsBytes } from './canonical.mjs';

const schemaPaths=[
 '../schemas/adapters/hulian-component-doc-v1.schema.json','../schemas/adapters/hulian-evaluation-request-v1.schema.json',
 '../schemas/core/authority.schema.json','../schemas/core/claims.schema.json','../schemas/core/evaluation-input.schema.json',
 '../schemas/core/real-world-case.schema.json','../schemas/core/snapshot-closure.schema.json','../schemas/evaluator/output.schema.json',
 '../schemas/evaluator/rule.schema.json','../schemas/evaluator/semantic-projection.schema.json'
];
const schemas=await Promise.all(schemaPaths.map(async(schemaFile)=>JSON.parse(await readFile(new URL(schemaFile,import.meta.url),'utf8'))));
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,verbose:false,messages:false,unicodeRegExp:true});
addFormats(ajv);
ajv.addFormat('canonical-relative-path',{type:'string',validate(value){try{assertCanonicalRelativePath(value);return true;}catch{return false;}}});
for(const schema of schemas)ajv.addSchema(schema);

const schemaIds=Object.freeze({
 EvaluationInputBundle:'https://ux-skill.invalid/schemas/core/evaluation-input.schema.json',
 CanonicalResponseHeaders:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/CanonicalResponseHeaders',
 HeaderItem:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/HeaderItem',
 ReplayProfile:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/ReplayProfile',
 RedirectHop:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/RedirectHop',
 NetworkRecord:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/NetworkRecord',
 ObservationRecord:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/ObservationRecord',
 SnapshotClosureManifest:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json',
 AstNode:'https://ux-skill.invalid/schemas/evaluator/rule.schema.json#/$defs/AstNode',
 Rule:'https://ux-skill.invalid/schemas/evaluator/rule.schema.json',
 AuthorityBundle:'https://ux-skill.invalid/schemas/core/authority.schema.json',
 ClaimsBundle:'https://ux-skill.invalid/schemas/core/claims.schema.json',
 EvaluationOutput:'https://ux-skill.invalid/schemas/evaluator/output.schema.json',
 SemanticProjection:'https://ux-skill.invalid/schemas/evaluator/semantic-projection.schema.json',
 HulianComponentDocV1:'https://ux-skill.invalid/schemas/adapters/hulian-component-doc-v1.schema.json',
 HulianEvaluationRequestV1:'https://ux-skill.invalid/schemas/adapters/hulian-evaluation-request-v1.schema.json',
 RealWorldRegressionCase:'https://ux-skill.invalid/schemas/core/real-world-case.schema.json'
});
const pointerToken=(value)=>String(value).replaceAll('~','~0').replaceAll('/','~1');
const params=(value)=>jcsBytes(value).toString('utf8');
const normalizedError=(stage,code,instance_pointer,invariant_or_schema_id,details={})=>({stage,code,instance_pointer,invariant_or_schema_id,params_jcs:params(details)});
const errorKey=(row)=>[row.stage,row.code,row.instance_pointer,row.invariant_or_schema_id,row.params_jcs];
const sortedErrors=(errors)=>canonicalSet(errors,errorKey);
const isPlainObject=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const defensiveCopy=(value)=>structuredClone(value);

const nfcErrors=(value,pointer='',out=[])=>{
 if(typeof value==='string'){if(value.normalize('NFC')!==value)out.push(normalizedError('nfc','UNICODE_NOT_NFC',pointer,'IJSON-NFC-v1'));return out;}
 if(!value||typeof value!=='object')return out;
 if(Array.isArray(value)){value.forEach((item,index)=>nfcErrors(item,`${pointer}/${index}`,out));return out;}
 for(const [key,child] of Object.entries(value)){
  const childPointer=`${pointer}/${pointerToken(key)}`;
  if(key.normalize('NFC')!==key)out.push(normalizedError('nfc','UNICODE_NOT_NFC',childPointer,'IJSON-NFC-v1'));
  nfcErrors(child,childPointer,out);
 }
 return out;
};

const keywordCode=(raw)=>{
 if(raw.keyword==='required')return 'REQUIRED_MISSING';
 if(raw.keyword==='additionalProperties')return 'ADDITIONAL_PROPERTY';
 if(raw.keyword==='type')return 'TYPE_MISMATCH';
 if(raw.keyword==='enum'||raw.keyword==='const')return 'ENUM_MISMATCH';
 if(raw.keyword==='format')return raw.params.format==='canonical-relative-path'?'PATH_INVALID':'FORMAT_INVALID';
 if(['pattern','minimum','maximum','exclusiveMinimum','minLength','minItems','maxItems','contentEncoding'].includes(raw.keyword))return 'FORMAT_INVALID';
 return 'INVARIANT_SCHEMA_DIAGNOSTIC';
};
const normalizeAjvErrors=(schemaId,rawErrors)=>{
 const grouped=new Map();
 for(const raw of rawErrors){
  if(raw.keyword==='anyOf'||raw.keyword==='oneOf')continue;
  let pointer=raw.instancePath||'';
  const code=keywordCode(raw);
  let details;
  if(raw.keyword==='required'){
   pointer+=`/${pointerToken(raw.params.missingProperty)}`;
   details={missingProperty:raw.params.missingProperty};
  }else if(raw.keyword==='additionalProperties'){
   pointer+=`/${pointerToken(raw.params.additionalProperty)}`;
   details={additionalProperty:raw.params.additionalProperty};
  }else if(raw.keyword==='type')details={expected:raw.params.type};
  else if(raw.keyword==='enum'||raw.keyword==='const')details={allowed:raw.params.allowedValues};
  else if(raw.keyword==='format')details={format:raw.params.format};
  else if(code==='FORMAT_INVALID')details={constraint:raw.keyword};
  else details={keyword:raw.keyword};
  const groupKey=params([pointer,code]);
  const current=grouped.get(groupKey);
  if(!current){grouped.set(groupKey,{pointer,code,details,expectedTypes:raw.keyword==='type'?[raw.params.type]:[]});continue;}
  if(raw.keyword==='type'&&!current.expectedTypes.includes(raw.params.type))current.expectedTypes.push(raw.params.type);
 }
 const out=[];
 for(const row of grouped.values()){
  if(row.expectedTypes.length>1)row.details={expected:row.expectedTypes};
  out.push(normalizedError('schema',row.code,row.pointer,schemaId,row.details));
 }
 return out;
};

const astOps=new Set(['literal','exists','eq','in','compare','all','any','not','builtin']);
const astBranches=Object.freeze({
 literal:{required:['value'],allowed:['node_id','op','value']},
 exists:{required:['path'],allowed:['node_id','op','path']},
 eq:{required:['path','value'],allowed:['node_id','op','path','value']},
 in:{required:['path','value'],allowed:['node_id','op','path','value']},
 compare:{required:['path','operator','value'],allowed:['node_id','op','path','operator','value']},
 all:{required:['children'],allowed:['node_id','op','children']},
 any:{required:['children'],allowed:['node_id','op','children']},
 not:{required:['child'],allowed:['node_id','op','child']},
 builtin:{required:['invariant_id','params'],allowed:['node_id','op','invariant_id','params']}
});
const typeError=(pointer,expected)=>normalizedError('schema','TYPE_MISMATCH',pointer,'AstNode',{expected});
const scalar=(value)=>value===null||['boolean','string','number'].includes(typeof value);
const astNodeErrors=(node,pointer='')=>{
 if(!isPlainObject(node))return[typeError(pointer,'object')];
 if(!Object.hasOwn(node,'op'))return[normalizedError('schema','AST_OP_REQUIRED',`${pointer}/op`,'AST-v1',{missingProperty:'op'})];
 if(!astOps.has(node.op))return[normalizedError('schema','AST_OP_UNKNOWN',`${pointer}/op`,'AST-v1',{op:node.op})];
 const branch=astBranches[node.op],out=[];
 if(!Object.hasOwn(node,'node_id'))out.push(normalizedError('schema','REQUIRED_MISSING',`${pointer}/node_id`,'AstNode',{missingProperty:'node_id'}));
 else if(typeof node.node_id!=='string')out.push(typeError(`${pointer}/node_id`,'string'));
 else if(node.node_id.length===0)out.push(normalizedError('schema','FORMAT_INVALID',`${pointer}/node_id`,'AstNode',{constraint:'minLength'}));
 for(const field of branch.required)if(!Object.hasOwn(node,field))out.push(normalizedError('schema','REQUIRED_MISSING',`${pointer}/${field}`,'AstNode',{missingProperty:field}));
 for(const field of Object.keys(node))if(!branch.allowed.includes(field))out.push(normalizedError('schema','ADDITIONAL_PROPERTY',`${pointer}/${pointerToken(field)}`,'AstNode',{additionalProperty:field}));
 const has=(field)=>Object.hasOwn(node,field);
 if(node.op==='literal'&&has('value')&&typeof node.value!=='boolean')out.push(typeError(`${pointer}/value`,'boolean'));
 if(node.op==='exists'&&has('path')&&typeof node.path!=='string')out.push(typeError(`${pointer}/path`,'string'));
 if((node.op==='eq'||node.op==='in')){
  if(has('path')&&typeof node.path!=='string')out.push(typeError(`${pointer}/path`,'string'));
  if(has('value')&&!scalar(node.value))out.push(typeError(`${pointer}/value`,'scalar'));
 }
 if(node.op==='compare'){
  if(has('path')&&typeof node.path!=='string')out.push(typeError(`${pointer}/path`,'string'));
  if(has('operator')&&!['lt','lte','gt','gte'].includes(node.operator))out.push(normalizedError('schema','ENUM_MISMATCH',`${pointer}/operator`,'AstNode',{allowed:['lt','lte','gt','gte']}));
  if(has('value')&&typeof node.value!=='number')out.push(typeError(`${pointer}/value`,'number'));
 }
 if(node.op==='all'||node.op==='any'){
  if(has('children')&&!Array.isArray(node.children))out.push(typeError(`${pointer}/children`,'array'));
  else if(Array.isArray(node.children))node.children.forEach((child,index)=>out.push(...astNodeErrors(child,`${pointer}/children/${index}`)));
 }
 if(node.op==='not'){
  if(has('child')&&!isPlainObject(node.child))out.push(typeError(`${pointer}/child`,'object'));
  else if(isPlainObject(node.child))out.push(...astNodeErrors(node.child,`${pointer}/child`));
 }
 if(node.op==='builtin'){
  if(has('invariant_id')&&typeof node.invariant_id!=='string')out.push(typeError(`${pointer}/invariant_id`,'string'));
  if(has('params')&&!isPlainObject(node.params))out.push(typeError(`${pointer}/params`,'object'));
 }
 return out;
};
const ruleAstFields=['applicability','exclusion','precondition','check'];
const placeholderAst={node_id:'validation-placeholder',op:'literal',value:true};

const schemaErrors=(schemaId,value)=>{
 if(!Object.hasOwn(schemaIds,schemaId))return[normalizedError('schema','INVARIANT_SCHEMA_ID_UNKNOWN','','SchemaRegistry-v1',{schema_id:schemaId})];
 if(schemaId==='AstNode')return astNodeErrors(value);
 const validate=ajv.getSchema(schemaIds[schemaId]);
 if(!validate)return[normalizedError('schema','INVARIANT_SCHEMA_ID_UNKNOWN','','SchemaRegistry-v1',{schema_id:schemaId})];
 let candidate=value,tagged=[];
 if(schemaId==='Rule'&&isPlainObject(value)){
  candidate=defensiveCopy(value);
  for(const field of ruleAstFields)if(Object.hasOwn(value,field)){
   tagged.push(...astNodeErrors(value[field],`/${field}`));
   candidate[field]=placeholderAst;
  }
 }
 validate(candidate);
 return [...normalizeAjvErrors(schemaId,validate.errors||[]),...tagged];
};

const schemaErrorAt=(schemaRows,pointer)=>schemaRows.some((row)=>row.stage==='schema'&&(row.instance_pointer===pointer||row.instance_pointer.startsWith(`${pointer}/`)));
const collectionInvariant=(schemaId)=>schemaId==='EvaluationOutput'||schemaId==='SemanticProjection'?'OutputCollectionRegistry-v1':'InputCollectionRegistry-v1';
const normalizeSet=(owner,field,keyOf,keyPointer,pathPrefix,invariant,out)=>{
 const items=owner?.[field];
 if(!Array.isArray(items))return;
 const seen=new Map();let conflict=false;
 items.forEach((item,index)=>{
  let key;
  try{key=keyOf(item);}catch{return;}
  if(key===undefined)return;
  const keyBytes=params(key),itemBytes=params(item);
  if(seen.has(keyBytes)&&seen.get(keyBytes)!==itemBytes){
   const suffix=keyPointer?`/${pointerToken(keyPointer)}`:'';
   out.push(normalizedError('collections','DUPLICATE_ID_CONFLICT',`${pathPrefix}/${index}${suffix}`,invariant,{key}));
   conflict=true;
  }else if(!seen.has(keyBytes))seen.set(keyBytes,itemBytes);
 });
 if(!conflict)owner[field]=canonicalSet(items,keyOf);
};
const normalizeSequence=(items,pathPrefix,invariant,out)=>{
 if(!Array.isArray(items))return;
 items.forEach((item,index)=>{if(isPlainObject(item)&&Number.isInteger(item.sequence)&&item.sequence!==index)out.push(normalizedError('collections','INVARIANT_SEQUENCE_CONTIGUOUS',`${pathPrefix}/${index}/sequence`,invariant,{actual:item.sequence,expected:index}));});
};
const normalizeEvaluationInput=(value,schemaRows,out)=>{
 if(!isPlainObject(value))return;
 const invariant='InputCollectionRegistry-v1';
 for(const [field,key] of [['scenario_profiles','scenario_profile_id'],['candidate_universe','solution_id'],['journeys','journey_id'],['evidence','evidence_id'],['studies','study_id'],['claims','claim_id'],['adapter_evidence','adapter_evidence_id']])normalizeSet(value,field,(row)=>isPlainObject(row)?row[key]:undefined,key,`/${field}`,invariant,out);
 normalizeSet(value,'source_registry_refs',(item)=>item,null,'/source_registry_refs',invariant,out);
 if(Array.isArray(value.candidate_universe))value.candidate_universe.forEach((row,index)=>{if(isPlainObject(row))normalizeSet(row,'option_ids',(item)=>item,null,`/candidate_universe/${index}/option_ids`,invariant,out);});
 if(Array.isArray(value.claims))value.claims.forEach((row,index)=>{if(isPlainObject(row)&&!schemaErrorAt(schemaRows,`/claims/${index}/evidence_refs`))normalizeSet(row,'evidence_refs',(item)=>item,null,`/claims/${index}/evidence_refs`,invariant,out);});
 const scenarioInvalid=schemaErrorAt(schemaRows,'/scenario_profile_id');
 const scenarioRegistryInvalid=schemaErrorAt(schemaRows,'/scenario_profiles')||!Array.isArray(value.scenario_profiles);
 if(scenarioInvalid||scenarioRegistryInvalid)out.push(normalizedError('collections','SUPPRESSED_BY_STAGE','/scenario_profile_id','ScenarioProfileRef-v1',{prerequisite_stage:'schema'}));
 else if(typeof value.scenario_profile_id==='string'&&!value.scenario_profiles.some((row)=>row?.scenario_profile_id===value.scenario_profile_id))out.push(normalizedError('collections','REF_MISSING','/scenario_profile_id','ScenarioProfileRef-v1',{ref:value.scenario_profile_id}));
 if(!Array.isArray(value.claims))return;
 const evidenceRegistryInvalid=schemaErrorAt(schemaRows,'/evidence')||!Array.isArray(value.evidence);
 const evidenceIds=evidenceRegistryInvalid?new Set():new Set(value.evidence.map((row)=>row?.evidence_id));
 value.claims.forEach((claim,claimIndex)=>{
  if(!isPlainObject(claim)||!Array.isArray(claim.evidence_refs))return;
  if(evidenceRegistryInvalid){out.push(normalizedError('collections','SUPPRESSED_BY_STAGE',`/claims/${claimIndex}/evidence_refs`,'EvidenceRef-v1',{prerequisite_stage:'schema'}));return;}
  claim.evidence_refs.forEach((refValue,refIndex)=>{
   const refPointer=`/claims/${claimIndex}/evidence_refs/${refIndex}`;
   if(schemaErrorAt(schemaRows,refPointer))out.push(normalizedError('collections','SUPPRESSED_BY_STAGE',refPointer,'EvidenceRef-v1',{prerequisite_stage:'schema'}));
   else if(typeof refValue==='string'&&!evidenceIds.has(refValue))out.push(normalizedError('collections','REF_MISSING',refPointer,'EvidenceRef-v1',{ref:refValue}));
  });
 });
};
const normalizeSnapshot=(schemaId,value,out)=>{
 if(!isPlainObject(value))return;
 const invariant='InputCollectionRegistry-v1';
 if(schemaId==='CanonicalResponseHeaders'){normalizeSequence(value.headers,'/headers',invariant,out);return;}
 if(schemaId==='NetworkRecord'){normalizeSequence(value.redirect_chain,'/redirect_chain',invariant,out);return;}
 if(schemaId==='SnapshotClosureManifest'){
  normalizeSet(value,'replay_profiles',(row)=>row?.replay_profile_id,'replay_profile_id','/replay_profiles',invariant,out);
  normalizeSet(value,'network_records',(row)=>isPlainObject(row)?[row.replay_profile_id,row.sequence]:undefined,null,'/network_records',invariant,out);
  normalizeSet(value,'observation_records',(row)=>isPlainObject(row)?[row.replay_profile_id,row.task_step_id,row.evidence_kind,row.ordinal]:undefined,null,'/observation_records',invariant,out);
  if(Array.isArray(value.network_records))value.network_records.forEach((row,index)=>normalizeSequence(row?.redirect_chain,`/network_records/${index}/redirect_chain`,invariant,out));
 }
};
const normalizeOutput=(value,invariant,out)=>{
 if(!isPlainObject(value))return;
 const entries=[['rule_evaluations',(row)=>row?.rule_id,'rule_id'],['findings',(row)=>row?.fingerprint??row,'finding_id'],['run_issues',(row)=>isPlainObject(row)?[row.code,row.instance_pointer,row.dependency_id]:undefined,null],['claim_assessments',(row)=>row?.claim_assessment_id,'claim_assessment_id'],['risk_assessments',(row)=>row?.risk_assessment_id,'risk_assessment_id'],['recommendation_assessments',(row)=>row?.recommendation_assessment_id,'recommendation_assessment_id'],['alternatives',(row)=>row?.alternative_id,'alternative_id'],['solutions',(row)=>row?.solution_id,'solution_id'],['unsat_cores',(row)=>row?.constraint_ids??row,null],['resolution_traces',(row)=>row?.resolution_trace_id,'resolution_trace_id'],['coverage_gaps',(row)=>row?.coverage_gap_id,'coverage_gap_id']];
 for(const [field,keyOf,keyPointer] of entries)normalizeSet(value,field,keyOf,keyPointer,`/${field}`,invariant,out);
 if(Array.isArray(value.resolution_traces))value.resolution_traces.forEach((trace,index)=>{normalizeSequence(trace?.nodes,`/resolution_traces/${index}/nodes`,invariant,out);normalizeSequence(trace?.steps,`/resolution_traces/${index}/steps`,invariant,out);});
};
const normalizeGenericBundle=(schemaId,value,out)=>{
 if(!isPlainObject(value))return;
 const invariant=collectionInvariant(schemaId);
 const tables={
  AuthorityBundle:[['authority_roots','authority_root_id'],['grants','grant_id'],['control_principal_edges','sequence'],['party_graph_proofs','proof_id'],['party_inventories','party_inventory_id'],['authorization_decisions','authorization_decision_id'],['execution_envelopes','envelope_id'],['time_authority_policies','time_authority_policy_id'],['capabilities','capability_id'],['capability_ledger_entries','capability_digest'],['invalidations','invalidation_id'],['execution_leases','execution_lease_id'],['external_effect_connectors','connector_id']],
  ClaimsBundle:[['sources','source_id'],['fragments','fragment_id'],['proposition_assessments','assessment_id'],['policy_adoptions','adoption_id'],['claims','claim_id'],['claim_assessments','claim_assessment_id'],['claim_assessment_policies','policy_id']],
  RealWorldRegressionCase:[['hypotheses','hypothesis_id'],['measures','measure_id'],['negative_controls','control_id']]
 };
 for(const [field,key] of tables[schemaId]||[])normalizeSet(value,field,(row)=>row?.[key],key,`/${field}`,invariant,out);
 if(schemaId==='AuthorityBundle'){normalizeSequence(value.acting_edges,'/acting_edges',invariant,out);normalizeSequence(value.approval_decisions,'/approval_decisions',invariant,out);}
};
const collectionStage=(schemaId,value,schemaRows)=>{
 const normalized=defensiveCopy(value),out=[];
 if(schemaId==='EvaluationInputBundle')normalizeEvaluationInput(normalized,schemaRows,out);
 if(['CanonicalResponseHeaders','NetworkRecord','SnapshotClosureManifest'].includes(schemaId))normalizeSnapshot(schemaId,normalized,out);
 if(schemaId==='EvaluationOutput'||schemaId==='SemanticProjection')normalizeOutput(normalized,'OutputCollectionRegistry-v1',out);
 normalizeGenericBundle(schemaId,normalized,out);
 return{value:normalized,errors:out};
};

export const validateBySchema=(schemaId,value)=>{
 try{assertIJson(value);}catch(cause){const code=typeof cause.code==='string'&&cause.code.startsWith('IJSON_')?cause.code:'IJSON_NON_JSON_VALUE';return{ok:false,errors:[normalizedError('parse',code,'','IJSON-v1')]};}
 const nfc=sortedErrors(nfcErrors(value));
 if(nfc.length)return{ok:false,errors:nfc};
 const schemaRows=sortedErrors(schemaErrors(schemaId,value));
 if(!Object.hasOwn(schemaIds,schemaId))return{ok:false,errors:schemaRows};
 const collections=collectionStage(schemaId,value,schemaRows);
 const errors=sortedErrors([...schemaRows,...collections.errors]);
 return errors.length?{ok:false,errors}:{ok:true,value:collections.value};
};
export const validateInput=(value)=>validateBySchema('EvaluationInputBundle',value);