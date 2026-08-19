import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalize } from 'json-canonicalize';

const CONTRACT_DIGEST='f297ea75545ceefa627a4d977d528ec7e48be736f6e9015c07cda2444e0deb8c';
const MAX_RESULT_BYTES=1_048_576;
const MAX_COLLECTION_ITEMS=1_024;
const TRANSPORT_STATUSES=new Set(['ok','invalid_request','auth_error','timeout','server_error','cancelled']);
const CONTRACT_KEYS=['adapter_contract_id','component_identity','evidence_scope','npm_integrity','prohibited_claims','provider_namespace','repository_commit','request','server_package','server_version','source_artifact','tool_name'];
const RESULT_KEYS=['transport_status','isError','content','structuredContent'];
const DOCUMENT_KEYS=['source_artifact','components','missing','versionSkew','stale','fallbacks'];
const COMPONENT_KEYS=['name','slug','category','import','exports','props','events','slots'];
const MEMBER_KEYS=['owner','name','kind','required','description'];
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
const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));
const safeArray=()=>{
 const result=[];Object.setPrototypeOf(result,null);
 Object.defineProperties(result,{toJSON:{value:undefined,enumerable:false},forEach:{value:Array.prototype.forEach,enumerable:false},map:{value:Array.prototype.map,enumerable:false}});
 return result;
};
const snapshot=(value,active=new WeakSet())=>{
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='string'){if(!stringValid(value,{empty:true}))fail('IJSON_INVALID_STRING');return value;}
 if(typeof value==='number'){if(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))fail('IJSON_INVALID_NUMBER');return value;}
 if(typeof value!=='object')fail('IJSON_NON_JSON_VALUE');
 if(utilTypes.isProxy(value))fail('IJSON_NON_PLAIN_OBJECT');
 if(active.has(value))fail('IJSON_CYCLE');
 active.add(value);
 try{
  if(Array.isArray(value)){
   if(Object.getPrototypeOf(value)!==Array.prototype)fail('IJSON_NON_PLAIN_OBJECT');
   const keys=Reflect.ownKeys(value);
   for(const key of keys){if(key==='length')continue;if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length)fail('IJSON_NON_JSON_PROPERTY');}
   const result=safeArray();
   for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))fail('IJSON_NON_JSON_PROPERTY');result[index]=snapshot(descriptor.value,active);}
   return result;
  }
  if(Object.getPrototypeOf(value)!==Object.prototype)fail('IJSON_NON_PLAIN_OBJECT');
  const result=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
   if(typeof key!=='string'||!stringValid(key,{empty:true}))fail('IJSON_NON_JSON_PROPERTY');
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))fail('IJSON_NON_JSON_PROPERTY');
   result[key]=snapshot(descriptor.value,active);
  }
  return result;
 }finally{active.delete(value);}
};
const jcs=(value)=>Buffer.from(canonicalize(value),'utf8');
const contractSnapshot=(contract)=>{
 const value=snapshot(contract);
 if(!exactKeys(value,CONTRACT_KEYS))fail('ADAPTER_CONTRACT_INVALID');
 if(createHash('sha256').update(jcs(value)).digest('hex')!==CONTRACT_DIGEST)fail('ADAPTER_CONTRACT_INVALID');
 return value;
};
const stringArray=(value)=>Array.isArray(value)&&value.length<=MAX_COLLECTION_ITEMS&&value.every((item)=>stringValid(item));
const sourceValid=(value)=>exactKeys(value,SOURCE_KEYS)&&stringValid(value.path)&&stringValid(value.sha256)&&/^[0-9a-f]{64}$/.test(value.sha256)&&stringValid(value.version);
const memberValid=(value)=>exactKeys(value,MEMBER_KEYS)&&stringValid(value.owner)&&stringValid(value.name)&&stringValid(value.kind)&&typeof value.required==='boolean'&&(value.description===null||stringValid(value.description,{empty:true}));
const memberArray=(value)=>Array.isArray(value)&&value.length<=MAX_COLLECTION_ITEMS&&value.every(memberValid);
const componentValid=(value)=>exactKeys(value,COMPONENT_KEYS)&&stringValid(value.name)&&stringValid(value.slug)&&stringValid(value.category)&&stringValid(value.import,{empty:true})&&stringArray(value.exports)&&memberArray(value.props)&&memberArray(value.events)&&memberArray(value.slots);
const documentValid=(value)=>exactKeys(value,DOCUMENT_KEYS)&&sourceValid(value.source_artifact)&&Array.isArray(value.components)&&value.components.length<=MAX_COLLECTION_ITEMS&&value.components.every(componentValid)&&stringArray(value.missing)&&(value.versionSkew===null||stringValid(value.versionSkew))&&typeof value.stale==='boolean'&&stringArray(value.fallbacks);
const contentValid=(value)=>Array.isArray(value)&&value.length<=MAX_COLLECTION_ITEMS&&value.every((item)=>exactKeys(item,['type','text'])&&item.type==='text'&&stringValid(item.text,{empty:true}));
const resultSnapshot=(result)=>{
 const value=snapshot(result);
 if(jcs(value).length>MAX_RESULT_BYTES)fail('ADAPTER_RESULT_OVERSIZE');
 if(!exactKeys(value,RESULT_KEYS)||!TRANSPORT_STATUSES.has(value.transport_status)||typeof value.isError!=='boolean'||!contentValid(value.content)||(value.structuredContent!==null&&typeof value.structuredContent!=='object'))fail('ADAPTER_RESULT_INVALID');
 return value;
};
const sameSource=(left,right)=>SOURCE_KEYS.every((key)=>left[key]===right[key]);
const sourceMismatch=(document,contract)=>document!==null&&typeof document==='object'&&sourceValid(document.source_artifact)&&!sameSource(document.source_artifact,contract.source_artifact);
const identityMatches=(component,contract)=>['name','slug','category'].every((key)=>component[key]===contract.component_identity[key]);
const partial=(document)=>document.missing.length>0||document.versionSkew!==null||document.stale===true||document.fallbacks.length>0;
const notFound=(result)=>result.isError===true&&result.structuredContent===null&&result.content.length>0&&result.content[0].text.startsWith('没有名为');
const inspect=(result,contract)=>{
 let fixed;try{fixed=contractSnapshot(contract);}catch{return{status:'invalid_request'};}
 let value;try{value=resultSnapshot(result);}catch{return{status:'server_error'};}
 if(value.transport_status==='invalid_request')return{status:'invalid_request'};
 if(value.transport_status==='auth_error')return{status:'auth_error'};
 if(sourceMismatch(value.structuredContent,fixed))return{status:'incompatible_source'};
 if(value.transport_status==='timeout')return{status:'timeout'};
 if(value.transport_status==='server_error')return{status:'server_error'};
 if(value.transport_status==='cancelled')return{status:'cancelled'};
 const validDocument=documentValid(value.structuredContent)&&value.structuredContent.components.length===1&&identityMatches(value.structuredContent.components[0],fixed);
 if(validDocument&&value.isError===false&&partial(value.structuredContent))return{status:'partial',result:value,contract:fixed};
 if(notFound(value))return{status:'not_found'};
 if(validDocument&&value.isError===false&&!partial(value.structuredContent))return{status:'success',result:value,contract:fixed};
 return{status:'server_error'};
};
const canonicalSet=(items,keyOf)=>{
 const entries=items.map((item)=>({item,key:jcs(keyOf(item)),bytes:jcs(item)})).sort((left,right)=>Buffer.compare(left.key,right.key));
 const result=[];let previous=null;
 for(const entry of entries){
  if(previous&&entry.key.equals(previous.key)){if(entry.bytes.equals(previous.bytes))continue;fail('DUPLICATE_ID_CONFLICT');}
  result.push(entry.item);previous=entry;
 }
 return result;
};
const memberCopy=(item)=>({owner:item.owner,name:item.name,kind:item.kind,required:item.required,description:item.description});
const memberSet=(items)=>canonicalSet(items.map(memberCopy),(item)=>[item.owner,item.name,item.kind]);

export const classifyHulianResult=(result,contract)=>inspect(result,contract).status;

export const mapHulianComponentDoc=(result,contract)=>{
 const checked=inspect(result,contract);
 if(checked.status==='invalid_request')fail('ADAPTER_CONTRACT_INVALID');
 if(checked.status==='incompatible_source')fail('INCOMPATIBLE_SOURCE');
 if(checked.status!=='success'&&checked.status!=='partial')fail('ADAPTER_RESULT_NOT_MAPPABLE');
 const component=checked.result.structuredContent.components[0];
 return{
  component_identity:{category:checked.contract.component_identity.category,name:checked.contract.component_identity.name,slug:checked.contract.component_identity.slug},
  events:memberSet(component.events),
  exports:canonicalSet(component.exports.map((item)=>item),(item)=>item),
  import:component.import,
  props:memberSet(component.props),
  slots:memberSet(component.slots),
  source_artifact_identity:{path:checked.contract.source_artifact.path,sha256:checked.contract.source_artifact.sha256,version:checked.contract.source_artifact.version}
 };
};
