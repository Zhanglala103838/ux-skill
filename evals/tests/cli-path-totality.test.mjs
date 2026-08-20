import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {runCli} from '../helpers/process.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const CLI=fileURLToPath(new URL('../../scripts/ux-evaluate.mjs',import.meta.url));
const RACE_PRELOAD=fileURLToPath(new URL('../helpers/task11-path-race.cjs',import.meta.url));
const RESPONSE_URL=new URL('../../schemas/adapters/ux-evaluate-response-v1.schema.json',import.meta.url);
const SEMANTIC_URL=new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url);
const FIXTURE_URL=new URL('../parity/scan.json',import.meta.url);
const MAX_BYTES=1_048_576;
const [responseSchema,semanticSchema,fixtureBytes]=await Promise.all([
 readFile(RESPONSE_URL,'utf8').then(JSON.parse),
 readFile(SEMANTIC_URL,'utf8').then(JSON.parse),
 readFile(FIXTURE_URL)
]);
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
const validateResponse=ajv.compile(responseSchema);
const args=(input)=>['--mode','scan','--input',input,'--output','json'];
const exactValidBytes=()=>{assert.ok(fixtureBytes.length<MAX_BYTES);return Buffer.concat([fixtureBytes,Buffer.alloc(MAX_BYTES-fixtureBytes.length,0x20)]);};
const expectUnreadable=(row,label)=>{
 assert.equal(row.timedOut??false,false,label+':timeout');assert.equal(row.status,2,label+':exit');assert.equal(row.signal,null,label+':signal');
 assert.deepEqual(row.json,{run_status:'invalid_input',error_codes:['INPUT_UNREADABLE']},label+':json');
 assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');assert.equal(row.stderr,'INPUT_UNREADABLE\n',label+':stderr');
 assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));
 for(const forbidden of ['audit_sidecar','assurance','inquiry','semantic_projection','semantic_digest'])assert.equal(Object.hasOwn(row.json,forbidden),false,label+':'+forbidden);
};
const invokeControlled=(input,{timeoutMs=15_000,mutationSize=null}={})=>new Promise((resolve,reject)=>{
 const execArgs=mutationSize===null?[]:['--require',RACE_PRELOAD];
 const env={LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:'task11-path-totality'};
 if(mutationSize!==null){env.TASK11_RACE_PATH=input;env.TASK11_RACE_SIZE=String(mutationSize);}
 const child=spawn(process.execPath,[...execArgs,CLI,...args(input)],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
 const stdout=[];const stderr=[];let timedOut=false;let forceTimer=null;
 child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));child.on('error',reject);
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),250);},timeoutMs);
 child.on('close',(status,signal)=>{clearTimeout(timer);if(forceTimer!==null)clearTimeout(forceTimer);const stdoutText=Buffer.concat(stdout).toString('utf8'),stderrText=Buffer.concat(stderr).toString('utf8');let json=null;try{if(stdoutText.length>0)json=JSON.parse(stdoutText);}catch(error){reject(Object.assign(error,{stdout:stdoutText,stderr:stderrText,status,signal,timedOut}));return;}resolve({status,signal,stdout:stdoutText,stderr:stderrText,json,timedOut});});
});
const capture=async(failures,label,operation)=>{try{await operation();}catch(error){failures.push(label+': '+error.message);}};

test('CLI path input is total and bound to one immutable regular-file snapshot',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ux-skill-task11-path-'));const failures=[];
 try{
  const exactPath=join(directory,'exact.json'),shrinkPath=join(directory,'shrink.json'),growthPath=join(directory,'growth.json');
  const missingPath=join(directory,'missing.json'),symlinkPath=join(directory,'link.json'),fifoPath=join(directory,'fifo.json');
  await Promise.all([writeFile(exactPath,exactValidBytes()),writeFile(shrinkPath,exactValidBytes()),writeFile(growthPath,fixtureBytes)]);
  await symlink(exactPath,symlinkPath);
  const mkfifo=spawnSync('mkfifo',[fifoPath],{encoding:'utf8'});assert.equal(mkfifo.status,0,mkfifo.stderr);
  const [base,exact,missing,directoryRow,symlinkRow,growth,shrink]=await Promise.all([
   runCli(args('evals/parity/scan.json')),runCli(args(exactPath)),runCli(args(missingPath)),runCli(args(directory)),runCli(args(symlinkPath)),
   invokeControlled(growthPath,{mutationSize:MAX_BYTES}),invokeControlled(shrinkPath,{mutationSize:fixtureBytes.length})
  ]);
  await capture(failures,'exact MAX regular file',async()=>{assert.equal(exact.status,0,exact.stderr);assert.equal(exact.stderr,'');assert.equal(validateResponse(exact.json),true,JSON.stringify(validateResponse.errors));assert.deepEqual(exact.json.semantic_projection,base.json.semantic_projection);assert.equal(exact.json.semantic_digest,base.json.semantic_digest);});
  await capture(failures,'missing path',async()=>expectUnreadable(missing,'missing'));
  await capture(failures,'directory path',async()=>expectUnreadable(directoryRow,'directory'));
  await capture(failures,'symlink path',async()=>expectUnreadable(symlinkRow,'symlink'));
  await capture(failures,'same-inode growth',async()=>expectUnreadable(growth,'growth'));
  await capture(failures,'same-inode shrink',async()=>expectUnreadable(shrink,'shrink'));
  const fifo=await invokeControlled(fifoPath,{timeoutMs:3_000});
  await capture(failures,'FIFO exits without writer',async()=>expectUnreadable(fifo,'fifo'));
 }finally{await rm(directory,{recursive:true,force:true});}
 if(failures.length>0)assert.fail('TASK11_PATH_SNAPSHOT_TOTALITY_RED\n'+failures.join('\n'));
});
