import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {digestJcs} from '../../evaluator/digests.mjs';
import {runCli} from '../helpers/process.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const RESPONSE_PATH='schemas/adapters/ux-evaluate-response-v1.schema.json';
const RESPONSE_URL=new URL('../../'+RESPONSE_PATH,import.meta.url);
let responseRaw;let schemaFailure;
try{responseRaw=await readFile(RESPONSE_URL);}catch(error){schemaFailure=error;}

if(schemaFailure){
 test('TASK11_RESPONSE_SCHEMA_RED',()=>assert.fail('TASK11_RESPONSE_SCHEMA_RED:'+(schemaFailure?.code??schemaFailure?.name??'MISSING')));
}else{
 const responseSchema=JSON.parse(responseRaw.toString('utf8'));
 const semanticSchema=JSON.parse(await readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8'));
 const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
 const validate=ajv.compile(responseSchema);
 const expectValid=(value,label)=>assert.equal(validate(value),true,label+':'+JSON.stringify(validate.errors));
 const expectInvalid=(value,label)=>assert.equal(validate(value),false,label);
 const exactEmission=(row,wantCode,wantStatus)=>{
  assert.equal(row.status,wantStatus);assert.equal(row.signal,null);assert.deepEqual(row.json,{run_status:wantStatus===1?'failed':'invalid_input',error_codes:[wantCode]});
  assert.equal(row.stdout,JSON.stringify(row.json)+'\n');assert.equal(row.stderr,wantCode+'\n');expectValid(row.json,wantCode);
 };
 const spawnCli=(script,args,stdin,cwd)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script,...args],{cwd,env:{LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:'task11-response-schema'},stdio:['pipe','pipe','pipe']});const out=[];const err=[];
  child.stdout.on('data',(chunk)=>out.push(chunk));child.stderr.on('data',(chunk)=>err.push(chunk));child.on('error',reject);child.on('close',(status,signal)=>{const stdout=Buffer.concat(out).toString('utf8'),stderr=Buffer.concat(err).toString('utf8');let json;try{json=JSON.parse(stdout);}catch(error){reject(Object.assign(error,{stdout,stderr,status,signal}));return;}resolve({status,signal,stdout,stderr,json});});child.stdin.end(stdin);
 });
 const failedArtifactRun=async(bundle)=>{
  const isolated=await mkdtemp(join(ROOT,'.task11-response-'));
  try{
   for(const path of ['scripts','evaluator','schemas','knowledge'])await cp(join(ROOT,path),join(isolated,path),{recursive:true});
   await cp(join(ROOT,'package.json'),join(isolated,'package.json'));
   const rules=join(isolated,'knowledge/rules.json');await writeFile(rules,(await readFile(rules,'utf8'))+' ');
   return await spawnCli(join(isolated,'scripts/ux-evaluate.mjs'),['--mode','scan','--input','-','--output','json'],JSON.stringify(bundle),isolated);
  }finally{await rm(isolated,{recursive:true,force:true});}
 };

 test('Task11 response schema is closed, three-branch, and raw-manifest authenticated',async()=>{
  assert.equal(responseSchema.$id,'https://ux-skill.invalid/schemas/adapters/ux-evaluate-response-v1.schema.json');assert.equal(responseSchema.oneOf.length,3);
  const manifest=JSON.parse(await readFile(new URL('../../schemas/manifest.json',import.meta.url),'utf8')),rows=manifest.filter((row)=>row.path===RESPONSE_PATH);
  assert.equal(rows.length,1);assert.equal(rows[0].file_digest,createHash('sha256').update(responseRaw).digest('hex'));
  const evaluatorManifest=JSON.parse(await readFile(new URL('../../evaluator/manifest.json',import.meta.url),'utf8'));
  assert.equal(evaluatorManifest.schema_manifest_digest,digestJcs('ux-skill:manifest:v1',manifest));
 });

 test('success stdout is one schema-valid closed EvaluationResult with no stderr and exit zero',async()=>{
  const row=await runCli(['--mode','scan','--input','evals/parity/scan.json','--output','json']);assert.equal(row.status,0);assert.equal(row.signal,null);assert.equal(row.stderr,'');assert.equal(row.stdout,JSON.stringify(row.json)+'\n');expectValid(row.json,'success');
  for(const mutate of [(value)=>{value.extra=true;},(value)=>{value.assurance.extra=true;},(value)=>{value.audit_sidecar.transport.extra=true;}]){const changed=structuredClone(row.json);mutate(changed);expectInvalid(changed,'closed success');}
 });

 test('every invalid-input CLI path emits one exact schema-valid JSON response, one stderr code, and exit two',async()=>{
  const scan=JSON.parse(await readFile(new URL('../parity/scan.json',import.meta.url),'utf8'));
  const invalidBundle=structuredClone(scan);delete invalidBundle.claims;
  const rows=[
   [await runCli(['--unknown','x']),'ARGUMENT_UNKNOWN'],
   [await runCli(['--mode']),'MODE_VALUE_REQUIRED'],
   [await runCli(['--input']),'INPUT_VALUE_REQUIRED'],
   [await runCli(['--output']),'OUTPUT_VALUE_REQUIRED'],
   [await runCli(['--mode','scan','--mode','verify']),'MODE_MULTIPLE'],
   [await runCli(['--mode','audit']),'MODE_INVALID'],
   [await runCli(['--mode','scan','--input','a','--input','b','--output','json']),'INPUT_MULTIPLE'],
   [await runCli(['--mode','scan','--input','a','--output','json','--output','json']),'OUTPUT_MULTIPLE'],
   [await runCli([]),'MODE_REQUIRED'],
   [await runCli(['--mode','scan','--input','a']),'OUTPUT_REQUIRED'],
   [await runCli(['--mode','scan','--input','a','--output','text']),'OUTPUT_INVALID'],
   [await runCli(['--mode','scan','--output','json']),'INPUT_REQUIRED'],
   [await runCli(['--mode','scan','--input','evals/parity/absent.json','--output','json']),'INPUT_UNREADABLE'],
   [await runCli(['--mode','scan','--input','-','--output','json'],'{'),'INPUT_JSON_INVALID'],
   [await runCli(['--mode','scan','--input','-','--output','json'],'[]'),'INPUT_JSON_INVALID'],
   [await runCli(['--mode','verify','--input','-','--output','json'],JSON.stringify(scan)),'MODE_BUNDLE_MISMATCH'],
   [await runCli(['--mode','scan','--input','-','--output','json'],JSON.stringify(invalidBundle)),'INVALID_EVALUATION_INPUT']
  ];
  for(const [row,code] of rows)exactEmission(row,code,2);
  const extra={...rows[0][0].json,extra:true};expectInvalid(extra,'closed invalid_input');
 });

 test('real evaluator artifact failure emits one exact schema-valid failed JSON response, one stderr code, and exit one',async()=>{
  const bundle=JSON.parse(await readFile(new URL('../parity/scan.json',import.meta.url),'utf8'));const row=await failedArtifactRun(bundle);exactEmission(row,'ARTIFACT_VERIFICATION_FAILED',1);
  expectInvalid({...row.json,extra:true},'closed failed');
 });
}
