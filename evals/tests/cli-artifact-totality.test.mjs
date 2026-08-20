import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmod,cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const RESPONSE_PATH='schemas/adapters/ux-evaluate-response-v1.schema.json';
const [responseSchema,semanticSchema,bundle]=await Promise.all([
 readFile(new URL('../../'+RESPONSE_PATH,import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../parity/scan.json',import.meta.url),'utf8').then(JSON.parse)
]);
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
const validateResponse=ajv.compile(responseSchema);
const spawnCli=(isolated)=>new Promise((resolve,reject)=>{
 const cli=join(isolated,'scripts/ux-evaluate.mjs');const args=['--mode','scan','--input','-','--output','json'];
 const child=spawn(process.execPath,[cli,...args],{cwd:isolated,env:{LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:'task11-artifact-totality'},stdio:['pipe','pipe','pipe']});
 const stdout=[];const stderr=[];child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));child.on('error',reject);
 child.on('close',(status,signal)=>{const stdoutText=Buffer.concat(stdout).toString('utf8'),stderrText=Buffer.concat(stderr).toString('utf8');let json=null;try{if(stdoutText.length>0)json=JSON.parse(stdoutText);}catch(error){reject(Object.assign(error,{stdout:stdoutText,stderr:stderrText,status,signal}));return;}resolve({status,signal,stdout:stdoutText,stderr:stderrText,json});});
 child.stdin.end(JSON.stringify(bundle));
});
const isolatedRun=async(mutate)=>{
 const isolated=await mkdtemp(join(ROOT,'.task11-artifact-totality-'));
 try{
  for(const name of ['scripts','evaluator','schemas','knowledge'])await cp(join(ROOT,name),join(isolated,name),{recursive:true});
  await cp(join(ROOT,'package.json'),join(isolated,'package.json'));
  await mutate(isolated);
  return await spawnCli(isolated);
 }finally{await rm(isolated,{recursive:true,force:true});}
};
const expectFailed=(row,code,label)=>{
 assert.equal(row.status,1,label+':exit');assert.equal(row.signal,null,label+':signal');
 assert.deepEqual(row.json,{run_status:'failed',error_codes:[code]},label+':json');
 assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');assert.equal(row.stderr,code+'\n',label+':stderr');
 assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));
 for(const leaked of ['ENOENT','EACCES','ERR_TASK11_UNAUTHORIZED','RESPONSE_SCHEMA_VALIDATION_FAILED']){assert.equal(row.stdout.includes(leaked),false,label+':stdout:'+leaked);assert.equal(row.stderr.includes(leaked),false,label+':stderr:'+leaked);}
};
const capture=async(failures,label,operation)=>{try{await operation();}catch(error){failures.push(label+': '+error.message);}};

test('CLI emits one closed total response for every evaluator artifact failure domain',async()=>{
 const failures=[];
 const cases=[
  ['missing rules','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'knowledge/rules.json'))],
  ['unreadable rules','ARTIFACT_VERIFICATION_FAILED',async(root)=>chmod(join(root,'knowledge/rules.json'),0o000)],
  ['missing knowledge manifest','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'knowledge/manifest.json'))],
  ['authorized artifact verification code','ARTIFACT_VERIFICATION_FAILED',async(root)=>{const path=join(root,'knowledge/rules.json');await writeFile(path,(await readFile(path,'utf8'))+' ');}],
  ['unauthorized evaluator code','EVALUATION_FAILED',async(root)=>{const path=join(root,'evaluator/index.mjs'),source=await readFile(path,'utf8');const needle=" const input=validateInput(bundle);if(!input.ok)inputFailure(input.errors);\n const artifacts=";assert.equal(source.split(needle).length,2,'evaluator injection anchor');const injected=" const input=validateInput(bundle);if(!input.ok)inputFailure(input.errors);\n const unexpected=new TypeError('task11 unexpected evaluator failure');unexpected.code='ERR_TASK11_UNAUTHORIZED';throw unexpected;\n const artifacts";await writeFile(path,source.replace(needle,injected));}]
 ];
 for(const [label,code,mutate] of cases){const row=await isolatedRun(mutate);await capture(failures,label,async()=>expectFailed(row,code,label));}
 const responseSchemaTamper=await isolatedRun(async(root)=>{const path=join(root,RESPONSE_PATH);await writeFile(path,(await readFile(path,'utf8'))+' ');});
 await capture(failures,'response schema trust root',async()=>{assert.equal(responseSchemaTamper.status,1);assert.equal(responseSchemaTamper.signal,null);assert.equal(responseSchemaTamper.stdout,'');assert.equal(responseSchemaTamper.stderr,'RESPONSE_SCHEMA_INVALID\n');assert.equal(responseSchemaTamper.json,null);});
 if(failures.length>0)assert.fail('TASK11_ARTIFACT_TOTAL_RESPONSE_RED\n'+failures.join('\n'));
});
