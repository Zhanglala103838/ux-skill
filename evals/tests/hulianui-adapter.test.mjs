import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {init,parse} from 'es-module-lexer';
import {assertCanonicalRelativePath,jcsBytes} from '../../evaluator/canonical.mjs';
import * as adapter from '../../adapters/hulianui/adapter.mjs';

const DIGEST='f297ea75545ceefa627a4d977d528ec7e48be736f6e9015c07cda2444e0deb8c';
const urls={contract:new URL('../../adapters/hulianui/contract.json',import.meta.url),fixture:new URL('../../adapters/hulianui/fixture.json',import.meta.url),red:new URL('../red/ADAPTER-HULIAN-ALERT-001.json',import.meta.url),golden:new URL('../golden/ADAPTER-HULIAN-ALERT-001.json',import.meta.url)};
const json=async(url)=>JSON.parse(await readFile(url,'utf8'));
const [contract,captured,golden]=await Promise.all([json(urls.contract),json(urls.red),json(urls.golden)]);
const clone=structuredClone;
const valid=()=>clone(captured);
const classify=(row,c=contract)=>adapter.classifyHulianResult(row,c);
const map=(row,c=contract)=>adapter.mapHulianComponentDoc(row,c);
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');

test('ADAPTER_TASK8_RED fixed contract has byte-identical raw and JCS digest',async()=>{
 const raw=await readFile(urls.contract);
 assert.equal(sha(raw),DIGEST);assert.equal(sha(jcsBytes(contract)),DIGEST);assert.ok(raw.equals(jcsBytes(contract)));
 assert.deepEqual(contract.prohibited_claims,['ux-outcome','wcag-conformance','user-success','complete-destructive-flow']);
});

test('adapter surface is two pure functions with no evaluator, MCP, or HulianUI import',async()=>{
 assert.deepEqual(Object.keys(adapter).sort(),['classifyHulianResult','mapHulianComponentDoc']);
 const source=await readFile(new URL('../../adapters/hulianui/adapter.mjs',import.meta.url),'utf8');await init;
 const specifiers=parse(source,'adapter.mjs')[0].map((row)=>row.n).filter((row)=>typeof row==='string').sort();
 assert.deepEqual(specifiers,['ajv-formats','ajv/dist/2020.js','json-canonicalize','node:crypto','node:fs','node:util']);
 assert.equal(specifiers.some((row)=>/evaluator|mcp|hulianui/i.test(row)),false);
});

test('classifier priority is total and mismatch dominates stale and partial',()=>{
 const rows=[];
 const invalid=valid();invalid.transport_status='invalid_request';invalid.structuredContent.source_artifact.sha256='0'.repeat(64);rows.push([invalid,'invalid_request']);
 const auth=valid();auth.transport_status='auth_error';auth.structuredContent.source_artifact.sha256='0'.repeat(64);rows.push([auth,'auth_error']);
 const mismatch=valid();mismatch.transport_status='timeout';mismatch.structuredContent.source_artifact.sha256='0'.repeat(64);mismatch.structuredContent.stale=true;mismatch.structuredContent.missing=['props'];rows.push([mismatch,'incompatible_source']);
 for(const status of ['timeout','server_error','cancelled']){const row=valid();row.transport_status=status;rows.push([row,status]);}
 const partial=valid();partial.structuredContent.stale=true;rows.push([partial,'partial']);
 rows.push([{transport_status:'ok',isError:true,content:[{type:'text',text:'没有名为 missing 的组件'}],structuredContent:null},'not_found']);
 rows.push([valid(),'success']);
 for(const [row,want] of rows)assert.equal(classify(row),want,want);
});

test('all four partial signals are exact and stale=false remains success',()=>{
 for(const mutate of [
  (row)=>{row.structuredContent.missing=['props'];},(row)=>{row.structuredContent.versionSkew='provider-newer';},
  (row)=>{row.structuredContent.stale=true;},(row)=>{row.structuredContent.fallbacks=['cached'];}
 ]){const row=valid();mutate(row);assert.equal(classify(row),'partial');}
 const complete=valid();complete.structuredContent.stale=false;assert.equal(classify(complete),'success');
});

test('captured result maps to exact seven-key golden evidence and no prohibited claim',async()=>{
 assert.deepEqual(await json(urls.fixture),captured);
 const evidence=map(captured);assert.deepEqual(evidence,golden);
 assert.deepEqual(Object.keys(evidence).sort(),['component_identity','events','exports','import','props','slots','source_artifact_identity']);
 const encoded=jcsBytes(evidence).toString('utf8');for(const claim of contract.prohibited_claims)assert.equal(encoded.includes(claim),false);
});

test('collections are UTF-8 JCS canonical sets; same-key conflicts fail closed',()=>{
 const row=valid(),component=row.structuredContent.components[0];
 component.exports=[...component.exports].reverse().concat(component.exports[0]);
 const p={owner:'AlertDialog',name:'\ue000',kind:'string',required:false,description:null};
 const a={owner:'AlertDialog',name:'\u{10000}',kind:'string',required:false,description:null};
 component.props=[a,...component.props.reverse(),p,clone(p)];
 const evidence=map(row);assert.deepEqual(evidence.exports,golden.exports);
 assert.deepEqual(evidence.props.filter((x)=>x.name==='\ue000'||x.name==='\u{10000}').map((x)=>x.name),['\ue000','\u{10000}']);
 const conflict=valid(),existing=conflict.structuredContent.components[0].props[0];
 conflict.structuredContent.components[0].props.push({...existing,description:'conflict'});
 assert.throws(()=>map(conflict),/DUPLICATE_ID_CONFLICT/);
 const cross=valid(),prop=cross.structuredContent.components[0].props[0];cross.structuredContent.components[0].slots.push(clone(prop));
 const kept=map(cross);assert.ok(kept.props.some((x)=>x.name===prop.name));assert.ok(kept.slots.some((x)=>x.name===prop.name));
});

test('all provider set shuffles are byte-equal and inputs are not mutated',()=>{
 const shuffled=valid(),component=shuffled.structuredContent.components[0];
 for(const field of ['exports','props','events','slots'])component[field]=[...component[field]].reverse();
 const before=clone(shuffled);assert.ok(jcsBytes(map(valid())).equals(jcsBytes(map(shuffled))));assert.deepEqual(shuffled,before);
});

test('contract, artifact, result schema, and component identity are closed and bound',()=>{
 const tampered=clone(contract);tampered.repository_commit='0'.repeat(40);assert.notEqual(sha(jcsBytes(tampered)),DIGEST);
 assert.equal(classify(valid(),tampered),'invalid_request');assert.throws(()=>map(valid(),tampered),/ADAPTER_CONTRACT_INVALID/);
 for(const field of ['path','sha256','version']){const row=valid();row.structuredContent.source_artifact[field]=field==='sha256'?'0'.repeat(64):'tampered';assert.equal(classify(row),'incompatible_source');assert.throws(()=>map(row),/INCOMPATIBLE_SOURCE/);}
 const extra=valid();extra.unexpected=true;assert.equal(classify(extra),'server_error');assert.throws(()=>map(extra),/ADAPTER_RESULT_NOT_MAPPABLE/);
 const nested=valid();nested.structuredContent.components[0].unexpected=true;assert.equal(classify(nested),'server_error');
 const many=valid();many.structuredContent.components.push(clone(many.structuredContent.components[0]));assert.equal(classify(many),'server_error');
 for(const field of ['name','slug','category']){const row=valid();row.structuredContent.components[0][field]='wrong';assert.equal(classify(row),'server_error');}
});

test('explicit required booleans survive; adapter never infers optionality',()=>{
 const evidence=map(valid()),members=[...evidence.props,...evidence.events,...evidence.slots];
 assert.ok(members.some((x)=>x.required===true));assert.ok(members.some((x)=>x.required===false));
 assert.equal(evidence.props.every((x)=>x.required===false),true);assert.equal(members.every((x)=>typeof x.required==='boolean'),true);
});

test('hostile JS values, Unicode, and oversize inputs are total fail-closed',()=>{
 const cycle=valid();cycle.content.push(cycle);
 const accessor=valid();let touched=false;Object.defineProperty(accessor,'structuredContent',{enumerable:true,get(){touched=true;return null;}});
 const proxy=new Proxy(valid(),{ownKeys(){throw new Error('proxy');}});
 const proto=Object.assign(Object.create({polluted:true}),valid());
 const nfd=valid();nfd.content[0].text='Cafe\u0301';const surrogate=valid();surrogate.content[0].text='\ud800';
 const oversize=valid();oversize.content[0].text='x'.repeat(1_048_577);
 for(const row of [cycle,accessor,proxy,proto,nfd,surrogate,oversize]){assert.doesNotThrow(()=>classify(row));assert.equal(classify(row),'server_error');assert.throws(()=>map(row),/ADAPTER_RESULT_NOT_MAPPABLE/);}
 assert.equal(touched,false);
});

test('no non-success status can materialize evidence',()=>{
 for(const status of ['invalid_request','auth_error','incompatible_source','timeout','server_error','cancelled','not_found']){
  const row=valid();if(status==='incompatible_source')row.structuredContent.source_artifact.version='wrong';
  else if(status==='not_found'){row.isError=true;row.structuredContent=null;row.content=[{type:'text',text:'没有名为 x 的组件'}];}
  else row.transport_status=status;
  assert.equal(classify(row),status);assert.throws(()=>map(row),/ADAPTER_RESULT_NOT_MAPPABLE|INCOMPATIBLE_SOURCE/);
 }
});

import {Worker} from 'node:worker_threads';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const TASK8_SCHEMA_ID='https://ux-skill.invalid/schemas/adapters/hulian-component-doc-v1.schema.json';
const TASK8_SCHEMA_DIGEST='86a4dc87401cbc8c5bb12ac181e3f9aa06fa02b87ffa662dc6093c1279ea46bb';
const task8SchemaUrl=new URL('../../schemas/adapters/hulian-component-doc-v1.schema.json',import.meta.url);
const canonicalRelativePath=(value)=>typeof value==='string'&&Buffer.byteLength(value,'utf8')>=1&&Buffer.byteLength(value,'utf8')<=100&&/^[\x20-\x7e]+$/u.test(value)&&!value.includes('\\')&&!/%2f|%5c/iu.test(value)&&!value.startsWith('/')&&!value.endsWith('/')&&!value.includes('//')&&value.split('/').every((part)=>part!=='.'&&part!=='..'&&Buffer.byteLength(part,'utf8')>=1&&Buffer.byteLength(part,'utf8')<=100);
const sharedDag=(depth)=>{let node={leaf:'x'};for(let index=0;index<depth;index+=1)node={left:node,right:node};return node;};
const chain=(depth)=>{let node='x';for(let index=0;index<depth;index+=1)node={next:node};return node;};
const wide=(size)=>{const value={};for(let index=0;index<size;index+=1)value['k'+String(index).padStart(5,'0')]=index;return value;};
const isolatedClassification=(result,contract)=>new Promise((resolve)=>{
 const workerSource=[
  "import {parentPort,workerData} from 'node:worker_threads';",
  "const subject=await import(workerData.adapterUrl);",
  "try{parentPort.postMessage({status:subject.classifyHulianResult(workerData.result,workerData.contract)});}catch(cause){parentPort.postMessage({error:String(cause?.code||cause)});}"
 ].join('\n');
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(workerSource)),{
  workerData:{adapterUrl:new URL('../../adapters/hulianui/adapter.mjs',import.meta.url).href,result,contract},
  resourceLimits:{maxOldGenerationSizeMb:32,stackSizeMb:2}
 });
 let settled=false;
 const finish=(value)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolve(value);};
 const timer=setTimeout(()=>finish({timeout:true}),750);
 worker.once('message',finish);
 worker.once('error',(cause)=>finish({worker_error:String(cause?.code||cause?.message||cause)}));
 worker.once('exit',(code)=>finish({worker_exit:code}));
});

test('TASK8_SCHEMA_TOTALITY_RED exact schema parity and bounded snapshots',async()=>{
 const issues=[];
 const record=(label,condition,detail='')=>{if(!condition)issues.push(label+(detail?':'+detail:''));};
 const schemaRaw=await readFile(task8SchemaUrl);
 const schema=JSON.parse(schemaRaw);
 record('schema-raw-digest',sha(schemaRaw)===TASK8_SCHEMA_DIGEST,sha(schemaRaw));
 record('schema-id',schema.$id===TASK8_SCHEMA_ID,String(schema.$id));
 let boundEvidence=null;try{boundEvidence=map(valid());}catch{}
 const schemaIdentity=boundEvidence?.source_artifact_identity?.schema_identity;
 record('schema-source-binding',schemaIdentity?.id===TASK8_SCHEMA_ID&&schemaIdentity?.path==='schemas/adapters/hulian-component-doc-v1.schema.json'&&schemaIdentity?.raw_sha256===TASK8_SCHEMA_DIGEST);

 const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});
 addFormats(ajv);
 ajv.addFormat('canonical-relative-path',{type:'string',validate:canonicalRelativePath});
 const validateDocument=ajv.compile(schema);
 const schemaAccepts=(document)=>validateDocument(clone(document))===true;
 const adapterAccepts=(row)=>{
  const status=classify(row);
  if(status!=='success'&&status!=='partial')return false;
  try{map(row);return true;}catch{return false;}
 };
 const validCase=(label,mutate,wantStatus)=>{
  const row=valid();mutate(row.structuredContent);
  record(label+'-schema',schemaAccepts(row.structuredContent),JSON.stringify(validateDocument.errors||[]));
  record(label+'-adapter',adapterAccepts(row),classify(row));
  if(wantStatus)record(label+'-status',classify(row)===wantStatus,classify(row));
 };
 validCase('schema-valid-empty-import',(doc)=>{doc.components[0].import='';},'success');
 validCase('schema-valid-empty-description',(doc)=>{doc.components[0].props[0].description='';},'success');
 validCase('schema-valid-null-description',(doc)=>{doc.components[0].props[0].description=null;},'success');
 validCase('schema-valid-long-missing',(doc)=>{doc.missing=Array.from({length:1025},(_,index)=>'m'+index);},'partial');
 validCase('schema-valid-long-fallbacks',(doc)=>{doc.fallbacks=Array.from({length:1025},(_,index)=>'f'+index);},'partial');
 for(const length of [1024,1025,2048]){
  const row=valid();
  const exports=Array.from({length},(_,index)=>'Export'+String(index).padStart(4,'0'));
  row.structuredContent.components[0].exports=exports;
  record('exports-'+length+'-within-total',Buffer.byteLength(JSON.stringify(row),'utf8')<1_048_576);
  record('exports-'+length+'-schema',schemaAccepts(row.structuredContent),JSON.stringify(validateDocument.errors||[]));
  record('exports-'+length+'-status',classify(row)==='success',classify(row));
  try{
   const forward=map(row),reversed=valid();
   reversed.structuredContent.components[0].exports=[...exports].reverse();
   record('exports-'+length+'-canonical',forward.exports.length===length&&jcsBytes(forward).equals(jcsBytes(map(reversed))));
  }catch(cause){record('exports-'+length+'-map',false,String(cause?.code||cause));}
 }

 const invalidCases=[];
 const addInvalid=(label,mutate)=>invalidCases.push([label,mutate]);
 for(const [label,path] of [['root','root'],['source','source'],['component','component'],['member','member']]){
  addInvalid('closed-'+label,(doc)=>{
   if(path==='root')doc.unexpected=true;
   else if(path==='source')doc.source_artifact.unexpected=true;
   else if(path==='component')doc.components[0].unexpected=true;
   else doc.components[0].props[0].unexpected=true;
  });
 }
 for(const field of ['source_artifact','components','missing','versionSkew','stale','fallbacks'])addInvalid('required-root-'+field,(doc)=>{delete doc[field];});
 for(const field of ['path','sha256','version'])addInvalid('required-source-'+field,(doc)=>{delete doc.source_artifact[field];});
 for(const field of ['name','slug','category','import','exports','props','events','slots'])addInvalid('required-component-'+field,(doc)=>{delete doc.components[0][field];});
 for(const field of ['owner','name','kind','required','description'])addInvalid('required-member-'+field,(doc)=>{delete doc.components[0].props[0][field];});
 const typeCases=[
  ['type-root-source',(doc)=>{doc.source_artifact=[];}],['type-root-components',(doc)=>{doc.components={};}],
  ['type-root-missing',(doc)=>{doc.missing={};}],['type-root-versionSkew',(doc)=>{doc.versionSkew=1;}],
  ['type-root-stale',(doc)=>{doc.stale='false';}],['type-root-fallbacks',(doc)=>{doc.fallbacks={};}],
  ['type-source-path',(doc)=>{doc.source_artifact.path=1;}],['type-source-sha',(doc)=>{doc.source_artifact.sha256=1;}],
  ['type-source-version',(doc)=>{doc.source_artifact.version=1;}],['type-component-name',(doc)=>{doc.components[0].name=1;}],
  ['type-component-slug',(doc)=>{doc.components[0].slug=1;}],['type-component-category',(doc)=>{doc.components[0].category=1;}],
  ['type-component-import',(doc)=>{doc.components[0].import=1;}],['type-component-exports',(doc)=>{doc.components[0].exports={};}],
  ['type-component-props',(doc)=>{doc.components[0].props={};}],['type-component-events',(doc)=>{doc.components[0].events={};}],
  ['type-component-slots',(doc)=>{doc.components[0].slots={};}],['type-array-component',(doc)=>{doc.components[0]=null;}],
  ['type-array-missing',(doc)=>{doc.missing=[1];}],['type-array-fallbacks',(doc)=>{doc.fallbacks=[1];}],
  ['type-array-export',(doc)=>{doc.components[0].exports=[1];}],['type-array-prop',(doc)=>{doc.components[0].props=[null];}],
  ['type-array-event',(doc)=>{doc.components[0].events=[null];}],['type-array-slot',(doc)=>{doc.components[0].slots=[null];}],
  ['type-member-owner',(doc)=>{doc.components[0].props[0].owner=1;}],['type-member-name',(doc)=>{doc.components[0].props[0].name=1;}],
  ['type-member-kind',(doc)=>{doc.components[0].props[0].kind=1;}],['type-member-required',(doc)=>{doc.components[0].props[0].required='false';}],
  ['type-member-description',(doc)=>{doc.components[0].props[0].description=1;}]
 ];
 for(const row of typeCases)addInvalid(...row);
 const formatCases=[
  ['format-source-path-empty',(doc)=>{doc.source_artifact.path='';}],['format-source-path-absolute',(doc)=>{doc.source_artifact.path='/apps/x';}],
  ['format-source-sha',(doc)=>{doc.source_artifact.sha256='A'.repeat(64);}],['min-source-version',(doc)=>{doc.source_artifact.version='';}],
  ['min-component-name',(doc)=>{doc.components[0].name='';}],['min-component-slug',(doc)=>{doc.components[0].slug='';}],
  ['min-component-category',(doc)=>{doc.components[0].category='';}],['min-export',(doc)=>{doc.components[0].exports=[''];}],
  ['min-missing',(doc)=>{doc.missing=[''];}],['min-versionSkew',(doc)=>{doc.versionSkew='';}],['min-fallback',(doc)=>{doc.fallbacks=[''];}],
  ['min-member-owner',(doc)=>{doc.components[0].props[0].owner='';}],['min-member-name',(doc)=>{doc.components[0].props[0].name='';}],
  ['min-member-kind',(doc)=>{doc.components[0].props[0].kind='';}]
 ];
 for(const row of formatCases)addInvalid(...row);
 for(const [label,mutate] of invalidCases){
  const row=valid();mutate(row.structuredContent);
  record(label+'-oracle',schemaAccepts(row.structuredContent)===false);
  record(label+'-adapter',adapterAccepts(row)===false,classify(row));
 }

 const sharedMember=valid(),member=sharedMember.structuredContent.components[0].props[0];
 sharedMember.structuredContent.components[0].props=[member,member];
 record('global-repeated-result-identity',classify(sharedMember)==='server_error',classify(sharedMember));
 const contractDag=clone(contract);contractDag.request=sharedDag(30);
 const resultDag=valid();resultDag.structuredContent=sharedDag(30);
 const [contractDagResult,resultDagResult]=await Promise.all([isolatedClassification(valid(),contractDag),isolatedClassification(resultDag,contract)]);
 record('contract-30-layer-shared-dag',contractDagResult.status==='invalid_request',JSON.stringify(contractDagResult));
 record('result-30-layer-shared-dag',resultDagResult.status==='server_error',JSON.stringify(resultDagResult));

 let contractAccessorTouched=false,resultAccessorTouched=false;
 const contractAccessor=clone(contract);Object.defineProperty(contractAccessor,'request',{enumerable:true,get(){contractAccessorTouched=true;return {};}});
 const resultAccessor=valid();Object.defineProperty(resultAccessor,'structuredContent',{enumerable:true,get(){resultAccessorTouched=true;return null;}});
 const contractCycle=clone(contract);contractCycle.request=contractCycle;
 const resultCycle=valid();resultCycle.structuredContent=resultCycle;
 const contractProxy=new Proxy(clone(contract),{ownKeys(){throw new Error('contract-proxy');}});
 const resultProxy=new Proxy(valid(),{ownKeys(){throw new Error('result-proxy');}});
 record('contract-accessor',classify(valid(),contractAccessor)==='invalid_request'&&!contractAccessorTouched);
 record('result-accessor',classify(resultAccessor)==='server_error'&&!resultAccessorTouched);
 record('contract-proxy',classify(valid(),contractProxy)==='invalid_request');
 record('result-proxy',classify(resultProxy)==='server_error');
 record('contract-cycle',classify(valid(),contractCycle)==='invalid_request');
 record('result-cycle',classify(resultCycle)==='server_error');

 for(const depth of [63,64,65]){
  const c=clone(contract);c.request=chain(depth);
  const r=valid();r.structuredContent=chain(depth);
  record('contract-depth-'+depth,classify(valid(),c)==='invalid_request');
  record('result-depth-'+depth,classify(r)==='server_error');
 }
 for(const size of [4095,4096,4097]){
  const c=clone(contract);c.request=wide(size);
  const r=valid();r.structuredContent=wide(size);
  record('contract-width-'+size,classify(valid(),c)==='invalid_request');
  record('result-width-'+size,classify(r)==='server_error');
 }
 for(const size of [1_048_575,1_048_576,1_048_577]){
  const c=clone(contract);c.server_version='x'.repeat(size);
  const r=valid();r.content[0].text='x'.repeat(size);
  record('contract-string-'+size,classify(valid(),c)==='invalid_request');
  record('result-string-'+size,classify(r)==='server_error');
 }
 assert.deepEqual(issues,[],'TASK8_SCHEMA_TOTALITY_RED\n'+issues.join('\n'));
});

const task8NodeCount=(root)=>{
 let count=0,stack=[root];
 while(stack.length){
  const value=stack.pop();count+=1;
  if(value===null||typeof value!=='object')continue;
  if(Array.isArray(value)){for(let index=0;index<value.length;index+=1)stack.push(value[index]);}
  else for(const child of Object.values(value))stack.push(child);
 }
 return count;
};
const canonicalPathOracle=(value)=>{try{assertCanonicalRelativePath(value);return true;}catch{return false;}};

test('TASK8_SCHEMA_DOMAIN_RED schema domain and canonical path parity',()=>{
 const issues=[];
 const record=(label,condition,detail='')=>{if(!condition)issues.push(label+(detail?':'+detail:''));};
 const template=valid(),originalExports=template.structuredContent.components[0].exports.length;
 const baseNodes=task8NodeCount(template)-originalExports;
 const maximumExports=8_192-baseNodes;
 record('maximum-exports-above-4097',maximumExports>4097,String(maximumExports));
 for(const length of [4096,4097,maximumExports]){
  const row=valid(),exports=Array.from({length},(_,index)=>'E'+String(index).padStart(4,'0'));
  row.structuredContent.components[0].exports=exports;
  record('exports-'+length+'-node-budget',task8NodeCount(row)<=8_192,String(task8NodeCount(row)));
  record('exports-'+length+'-byte-budget',Buffer.byteLength(JSON.stringify(row),'utf8')<1_048_576);
  record('exports-'+length+'-status',classify(row)==='success',classify(row));
  try{
   const evidence=map(row);
   record('exports-'+length+'-map',evidence.exports.length===length,String(evidence.exports.length));
   if(length!==maximumExports){
    const reversed=valid();reversed.structuredContent.components[0].exports=[...exports].reverse();
    record('exports-'+length+'-canonical',jcsBytes(evidence).equals(jcsBytes(map(reversed))));
   }
  }catch(cause){record('exports-'+length+'-map',false,String(cause?.code||cause));}
 }
 const corpus=[
  ['cjk','目录/组件.json',true],
  ['accent','café/é.json',true],
  ['emoji','emoji/😀.json',true],
  ['nfd','Cafe\u0301/file.json',false],
  ['c0','bad\u0001/file.json',false],
  ['c1','bad\u0085/file.json',false],
  ['backslash','bad\\file.json',false],
  ['absolute','/bad/file.json',false],
  ['dot','bad/./file.json',false],
  ['dotdot','bad/../file.json',false],
  ['double-slash','bad//file.json',false],
  ['trailing-slash','bad/file.json/',false],
  ['encoded-slash','bad%2Ffile.json',false],
  ['over-total-bytes','界'.repeat(34),false],
  ['over-segment-bytes','a/'+'界'.repeat(34),false]
 ];
 for(const [label,path,want] of corpus){
  const oracle=canonicalPathOracle(path);
  record('path-'+label+'-oracle',oracle===want,String(oracle));
  const row=valid();row.structuredContent.source_artifact.path=path;
  record('path-'+label+'-result',classify(row)===(want?'incompatible_source':'server_error'),classify(row));
  if(!want){
   const changedContract=clone(contract);changedContract.source_artifact.path=path;
   record('path-'+label+'-contract',classify(valid(),changedContract)==='invalid_request',classify(valid(),changedContract));
  }
 }
 assert.deepEqual(issues,[],'TASK8_SCHEMA_DOMAIN_RED\n'+issues.join('\n'));
});

test('TASK8_OPTIONAL_UNKNOWN_RED preserves omitted unknowns without inventing defaults',async()=>{
 const issues=[];
 const record=(label,condition,detail='')=>{if(!condition)issues.push(label+(detail?':'+detail:''));};
 const schema=JSON.parse(await readFile(task8SchemaUrl,'utf8'));
 const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});
 addFormats(ajv);
 ajv.addFormat('canonical-relative-path',{type:'string',validate:canonicalPathOracle});
 const validateOptionalDocument=ajv.compile(schema);
 const schemaAccepts=(document)=>validateOptionalDocument(clone(document))===true;
 const safeStatus=(row)=>{try{return classify(row);}catch(cause){return 'threw:'+String(cause?.code||cause?.message||cause);}};
 const safeMap=(row)=>{try{return {ok:true,value:map(row)};}catch(cause){return {ok:false,error:String(cause?.code||cause?.message||cause)};}};

 const rootOptional=valid();delete rootOptional.structuredContent.missing;delete rootOptional.structuredContent.stale;
 record('root-omitted-schema',schemaAccepts(rootOptional.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
 record('root-omitted-status',safeStatus(rootOptional)==='success',safeStatus(rootOptional));
 record('root-omitted-map',safeMap(rootOptional).ok,safeMap(rootOptional).error);

 for(const collection of ['props','events','slots']){
  const row=valid(),sourceMember=row.structuredContent.components[0][collection][0];
  const identity=[sourceMember.owner,sourceMember.name,sourceMember.kind];delete sourceMember.required;
  record(collection+'-unknown-schema',schemaAccepts(row.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
  record(collection+'-unknown-status',safeStatus(row)==='success',safeStatus(row));
  const mapped=safeMap(row);
  record(collection+'-unknown-map',mapped.ok,mapped.error);
  if(mapped.ok){
   const member=mapped.value[collection].find((item)=>item.owner===identity[0]&&item.name===identity[1]&&item.kind===identity[2]);
   record(collection+'-unknown-present',Boolean(member));
   record(collection+'-unknown-required-absent',Boolean(member)&&!Object.hasOwn(member,'required'),member?JSON.stringify(Reflect.ownKeys(member)):'missing');
  }
 }

 const missingPartial=valid();delete missingPartial.structuredContent.stale;missingPartial.structuredContent.missing=['props'];
 record('missing-nonempty-schema',schemaAccepts(missingPartial.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
 record('missing-nonempty-partial',safeStatus(missingPartial)==='partial',safeStatus(missingPartial));
 const stalePartial=valid();delete stalePartial.structuredContent.missing;stalePartial.structuredContent.stale=true;
 record('stale-true-schema',schemaAccepts(stalePartial.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
 record('stale-true-partial',safeStatus(stalePartial)==='partial',safeStatus(stalePartial));

 for(const [label,mutate] of [
  ['missing-wrong-type',(doc)=>{doc.missing='props';}],
  ['stale-wrong-type',(doc)=>{doc.stale='true';}]
 ]){
  const row=valid();mutate(row.structuredContent);
  record(label+'-schema',schemaAccepts(row.structuredContent)===false);
  record(label+'-adapter',safeStatus(row)==='server_error',safeStatus(row));
  record(label+'-not-mappable',safeMap(row).ok===false);
 }

 const mixed=valid();delete mixed.structuredContent.missing;delete mixed.structuredContent.stale;
 delete mixed.structuredContent.components[0].props[0].required;
 delete mixed.structuredContent.components[0].events[0].required;
 delete mixed.structuredContent.components[0].slots[1].required;
 record('mixed-schema',schemaAccepts(mixed.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
 const mappedMixed=safeMap(mixed);
 record('mixed-map',mappedMixed.ok,mappedMixed.error);
 if(mappedMixed.ok){
  const all=[...mappedMixed.value.props,...mappedMixed.value.events,...mappedMixed.value.slots];
  for(const name of ['open','onOpenChange','content']){
   const member=all.find((item)=>item.name===name);
   record('mixed-unknown-'+name,Boolean(member)&&!Object.hasOwn(member,'required'),member?JSON.stringify(Reflect.ownKeys(member)):'missing');
  }
  record('mixed-explicit-false',all.find((item)=>item.name==='defaultOpen')?.required===false);
  record('mixed-explicit-true',all.find((item)=>item.name==='trigger')?.required===true);
  const shuffled=clone(mixed),component=shuffled.structuredContent.components[0];
  for(const collection of ['props','events','slots'])component[collection]=[...component[collection]].reverse();
  const mappedShuffled=safeMap(shuffled);
  record('mixed-shuffle-map',mappedShuffled.ok,mappedShuffled.error);
  if(mappedShuffled.ok)record('mixed-shuffle-jcs',jcsBytes(mappedMixed.value).equals(jcsBytes(mappedShuffled.value)));
 }
 assert.deepEqual(issues,[],'TASK8_OPTIONAL_UNKNOWN_RED\n'+issues.join('\n'));
});

