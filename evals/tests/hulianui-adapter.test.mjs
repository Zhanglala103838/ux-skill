import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {init,parse} from 'es-module-lexer';
import {assertCanonicalRelativePath,jcsBytes} from '../../evaluator/canonical.mjs';
import * as adapter from '../../adapters/hulianui/adapter.mjs';

const DIGEST='a14b5fec69cebe5802d6d34ff02fd8e4b571b3468832127b6a43c19989e0b4a9';
const urls={contract:new URL('../../adapters/hulianui/contract.json',import.meta.url),fixture:new URL('../../adapters/hulianui/fixture.json',import.meta.url),red:new URL('../red/ADAPTER-HULIAN-ALERT-001.json',import.meta.url),golden:new URL('../golden/ADAPTER-HULIAN-ALERT-001.json',import.meta.url),unanchored:new URL('../red/ADAPTER-HULIAN-UNANCHORED-001.json',import.meta.url)};
const json=async(url)=>JSON.parse(await readFile(url,'utf8'));
const [contract,captured,golden]=await Promise.all([json(urls.contract),json(urls.red),json(urls.golden)]);
const clone=structuredClone;
const valid=()=>clone(captured);
const classify=(row,c=contract)=>adapter.classifyHulianResult(row,c);
const map=(row,c=contract)=>adapter.mapHulianComponentDoc(row,c);
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
// 下面这组助手对着**真实** @hulianui/mcp 响应写：产物锚点在 source.artifactDigests，
// 三个「回答不完整」的信号住在 source 下（只有 missing 在顶层），stale 是对象不是布尔。
const ARTIFACT='llms-props.json';
const breakAnchor=(row)=>{row.structuredContent.source.artifactDigests[ARTIFACT]='sha256:'+'0'.repeat(64);};
const markStale=(row)=>{row.structuredContent.source.stale={stale:true,reasons:['src/alert-dialog/alert-dialog.md 比产物新']};};

test('ADAPTER_TASK8_RED fixed contract has byte-identical raw and JCS digest',async()=>{
 const raw=await readFile(urls.contract);
 assert.equal(sha(raw),DIGEST);assert.equal(sha(jcsBytes(contract)),DIGEST);assert.ok(raw.equals(jcsBytes(contract)));
 assert.deepEqual(contract.prohibited_claims,['ux-outcome','wcag-conformance','user-success','complete-destructive-flow']);
});

// 这一条是整个 adapter 唯一真正防住上一版那个缺陷的测试：喂的是**已发布的
// @hulianui/mcp@0.10.1 实际吐出来的字节**（npx 跑真 server 抓的），不是任何人手写的形状。
// 上一版所有测试都喂同一份手写 fixture，于是「adapter 跑不通真实输出」这件事全绿了几周。
test('a real published @hulianui/mcp@0.10.1 response is shaped as declared and fails closed for lack of an artifact digest',async()=>{
 const published=await json(urls.unanchored);
 // 形状必须过 —— 这是 0.10.1 真实的响应，schema 说它坏就是 schema 错了。
 assert.equal(published.structuredContent.source.artifactDigests,undefined,'0.10.1 本来就没有这个字段');
 assert.equal(published.structuredContent.components[0].slug,'alert-dialog');
 // 但锚不住证据：不许放行，且错误码要指向「升级 server」而不是「重抓 contract」。
 assert.equal(classify(published),'incompatible_source');
 assert.throws(()=>map(published),(error)=>error?.code==='SOURCE_UNANCHORED');
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
 const invalid=valid();invalid.transport_status='invalid_request';breakAnchor(invalid);rows.push([invalid,'invalid_request']);
 const auth=valid();auth.transport_status='auth_error';breakAnchor(auth);rows.push([auth,'auth_error']);
 const mismatch=valid();mismatch.transport_status='timeout';breakAnchor(mismatch);markStale(mismatch);mismatch.structuredContent.missing=['props'];rows.push([mismatch,'incompatible_source']);
 for(const status of ['timeout','server_error','cancelled']){const row=valid();row.transport_status=status;rows.push([row,status]);}
 const partial=valid();markStale(partial);rows.push([partial,'partial']);
 // 服务端根本给不出摘要（@hulianui/mcp < 0.11.0）：锚不住证据，与锚错了同样不许放行。
 const unanchored=valid();delete unanchored.structuredContent.source.artifactDigests;rows.push([unanchored,'incompatible_source']);
 rows.push([{transport_status:'ok',isError:true,content:[{type:'text',text:'没有名为 missing 的组件'}],structuredContent:null},'not_found']);
 rows.push([valid(),'success']);
 for(const [row,want] of rows)assert.equal(classify(row),want,want);
});

test('all four partial signals are exact and stale=false remains success',()=>{
 for(const mutate of [
  (row)=>{row.structuredContent.missing=['props'];},
  (row)=>{row.structuredContent.source.versionSkew={artifact:'0.56.0',source:'0.57.0'};},
  markStale,
  (row)=>{row.structuredContent.source.fallbacks=['registry.json'];}
 ]){const row=valid();mutate(row);assert.equal(classify(row),'partial');}
 // stale 的「不陈旧」在真实服务端是 null，不是 false —— 上一版按布尔写，对着真实响应
 // 永远读到 undefined，本地产物陈旧这件事一次都不会被报成 partial。
 const complete=valid();complete.structuredContent.source.stale=null;assert.equal(classify(complete),'success');
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
 const p={owner:'AlertDialog',name:'\ue000',kind:'string',required:false,type:'string',description:null};
 const a={owner:'AlertDialog',name:'\u{10000}',kind:'string',required:false,type:'string',description:null};
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
 // 锚错了：摘要或版本对不上 contract。
 const wrongSha=valid();breakAnchor(wrongSha);assert.equal(classify(wrongSha),'incompatible_source');assert.throws(()=>map(wrongSha),/INCOMPATIBLE_SOURCE/);
 const wrongVersion=valid();wrongVersion.structuredContent.version='0.1.0';assert.equal(classify(wrongVersion),'incompatible_source');assert.throws(()=>map(wrongVersion),/INCOMPATIBLE_SOURCE/);
 // 换成别的产物名：adapter 自己的产物比对先于 schema 校验发生，所以这里判「不兼容」——
 // 读到的确实是另一份产物。schema 把这一格钉死在 llms-props.json 上是第二道防线。
 const wrongArtifact=valid();const moved=wrongArtifact.structuredContent.source.artifactDigests[ARTIFACT];
 delete wrongArtifact.structuredContent.source.artifactDigests[ARTIFACT];wrongArtifact.structuredContent.source.artifactDigests['registry.json']=moved;
 assert.equal(classify(wrongArtifact),'incompatible_source');assert.throws(()=>map(wrongArtifact),/INCOMPATIBLE_SOURCE/);
 // 两份产物同时在场也锚不到唯一一份 —— 宁可判锚不住，也不要挑一个当代表。
 const twoArtifacts=valid();twoArtifacts.structuredContent.source.artifactDigests['registry.json']='sha256:'+'0'.repeat(64);
 assert.equal(classify(twoArtifacts),'server_error');assert.throws(()=>map(twoArtifacts),/ADAPTER_RESULT_NOT_MAPPABLE/);
 // 锚不住：0.10.1 那种没有 artifactDigests 的真实响应，对外同为 incompatible_source，
 // 但 map 抛的是另一个码 —— 处方不同（升级 server，不是重抓 contract）。
 const unanchored=valid();delete unanchored.structuredContent.source.artifactDigests;
 assert.equal(classify(unanchored),'incompatible_source');assert.throws(()=>map(unanchored),/SOURCE_UNANCHORED/);
 const extra=valid();extra.unexpected=true;assert.equal(classify(extra),'server_error');assert.throws(()=>map(extra),/ADAPTER_RESULT_NOT_MAPPABLE/);
 const nested=valid();nested.structuredContent.components[0].unexpected=true;assert.equal(classify(nested),'server_error');
 const many=valid();many.structuredContent.components.push(clone(many.structuredContent.components[0]));assert.equal(classify(many),'server_error');
 for(const field of ['name','slug','category']){const row=valid();row.structuredContent.components[0][field]='wrong';assert.equal(classify(row),'server_error');}
});

test('explicit required booleans survive; adapter never infers optionality',()=>{
 const evidence=map(valid()),members=[...evidence.props,...evidence.events,...evidence.slots];
 // 真实目录里 slots 整族既没有 required 也没有 kind —— 这不是数据缺陷，是这两个字段本来
 // 就只对 props/events 有定义。上一版断言「必须存在 required===true 的成员」，只有靠一份
 // 手写 fixture 才满足得了；真实的 AlertDialog 一个必填 prop 都没有。
 assert.ok(members.some((x)=>x.required===false),'显式写了 required:false 的成员要原样留住');
 assert.ok(evidence.slots.every((x)=>!Object.hasOwn(x,'required')),'源里没有 required 就不许补出一个');
 assert.ok(evidence.slots.every((x)=>!Object.hasOwn(x,'kind')),'源里没有 kind 就不许补出一个');
 // 补 false 会把「没说必填与否」讲成「不必填」—— 对消费方而言这是两件不同的事。
 for(const collection of ['props','events','slots']){
  const source=captured.structuredContent.components[0][collection];
  for(const member of evidence[collection]){
   const origin=source.find((row)=>row.owner===member.owner&&row.name===member.name&&(row.kind??undefined)===(member.kind??undefined));
   assert.ok(origin,collection+':'+member.name);
   assert.equal(Object.hasOwn(member,'required'),Object.hasOwn(origin,'required'),collection+':'+member.name);
  }
 }
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
  const row=valid();if(status==='incompatible_source')row.structuredContent.version='wrong';
  else if(status==='not_found'){row.isError=true;row.structuredContent=null;row.content=[{type:'text',text:'没有名为 x 的组件'}];}
  else row.transport_status=status;
  assert.equal(classify(row),status);assert.throws(()=>map(row),/ADAPTER_RESULT_NOT_MAPPABLE|INCOMPATIBLE_SOURCE/);
 }
});

import {Worker} from 'node:worker_threads';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const TASK8_SCHEMA_ID='https://ux-skill.invalid/schemas/adapters/hulian-component-doc-v1.schema.json';
const TASK8_SCHEMA_DIGEST='3b7e9140e2c10934ba203691082f00d431fb6d09833bec28e7523befd5f06383';
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
 // owner / kind / required 在真实目录里都是可选的（3533 条 props 只有 358 条带 owner，
 // slots 整族没有 kind 和 required）—— 缺了必须照样通过，不能当成坏响应。
 validCase('schema-valid-member-no-owner',(doc)=>{delete doc.components[0].props[0].owner;},'success');
 validCase('schema-valid-member-no-kind',(doc)=>{delete doc.components[0].props[0].kind;},'success');
 validCase('schema-valid-member-enum',(doc)=>{Object.assign(doc.components[0].props[0],{values:['solid','soft'],valueType:'string'});},'success');
 validCase('schema-valid-long-missing',(doc)=>{doc.missing=Array.from({length:1025},(_,index)=>'m'+index);},'partial');
 validCase('schema-valid-long-fallbacks',(doc)=>{doc.source.fallbacks=Array.from({length:1025},(_,index)=>'f'+index);},'partial');
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
 for(const [label,mutate] of [
  ['root',(doc)=>{doc.unexpected=true;}],
  ['source',(doc)=>{doc.source.unexpected=true;}],
  ['digests',(doc)=>{doc.source.artifactDigests.unexpected='sha256:'+'0'.repeat(64);}],
  ['component',(doc)=>{doc.components[0].unexpected=true;}],
  ['member',(doc)=>{doc.components[0].props[0].unexpected=true;}]
 ])addInvalid('closed-'+label,mutate);
 for(const field of ['version','components','source'])addInvalid('required-root-'+field,(doc)=>{delete doc[field];});
 for(const field of ['mode','origin','version','artifactVersion','sourceVersion','versionSkew','generatedAt','cacheTtlMs','fallbacks','stale'])addInvalid('required-source-'+field,(doc)=>{delete doc.source[field];});
 addInvalid('required-digest-artifact',(doc)=>{delete doc.source.artifactDigests[ARTIFACT];});
 for(const field of ['name','slug','category','import','exports','doc','props','events','slots'])addInvalid('required-component-'+field,(doc)=>{delete doc.components[0][field];});
 for(const field of ['name','type','description'])addInvalid('required-member-'+field,(doc)=>{delete doc.components[0].props[0][field];});
 const typeCases=[
  ['type-root-version',(doc)=>{doc.version=1;}],['type-root-components',(doc)=>{doc.components={};}],
  ['type-root-missing',(doc)=>{doc.missing={};}],['type-root-source',(doc)=>{doc.source=[];}],
  ['type-root-versionSkew',(doc)=>{doc.versionSkew=1;}],
  ['type-source-mode',(doc)=>{doc.source.mode='hybrid';}],['type-source-origin',(doc)=>{doc.source.origin=1;}],
  ['type-source-ttl',(doc)=>{doc.source.cacheTtlMs='300000';}],['type-source-stale',(doc)=>{doc.source.stale=true;}],
  ['type-source-stale-reasons',(doc)=>{doc.source.stale={stale:true,reasons:[]};}],
  ['type-source-skew',(doc)=>{doc.source.versionSkew='provider-newer';}],
  ['type-source-fallbacks',(doc)=>{doc.source.fallbacks={};}],
  ['type-digest-value',(doc)=>{doc.source.artifactDigests[ARTIFACT]='0'.repeat(64);}],
  ['type-digest-uppercase',(doc)=>{doc.source.artifactDigests[ARTIFACT]='sha256:'+'A'.repeat(64);}],
  ['type-member-type',(doc)=>{doc.components[0].props[0].type=1;}],
  ['type-member-default',(doc)=>{doc.components[0].props[0].default=1;}],
  ['type-member-values',(doc)=>{doc.components[0].props[0].values='solid';}],
  ['type-component-doc',(doc)=>{doc.components[0].doc=1;}],
  ['type-component-name',(doc)=>{doc.components[0].name=1;}],
  ['type-component-slug',(doc)=>{doc.components[0].slug=1;}],['type-component-category',(doc)=>{doc.components[0].category=1;}],
  ['type-component-import',(doc)=>{doc.components[0].import=1;}],['type-component-exports',(doc)=>{doc.components[0].exports={};}],
  ['type-component-props',(doc)=>{doc.components[0].props={};}],['type-component-events',(doc)=>{doc.components[0].events={};}],
  ['type-component-slots',(doc)=>{doc.components[0].slots={};}],['type-array-component',(doc)=>{doc.components[0]=null;}],
  ['type-array-missing',(doc)=>{doc.missing=[1];}],['type-array-fallbacks',(doc)=>{doc.source.fallbacks=[1];}],
  ['type-array-export',(doc)=>{doc.components[0].exports=[1];}],['type-array-prop',(doc)=>{doc.components[0].props=[null];}],
  ['type-array-event',(doc)=>{doc.components[0].events=[null];}],['type-array-slot',(doc)=>{doc.components[0].slots=[null];}],
  ['type-member-owner',(doc)=>{doc.components[0].props[0].owner=1;}],['type-member-name',(doc)=>{doc.components[0].props[0].name=1;}],
  ['type-member-kind',(doc)=>{doc.components[0].props[0].kind=1;}],['type-member-required',(doc)=>{doc.components[0].props[0].required='false';}],
  ['type-member-description',(doc)=>{doc.components[0].props[0].description=1;}]
 ];
 for(const row of typeCases)addInvalid(...row);
 const formatCases=[
  ['min-root-version',(doc)=>{doc.version='';}],
  ['min-source-origin',(doc)=>{doc.source.origin='';}],['min-source-artifactVersion',(doc)=>{doc.source.artifactVersion='';}],
  ['min-component-name',(doc)=>{doc.components[0].name='';}],['min-component-slug',(doc)=>{doc.components[0].slug='';}],
  ['min-component-category',(doc)=>{doc.components[0].category='';}],['min-component-doc',(doc)=>{doc.components[0].doc='';}],
  ['min-export',(doc)=>{doc.components[0].exports=[''];}],
  ['min-missing',(doc)=>{doc.missing=[''];}],['min-fallback',(doc)=>{doc.source.fallbacks=[''];}],
  ['min-skew-artifact',(doc)=>{doc.source.versionSkew={artifact:'',source:'0.57.0'};}],
  ['min-member-owner',(doc)=>{doc.components[0].props[0].owner='';}],['min-member-name',(doc)=>{doc.components[0].props[0].name='';}],
  ['min-member-kind',(doc)=>{doc.components[0].props[0].kind='';}],['min-member-type',(doc)=>{doc.components[0].props[0].type='';}]
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
  // 响应侧：把产物名换成语料里的任何一个，都不再是 contract 锚的那一份。两种落法：
  //   · 合法相对路径 → 能锚出一个三元组，只是和 contract 对不上 → incompatible_source
  //   · 非法路径     → 连 SourceArtifactIdentity 都过不了，schema 那一格也钉死在
  //                    llms-props.json 上，两道一起判坏响应 → server_error
  const row=valid();const moved=row.structuredContent.source.artifactDigests[ARTIFACT];
  delete row.structuredContent.source.artifactDigests[ARTIFACT];row.structuredContent.source.artifactDigests[path]=moved;
  record('path-'+label+'-result',classify(row)===(want?'incompatible_source':'server_error'),classify(row));
  record('path-'+label+'-not-mappable',(()=>{try{map(row);return false;}catch(cause){return /INCOMPATIBLE_SOURCE|ADAPTER_RESULT_NOT_MAPPABLE/.test(String(cause?.code));}})());
  // contract 侧：动 contract 里任何一个字节都会让 JCS 摘要对不上，一律 invalid_request。
  const changedContract=clone(contract);changedContract.source_artifact.path=path;
  record('path-'+label+'-contract',classify(valid(),changedContract)==='invalid_request',classify(valid(),changedContract));
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

 const rootOptional=valid();delete rootOptional.structuredContent.missing;rootOptional.structuredContent.source.stale=null;
 record('root-omitted-schema',schemaAccepts(rootOptional.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
 record('root-omitted-status',safeStatus(rootOptional)==='success',safeStatus(rootOptional));
 record('root-omitted-map',safeMap(rootOptional).ok,safeMap(rootOptional).error);

 for(const collection of ['props','events','slots']){
  const row=valid(),sourceMember=row.structuredContent.components[0][collection][0];
  const identity=[sourceMember.owner,sourceMember.name,sourceMember.kind];delete sourceMember.required;delete sourceMember.default;
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

 const missingPartial=valid();missingPartial.structuredContent.source.stale=null;missingPartial.structuredContent.missing=['props'];
 record('missing-nonempty-schema',schemaAccepts(missingPartial.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
 record('missing-nonempty-partial',safeStatus(missingPartial)==='partial',safeStatus(missingPartial));
 const stalePartial=valid();delete stalePartial.structuredContent.missing;stalePartial.structuredContent.source.stale={stale:true,reasons:['src/alert-dialog/alert-dialog.md 比产物新']};
 record('stale-object-schema',schemaAccepts(stalePartial.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
 record('stale-object-partial',safeStatus(stalePartial)==='partial',safeStatus(stalePartial));

 for(const [label,mutate] of [
  ['missing-wrong-type',(doc)=>{doc.missing='props';}],
  ['stale-wrong-type',(doc)=>{doc.source.stale='true';}],
  ['stale-legacy-boolean',(doc)=>{doc.source.stale=false;}]
 ]){
  const row=valid();mutate(row.structuredContent);
  record(label+'-schema',schemaAccepts(row.structuredContent)===false);
  record(label+'-adapter',safeStatus(row)==='server_error',safeStatus(row));
  record(label+'-not-mappable',safeMap(row).ok===false);
 }

 const mixed=valid();delete mixed.structuredContent.missing;mixed.structuredContent.source.stale=null;
 delete mixed.structuredContent.components[0].props[0].required;
 delete mixed.structuredContent.components[0].events[0].required;
 record('mixed-schema',schemaAccepts(mixed.structuredContent),JSON.stringify(validateOptionalDocument.errors||[]));
 const mappedMixed=safeMap(mixed);
 record('mixed-map',mappedMixed.ok,mappedMixed.error);
 if(mappedMixed.ok){
  const all=[...mappedMixed.value.props,...mappedMixed.value.events,...mappedMixed.value.slots];
  // 删掉的那两处（props 里的 className、events 里的 onOpenChange）映射后必须**没有**
  // required 这个键 —— 不许补一个 false 出来：「没说必填与否」和「不必填」是两件事。
  const droppedProp=mappedMixed.value.props.find((item)=>item.name==='className');
  const droppedEvent=mappedMixed.value.events.find((item)=>item.name==='onOpenChange');
  record('mixed-unknown-className',Boolean(droppedProp)&&!Object.hasOwn(droppedProp,'required'),droppedProp?JSON.stringify(Reflect.ownKeys(droppedProp)):'missing');
  record('mixed-unknown-onOpenChange-event',Boolean(droppedEvent)&&!Object.hasOwn(droppedEvent,'required'),droppedEvent?JSON.stringify(Reflect.ownKeys(droppedEvent)):'missing');
  // 没动的那一份照旧：合并进 props 数组的那条 onOpenChange（kind:"event"）仍带显式 false。
  // 服务端刻意把 events 同时放进 props 与 events 两个数组（hulianui/hulian#298），两份是
  // 独立的成员，删掉其中一份的 required 不该波及另一份。
  const keptEvent=mappedMixed.value.props.find((item)=>item.name==='onOpenChange'&&item.kind==='event');
  record('mixed-explicit-false',keptEvent?.required===false,JSON.stringify(keptEvent));
  // slots 本来就没有 required 与 kind，映射后同样不该冒出来。
  record('mixed-slots-required-absent',mappedMixed.value.slots.every((item)=>!Object.hasOwn(item,'required')));
  record('mixed-slots-kind-absent',mappedMixed.value.slots.every((item)=>!Object.hasOwn(item,'kind')));
  const shuffled=clone(mixed),component=shuffled.structuredContent.components[0];
  for(const collection of ['props','events','slots'])component[collection]=[...component[collection]].reverse();
  const mappedShuffled=safeMap(shuffled);
  record('mixed-shuffle-map',mappedShuffled.ok,mappedShuffled.error);
  if(mappedShuffled.ok)record('mixed-shuffle-jcs',jcsBytes(mappedMixed.value).equals(jcsBytes(mappedShuffled.value)));
 }
 assert.deepEqual(issues,[],'TASK8_OPTIONAL_UNKNOWN_RED\n'+issues.join('\n'));
});
