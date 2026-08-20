import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmod,cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {ImportType,init,parse} from 'es-module-lexer';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const CLI=join(ROOT,'scripts/ux-evaluate.mjs');
const RACE_PRELOAD=fileURLToPath(new URL('../helpers/task11-path-race.cjs',import.meta.url));
const RESPONSE_PATH='schemas/adapters/ux-evaluate-response-v1.schema.json';
const [responseSchema,semanticSchema,bundle,fixtureBytes]=await Promise.all([
 readFile(new URL('../../'+RESPONSE_PATH,import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../parity/scan.json',import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../parity/scan.json',import.meta.url))
]);
await init;
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
const collectStaticLocalClosure=async(entry)=>{
 const visited=new Set();
 const visit=async(path)=>{
  if(visited.has(path))return;visited.add(path);
  const [imports]=parse(await readFile(path,'utf8'),relative(ROOT,path));
  for(const row of imports){if(row.t===ImportType.Static&&typeof row.n==='string'&&row.n.startsWith('.'))await visit(resolve(dirname(path),row.n));}
 };
 await visit(entry);
 return [...visited].filter((path)=>path!==entry).map((path)=>relative(ROOT,path).split('\\').join('/')).sort();
};
const runTornSnapshot=async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ux-skill-task11-torn-'));
 try{
  const inputPath=join(directory,'input.json'),replacementPath=join(directory,'replacement.json'),markerPath=join(directory,'mutation.json');
  const source=fixtureBytes.toString('utf8');
  const replacementSource=source.replace('2026-08-20T00:00:00.000Z','2026-08-21T00:00:00.000Z').replace('snap-delete-001','snap-update-001');
  assert.notEqual(replacementSource,source,'replacement must differ');
  const replacement=Buffer.from(replacementSource,'utf8'),partialBytes=160;
  assert.equal(replacement.length,fixtureBytes.length,'replacement size');
  const hybrid=Buffer.concat([fixtureBytes.subarray(0,partialBytes),replacement.subarray(partialBytes)]);
  assert.doesNotThrow(()=>JSON.parse(hybrid.toString('utf8')),'hybrid JSON');
  assert.equal(hybrid.equals(fixtureBytes),false,'hybrid differs from A');assert.equal(hybrid.equals(replacement),false,'hybrid differs from B');
  await Promise.all([writeFile(inputPath,fixtureBytes),writeFile(replacementPath,replacement)]);
  const env={LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:'task11-torn-snapshot',TASK11_RACE_PATH:inputPath,TASK11_RACE_MODE:'same-size-overwrite',TASK11_RACE_REPLACEMENT_PATH:replacementPath,TASK11_RACE_PARTIAL_BYTES:String(partialBytes),TASK11_RACE_MARKER_PATH:markerPath};
  const row=await new Promise((resolveRow,reject)=>{
   const child=spawn(process.execPath,['--require',RACE_PRELOAD,CLI,'--mode','scan','--input',inputPath,'--output','json'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
   const stdout=[];const stderr=[];let timedOut=false;let forceTimer=null;
   child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));child.on('error',reject);
   const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),250);},15_000);
   child.on('close',(status,signal)=>{clearTimeout(timer);if(forceTimer!==null)clearTimeout(forceTimer);const stdoutText=Buffer.concat(stdout).toString('utf8'),stderrText=Buffer.concat(stderr).toString('utf8');let json=null;try{if(stdoutText.length>0)json=JSON.parse(stdoutText);}catch(error){reject(Object.assign(error,{stdout:stdoutText,stderr:stderrText,status,signal,timedOut}));return;}resolveRow({status,signal,stdout:stdoutText,stderr:stderrText,json,timedOut});});
  });
  const marker=JSON.parse(await readFile(markerPath,'utf8'));const finalBytes=await readFile(inputPath);
  return{row,marker,finalMatchesReplacement:finalBytes.equals(replacement),partialBytes};
 }finally{await rm(directory,{recursive:true,force:true});}
};

test('CLI closes bootstrap failures and rejects a same-size torn path snapshot',async()=>{
 const failures=[];
 await capture(failures,'CLI static local bootstrap closure',async()=>assert.deepEqual(await collectStaticLocalClosure(CLI),[]));
 const cases=[
  ['missing evaluator digests stdin','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'evaluator/digests.mjs')),{inputKind:'stdin'}],
  ['malformed evaluator digests path','ARTIFACT_VERIFICATION_FAILED',async(root)=>writeFile(join(root,'evaluator/digests.mjs'),'export const =\n'),{inputKind:'path'}],
  ['missing evaluator canonical path','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'evaluator/canonical.mjs')),{inputKind:'path'}],
  ['malformed evaluator canonical stdin','ARTIFACT_VERIFICATION_FAILED',async(root)=>writeFile(join(root,'evaluator/canonical.mjs'),'export const =\n'),{inputKind:'stdin'}],
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
  ['input precedence','INPUT_JSON_INVALID',async(root)=>rm(join(root,'schemas/core/evaluation-input.schema.json')),{stdinBytes:'{'}],
  ['evaluator bootstrap argument precedence','MODE_INVALID',async(root)=>rm(join(root,'evaluator/digests.mjs')),{args:['--mode','audit','--input','-','--output','json']}],
  ['evaluator bootstrap input precedence','INPUT_JSON_INVALID',async(root)=>rm(join(root,'evaluator/canonical.mjs')),{stdinBytes:'{'}]
 ];
 for(const [label,code,mutate,options] of precedenceCases){const row=await isolatedRun(mutate,options);await capture(failures,label,async()=>expectInvalid(row,code,label));}
 const responseSchemaCases=[
  ['strict JSON bootstrap missing',async(root)=>rm(join(root,'scripts/strict-json.mjs'))],
  ['strict JSON bootstrap malformed',async(root)=>writeFile(join(root,'scripts/strict-json.mjs'),'export const =\n')],
  ['strict JSON bootstrap precedes invalid mode',async(root)=>rm(join(root,'scripts/strict-json.mjs')),{args:['--mode','audit','--input','-','--output','json']}],
  ['response schema digest trust root',async(root)=>{const path=join(root,RESPONSE_PATH);await writeFile(path,(await readFile(path,'utf8'))+' ');}],
  ['response schema missing trust root',async(root)=>rm(join(root,RESPONSE_PATH))],
  ['response schema malformed trust root',async(root)=>writeFile(join(root,RESPONSE_PATH),'{')]
 ];
 for(const [label,mutate,options] of responseSchemaCases){const row=await isolatedRun(mutate,options);await capture(failures,label,async()=>expectResponseSchemaBoundary(row,label));}
 await capture(failures,'same-inode same-size torn snapshot',async()=>{
  const {row,marker,finalMatchesReplacement,partialBytes}=await runTornSnapshot();
  assert.equal(marker.fired,true,'mutation marker');assert.equal(marker.firstReadBytes,partialBytes,'partial read');assert.equal(finalMatchesReplacement,true,'final file B');
  for(const field of ['dev','ino','size'])assert.equal(marker.before[field],marker.after[field],field+' stable');
  assert.ok(marker.before.mtimeNs!==marker.after.mtimeNs||marker.before.ctimeNs!==marker.after.ctimeNs,'nanosecond mutation metadata must change');
  assert.equal(row.timedOut,false,'timeout');expectInvalid(row,'INPUT_UNREADABLE','torn snapshot');
  for(const forbidden of ['audit_sidecar','assurance','inquiry','semantic_projection','semantic_digest'])assert.equal(Object.hasOwn(row.json,forbidden),false,'torn snapshot:'+forbidden);
 });
 if(failures.length>0)assert.fail('TASK11_CLI_BOOTSTRAP_SNAPSHOT_RED\n'+failures.join('\n'));
});
