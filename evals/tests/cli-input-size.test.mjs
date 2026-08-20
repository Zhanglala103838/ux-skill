import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,open,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {runCli} from '../helpers/process.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const CLI=fileURLToPath(new URL('../../scripts/ux-evaluate.mjs',import.meta.url));
const RESPONSE_URL=new URL('../../schemas/adapters/ux-evaluate-response-v1.schema.json',import.meta.url);
const SEMANTIC_URL=new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url);
const FIXTURE_URL=new URL('../parity/scan.json',import.meta.url);
const MAX_BYTES=1_048_576;
const PRODUCER_BYTES=16*MAX_BYTES;
const PRODUCER_CHUNK_BYTES=64*1024;
const SPARSE_BYTES=3*1024*1024*1024;
const [responseSchema,semanticSchema,fixtureBytes]=await Promise.all([
 readFile(RESPONSE_URL,'utf8').then(JSON.parse),
 readFile(SEMANTIC_URL,'utf8').then(JSON.parse),
 readFile(FIXTURE_URL)
]);
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
const validateResponse=ajv.compile(responseSchema);
const args=(input)=>['--mode','scan','--input',input,'--output','json'];
const exactValidBytes=(size)=>{assert.ok(fixtureBytes.length<size,'fixture must leave controlled whitespace padding');return Buffer.concat([fixtureBytes,Buffer.alloc(size-fixtureBytes.length,0x20)]);};
const parseProcessResult=(status,signal,out,err)=>{const stdout=Buffer.concat(out).toString('utf8'),stderr=Buffer.concat(err).toString('utf8');return{status,signal,stdout,stderr,json:JSON.parse(stdout)};};
const expectCanonicalInvalid=(row,label)=>{
 assert.equal(row.status,2,label+':exit');assert.equal(row.signal,null,label+':signal');
 assert.deepEqual(row.json,{run_status:'invalid_input',error_codes:['INPUT_TOO_LARGE']},label+':json');
 assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');assert.equal(row.stderr,'INPUT_TOO_LARGE\n',label+':stderr');
 assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));
 for(const forbidden of ['audit_sidecar','assurance','inquiry','semantic_projection','semantic_digest'])assert.equal(Object.hasOwn(row.json,forbidden),false,label+':'+forbidden);
};
const runStreamingProducer=()=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[CLI,...args('-')],{cwd:ROOT,env:{LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:'task11-size-boundary'},stdio:['pipe','pipe','pipe']});
 const stdout=[];const stderr=[];let offeredBytes=0;let childClosed=false;let stdinError=null;
 child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));child.on('error',reject);
 child.stdin.on('error',(error)=>{stdinError=error.code??error.name;});
 child.on('close',(status,signal)=>{childClosed=true;try{resolve({...parseProcessResult(status,signal,stdout,stderr),offeredBytes,stdinError});}catch(error){reject(error);}});
 const nextChunk=()=>{
  const length=Math.min(PRODUCER_CHUNK_BYTES,PRODUCER_BYTES-offeredBytes);
  if(offeredBytes<fixtureBytes.length)return fixtureBytes.subarray(offeredBytes,Math.min(fixtureBytes.length,offeredBytes+length));
  return Buffer.alloc(length,0x20);
 };
 const pump=()=>{
  while(!childClosed&&offeredBytes<PRODUCER_BYTES){const chunk=nextChunk();offeredBytes+=chunk.length;if(!child.stdin.write(chunk)){child.stdin.once('drain',pump);return;}}
  if(!childClosed&&offeredBytes===PRODUCER_BYTES)child.stdin.end();
 };
 setImmediate(pump);
});
const capture=async(failures,label,operation)=>{try{await operation();}catch(error){failures.push(label+': '+error.message);}};

test('CLI enforces the 1 MiB transport boundary before unbounded input allocation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ux-skill-task11-size-'));const failures=[];
 try{
  const exactPath=join(directory,'exact.json'),plusOnePath=join(directory,'plus-one.json'),sparsePath=join(directory,'sparse.json');
  await Promise.all([writeFile(exactPath,exactValidBytes(MAX_BYTES)),writeFile(plusOnePath,exactValidBytes(MAX_BYTES+1))]);
  const sparse=await open(sparsePath,'w');try{await sparse.truncate(SPARSE_BYTES);}finally{await sparse.close();}
  const [base,exact,plusOne,multiGib]=await Promise.all([runCli(args('evals/parity/scan.json')),runCli(args(exactPath)),runCli(args(plusOnePath)),runCli(args(sparsePath))]);
  await capture(failures,'exact MAX path remains valid',async()=>{assert.equal(exact.status,0,exact.stderr);assert.equal(exact.stderr,'');assert.equal(validateResponse(exact.json),true,JSON.stringify(validateResponse.errors));assert.deepEqual(exact.json.semantic_projection,base.json.semantic_projection);assert.equal(exact.json.semantic_digest,base.json.semantic_digest);});
  await capture(failures,'MAX+1 valid path',async()=>expectCanonicalInvalid(plusOne,'MAX+1:path'));
  await capture(failures,'multi-GiB sparse path',async()=>expectCanonicalInvalid(multiGib,'sparse:path'));
  const streamed=await runStreamingProducer();
  await capture(failures,'stdin producer closes early',async()=>{assert.ok(streamed.offeredBytes<PRODUCER_BYTES,'consumer accepted the complete '+PRODUCER_BYTES+'-byte producer');assert.ok(streamed.offeredBytes<=MAX_BYTES+MAX_BYTES,'consumer accepted '+streamed.offeredBytes+' bytes before closing');});
  await capture(failures,'MAX+1 streaming stdin',async()=>expectCanonicalInvalid(streamed,'MAX+1:stdin'));
 }finally{await rm(directory,{recursive:true,force:true});}
 if(failures.length>0)assert.fail('TASK11_INPUT_MEMORY_BOUNDARY_RED\n'+failures.join('\n'));
});
