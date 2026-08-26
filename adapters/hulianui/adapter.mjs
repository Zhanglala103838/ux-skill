import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {types as utilTypes} from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {canonicalize} from 'json-canonicalize';

const CONTRACT_DIGEST='e51715715770fcf21273262582cc64207054949b1cbed18e70b8ca810df1b5a7';
const SCHEMA_PATH='schemas/adapters/hulian-component-doc-v1.schema.json';
const SCHEMA_ID='https://ux-skill.invalid/schemas/adapters/hulian-component-doc-v1.schema.json';
const SCHEMA_RAW_DIGEST='3b7e9140e2c10934ba203691082f00d431fb6d09833bec28e7523befd5f06383';
const MAX_SNAPSHOT_BYTES=1_048_576;
const MAX_DEPTH=64;
const MAX_NODES=8_192;
const MAX_STRING_BYTES=1_048_576;
const TRANSPORT_STATUSES=new Set(['ok','invalid_request','auth_error','timeout','server_error','cancelled']);
const CONTRACT_KEYS=['adapter_contract_id','component_identity','evidence_scope','npm_integrity','prohibited_claims','provider_namespace','repository_commit','request','server_package','server_version','source_artifact','tool_name'];
const RESULT_KEYS=['transport_status','isError','content','structuredContent'];
const SOURCE_KEYS=['path','sha256','version'];
const fail=(code)=>{const error=new TypeError(code);error.code=code;throw error;};

const isScalarString=(value)=>{
 for(let index=0;index<value.length;index+=1){
  const unit=value.charCodeAt(index);
  if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(index+1);if(!(next>=0xdc00&&next<=0xdfff))return false;index+=1;}
  else if(unit>=0xdc00&&unit<=0xdfff)return false;
 }
 return true;
};
const stringValid=(value,{empty=false}={})=>typeof value==='string'&&(empty||value.length>0)&&isScalarString(value)&&value.normalize('NFC')===value;
const jsonStringBytes=(value)=>{
 let bytes=2;
 for(let index=0;index<value.length;index+=1){
  const unit=value.charCodeAt(index);
  if(unit===0x22||unit===0x5c||unit===0x08||unit===0x09||unit===0x0a||unit===0x0c||unit===0x0d){bytes+=2;continue;}
  if(unit<=0x1f){bytes+=6;continue;}
  if(unit>=0xd800&&unit<=0xdbff){bytes+=4;index+=1;continue;}
  bytes+=unit<=0x7f?1:unit<=0x7ff?2:3;
 }
 return bytes;
};
const addBytes=(state,amount)=>{state.bytes+=amount;if(state.bytes>MAX_SNAPSHOT_BYTES)fail('IJSON_OVERSIZE');};
const inspectScalar=(value,state)=>{
 if(value===null){addBytes(state,4);return true;}
 if(typeof value==='boolean'){addBytes(state,value?4:5);return true;}
 if(typeof value==='string'){
  if(!stringValid(value,{empty:true}))fail('IJSON_INVALID_STRING');
  if(Buffer.byteLength(value,'utf8')>MAX_STRING_BYTES)fail('IJSON_STRING_OVERSIZE');
  addBytes(state,jsonStringBytes(value));return true;
 }
 if(typeof value==='number'){
  if(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))fail('IJSON_INVALID_NUMBER');
  addBytes(state,Buffer.byteLength(JSON.stringify(value),'utf8'));return true;
 }
 if(typeof value!=='object')fail('IJSON_NON_JSON_VALUE');
 return false;
};
const preflight=(root)=>{
 const state={bytes:0,nodes:0},seen=new WeakSet(),stack=[{value:root,depth:0}];
 while(stack.length){
  const frame=stack.pop(),value=frame.value;
  state.nodes+=1;if(state.nodes>MAX_NODES)fail('IJSON_NODE_LIMIT');
  if(frame.depth>MAX_DEPTH)fail('IJSON_DEPTH_LIMIT');
  if(inspectScalar(value,state))continue;
  if(utilTypes.isProxy(value))fail('IJSON_NON_PLAIN_OBJECT');
  if(seen.has(value))fail('IJSON_REPEATED_IDENTITY');
  seen.add(value);
  if(Array.isArray(value)){
   if(Object.getPrototypeOf(value)!==Array.prototype)fail('IJSON_NON_PLAIN_OBJECT');
   if(state.nodes+stack.length+value.length>MAX_NODES)fail('IJSON_NODE_LIMIT');
   const keys=Reflect.ownKeys(value);
   if(keys.length!==value.length+1)fail('IJSON_NON_JSON_PROPERTY');
   addBytes(state,2+(value.length>0?value.length-1:0));
   for(const key of keys){
    if(key==='length')continue;
    if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length)fail('IJSON_NON_JSON_PROPERTY');
   }
   for(let index=0;index<value.length;index+=1){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))fail('IJSON_NON_JSON_PROPERTY');
    stack.push({value:descriptor.value,depth:frame.depth+1});
   }
   continue;
  }
  if(Object.getPrototypeOf(value)!==Object.prototype)fail('IJSON_NON_PLAIN_OBJECT');
  const keys=Reflect.ownKeys(value);
  if(state.nodes+stack.length+keys.length>MAX_NODES)fail('IJSON_NODE_LIMIT');
  addBytes(state,2+(keys.length>0?keys.length-1:0));
  for(const key of keys){
   if(typeof key!=='string'||!stringValid(key,{empty:true}))fail('IJSON_NON_JSON_PROPERTY');
   if(Buffer.byteLength(key,'utf8')>MAX_STRING_BYTES)fail('IJSON_STRING_OVERSIZE');
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))fail('IJSON_NON_JSON_PROPERTY');
   addBytes(state,jsonStringBytes(key)+1);
   stack.push({value:descriptor.value,depth:frame.depth+1});
  }
 }
 return state;
};
const safeArray=()=>{const result=[];Object.setPrototypeOf(result,null);return result;};
const emptyCopy=(value)=>Array.isArray(value)?safeArray():Object.create(null);
const snapshot=(value)=>{
 preflight(value);
 if(value===null||typeof value!=='object')return value;
 const root=emptyCopy(value),stack=[{source:value,target:root}];
 while(stack.length){
  const frame=stack.pop(),source=frame.source,target=frame.target;
  if(Array.isArray(source)){
   for(let index=0;index<source.length;index+=1){
    const child=Object.getOwnPropertyDescriptor(source,String(index)).value;
    if(child!==null&&typeof child==='object'){const next=emptyCopy(child);target[index]=next;stack.push({source:child,target:next});}
    else target[index]=child;
   }
  }else{
   for(const key of Reflect.ownKeys(source)){
    const child=Object.getOwnPropertyDescriptor(source,key).value;
    if(child!==null&&typeof child==='object'){const next=emptyCopy(child);target[key]=next;stack.push({source:child,target:next});}
    else target[key]=child;
   }
  }
 }
 return root;
};
const trustedJson=(value)=>{
 if(Array.isArray(value)){const result=[];for(let index=0;index<value.length;index+=1)result.push(trustedJson(value[index]));return result;}
 if(value!==null&&typeof value==='object'){const result=Object.create(null);for(const key of Object.keys(value))result[key]=trustedJson(value[key]);return result;}
 return value;
};
const jcs=(value)=>Buffer.from(canonicalize(trustedJson(value)),'utf8');
const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));
const canonicalRelativePath=(value)=>{
 if(typeof value!=='string'||!isScalarString(value)||value.normalize('NFC')!==value)return false;
 const totalBytes=Buffer.byteLength(value,'utf8');
 if(totalBytes<1||totalBytes>100||/[\u0000-\u001f\u007f-\u009f]/u.test(value))return false;
 if(value.includes('\\')||/%2f|%5c/iu.test(value)||value.startsWith('/')||value.endsWith('/')||value.includes('//'))return false;
 const segments=value.split('/');
 for(let index=0;index<segments.length;index+=1){
  const segment=segments[index],segmentBytes=Buffer.byteLength(segment,'utf8');
  if(segmentBytes<1||segmentBytes>100||segment==='.'||segment==='..')return false;
 }
 return true;
};

const schemaRaw=readFileSync(new URL('../../'+SCHEMA_PATH,import.meta.url));
if(createHash('sha256').update(schemaRaw).digest('hex')!==SCHEMA_RAW_DIGEST)fail('ADAPTER_SCHEMA_DIGEST_INVALID');
let schema;
try{schema=JSON.parse(schemaRaw.toString('utf8'));}catch{fail('ADAPTER_SCHEMA_INVALID');}
if(schema.$id!==SCHEMA_ID)fail('ADAPTER_SCHEMA_INVALID');
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});
addFormats(ajv);
ajv.addFormat('canonical-relative-path',{type:'string',validate:canonicalRelativePath});
ajv.addSchema(schema);
const validateDocument=ajv.getSchema(SCHEMA_ID);
const validateSource=ajv.getSchema(SCHEMA_ID+'#/$defs/SourceArtifactIdentity');
if(typeof validateDocument!=='function'||typeof validateSource!=='function')fail('ADAPTER_SCHEMA_INVALID');

const contractSnapshot=(contract)=>{
 const value=snapshot(contract);
 if(!exactKeys(value,CONTRACT_KEYS))fail('ADAPTER_CONTRACT_INVALID');
 if(createHash('sha256').update(jcs(value)).digest('hex')!==CONTRACT_DIGEST)fail('ADAPTER_CONTRACT_INVALID');
 return value;
};
const contentValid=(value)=>{
 if(!Array.isArray(value))return false;
 for(let index=0;index<value.length;index+=1){
  const item=value[index];
  if(!exactKeys(item,['type','text'])||item.type!=='text'||!stringValid(item.text,{empty:true}))return false;
 }
 return true;
};
const resultSnapshot=(result)=>{
 const value=snapshot(result);
 if(!exactKeys(value,RESULT_KEYS)||!TRANSPORT_STATUSES.has(value.transport_status)||typeof value.isError!=='boolean'||!contentValid(value.content)||(value.structuredContent!==null&&typeof value.structuredContent!=='object'))fail('ADAPTER_RESULT_INVALID');
 return value;
};
const ARTIFACT_DIGEST_PREFIX='sha256:';
/**
 * 产物三元组从**这次响应**里取，不从 contract 抄。
 *
 * contract 里那份说的是「我们当初照着写的是哪一份」，响应里这份说的是「你这次实际拿到的是
 * 哪一份」—— 两者对得上才谈得上证据，对不上就是 incompatible_source。上一版把 source_artifact
 * 当成服务端会直接给的顶层字段，而真实的 @hulianui/mcp 从来没有这个字段，于是这条比对从未
 * 真正发生过：唯一被比对的是 contract 跟它自己。
 *
 * 现在的来源是 source.artifactDigests（@hulianui/mcp >= 0.11.0，hulianui/hulian#332）：
 * 键是产物名，值是该产物的字节摘要，可以用 shasum -a 256 独立复核。
 */
const sourceArtifactOf=(document)=>{
 if(document===null||typeof document!=='object')return null;
 const source=document.source;
 if(source===null||typeof source!=='object'||Array.isArray(source))return null;
 const digests=source.artifactDigests;
 if(digests===null||typeof digests!=='object'||Array.isArray(digests))return null;
 const paths=Object.keys(digests);
 // 一次调用读了多份产物就锚不到唯一一份，宁可判锚不住，也不要挑一个当代表。
 if(paths.length!==1)return null;
 const path=paths[0],prefixed=digests[path];
 if(typeof prefixed!=='string'||!prefixed.startsWith(ARTIFACT_DIGEST_PREFIX))return null;
 const candidate={path,sha256:prefixed.slice(ARTIFACT_DIGEST_PREFIX.length),version:document.version};
 return validateSource(candidate)===true?candidate:null;
};
const sameSource=(left,right)=>SOURCE_KEYS.every((key)=>left[key]===right[key]);
const identityMatches=(component,contract)=>['name','slug','category'].every((key)=>component[key]===contract.component_identity[key]);
/**
 * 四个「回答不完整」的信号，全部住在 source 下（顶层的 missing 除外）。
 * stale 在真实服务端是 {stale:true,reasons:[…]} 或 null，不是布尔 —— 上一版按布尔判，
 * 对着真实响应永远读到 undefined，于是本地产物陈旧这件事一次都不会被报成 partial。
 */
const partial=(document)=>document.missing?.length>0||document.source.versionSkew!==null||document.source.stale!==null||document.source.fallbacks.length>0;
const notFound=(result)=>result.isError===true&&result.structuredContent===null&&result.content.length>0&&result.content[0].text.startsWith('没有名为');
const inspected=(status,contract_valid,details={})=>({status,contract_valid,...details});
const inspect=(result,contract)=>{
 let fixed;try{fixed=contractSnapshot(contract);}catch{return inspected('invalid_request',false);}
 let value;try{value=resultSnapshot(result);}catch{return inspected('server_error',true);}
 if(value.transport_status==='invalid_request')return inspected('invalid_request',true);
 if(value.transport_status==='auth_error')return inspected('auth_error',true);
 const artifact=sourceArtifactOf(value.structuredContent);
 if(artifact!==null&&!sameSource(artifact,fixed.source_artifact))return inspected('incompatible_source',true);
 if(value.transport_status==='timeout')return inspected('timeout',true);
 if(value.transport_status==='server_error')return inspected('server_error',true);
 if(value.transport_status==='cancelled')return inspected('cancelled',true);
 const validDocument=validateDocument(value.structuredContent)===true&&value.structuredContent.components.length===1&&identityMatches(value.structuredContent.components[0],fixed);
 // 形状合法但服务端一个产物摘要都给不出（@hulianui/mcp < 0.11.0）：这不是坏响应，是**锚不住
 // 证据**。对外仍报 incompatible_source —— 评估器那套 TOOL_STATUSES 是封闭集合，为此新开一个
 // 状态要动评估器核心；而这两种情形对评估器的处方本来就相同：不许拿它当证据。真正的区别
 // （该重抓 vs 该升级 server）由 map 抛出的错误码说清楚，那才是给人看的通道。
 if(validDocument&&value.isError===false&&artifact===null)return inspected('incompatible_source',true,{unanchored:true});
 if(validDocument&&value.isError===false&&partial(value.structuredContent))return inspected('partial',true,{result:value,contract:fixed,artifact});
 if(notFound(value))return inspected('not_found',true);
 if(validDocument&&value.isError===false&&!partial(value.structuredContent))return inspected('success',true,{result:value,contract:fixed,artifact});
 return inspected('server_error',true);
};
const canonicalSet=(items,keyOf)=>{
 const entries=[];
 for(let index=0;index<items.length;index+=1){const item=items[index];entries.push({item,key:jcs(keyOf(item)),bytes:jcs(item)});}
 entries.sort((left,right)=>Buffer.compare(left.key,right.key));
 const result=[];let previous=null;
 for(const entry of entries){
  if(previous&&entry.key.equals(previous.key)){if(entry.bytes.equals(previous.bytes))continue;fail('DUPLICATE_ID_CONFLICT');}
  result.push(entry.item);previous=entry;
 }
 return result;
};
/**
 * 证据里的成员形状。三条：
 *   · name / type / description 是服务端保证有的，照抄。
 *   · owner / kind / required 是**可选**的 —— 真实目录里 3533 条 props 只有 358 条带 owner，
 *     slots 整族既没有 kind 也没有 required。上一版把它们写成必填，等于要求服务端给出它
 *     从来没给过的东西。缺就保持缺，不补默认值（补 false 会把「没说」讲成「不必填」）。
 *   · default / values / valueType / resolvedType 刻意不进证据：它们描述默认值与类型推导，
 *     不是接口契约本身，而 contract.evidence_scope 声明的范围里没有它们。
 */
const memberCopy=(item)=>{
 const copy={};
 if(Object.hasOwn(item,'owner'))copy.owner=item.owner;
 copy.name=item.name;
 if(Object.hasOwn(item,'kind'))copy.kind=item.kind;
 if(Object.hasOwn(item,'required'))copy.required=item.required;
 copy.type=item.type;
 copy.description=item.description;
 return copy;
};
// 去重键要能容忍 owner / kind 缺席：用 null 占位，null 与字符串在 JCS 下不会撞。
const memberSet=(items)=>{const copies=[];for(let index=0;index<items.length;index+=1)copies.push(memberCopy(items[index]));return canonicalSet(copies,(item)=>[item.owner??null,item.name,item.kind??null]);};
const stringSet=(items)=>{const copies=[];for(let index=0;index<items.length;index+=1)copies.push(items[index]);return canonicalSet(copies,(item)=>item);};

export const classifyHulianResult=(result,contract)=>inspect(result,contract).status;

export const mapHulianComponentDoc=(result,contract)=>{
 const checked=inspect(result,contract);
 if(checked.contract_valid===false)fail('ADAPTER_CONTRACT_INVALID');
 // 锚不住与锚错了分成两个码：前者的处方是升级 @hulianui/mcp 到 >= 0.11.0，后者是重新抓
 // contract 引脚。归成一个码只会让人对着「不兼容」去重抓，抓多少次都还是没有摘要。
 if(checked.unanchored===true)fail('SOURCE_UNANCHORED');
 if(checked.status==='incompatible_source')fail('INCOMPATIBLE_SOURCE');
 if(checked.status!=='success'&&checked.status!=='partial')fail('ADAPTER_RESULT_NOT_MAPPABLE');
 const component=checked.result.structuredContent.components[0];
 return{
  component_identity:{category:checked.contract.component_identity.category,name:checked.contract.component_identity.name,slug:checked.contract.component_identity.slug},
  events:memberSet(component.events),
  exports:stringSet(component.exports),
  import:component.import,
  props:memberSet(component.props),
  slots:memberSet(component.slots),
  // 取自响应而非 contract：上面已证明两者逐字相同，但证据该记「实际读到的是哪一份」。
  source_artifact_identity:{
   path:checked.artifact.path,
   schema_identity:{id:SCHEMA_ID,path:SCHEMA_PATH,raw_sha256:SCHEMA_RAW_DIGEST},
   sha256:checked.artifact.sha256,
   version:checked.artifact.version
  }
 };
};
