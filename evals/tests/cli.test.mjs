import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access,readFile} from 'node:fs/promises';
import {evaluate} from '../../evaluator/index.mjs';
import {jcsBytes} from '../../evaluator/canonical.mjs';
import {runCli,runCliWithDifferentRequestId} from '../helpers/process.mjs';

const CLI_URL=new URL('../../scripts/ux-evaluate.mjs',import.meta.url);
let bridgeModule;let entryFailure;
try{await access(CLI_URL);bridgeModule=await import('../../adapters/hulianui/bridge.mjs');}catch(error){entryFailure=error;}

if(entryFailure){
 test('TASK11_RED_TRANSPORT_ENTRYPOINTS',()=>assert.fail('TASK11_RED_TRANSPORT_ENTRYPOINTS:'+(entryFailure?.code??entryFailure?.name??'MISSING')));
}else{
 const MODES=['guide','scan','refactor','verify'];
 const json=async(url)=>JSON.parse(await readFile(url,'utf8'));
 const [toolResult,mappedEvidence,contract]=await Promise.all([
  json(new URL('../../adapters/hulianui/fixture.json',import.meta.url)),
  json(new URL('../golden/ADAPTER-HULIAN-ALERT-001.json',import.meta.url)),
  json(new URL('../../adapters/hulianui/contract.json',import.meta.url))
 ]);
 const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
 const expectedAdapterEvidence={adapter_evidence_id:contract.adapter_contract_id,adapter_contract_id:contract.adapter_contract_id,artifact_digest:sha(jcsBytes(mappedEvidence))};
 const fixture=async(mode)=>json(new URL('../parity/'+mode+'.json',import.meta.url));
 const baseOf=(bundle)=>{const base=structuredClone(bundle);delete base.adapter_evidence;return base;};
 const semanticBytes=(result)=>jcsBytes(result.semantic_projection);

 test('CLI accepts exactly guide scan refactor verify from a path or stdin and matches bridge, direct, and Skill-intended semantics',async()=>{
  for(const mode of MODES){
   const bundle=await fixture(mode);
   assert.equal(bundle.request_mode,mode);
   assert.deepEqual(bundle.adapter_evidence,[expectedAdapterEvidence]);
   const args=['--mode',mode,'--input','evals/parity/'+mode+'.json','--output','json'];
   const cli=await runCli(args);
   const skillIntended=await runCli(['--mode',mode,'--input','-','--output','json'],JSON.stringify(bundle));
   const tool=structuredClone(toolResult);const base=baseOf(bundle);const baseBefore=structuredClone(base);
   const bridge=await bridgeModule.evaluateHulianMcpResult(base,tool);
   const direct=await evaluate(structuredClone(bundle));
   assert.equal(cli.status,0,cli.stderr);assert.equal(skillIntended.status,0,skillIntended.stderr);
   assert.equal(cli.stderr,'');assert.equal(skillIntended.stderr,'');
   assert.deepEqual(JSON.parse(cli.stdout),cli.json);assert.deepEqual(JSON.parse(skillIntended.stdout),skillIntended.json);
   for(const result of [cli.json,skillIntended.json,bridge,direct])assert.ok(semanticBytes(result).equals(semanticBytes(direct)),mode);
   assert.equal(new Set([cli.json.semantic_digest,skillIntended.json.semantic_digest,bridge.semantic_digest,direct.semantic_digest]).size,1);
   assert.deepEqual(base,baseBefore);assert.deepEqual(tool,toolResult);
  }
 });

 test('unknown and multiple modes are invalid_input JSON with diagnostics only on stderr',async()=>{
  const rows=[
   [await runCli(['--mode','audit+verify']),'MODE_INVALID'],
   [await runCli(['--mode','scan','--mode','verify']),'MODE_MULTIPLE']
  ];
  for(const [row,code] of rows){assert.equal(row.status,2);assert.deepEqual(row.json,{run_status:'invalid_input',error_codes:[code]});assert.equal(row.stdout,JSON.stringify(row.json)+'\n');assert.match(row.stderr,new RegExp('^'+code+'\\n$'));}
 });

 test('unsupported output and incomplete arguments fail closed without reading or evaluating input',async()=>{
  const badOutput=await runCli(['--mode','scan','--input','evals/parity/scan.json','--output','text']);
  const missingInput=await runCli(['--mode','scan','--output','json']);
  assert.deepEqual([badOutput.json,missingInput.json],[{run_status:'invalid_input',error_codes:['OUTPUT_INVALID']},{run_status:'invalid_input',error_codes:['INPUT_REQUIRED']}]);
  assert.deepEqual([badOutput.status,missingInput.status],[2,2]);
 });

 test('bridge validates a closed full request base and forbids every preset adapter evidence channel',async()=>{
  const complete=baseOf(await fixture('scan'));
  const preset={...structuredClone(complete),adapter_evidence:[]};
  await assert.rejects(()=>bridgeModule.evaluateHulianMcpResult(preset,structuredClone(toolResult)),(error)=>error?.code==='INVALID_HULIAN_REQUEST'&&error.errors?.some((row)=>row.code==='ADDITIONAL_PROPERTY'&&row.instance_pointer==='/adapter_evidence'));
  const missing=structuredClone(complete);delete missing.claims;
  await assert.rejects(()=>bridgeModule.evaluateHulianMcpResult(missing,structuredClone(toolResult)),(error)=>error?.code==='INVALID_HULIAN_REQUEST'&&error.errors?.some((row)=>row.code==='REQUIRED_MISSING'&&row.instance_pointer==='/claims'));
  const unknownMode={...structuredClone(complete),request_mode:'audit'};
  await assert.rejects(()=>bridgeModule.evaluateHulianMcpResult(unknownMode,structuredClone(toolResult)),(error)=>error?.code==='INVALID_HULIAN_REQUEST'&&error.errors?.some((row)=>row.code==='ENUM_MISMATCH'&&row.instance_pointer==='/request_mode'));
 });

 test('transport request IDs stay in audit metadata and never alter semantic projection or digest',async()=>{
  const args=['--mode','scan','--input','evals/parity/scan.json','--output','json'];
  const a=await runCli(args);const b=await runCliWithDifferentRequestId(args);
  assert.equal(a.status,0);assert.equal(b.status,0);
  assert.equal(a.json.semantic_digest,b.json.semantic_digest);assert.ok(semanticBytes(a.json).equals(semanticBytes(b.json)));
  assert.deepEqual([a.json.audit_sidecar.transport.request_id,b.json.audit_sidecar.transport.request_id],['task11-request-a','task11-request-b']);
 });

 test('bridge canonicalizes the Hulian result into exactly one evaluator adapter-evidence member',async()=>{
  const bundle=await fixture('verify');const base=baseOf(bundle);
  const result=await bridgeModule.evaluateHulianMcpResult(base,structuredClone(toolResult));
  const direct=await evaluate(structuredClone(bundle));
  assert.ok(semanticBytes(result).equals(semanticBytes(direct)));
  assert.equal(result.audit_sidecar.transport.kind,'hulianui-mcp-bridge');
  assert.equal(result.audit_sidecar.transport.adapter_evidence_count,1);
  assert.equal(result.audit_sidecar.transport.adapter_artifact_digest,expectedAdapterEvidence.artifact_digest);
 });
}
