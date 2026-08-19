import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {init,parse} from 'es-module-lexer';
import {jcsBytes} from '../../evaluator/canonical.mjs';
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
 assert.deepEqual(specifiers,['json-canonicalize','node:crypto','node:util']);
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
