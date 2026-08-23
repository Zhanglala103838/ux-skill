import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const MARKER='TASK14_RELEASE_PARITY_RED';
let transportsModule;
let releaseModule;
let entryFailure;
try{
 [transportsModule,releaseModule]=await Promise.all([
  import('../helpers/transports.mjs'),
  import('../../scripts/check-release.mjs')
 ]);
}catch(error){entryFailure=error;}

if(entryFailure){
 test(MARKER,()=>assert.fail(MARKER+':'+(entryFailure?.code??entryFailure?.name??'MISSING')));
}else{
 const MODES=Object.freeze(['guide','scan','refactor','verify']);
 const cache=new Map();
 const load=async(mode)=>{
  if(!cache.has(mode))cache.set(mode,transportsModule.evaluateThreeTransports('evals/parity/'+mode+'.json'));
  return cache.get(mode);
 };
 const clone=(value)=>structuredClone(value);

 test('guide scan refactor and verify have byte-equal Skill CLI MCP and direct-oracle semantics',async()=>{
  for(const mode of MODES){
   const transports=await load(mode);
   assert.deepEqual(Object.keys(transports),['skill','cli','mcp']);
   assert.deepEqual(releaseModule.checkParity(transports),{semantic_parity:1,adapter_evidence_parity:1},mode);
   assert.equal(transports.skill.audit_sidecar.transport.request_mode,mode);
   assert.equal(transports.cli.audit_sidecar.transport.request_mode,mode);
   assert.equal(transports.mcp.audit_sidecar.transport.request_mode,mode);
  }
 });

 test('parity excludes only the documented top-level audit sidecar and detects semantic or adapter tamper',async()=>{
  const transports=await load('scan');
  const auditOnly=clone(transports);
  auditOnly.skill.audit_sidecar={transport:{kind:'different-audit-only'}};
  assert.deepEqual(releaseModule.checkParity(auditOnly),{semantic_parity:1,adapter_evidence_parity:1});

  const semanticTamper=clone(transports);
  semanticTamper.mcp.semantic_projection.run_status='completed_clear';
  assert.deepEqual(releaseModule.checkParity(semanticTamper),{semantic_parity:0,adapter_evidence_parity:1});

  const adapterTamper=clone(transports);
  adapterTamper.mcp.semantic_projection.input_digest='0'.repeat(64);
  assert.deepEqual(releaseModule.checkParity(adapterTamper),{semantic_parity:0,adapter_evidence_parity:0});
 });

 test('parity helper accepts only the four module-relative fixtures and never mutates transport results',async()=>{
  for(const path of ['../evals/parity/scan.json','/tmp/scan.json','evals/parity/../scan.json','evals\\parity\\scan.json','evals/parity/scan.json%2fextra','evals/parity/audit.json']){
   await assert.rejects(()=>transportsModule.evaluateThreeTransports(path),(error)=>error?.code==='PARITY_PATH_INVALID',path);
  }
  const transports=await load('verify');
  const before=JSON.stringify(transports);
  releaseModule.checkParity(transports);
  assert.equal(JSON.stringify(transports),before);
 });

 test('checkParity rejects accessor and Proxy inputs without executing user code',()=>{
  let getterCalls=0;
  const accessor={cli:{},mcp:{}};
  Object.defineProperty(accessor,'skill',{enumerable:true,get(){getterCalls+=1;throw new Error('GETTER_EXECUTED');}});
  assert.throws(()=>releaseModule.checkParity(accessor),(error)=>error?.code==='PARITY_INPUT_INVALID');
  assert.equal(getterCalls,0);
  const proxy=new Proxy({skill:{},cli:{},mcp:{}},{ownKeys(){throw new Error('PROXY_EXECUTED');}});
  assert.throws(()=>releaseModule.checkParity(proxy),(error)=>error?.code==='PARITY_INPUT_INVALID');
 });

 test('committed fixture remains the complete bundle E consumed by the helper',async()=>{
  const source=await readFile(new URL('../parity/scan.json',import.meta.url),'utf8');
  const bundle=JSON.parse(source);
  assert.equal(bundle.request_mode,'scan');
  assert.equal(Array.isArray(bundle.adapter_evidence),true);
  assert.equal(bundle.adapter_evidence.length,1);
 });
}
