import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { assertIJson, assertNfc, assertCanonicalRelativePath, canonicalSet, jcsBytes } from './canonical.mjs';

const schemaPaths=[
 '../schemas/adapters/hulian-component-doc-v1.schema.json','../schemas/adapters/hulian-evaluation-request-v1.schema.json',
 '../schemas/core/authority.schema.json','../schemas/core/claims.schema.json','../schemas/core/evaluation-input.schema.json',
 '../schemas/core/real-world-case.schema.json','../schemas/core/snapshot-closure.schema.json','../schemas/evaluator/output.schema.json',
 '../schemas/evaluator/rule.schema.json','../schemas/evaluator/semantic-projection.schema.json'
];
const schemas=await Promise.all(schemaPaths.map(async(path)=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'))));
const ajv=new Ajv2020({allErrors:true,strict:true,validateFormats:true,verbose:false,messages:false,unicodeRegExp:true});
addFormats(ajv);
ajv.addFormat('canonical-relative-path',{type:'string',validate(value){try{assertCanonicalRelativePath(value);return true;}catch{return false;}}});
for(const schema of schemas)ajv.addSchema(schema);

const ids={
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
};
const pointerToken=(value)=>String(value).replaceAll('~','~0').replaceAll('/','~1');
const params=(value)=>jcsBytes(value).toString('utf8');
const error=(stage,code,instance_pointer,invariant_or_schema_id,details={})=>({stage,code,instance_pointer,invariant_or_schema_id,params_jcs:params(details)});
const errorKey=(e)=>[e.stage,e.code,e.instance_pointer,e.invariant_or_schema_id,e.params_jcs];
const sorted=(errors)=>canonicalSet(errors,errorKey);
const nfcErrors=(value,pointer='',out=[])=>{
 if(typeof value==='string'){if(value.normalize('NFC')!==value)out.push(error('nfc','UNICODE_NOT_NFC',pointer,'IJSON-NFC-v1'));return out;}
 if(!value||typeof value!=='object')return out;
 if(Array.isArray(value)){value.forEach((item,index)=>nfcErrors(item,pointer+'/'+index,out));return out;}
 for(const [key,child] of Object.entries(value)){
  const childPointer=pointer+'/'+pointerToken(key);
  if(key.normalize('NFC')!==key)out.push(error('nfc','UNICODE_NOT_NFC',childPointer,'IJSON-NFC-v1'));
  nfcErrors(child,childPointer,out);
 }
 return out;
};
const ajvError=(schemaId,raw)=>{
 let code='INVARIANT_SCHEMA_DIAGNOSTIC',pointer=raw.instancePath||'',details=raw.params||{};
 if(raw.keyword==='required'){code='REQUIRED_MISSING';pointer+=(pointer?'':'')+'/'+pointerToken(raw.params.missingProperty);}
 else if(raw.keyword==='additionalProperties'){code='ADDITIONAL_PROPERTY';pointer+=(pointer?'':'')+'/'+pointerToken(raw.params.additionalProperty);}
 else if(raw.keyword==='type')code='TYPE_MISMATCH';
 else if(raw.keyword==='enum'||raw.keyword==='const')code='ENUM_MISMATCH';
 else if(raw.keyword==='format'){code=raw.params.format==='canonical-relative-path'?'PATH_INVALID':'FORMAT_INVALID';}
 else if(['pattern','minimum','maximum','exclusiveMinimum','minLength','minItems','maxItems','contentEncoding'].includes(raw.keyword))code='FORMAT_INVALID';
 else if(raw.keyword==='anyOf')code='TYPE_MISMATCH';
 return error('schema',code,pointer,schemaId,details);
};
const astOps=new Set(['literal','exists','eq','in','compare','all','any','not','builtin']);
const discriminatorErrors=(node,pointer='')=>{
 if(!node||typeof node!=='object'||Array.isArray(node))return[];
 if(!Object.hasOwn(node,'op'))return[error('schema','AST_OP_REQUIRED',pointer+'/op','AST-v1',{missingProperty:'op'})];
 if(!astOps.has(node.op))return[error('schema','AST_OP_UNKNOWN',pointer+'/op','AST-v1',{op:node.op})];
 const out=[];
 if((node.op==='all'||node.op==='any')&&Array.isArray(node.children))node.children.forEach((child,index)=>out.push(...discriminatorErrors(child,pointer+'/children/'+index)));
 if(node.op==='not'&&node.child)out.push(...discriminatorErrors(node.child,pointer+'/child'));
 return out;
};
const schemaValidate=(schemaId,value)=>{
 const validate=ajv.getSchema(ids[schemaId]);
 if(!validate)return[error('schema','INVARIANT_SCHEMA_ID_UNKNOWN','',schemaId,{schemaId})];
 const tagged=schemaId==='AstNode'?discriminatorErrors(value):[];
 if(tagged.length)return tagged;
 validate(value);
 const out=(validate.errors||[]).map((raw)=>ajvError(schemaId,raw));
 if(schemaId==='Rule'&&value&&typeof value==='object'){
  for(const field of ['applicability','exclusion','precondition','check'])if(value[field])out.push(...discriminatorErrors(value[field],'/'+field));
 }
 return out;
};
export const validateBySchema=(schemaId,value)=>{
 try{assertIJson(value);}catch(cause){const code=typeof cause.code==='string'&&cause.code.startsWith('IJSON_')?cause.code:'IJSON_NON_JSON_VALUE';return{ok:false,errors:[error('parse',code,'','IJSON-v1')]};}
 const nfc=sorted(nfcErrors(value));if(nfc.length)return{ok:false,errors:nfc};
 const errors=sorted(schemaValidate(schemaId,value));return errors.length?{ok:false,errors}:{ok:true,value};
};
const collectionErrors=(value,schemaErrors)=>{
 const out=[];
 const registries=[['scenario_profiles','scenario_profile_id'],['candidate_universe','solution_id'],['journeys','journey_id'],['evidence','evidence_id'],['studies','study_id'],['claims','claim_id'],['adapter_evidence','adapter_evidence_id']];
 for(const [field,key]of registries){
  const items=value[field];if(!Array.isArray(items))continue;const seen=new Map();
  items.forEach((item,index)=>{if(!item||typeof item!=='object'||typeof item[key]!=='string')return;const bytes=jcsBytes(item).toString('utf8');if(seen.has(item[key])&&seen.get(item[key]).bytes!==bytes)out.push(error('collections','DUPLICATE_ID_CONFLICT','/'+field+'/'+index+'/'+key,'InputCollectionRegistry-v1',{key:item[key]}));else if(!seen.has(item[key]))seen.set(item[key],{bytes,index});});
 }
 const missingScenario=schemaErrors.some((e)=>e.code==='REQUIRED_MISSING'&&e.instance_pointer==='/scenario_profile_id');
 if(missingScenario)out.push(error('collections','SUPPRESSED_BY_STAGE','/scenario_profile_id','ScenarioProfileRef-v1',{prerequisite_stage:'schema'}));
 else if(typeof value.scenario_profile_id==='string'&&Array.isArray(value.scenario_profiles)&&!value.scenario_profiles.some((row)=>row?.scenario_profile_id===value.scenario_profile_id))out.push(error('collections','REF_MISSING','/scenario_profile_id','ScenarioProfileRef-v1',{ref:value.scenario_profile_id}));
 if(Array.isArray(value.claims)&&Array.isArray(value.evidence)){
  const evidenceIds=new Set(value.evidence.map((row)=>row?.evidence_id));
  value.claims.forEach((row,index)=>Array.isArray(row?.evidence_refs)&&row.evidence_refs.forEach((refValue,refIndex)=>{if(!evidenceIds.has(refValue))out.push(error('collections','REF_MISSING','/claims/'+index+'/evidence_refs/'+refIndex,'EvidenceRef-v1',{ref:refValue}));}));
 }
 return out;
};
export const validateInput=(value)=>{
 const base=validateBySchema('EvaluationInputBundle',value);
 if(base.ok)return{ok:true,value:base.value};
 if(base.errors.some((e)=>e.stage==='parse'||e.stage==='nfc'))return base;
 const errors=sorted([...base.errors,...collectionErrors(value,base.errors)]);
 return{ok:false,errors};
};
