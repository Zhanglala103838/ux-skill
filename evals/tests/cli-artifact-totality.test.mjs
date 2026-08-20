import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod,cp,mkdtemp,readFile,rm,stat,truncate,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {ImportType,init,parse} from 'es-module-lexer';
import {canonicalize} from 'json-canonicalize';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const CLI=join(ROOT,'scripts/ux-evaluate.mjs');
const RACE_PRELOAD=fileURLToPath(new URL('../helpers/task11-path-race.cjs',import.meta.url));
const TELEMETRY_PRELOAD=fileURLToPath(new URL('../helpers/task11-artifact-io-telemetry.cjs',import.meta.url));
const RESPONSE_PATH='schemas/adapters/ux-evaluate-response-v1.schema.json';
const SEMANTIC_PATH='schemas/evaluator/semantic-projection.schema.json';
const SCHEMA_MANIFEST_PATH='schemas/manifest.json';
const EVALUATOR_MANIFEST_PATH='evaluator/manifest.json';
const ARTIFACT_RESOURCE_LIMIT=1_048_576;
const BOOTSTRAP_SPARSE_BYTES=67_108_864;
const LARGE_SPARSE_ARTIFACT_BYTES=3_221_225_472;
const SNAPSHOT_REGISTRY_UNAVAILABLE_EVALUATOR_DIGEST='2736eb367eed0496a1aca8d7702f5cc1abd73344a2789c91d2c7ef8aca65b267';
const RESPONSE_SCHEMA_CLOSURE=Object.freeze([
 Object.freeze({path:RESPONSE_PATH,id:'https://ux-skill.invalid/schemas/adapters/ux-evaluate-response-v1.schema.json'}),
 Object.freeze({path:SEMANTIC_PATH,id:'https://ux-skill.invalid/schemas/evaluator/semantic-projection.schema.json'})
]);
const [responseSchema,semanticSchema,bundle,fixtureBytes,snapshotFallbackBundle]=await Promise.all([
 readFile(new URL('../../'+RESPONSE_PATH,import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../parity/scan.json',import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../parity/scan.json',import.meta.url)),
 readFile(new URL('../golden/high-risk-delete.json',import.meta.url),'utf8').then(JSON.parse).then((value)=>{
  const fallback=value.bundle;
  fallback.target_snapshot={target_snapshot_id:'task10-black-box-snapshot',target_kind:'black_box_site',canonical_locator:'public-sites/task10-example',snapshot_digest:'5ba077ceb4c541a38eb64e9bd8c0579b5688cacc44a83248f84e11c2e0fb951b'};
  fallback.research_state={research_state_id:'task10-tamper-research',status:'authorized',authorization_ref:'task10-read-only'};
  fallback.adapter_evidence=[];fallback.snapshot_closure_result=null;return fallback;
 })
]);
await init;
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
const validateResponse=ajv.compile(responseSchema);
const DIRECT_EVALUATOR_SOURCE="import{readFile}from'node:fs/promises';const bundle=JSON.parse(await readFile('runtime-input.json','utf8'));try{const{evaluate}=await import('./evaluator/index.mjs');await evaluate(bundle);process.stdout.write(JSON.stringify({status:'success'})+'\\n');}catch(error){process.stdout.write(JSON.stringify({status:'rejected',code:error?.code??null})+'\\n');}";
const spawnCli=(isolated,options={})=>new Promise((resolve,reject)=>{
 const inputKind=options.inputKind??'stdin',inputPath=join(isolated,'runtime-input.json');
 const cli=join(isolated,'scripts/ux-evaluate.mjs'),args=options.args??['--mode','scan','--input',inputKind==='path'?inputPath:'-','--output','json'];
 const child=spawn(process.execPath,[...(options.nodeArgs??[]),cli,...args],{cwd:isolated,env:{LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:'task11-artifact-totality',...(options.env??{})},stdio:['pipe','pipe','pipe']});
 const stdout=[];const stderr=[];let timedOut=false;let forceTimer=null;
 child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));child.on('error',reject);
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),250);},options.timeoutMs??15_000);
 child.on('close',(status,signal)=>{clearTimeout(timer);if(forceTimer!==null)clearTimeout(forceTimer);const stdoutText=Buffer.concat(stdout).toString('utf8'),stderrText=Buffer.concat(stderr).toString('utf8');let json=null;try{if(stdoutText.length>0)json=JSON.parse(stdoutText);}catch(error){reject(Object.assign(error,{stdout:stdoutText,stderr:stderrText,status,signal,timedOut}));return;}resolve({status,signal,stdout:stdoutText,stderr:stderrText,json,timedOut});});
 child.stdin.end(options.stdinBytes??JSON.stringify(bundle));
});
const spawnDirectEvaluator=(isolated)=>new Promise((resolveRow,reject)=>{
 const child=spawn(process.execPath,['--input-type=module','--eval',DIRECT_EVALUATOR_SOURCE],{cwd:isolated,env:{LANG:'C',LC_ALL:'C',TZ:'UTC'},stdio:['ignore','pipe','pipe']});
 const stdout=[];const stderr=[];child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));child.on('error',reject);
 child.on('close',(status,signal)=>{const stdoutText=Buffer.concat(stdout).toString('utf8'),stderrText=Buffer.concat(stderr).toString('utf8');let json=null;try{if(stdoutText.length>0)json=JSON.parse(stdoutText);}catch(error){reject(Object.assign(error,{stdout:stdoutText,stderr:stderrText,status,signal}));return;}resolveRow({status,signal,stdout:stdoutText,stderr:stderrText,json});});
});
const isolatedRun=async(mutate,options={})=>{
 const isolated=await mkdtemp(join(ROOT,'.task11-artifact-totality-'));
 try{
  for(const name of ['scripts','evaluator','schemas','knowledge','references'])await cp(join(ROOT,name),join(isolated,name),{recursive:true});
  await cp(join(ROOT,'package.json'),join(isolated,'package.json'));
  await writeFile(join(isolated,'runtime-input.json'),options.pathBytes??JSON.stringify(bundle));
  await mutate(isolated);
  return await spawnCli(isolated,options);
 }finally{await rm(isolated,{recursive:true,force:true});}
};
const readTelemetry=async(path)=>{
 let source='';try{source=await readFile(path,'utf8');}catch(error){if(error?.code!=='ENOENT')throw error;}
 return source.split('\n').filter(Boolean).map((line)=>JSON.parse(line));
};
const isolatedTelemetryRun=async(path,size=null,options={})=>{
 const isolated=await mkdtemp(join(ROOT,'.task11-artifact-telemetry-'));
 try{
  for(const name of ['scripts','evaluator','schemas','knowledge','references'])await cp(join(ROOT,name),join(isolated,name),{recursive:true});
  await cp(join(ROOT,'package.json'),join(isolated,'package.json'));
  await writeFile(join(isolated,'runtime-input.json'),JSON.stringify(bundle));
  const target=join(isolated,path),telemetryPath=join(isolated,'artifact-telemetry.ndjson');
  if(size!==null)await makeSparseArtifact(isolated,path,size);
  const row=await spawnCli(isolated,{...options,nodeArgs:['--require',TELEMETRY_PRELOAD],env:{TASK11_ARTIFACT_TARGET:target,TASK11_ARTIFACT_TELEMETRY:telemetryPath,...(options.env??{})}});
  return{...row,telemetry:await readTelemetry(telemetryPath)};
 }finally{await rm(isolated,{recursive:true,force:true});}
};
const isolatedTrustRootRuns=async(mutate)=>{
 const isolated=await mkdtemp(join(ROOT,'.task11-response-trust-'));
 try{
  for(const name of ['scripts','evaluator','schemas','knowledge','references'])await cp(join(ROOT,name),join(isolated,name),{recursive:true});
  await cp(join(ROOT,'package.json'),join(isolated,'package.json'));
  await writeFile(join(isolated,'runtime-input.json'),JSON.stringify(bundle));
  await mutate(isolated);
  const earlyInvalid=await spawnCli(isolated,{args:['--unknown','x']});
  const validBundle=await spawnCli(isolated);
  return{earlyInvalid,validBundle};
 }finally{await rm(isolated,{recursive:true,force:true});}
};
const isolatedEvaluatorRuns=async(mutate)=>{
 const isolated=await mkdtemp(join(ROOT,'.task11-evaluator-manifest-'));
 try{
  for(const name of ['scripts','evaluator','schemas','knowledge','references'])await cp(join(ROOT,name),join(isolated,name),{recursive:true});
  await cp(join(ROOT,'package.json'),join(isolated,'package.json'));
  await writeFile(join(isolated,'runtime-input.json'),JSON.stringify(bundle));
  await mutate(isolated);
  const cli=await spawnCli(isolated),direct=await spawnDirectEvaluator(isolated);
  return{cli,direct};
 }finally{await rm(isolated,{recursive:true,force:true});}
};
const expectFailed=(row,code,label)=>{
 assert.equal(row.status,1,label+':exit');assert.equal(row.signal,null,label+':signal');
 assert.equal(row.timedOut,false,label+':timeout');
 assert.deepEqual(row.json,{run_status:'failed',error_codes:[code]},label+':json');
 assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');assert.equal(row.stderr,code+'\n',label+':stderr');
 assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));
 for(const leaked of ['ENOENT','EACCES','SyntaxError','ERR_FS_FILE_TOO_LARGE','ERR_TASK11_UNAUTHORIZED','RESPONSE_SCHEMA_VALIDATION_FAILED',ROOT]){assert.equal(row.stdout.includes(leaked),false,label+':stdout:'+leaked);assert.equal(row.stderr.includes(leaked),false,label+':stderr:'+leaked);}
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
const expectSuccess=(row,label)=>{
 assert.equal(row.status,0,label+':exit');assert.equal(row.signal,null,label+':signal');assert.equal(row.stderr,'',label+':stderr');assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');
};
const expectBoundedBeforeAllocation=(row,label)=>{
 const wholeFileReads=row.telemetry.filter((event)=>event.op==='readFile');
 assert.deepEqual(wholeFileReads,[],label+':whole-file readFile forbidden');
 const opens=row.telemetry.filter((event)=>event.op==='open');assert.ok(opens.length>=1,label+':bounded open required');
 const reads=row.telemetry.filter((event)=>event.op==='read');
 const requested=reads.reduce((total,event)=>total+event.requested,0),actual=reads.reduce((total,event)=>total+event.actual,0);
 assert.ok(requested<=ARTIFACT_RESOURCE_LIMIT+1,label+':requested read budget '+requested);
 assert.ok(actual<=ARTIFACT_RESOURCE_LIMIT+1,label+':actual read budget '+actual);
};
const expectSnapshotRegistryFallback=(row,label)=>{
 expectSuccess(row,label);assert.equal(row.timedOut,false,label+':timeout');
 assert.equal(row.json.assurance?.release_status,'no_release',label+':assurance release');
 assert.equal(row.json.semantic_projection?.release_recommendation?.status,'no_release',label+':semantic release');
 assert.equal(row.json.semantic_projection?.evaluator_digest,SNAPSHOT_REGISTRY_UNAVAILABLE_EVALUATOR_DIGEST,label+':fixed sentinel');
 assert.equal(row.json.audit_sidecar?.manifest_verification,'partial_failure',label+':manifest verification');
 assert.equal(row.json.audit_sidecar?.snapshot_source_registry,'unavailable',label+':registry status');
 assert.equal(row.json.audit_sidecar?.snapshot_source_digest,null,label+':snapshot digest sentinel');
 assert.equal(row.json.audit_sidecar?.snapshot_source_authority_digest,null,label+':authority digest sentinel');
 for(const leaked of ['ERR_FS_FILE_TOO_LARGE','ENOMEM','RangeError',ROOT]){assert.equal(row.stdout.includes(leaked),false,label+':stdout:'+leaked);assert.equal(row.stderr.includes(leaked),false,label+':stderr:'+leaked);}
};
const expectDirect=(row,expected,label)=>{
 assert.equal(row.status,0,label+':exit');assert.equal(row.signal,null,label+':signal');assert.equal(row.stderr,'',label+':stderr');assert.deepEqual(row.json,expected,label+':json');assert.equal(row.stdout,JSON.stringify(expected)+'\n',label+':stdout');
};
const capture=async(failures,label,operation)=>{try{await operation();}catch(error){failures.push(label+': '+error.message);}};
const makeSparseArtifact=async(root,path,size)=>{
 const target=join(root,path);await truncate(target,size);
 const snapshot=await stat(target,{bigint:true});assert.equal(snapshot.size,BigInt(size),path+':sparse size');
 if(size>=BOOTSTRAP_SPARSE_BYTES&&typeof snapshot.blocks==='bigint')assert.ok(snapshot.blocks*512n<snapshot.size,path+':sparse allocation');
};
const rawSha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const schemaManifestDigest=(manifest)=>createHash('sha256').update('ux-skill:manifest:v1','utf8').update(canonicalize(manifest),'utf8').digest('hex');
const evaluatorManifestDigest=(manifest)=>createHash('sha256').update('ux-skill:evaluator-manifest:v1','utf8').update(canonicalize(manifest),'utf8').digest('hex');
const replaceDigestPin=(source,name,digest)=>{const pattern=new RegExp("const "+name+"='[0-9a-f]{64}';",'gu'),matches=[...source.matchAll(pattern)];assert.equal(matches.length,1,name+':pin');return source.replace(pattern,"const "+name+"='"+digest+"';");};
const replaceUnique=async(path,needle,replacement)=>{const source=await readFile(path,'utf8');assert.equal(source.split(needle).length,2,path+':mutation anchor');await writeFile(path,source.replace(needle,replacement));};
const semanticRowIndex=(manifest)=>{const indexes=[];for(let index=0;index<manifest.length;index+=1){if(manifest[index]?.path===SEMANTIC_PATH)indexes.push(index);}assert.deepEqual(indexes.length,1,'semantic manifest row precondition');return indexes[0];};
const rewriteBoundSchemaManifest=async(root,mutate)=>{
 const schemaPath=join(root,SCHEMA_MANIFEST_PATH),evaluatorPath=join(root,EVALUATOR_MANIFEST_PATH);
 const manifest=JSON.parse(await readFile(schemaPath,'utf8'));await mutate(manifest);
 const evaluatorManifest=JSON.parse(await readFile(evaluatorPath,'utf8'));evaluatorManifest.schema_manifest_digest=schemaManifestDigest(manifest);
 await Promise.all([writeFile(schemaPath,JSON.stringify(manifest,null,2)+'\n'),writeFile(evaluatorPath,JSON.stringify(evaluatorManifest,null,2)+'\n')]);
};
const assertResponseSchemaClosure=async(root)=>{
 const manifest=JSON.parse(await readFile(join(root,SCHEMA_MANIFEST_PATH),'utf8')),schemasById=new Map(),pathsById=new Map();
 for(const expected of RESPONSE_SCHEMA_CLOSURE){
  const raw=await readFile(join(root,expected.path)),schema=JSON.parse(raw);
  assert.equal(schema.$id,expected.id,expected.path+':$id');
  const rows=manifest.filter((row)=>row?.path===expected.path);assert.equal(rows.length,1,expected.path+':manifest row');assert.equal(rows[0].file_digest,rawSha(raw),expected.path+':raw digest');
  assert.equal(schemasById.has(expected.id),false,expected.id+':duplicate id');schemasById.set(expected.id,schema);pathsById.set(expected.id,expected.path);
 }
 const visited=new Set();
 const visit=(id)=>{
  if(visited.has(id))return;visited.add(id);const schema=schemasById.get(id);assert.ok(schema,id+':schema missing');
  const walk=(value)=>{
   if(value===null||typeof value!=='object')return;
   if(typeof value.$ref==='string'&&!value.$ref.startsWith('#')){const target=new URL(value.$ref,id);target.hash='';assert.equal(target.hostname,'ux-skill.invalid',value.$ref+':remote ref');assert.ok(schemasById.has(target.href),target.href+':unbound external ref');visit(target.href);}
   for(const child of Array.isArray(value)?value:Object.values(value))walk(child);
  };
  walk(schema);
 };
 visit(RESPONSE_SCHEMA_CLOSURE[0].id);
 const actual=[...visited].map((id)=>pathsById.get(id)).sort(),expected=RESPONSE_SCHEMA_CLOSURE.map((row)=>row.path).sort();assert.deepEqual(actual,expected,'response schema external closure');
};
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

test('CLI closes bootstrap, schema-closure, and torn-snapshot trust failures',async()=>{
 const failures=[];
 await capture(failures,'CLI static local bootstrap closure',async()=>assert.deepEqual(await collectStaticLocalClosure(CLI),[]));
 await capture(failures,'response schema external closure is exact and raw-bound',async()=>assertResponseSchemaClosure(ROOT));
 const cases=[
  ['missing evaluator digests stdin','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'evaluator/digests.mjs')),{inputKind:'stdin'}],
  ['malformed evaluator digests path','ARTIFACT_VERIFICATION_FAILED',async(root)=>writeFile(join(root,'evaluator/digests.mjs'),'export const =\n'),{inputKind:'path'}],
  ['missing evaluation schema stdin','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'schemas/core/evaluation-input.schema.json')),{inputKind:'stdin'}],
  ['missing authority registry path','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'knowledge/registries.json')),{inputKind:'path'}],
  ['malformed evaluation schema path','ARTIFACT_VERIFICATION_FAILED',async(root)=>writeFile(join(root,'schemas/core/evaluation-input.schema.json'),'{'),{inputKind:'path'}],
  ['malformed authority registry stdin','ARTIFACT_VERIFICATION_FAILED',async(root)=>writeFile(join(root,'knowledge/registries.json'),'{'),{inputKind:'stdin'}],
  ['missing rules','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'knowledge/rules.json'))],
  ['unreadable rules','ARTIFACT_VERIFICATION_FAILED',async(root)=>chmod(join(root,'knowledge/rules.json'),0o000)],
  ['missing knowledge manifest','ARTIFACT_VERIFICATION_FAILED',async(root)=>rm(join(root,'knowledge/manifest.json'))],
  ['authorized artifact verification code','ARTIFACT_VERIFICATION_FAILED',async(root)=>{const path=join(root,'knowledge/rules.json');await writeFile(path,(await readFile(path,'utf8'))+' ');}],
  ['authorized unexpected evaluator code','EVALUATION_FAILED',async(root)=>{
   const evaluatorPath=join(root,'evaluator/index.mjs'),source=await readFile(evaluatorPath,'utf8');
   const needle=" const input=validateInput(bundle);if(!input.ok)inputFailure(input.errors);\n const artifacts=";assert.equal(source.split(needle).length,2,'evaluator injection anchor');
   const injected=source.replace(needle," const input=validateInput(bundle);if(!input.ok)inputFailure(input.errors);\n const unexpected=new TypeError('task11 unexpected evaluator failure');unexpected.code='ERR_TASK11_UNAUTHORIZED';throw unexpected;\n const artifacts=");
   await writeFile(evaluatorPath,injected);
   const manifestPath=join(root,EVALUATOR_MANIFEST_PATH),manifest=JSON.parse(await readFile(manifestPath,'utf8')),row=manifest.evaluator_files.find((entry)=>entry.path==='evaluator/index.mjs');assert.ok(row,'evaluator row');row.file_digest=rawSha(Buffer.from(injected));
   const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(manifestPath,manifestBytes);
   const cliPath=join(root,'scripts/ux-evaluate.mjs');let cli=await readFile(cliPath,'utf8');cli=replaceDigestPin(cli,'EVALUATOR_MANIFEST_RAW_DIGEST',rawSha(manifestBytes));cli=replaceDigestPin(cli,'EVALUATOR_MANIFEST_SEMANTIC_DIGEST',evaluatorManifestDigest(manifest));await writeFile(cliPath,cli);
  }]
 ];
 for(const [label,code,mutate,options] of cases){const row=await isolatedRun(mutate,options);await capture(failures,label,async()=>expectFailed(row,code,label));}
 const artifactResourcePaths=[
  ['rules artifact','knowledge/rules.json','failed'],
  ['evaluation schema artifact','schemas/core/evaluation-input.schema.json','failed'],
  ['authority registry artifact','knowledge/registries.json','failed'],
  ['authority policy artifact','knowledge/decision-policies.json','failed'],
  ['evaluator manifest artifact','evaluator/manifest.json','failed'],
  ['snapshot source registry artifact','evaluator/snapshot-source-registry.json','fallback']
 ];
 for(const [sizeLabel,size] of [['limit plus one',ARTIFACT_RESOURCE_LIMIT+1],['three GiB sparse',LARGE_SPARSE_ARTIFACT_BYTES]]){
  for(const [artifactLabel,path,expectation] of artifactResourcePaths){
   const label=artifactLabel+' '+sizeLabel;
   await capture(failures,label,async()=>{
    const options=expectation==='fallback'?{timeoutMs:15_000,args:['--mode',snapshotFallbackBundle.request_mode,'--input','-','--output','json'],stdinBytes:JSON.stringify(snapshotFallbackBundle)}:{timeoutMs:15_000};
    const row=await isolatedRun((root)=>makeSparseArtifact(root,path,size),options);
    if(expectation==='fallback')expectSnapshotRegistryFallback(row,label);
    else expectFailed(row,'ARTIFACT_VERIFICATION_FAILED',label);
   });
 }
}
 const bootstrapTrustCases=[
  ['response schema bootstrap',RESPONSE_PATH,'response'],
  ['semantic schema bootstrap',SEMANTIC_PATH,'response'],
  ['schema manifest bootstrap',SCHEMA_MANIFEST_PATH,'response'],
  ['evaluator manifest bootstrap',EVALUATOR_MANIFEST_PATH,'artifact']
 ];
 for(const [label,path,classification] of bootstrapTrustCases){
  await capture(failures,label+' 64 MiB preallocation boundary',async()=>{
   const row=await isolatedTelemetryRun(path,BOOTSTRAP_SPARSE_BYTES,{timeoutMs:20_000});
   if(classification==='response')expectResponseSchemaBoundary(row,label);
   else expectFailed(row,'ARTIFACT_VERIFICATION_FAILED',label);
   expectBoundedBeforeAllocation(row,label);
  });
 }
 for(const [sizeLabel,size] of [['64 MiB sparse',BOOTSTRAP_SPARSE_BYTES],['three GiB sparse',LARGE_SPARSE_ARTIFACT_BYTES]]){
  await capture(failures,'claims module '+sizeLabel+' pre-import boundary',async()=>{
   const label='claims module '+sizeLabel,row=await isolatedTelemetryRun('evaluator/claims.mjs',size,{timeoutMs:20_000});
   expectFailed(row,'ARTIFACT_VERIFICATION_FAILED',label);expectBoundedBeforeAllocation(row,label);
   assert.equal(row.telemetry.some((event)=>event.op==='module_resolve'),false,label+':must reject before Node module resolution');
  });
 }
 await capture(failures,'normal claims module telemetry acceptance',async()=>{
  const row=await isolatedTelemetryRun('evaluator/claims.mjs');expectSuccess(row,'normal claims module');
  assert.equal(row.telemetry.some((event)=>event.op==='module_resolve'),true,'normal claims module:telemetry resolve positive');
 });
 const precedenceCases=[
  ['argument precedence','MODE_INVALID',async(root)=>rm(join(root,'schemas/core/evaluation-input.schema.json')),{args:['--mode','audit','--input','-','--output','json']}],
  ['input precedence','INPUT_JSON_INVALID',async(root)=>rm(join(root,'schemas/core/evaluation-input.schema.json')),{stdinBytes:'{'}],
  ['evaluator bootstrap argument precedence','MODE_INVALID',async(root)=>rm(join(root,'evaluator/digests.mjs')),{args:['--mode','audit','--input','-','--output','json']}],
  ['evaluator bootstrap input precedence','INPUT_JSON_INVALID',async(root)=>rm(join(root,'evaluator/digests.mjs')),{stdinBytes:'{'}]
 ];
 for(const [label,code,mutate,options] of precedenceCases){const row=await isolatedRun(mutate,options);await capture(failures,label,async()=>expectInvalid(row,code,label));}
 const responseSchemaCases=[
  ['strict JSON bootstrap missing',async(root)=>rm(join(root,'scripts/strict-json.mjs'))],
  ['strict JSON bootstrap malformed',async(root)=>writeFile(join(root,'scripts/strict-json.mjs'),'export const =\n')],
  ['strict JSON bootstrap precedes invalid mode',async(root)=>rm(join(root,'scripts/strict-json.mjs')),{args:['--mode','audit','--input','-','--output','json']}],
  ['shared strict parser missing',async(root)=>rm(join(root,'evaluator/canonical.mjs'))],
  ['shared strict parser malformed',async(root)=>writeFile(join(root,'evaluator/canonical.mjs'),'export const =\n')],
  ['shared strict parser precedes invalid input',async(root)=>rm(join(root,'evaluator/canonical.mjs')),{stdinBytes:'{'}],
  ['response schema digest trust root',async(root)=>{const path=join(root,RESPONSE_PATH);await writeFile(path,(await readFile(path,'utf8'))+' ');}],
  ['response schema missing trust root',async(root)=>rm(join(root,RESPONSE_PATH))],
  ['response schema malformed trust root',async(root)=>writeFile(join(root,RESPONSE_PATH),'{')]
 ];
 for(const [label,mutate,options] of responseSchemaCases){const row=await isolatedRun(mutate,options);await capture(failures,label,async()=>expectResponseSchemaBoundary(row,label));}
 const responseClosureCases=[
  ['semantic schema whitespace raw tamper',async(root)=>{const path=join(root,SEMANTIC_PATH);await writeFile(path,(await readFile(path,'utf8'))+' \n');}],
  ['semantic schema missing',async(root)=>rm(join(root,SEMANTIC_PATH))],
  ['semantic schema malformed',async(root)=>writeFile(join(root,SEMANTIC_PATH),'{')],
  ['semantic manifest row missing',async(root)=>rewriteBoundSchemaManifest(root,(manifest)=>{manifest.splice(semanticRowIndex(manifest),1);})],
  ['semantic manifest row duplicate',async(root)=>rewriteBoundSchemaManifest(root,(manifest)=>{const index=semanticRowIndex(manifest);manifest.splice(index+1,0,{...manifest[index]});})],
  ['semantic manifest row wrong path',async(root)=>rewriteBoundSchemaManifest(root,(manifest)=>{manifest[semanticRowIndex(manifest)].path='schemas/evaluator/semantic-projection-copy.schema.json';})],
  ['semantic manifest row wrong digest',async(root)=>rewriteBoundSchemaManifest(root,(manifest)=>{manifest[semanticRowIndex(manifest)].file_digest='0'.repeat(64);})]
 ];
 for(const [label,mutate] of responseClosureCases){
  const rows=await isolatedTrustRootRuns(mutate);
  await capture(failures,label+' early invalid',async()=>expectResponseSchemaBoundary(rows.earlyInvalid,label+' early invalid'));
  await capture(failures,label+' valid bundle',async()=>expectResponseSchemaBoundary(rows.validBundle,label+' valid bundle'));
 }
 const responseManifestDuplicateCases=[
  ['response manifest same-value duplicate',async(root)=>{const path=join(root,SCHEMA_MANIFEST_PATH),needle='    "path": "'+RESPONSE_PATH+'",';await replaceUnique(path,needle,needle+'\n'+needle);}],
  ['response manifest escaped-equivalent duplicate',async(root)=>{const path=join(root,SCHEMA_MANIFEST_PATH),needle='    "path": "'+RESPONSE_PATH+'",',escaped='    "pa\\u0074h": "'+RESPONSE_PATH+'",';await replaceUnique(path,needle,needle+'\n'+escaped);}]
 ];
 for(const [label,mutate] of responseManifestDuplicateCases){
  const rows=await isolatedTrustRootRuns(mutate);
  await capture(failures,label+' early invalid',async()=>expectResponseSchemaBoundary(rows.earlyInvalid,label+' early invalid'));
  await capture(failures,label+' valid bundle',async()=>expectResponseSchemaBoundary(rows.validBundle,label+' valid bundle'));
 }
 await capture(failures,'normal manifests CLI and direct acceptance',async()=>{
  const rows=await isolatedEvaluatorRuns(async()=>{});expectSuccess(rows.cli,'normal manifests CLI');expectDirect(rows.direct,{status:'success'},'normal manifests direct');
 });
 const evaluatorManifestDuplicateCases=[
  ['evaluator manifest same-value top-level duplicate',async(root)=>{const path=join(root,EVALUATOR_MANIFEST_PATH),needle='  "schema_manifest_digest": "7c66ac79b3f6b820377b8d56eaa2e3a9b383f659e6cc3a54dbcf73a76a9622aa",';await replaceUnique(path,needle,needle+'\n'+needle);}],
  ['evaluator manifest escaped-equivalent row duplicate',async(root)=>{const path=join(root,EVALUATOR_MANIFEST_PATH),needle='      "path": "evaluator/authority.mjs",',escaped='      "pa\\u0074h": "evaluator/authority.mjs",';await replaceUnique(path,needle,needle+'\n'+escaped);}]
 ];
 for(const [label,mutate] of evaluatorManifestDuplicateCases){
  const rows=await isolatedEvaluatorRuns(mutate);
  await capture(failures,label+' CLI',async()=>expectFailed(rows.cli,'ARTIFACT_VERIFICATION_FAILED',label+' CLI'));
  await capture(failures,label+' direct',async()=>expectDirect(rows.direct,{status:'rejected',code:'ARTIFACT_VERIFICATION_FAILED'},label+' direct'));
 }
 await capture(failures,'same-inode same-size torn snapshot',async()=>{
  const {row,marker,finalMatchesReplacement,partialBytes}=await runTornSnapshot();
  assert.equal(marker.fired,true,'mutation marker');assert.equal(marker.firstReadBytes,partialBytes,'partial read');assert.equal(finalMatchesReplacement,true,'final file B');
  for(const field of ['dev','ino','size'])assert.equal(marker.before[field],marker.after[field],field+' stable');
  assert.ok(marker.before.mtimeNs!==marker.after.mtimeNs||marker.before.ctimeNs!==marker.after.ctimeNs,'nanosecond mutation metadata must change');
  assert.equal(row.timedOut,false,'timeout');expectInvalid(row,'INPUT_UNREADABLE','torn snapshot');
  for(const forbidden of ['audit_sidecar','assurance','inquiry','semantic_projection','semantic_digest'])assert.equal(Object.hasOwn(row.json,forbidden),false,'torn snapshot:'+forbidden);
 });
 if(failures.length>0)assert.fail('TASK11_BOOTSTRAP_PREFLIGHT_RED\n'+failures.join('\n'));
});
