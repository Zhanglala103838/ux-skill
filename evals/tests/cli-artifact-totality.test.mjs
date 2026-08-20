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
const spawnCli=(isolated,options={})=>new Promise((resolve,reject)=>{
 const inputKind=options.inputKind??'stdin',inputPath=join(isolated,'runtime-input.json');
 const cli=join(isolated,'scripts/ux-evaluate.mjs'),args=options.args??['--mode','scan','--input',inputKind==='path'?inputPath:'-','--output','json'];
 const child=spawn(process.execPath,[cli,...args],{cwd:isolated,env:{LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:'task11-artifact-totality'},stdio:['pipe','pipe','pipe']});
 const stdout=[];const stderr=[];child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));child.on('error',reject);
 child.on('close',(status,signal)=>{const stdoutText=Buffer.concat(stdout).toString('utf8'),stderrText=Buffer.concat(stderr).toString('utf8');let json=null;try{if(stdoutText.length>0)json=JSON.parse(stdoutText);}catch(error){reject(Object.assign(error,{stdout:stdoutText,stderr:stderrText,status,signal}));return;}resolve({status,signal,stdout:stdoutText,stderr:stderrText,json});});
 child.stdin.end(options.stdinBytes??JSON.stringify(bundle));
});
const isolatedRun=async(mutate,options={})=>{
 const isolated=await mkdtemp(join(ROOT,'.task11-artifact-totality-'));
 try{
  for(const name of ['scripts','evaluator','schemas','knowledge'])await cp(join(ROOT,name),join(isolated,name),{recursive:true});
  await cp(join(ROOT,'package.json'),join(isolated,'package.json'));
  await writeFile(join(isolated,'runtime-input.json'),options.pathBytes??JSON.stringify(bundle));
  await mutate(isolated);
  return await spawnCli(isolated,options);
 }finally{await rm(isolated,{recursive:true,force:true});}
};
const expectFailed=(row,code,label)=>{
 assert.equal(row.status,1,label+':exit');assert.equal(row.signal,null,label+':signal');
 assert.deepEqual(row.json,{run_status:'failed',error_codes:[code]},label+':json');
 assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');assert.equal(row.stderr,code+'\n',label+':stderr');
 assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));
 for(const leaked of ['ENOENT','EACCES','SyntaxError','ERR_TASK11_UNAUTHORIZED','RESPONSE_SCHEMA_VALIDATION_FAILED',ROOT]){assert.equal(row.stdout.includes(leaked),false,label+':stdout:'+leaked);assert.equal(row.stderr.includes(leaked),false,label+':stderr:'+leaked);}
};
const expectInvalid=(row,code,label)=>{
 assert.equal(row.status,2,label+':exit');assert.equal(row.signal,null,label+':signal');
 assert.deepEqual(row.json,{run_status:'invalid_input',error_codes:[code]},label+':json');
 assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');assert.equal(row.stderr,code+'\n',label+':stderr');
 assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));
};
const expectResponseSchemaBoundary=(row,label)=>{
 assert.equal(row.status,1,label+':exit');assert.equal(row.signal,null,label+':signal');assert.equal(row.stdout,'',label+':stdout');assert.equal(row.stderr,'RESPONSE_SCHEMA_INVALID\n',label+':stderr');assert.equal(row.json,null,label+':json');
};
const capture=async(failures,label,operation)=>{try{await operation();}catch(error){failures.push(label+': '+error.message);}};

test('CLI emits one closed total response for every evaluator artifact failure domain',async()=>{
 const failures=[];
 const cases=[
  ['missing evaluation schema stdin','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'schemas/core/evaluation-input.schema.json')),{inputKind:'stdin'}],
  ['missing authority registry path','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'knowledge/registries.json')),{inputKind:'path'}],
  ['malformed evaluation schema path','ARTIFACT_VERIFICATION_FAILED',async(root)=>writeFile(join(root,'schemas/core/evaluation-input.schema.json'),'{'),{inputKind:'path'}],
  ['malformed authority registry stdin','ARTIFACT_VERIFICATION_FAILED',async(root)=>writeFile(join(root,'knowledge/registries.json'),'{'),{inputKind:'stdin'}],
  ['missing rules','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'knowledge/rules.json'))],
  ['unreadable rules','ARTIFACT_VERIFICATION_FAILED',async(root)=>chmod(join(root,'knowledge/rules.json'),0o000)],
  ['missing knowledge manifest','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'knowledge/manifest.json'))],
  ['authorized artifact verification code','ARTIFACT_VERIFICATION_FAILED',async(root)=>{const path=join(root,'knowledge/rules.json');await writeFile(path,(await readFile(path,'utf8'))+' ');}],
  ['unauthorized evaluator code','EVALUATION_FAILED',async(root)=>{const path=join(root,'evaluator/index.mjs'),source=await readFile(path,'utf8');const needle=" const input=validateInput(bundle);if(!input.ok)inputFailure(input.errors);\n const artifacts=";assert.equal(source.split(needle).length,2,'evaluator injection anchor');const injected=" const input=validateInput(bundle);if(!input.ok)inputFailure(input.errors);\n const unexpected=new TypeError('task11 unexpected evaluator failure');unexpected.code='ERR_TASK11_UNAUTHORIZED';throw unexpected;\n const artifacts=";await writeFile(path,source.replace(needle,injected));}]
 ];
 for(const [label,code,mutate,options] of cases){const row=await isolatedRun(mutate,options);await capture(failures,label,async()=>expectFailed(row,code,label));}
 const precedenceCases=[
  ['argument precedence','MODE_INVALID',async(root)=>rm(join(root,'schemas/core/evaluation-input.schema.json')),{args:['--mode','audit','--input','-','--output','json']}],
  ['input precedence','INPUT_JSON_INVALID',async(root)=>rm(join(root,'schemas/core/evaluation-input.schema.json')),{stdinBytes:'{'}]
 ];
 for(const [label,code,mutate,options] of precedenceCases){const row=await isolatedRun(mutate,options);await capture(failures,label,async()=>expectInvalid(row,code,label));}
 const responseSchemaCases=[
  ['response schema digest trust root',async(root)=>{const path=join(root,RESPONSE_PATH);await writeFile(path,(await readFile(path,'utf8'))+' ');}],
  ['response schema missing trust root',async(root)=>rm(join(root,RESPONSE_PATH))],
  ['response schema malformed trust root',async(root)=>writeFile(join(root,RESPONSE_PATH),'{')]
 ];
 for(const [label,mutate] of responseSchemaCases){const row=await isolatedRun(mutate);await capture(failures,label,async()=>expectResponseSchemaBoundary(row,label));}
 if(failures.length>0)assert.fail('TASK11_STARTUP_ARTIFACT_TOTAL_RESPONSE_RED\n'+failures.join('\n'));
});
