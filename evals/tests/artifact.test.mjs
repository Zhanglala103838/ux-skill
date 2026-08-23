import test from 'node:test';
import assert from 'node:assert/strict';
import {constants as fsConstants} from 'node:fs';
import {cp,mkdtemp,mkdir,writeFile,readFile,open,realpath,symlink,link,stat,chmod,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,relative as pathRelative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {init as initModuleLexer,parse as parseModule} from 'es-module-lexer';
import {digest} from '../../evaluator/digests.mjs';
import {parseKnowledgeJson} from '../../scripts/strict-json.mjs';
import {collectLocalEvaluatorImportClosure} from '../helpers/import-closure.mjs';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const PACKER=join(ROOT,'scripts','pack-ustar.mjs');
const RACE_HELPER=join(ROOT,'evals','helpers','task11-path-race.cjs');
const TELEMETRY_HELPER=join(ROOT,'evals','helpers','task11-artifact-io-telemetry.cjs');
const MARKER='TASK13_USTAR_RED_PACKER_MISSING';
const EXPECTED_DISTRIBUTION=Object.freeze([
 '.nvmrc',
 'LICENSE',
 'SKILL.md',
 'adapters/hulianui/adapter.mjs',
 'adapters/hulianui/bridge.mjs',
 'adapters/hulianui/contract.json',
 'adapters/hulianui/fixture.json',
 'agents/openai.yaml',
 'evaluator/authority.mjs',
 'evaluator/canonical.mjs',
 'evaluator/claims.mjs',
 'evaluator/dependency-decision.mjs',
 'evaluator/digests.mjs',
 'evaluator/index.mjs',
 'evaluator/manifest.json',
 'evaluator/projection.mjs',
 'evaluator/rules-runtime.mjs',
 'evaluator/snapshot-source-registry.json',
 'evaluator/validation.mjs',
 'knowledge/artifact-manifest.json',
 'knowledge/assertions.json',
 'knowledge/decision-policies.json',
 'knowledge/manifest.json',
 'knowledge/policy-manifest.json',
 'knowledge/registries.json',
 'knowledge/rules.json',
 'knowledge/sources.json',
 'package.json',
 'pnpm-lock.yaml',
 'references/claim-study.md',
 'references/context-model.md',
 'references/ethics.md',
 'references/implementation-mapping.md',
 'references/inquiry-design.md',
 'references/journey-authority.md',
 'references/risk-reporting.md',
 'references/rules-runtime.md',
 'schemas/adapters/hulian-component-doc-v1.schema.json',
 'schemas/adapters/hulian-evaluation-request-v1.schema.json',
 'schemas/adapters/ux-evaluate-response-v1.schema.json',
 'schemas/core/authority.schema.json',
 'schemas/core/candidate-solver-input.schema.json',
 'schemas/core/claims.schema.json',
 'schemas/core/evaluation-input.schema.json',
 'schemas/core/real-world-case.schema.json',
 'schemas/core/snapshot-closure.schema.json',
 'schemas/evaluator/output.schema.json',
 'schemas/evaluator/rule.schema.json',
 'schemas/evaluator/semantic-projection.schema.json',
 'schemas/manifest.json',
 'scripts/capture-snapshot-closure.mjs',
 'scripts/check-knowledge.mjs',
 'scripts/pack-ustar.mjs',
 'scripts/strict-json.mjs',
 'scripts/ux-evaluate.mjs',
 'scripts/validate-skill.mjs'
]);

let packer=null;
try{packer=await import('../../scripts/pack-ustar.mjs');}catch{}

if(packer===null){
 test('Task 13 starts RED because the canonical packer is absent',()=>assert.fail(MARKER));
}else{
 const {packCanonicalUstar}=packer;
 const code=(expected)=>({code:expected});
 const runCli=(cwd,manifest,output,{env={},entry=PACKER}={})=>new Promise((done)=>{
  const child=spawn(process.execPath,[entry,manifest,output],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  const stdout=[],stderr=[];
  child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));
  child.on('close',(status,signal)=>done({status,signal,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')}));
 });
 const runProcess=(command,args,cwd,stdin=undefined)=>new Promise((done,reject)=>{
  const child=spawn(command,args,{cwd,env:{...process.env,LANG:'C',LC_ALL:'C',TZ:'UTC'},stdio:[stdin===undefined?'ignore':'pipe','pipe','pipe']});
  const stdout=[],stderr=[];
  child.stdout.on('data',(chunk)=>stdout.push(chunk));child.stderr.on('data',(chunk)=>stderr.push(chunk));child.on('error',reject);
  child.on('close',(status,signal)=>done({status,signal,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')}));
  if(stdin!==undefined)child.stdin.end(stdin);
 });
 const tempRoot=async()=>mkdtemp(join(tmpdir(),'ux-skill-artifact-'));
 const manifestPath=(root)=>join(root,'knowledge','artifact-manifest.json');
 const putManifest=async(root,source)=>{await mkdir(join(root,'knowledge'),{recursive:true});await writeFile(manifestPath(root),source);return manifestPath(root);};
 const goodManifest=(paths)=>Buffer.from(JSON.stringify({manifest_version:'artifact-manifest-v1',paths})+'\n','utf8');
 const archiveEntries=(bytes)=>{
  const rows=[];let offset=0,zeroBlocks=0;
  while(offset<bytes.length){
   const header=bytes.subarray(offset,offset+512);assert.equal(header.length,512);
   if(header.every((value)=>value===0)){zeroBlocks+=1;offset+=512;continue;}
   assert.equal(zeroBlocks,0);
   const nameEnd=header.indexOf(0);assert.ok(nameEnd>0);
   const name=header.subarray(0,nameEnd).toString('utf8');
   const modeField=Buffer.from(header.subarray(100,108));
   const mode=Number.parseInt(modeField.subarray(0,7).toString('ascii'),8);assert.ok(Number.isSafeInteger(mode));
   const sizeText=header.subarray(124,135).toString('ascii');
   const size=Number.parseInt(sizeText,8);assert.ok(Number.isSafeInteger(size));
   const content=bytes.subarray(offset+512,offset+512+size);
   rows.push({path:name,mode,modeField,content:Buffer.from(content)});
   offset+=512+Math.ceil(size/512)*512;
  }
  assert.equal(zeroBlocks,2);return rows;
 };
 const expectCliFailure=async(root,manifest,output,expected,{env={}}={})=>{
  const result=await runCli(root,manifest,output,{env});
  assert.notEqual(result.status,0);assert.equal(result.signal,null);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),expected);return result;
 };
 const utf8Sort=(rows)=>[...rows].sort((left,right)=>Buffer.compare(Buffer.from(left,'utf8'),Buffer.from(right,'utf8')));

 test('ART-ONEFILE-001 is an independent byte-exact ustar golden',async()=>{
  const golden=parseKnowledgeJson(await readFile(join(ROOT,'evals','artifact','ART-ONEFILE-001.json')),'ART-ONEFILE-001.json','GOLDEN_INVALID');
  const input=await readFile(join(ROOT,'evals','artifact','one-file-input',golden.path));
  assert.equal(input.toString('base64'),golden.file_base64);
  const bytes=packCanonicalUstar([{path:golden.path,content:input}]);
  assert.equal(bytes.length,golden.archive_length);
  assert.equal(bytes.toString('base64'),golden.archive_base64);
  assert.equal(digest('ux-skill:artifact:v1',bytes),golden.artifact_digest);
 });

 test('canonical ustar sorts by unsigned UTF-8 bytes and is input-order independent',()=>{
  const forward=[{path:'z',content:Buffer.from('last')},{path:'é',content:Buffer.from('unicode')},{path:'a',content:Buffer.from('first')}];
  const left=packCanonicalUstar(forward),right=packCanonicalUstar([...forward].reverse());
  assert.deepEqual(left,right);
  assert.deepEqual(archiveEntries(left).map((row)=>row.path),utf8Sort(forward.map((row)=>row.path)));
 });

 test('canonical ustar rejects every non-canonical path and duplicate path',()=>{
  const invalid=['','/a','a/','a//b','.','..','a/../b','a\\b','a%2Fb','a%5Cb','e\u0301','a^@b','a'.repeat(101)];
  for(const path of invalid)assert.throws(()=>packCanonicalUstar([{path,content:Buffer.alloc(0)}]),code('USTAR_PATH_INVALID'),path);
  assert.throws(()=>packCanonicalUstar([{path:'a',content:Buffer.alloc(0)},{path:'a',content:Buffer.alloc(0)}]),code('USTAR_DUPLICATE_PATH'));
 });

 test('canonical ustar accepts only closed plain entry arrays and owned Buffer snapshots',()=>{
  assert.throws(()=>packCanonicalUstar(new Proxy([],{get:Reflect.get})),code('USTAR_INPUT_INVALID'));
  const sparse=[];sparse.length=1;assert.throws(()=>packCanonicalUstar(sparse),code('USTAR_INPUT_INVALID'));
  assert.throws(()=>packCanonicalUstar([{path:'a',content:Buffer.alloc(0),extra:true}]),code('USTAR_INPUT_INVALID'));
  assert.throws(()=>packCanonicalUstar([{path:'a',get content(){return Buffer.alloc(0);}}]),code('USTAR_INPUT_INVALID'));
  assert.throws(()=>packCanonicalUstar([new Proxy({path:'a',content:Buffer.alloc(0)},{get:Reflect.get})]),code('USTAR_INPUT_INVALID'));
  assert.throws(()=>packCanonicalUstar([{path:'a',content:new Uint8Array()}]),code('USTAR_INPUT_INVALID'));
  const input=Buffer.from('x'),bytes=packCanonicalUstar([{path:'a',content:input}]);input[0]=0x79;
  assert.equal(archiveEntries(bytes)[0].content.toString(),'x');
 });

 test('canonical ustar enforces bounded entry, per-file, and total content budgets before allocation',()=>{
  const empty=[];for(let index=0;index<4097;index+=1)empty.push({path:`f/${String(index).padStart(4,'0')}`,content:Buffer.alloc(0)});
  assert.throws(()=>packCanonicalUstar(empty),code('USTAR_ENTRY_LIMIT'));
  assert.throws(()=>packCanonicalUstar([{path:'large',content:Buffer.alloc(16_777_217)}]),code('USTAR_FILE_TOO_LARGE'));
  const block=Buffer.alloc(16_777_216);
  assert.throws(()=>packCanonicalUstar([{path:'a',content:block},{path:'b',content:block},{path:'c',content:Buffer.from('x')}]),code('USTAR_TOTAL_TOO_LARGE'));
 });

 test('CLI reads only the manifest exact paths, ignores unlisted files, avoids system tar, and reproduces bytes',async(t)=>{
  const root=await tempRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'a'),Buffer.from('a'));await writeFile(join(root,'unlisted-secret'),Buffer.from('secret'));
  const manifest=await putManifest(root,goodManifest(['a'])),one=join(root,'one.tar'),two=join(root,'two.tar');
  const first=await runCli(root,manifest,one,{env:{PATH:''}}),second=await runCli(root,manifest,two,{env:{PATH:''}});
  assert.equal(first.status,0,first.stderr);assert.equal(second.status,0,second.stderr);assert.equal(first.stdout,'');assert.equal(first.stderr,'');
  const left=await readFile(one),right=await readFile(two);assert.deepEqual(left,right);assert.deepEqual(archiveEntries(left).map((row)=>row.path),['a']);
 });

 test('CLI manifest parsing is strict UTF-8, BOM-free, duplicate-aware, NFC, closed, sorted, unique, and glob-free',async(t)=>{
  const root=await tempRoot();t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'a'),Buffer.from('a'));await writeFile(join(root,'b'),Buffer.from('b'));
  const invalid=[
   Buffer.from([0xff]),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),goodManifest(['a'])]),
   Buffer.from('{"manifest_version":"artifact-manifest-v1","manifest_version":"artifact-manifest-v1","paths":["a"]}\n'),
   Buffer.from('{"manifest_version":"artifact-manifest-v1","paths":["a"],"extra":true}\n'),
   goodManifest(['b','a']),goodManifest(['a','a']),goodManifest(['*']),goodManifest(['e\u0301'])
  ];
  for(let index=0;index<invalid.length;index+=1){const manifest=await putManifest(root,invalid[index]);await expectCliFailure(root,manifest,join(root,`bad-${index}.tar`),'ARTIFACT_MANIFEST_INVALID');}
 });

 test('CLI rejects manifest symlinks, source symlinks, directories, and hard-link aliases',async(t)=>{
  const root=await tempRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'real'),Buffer.from('x'));await symlink('real',join(root,'symbolic'));await mkdir(join(root,'directory'));await link(join(root,'real'),join(root,'alias'));
  let manifest=await putManifest(root,goodManifest(['symbolic']));await expectCliFailure(root,manifest,join(root,'symbolic.tar'),'ARTIFACT_INPUT_UNSAFE');
  manifest=await putManifest(root,goodManifest(['directory']));await expectCliFailure(root,manifest,join(root,'directory.tar'),'ARTIFACT_INPUT_UNSAFE');
  manifest=await putManifest(root,goodManifest(['alias','real']));await expectCliFailure(root,manifest,join(root,'alias.tar'),'ARTIFACT_INPUT_ALIAS');
  const realManifest=join(root,'real-manifest.json');await writeFile(realManifest,goodManifest(['real']));await rm(manifestPath(root));await symlink('../real-manifest.json',manifestPath(root));
  await expectCliFailure(root,manifestPath(root),join(root,'manifest-link.tar'),'ARTIFACT_MANIFEST_INVALID');
 });

 test('CLI rejects output self-inclusion and unsafe output aliases without changing their targets',async(t)=>{
  const root=await tempRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'output.tar'),Buffer.from('sentinel'));let manifest=await putManifest(root,goodManifest(['output.tar']));
  await expectCliFailure(root,manifest,join(root,'output.tar'),'ARTIFACT_OUTPUT_SELF');assert.equal((await readFile(join(root,'output.tar'))).toString(),'sentinel');
  await writeFile(join(root,'a'),Buffer.from('a'));await writeFile(join(root,'victim'),Buffer.from('victim'));await symlink('victim',join(root,'link.tar'));manifest=await putManifest(root,goodManifest(['a']));
  await expectCliFailure(root,manifest,join(root,'link.tar'),'ARTIFACT_OUTPUT_UNSAFE');assert.equal((await readFile(join(root,'victim'))).toString(),'victim');
 });

 test('CLI detects resize and same-size overwrite races and preserves the previous output atomically',async(t)=>{
  const root=await tempRoot();t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source.bin'),replacement=join(root,'replacement.bin'),output=join(root,'artifact.tar'),raceMarker=join(root,'race.json');
  await writeFile(source,Buffer.alloc(8192,0x61));await writeFile(replacement,Buffer.alloc(8192,0x62));await writeFile(output,Buffer.from('sentinel'));const manifest=await putManifest(root,goodManifest(['source.bin']));
  await expectCliFailure(root,manifest,output,'ARTIFACT_INPUT_CHANGED',{env:{NODE_OPTIONS:`--require=${RACE_HELPER}`,TASK11_RACE_PATH:source,TASK11_RACE_MODE:'resize-after-stat',TASK11_RACE_SIZE:'1'}});assert.equal((await readFile(output)).toString(),'sentinel');
  await writeFile(source,Buffer.alloc(8192,0x61));await expectCliFailure(root,manifest,output,'ARTIFACT_INPUT_CHANGED',{env:{NODE_OPTIONS:`--require=${RACE_HELPER}`,TASK11_RACE_PATH:source,TASK11_RACE_MODE:'same-size-overwrite',TASK11_RACE_REPLACEMENT_PATH:replacement,TASK11_RACE_PARTIAL_BYTES:'1024',TASK11_RACE_MARKER_PATH:raceMarker}});
  assert.equal(JSON.parse(await readFile(raceMarker,'utf8')).fired,true);assert.equal((await readFile(output)).toString(),'sentinel');
 });

 test('CLI rejects a large sparse file from metadata before reading its content',async(t)=>{
  const root=await tempRoot();t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'sparse.bin'),telemetry=join(root,'telemetry.jsonl'),output=join(root,'artifact.tar');
  const handle=await open(source,fsConstants.O_CREAT|fsConstants.O_EXCL|fsConstants.O_WRONLY,0o600);try{await handle.truncate(16_777_217);}finally{await handle.close();}
  const manifest=await putManifest(root,goodManifest(['sparse.bin']));await expectCliFailure(root,manifest,output,'ARTIFACT_INPUT_TOO_LARGE',{env:{NODE_OPTIONS:`--require=${TELEMETRY_HELPER}`,TASK11_ARTIFACT_TARGET:source,TASK11_ARTIFACT_TELEMETRY:telemetry}});
  const events=(await readFile(telemetry,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);assert.ok(events.some((row)=>row.op==='open'));assert.ok(events.every((row)=>row.op!=='read'&&row.op!=='readFile'));
 });

 test('committed artifact manifest is the exact current distributable surface and every path is a real file',async()=>{
  const raw=await readFile(join(ROOT,'knowledge','artifact-manifest.json'));const manifest=parseKnowledgeJson(raw,'knowledge/artifact-manifest.json','ARTIFACT_MANIFEST_INVALID');
  assert.deepEqual(Object.keys(manifest),['manifest_version','paths']);assert.equal(manifest.manifest_version,'artifact-manifest-v1');assert.deepEqual(manifest.paths,EXPECTED_DISTRIBUTION);assert.deepEqual(manifest.paths,utf8Sort(manifest.paths));
  for(const path of manifest.paths){const info=await stat(join(ROOT,...path.split('/')));assert.equal(info.isFile(),true,path);assert.equal(info.isSymbolicLink(),false,path);}
  for(const forbidden of ['docs/superpowers/specs/2026-08-18-evidence-aware-product-ux-skill-design.md','evals/tests/artifact.test.mjs','.github/workflows/implementation-ci.yml'])assert.equal(manifest.paths.includes(forbidden),false,forbidden);
 });

 test('artifact evaluator subset equals both the exact manifest and real recursive import closure',async()=>{
  const artifact=JSON.parse(await readFile(join(ROOT,'knowledge','artifact-manifest.json'),'utf8'));const evaluator=JSON.parse(await readFile(join(ROOT,'evaluator','manifest.json'),'utf8'));
  const subset=artifact.paths.filter((path)=>/^evaluator\/[^/]+\.mjs$/u.test(path));const declared=evaluator.evaluator_files.map((row)=>row.path);const closure=await collectLocalEvaluatorImportClosure({repositoryRoot:ROOT});
  assert.deepEqual(subset,declared);assert.deepEqual(subset,closure);assert.equal(subset.length,9);
 });

 test('artifact covers package release scripts, Skill links, and every local module import closure without inventing a capture registry',async()=>{
  const artifact=JSON.parse(await readFile(join(ROOT,'knowledge','artifact-manifest.json'),'utf8'));const included=new Set(artifact.paths);const pkg=JSON.parse(await readFile(join(ROOT,'package.json'),'utf8'));
  assert.equal(pkg.dependencies['es-module-lexer'],'2.3.2');assert.equal(pkg.devDependencies?.['es-module-lexer'],undefined);
  const releaseScripts=['artifact:pack','capture:closure','knowledge:check','skill:check','ux:evaluate'];
  for(const name of releaseScripts){const match=/^node ([^ ]+\.mjs)(?: |$)/u.exec(pkg.scripts[name]);assert.ok(match,name);assert.equal(included.has(match[1]),true,match[1]);}
  const skill=await readFile(join(ROOT,'SKILL.md'),'utf8');for(const path of ['knowledge/manifest.json','scripts/ux-evaluate.mjs'])assert.equal(skill.includes(`](${path})`),true,path);
  await initModuleLexer;const roots=['scripts/ux-evaluate.mjs','scripts/capture-snapshot-closure.mjs','scripts/check-knowledge.mjs','scripts/validate-skill.mjs','scripts/pack-ustar.mjs','adapters/hulianui/bridge.mjs'];const visited=new Set();
  const visit=async(path)=>{if(visited.has(path))return;visited.add(path);const source=await readFile(join(ROOT,...path.split('/')),'utf8');for(const row of parseModule(source)[0]){if(row.n===undefined||row.n===null||!row.n.startsWith('.'))continue;const resolvedPath=fileURLToPath(new URL(row.n,pathToFileURL(join(ROOT,...path.split('/')))));const relative=pathRelative(ROOT,resolvedPath).split('\\').join('/');assert.equal(relative.startsWith('../'),false,row.n);await visit(relative);}};
  for(const path of roots)await visit(path);for(const path of visited)assert.equal(included.has(path),true,path);
  assert.equal(artifact.paths.some((path)=>/capture-(?:registry|runner|transport)/u.test(path)),false);
 });
 test('CLI path identity distinguishes system aliases, caller symlinks, imports, and direct entrypoints',async(t)=>{
  const failures=[];
  const capture=async(label,operation)=>{try{await operation();}catch(error){failures.push(label+': '+error.message);}};
  const expectMissing=async(path)=>assert.rejects(readFile(path),(error)=>error?.code==='ENOENT');
  let temporaryAlias=tmpdir();
  try{await realpath('/tmp');temporaryAlias='/tmp';}catch{}
  const lexicalSandbox=await mkdtemp(join(temporaryAlias,'ux-skill-task13-path-'));
  const physicalSandbox=await realpath(lexicalSandbox);
  t.after(()=>rm(physicalSandbox,{recursive:true,force:true}));
  const lexicalRunner=join(lexicalSandbox,'runner');
  for(const path of ['scripts/pack-ustar.mjs','scripts/strict-json.mjs','evaluator/canonical.mjs']){
   const target=join(lexicalRunner,...path.split('/'));await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(join(ROOT,...path.split('/'))));
  }
  await cp(join(ROOT,'node_modules','json-canonicalize'),join(lexicalRunner,'node_modules','json-canonicalize'),{recursive:true});
  const lexicalPacker=join(lexicalRunner,'scripts','pack-ustar.mjs');
  const physicalPacker=await realpath(lexicalPacker);
  const lexicalRepository=join(lexicalSandbox,'repository');
  await mkdir(lexicalRepository);await writeFile(join(lexicalRepository,'a'),Buffer.from('a'));
  const lexicalManifest=await putManifest(lexicalRepository,goodManifest(['a']));
  const physicalRepository=await realpath(lexicalRepository);
  const physicalManifest=join(physicalRepository,'knowledge','artifact-manifest.json');

  const aliasOutput=join(lexicalRepository,'system-alias.tar');
  const aliasRun=await runCli(lexicalRepository,lexicalManifest,aliasOutput,{entry:lexicalPacker});
  await capture('canonical system alias direct entry exits zero',async()=>{assert.equal(aliasRun.signal,null);assert.equal(aliasRun.status,0,aliasRun.stderr);assert.equal(aliasRun.stdout,'');assert.equal(aliasRun.stderr,'');});
  await capture('canonical system alias direct entry produces the archive',async()=>{assert.deepEqual(archiveEntries(await readFile(aliasOutput)).map((row)=>row.path),['a']);});

  const physicalOutput=join(physicalRepository,'physical-entry.tar');
  const physicalRun=await runCli(physicalRepository,physicalManifest,physicalOutput,{entry:physicalPacker});
  await capture('physical direct entry exits zero',async()=>{assert.equal(physicalRun.signal,null);assert.equal(physicalRun.status,0,physicalRun.stderr);assert.equal(physicalRun.stdout,'');assert.equal(physicalRun.stderr,'');});
  await capture('physical direct entry produces the archive',async()=>{assert.deepEqual(archiveEntries(await readFile(physicalOutput)).map((row)=>row.path),['a']);});

  const imported=await runProcess(process.execPath,['--input-type=module','--eval',`await import(${JSON.stringify(pathToFileURL(physicalPacker).href)})`],physicalSandbox);
  await capture('import-only does not execute main',async()=>{assert.equal(imported.signal,null);assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');});

  const userRepositoryAlias=join(physicalSandbox,'caller-created-repository-alias');
  await symlink(physicalRepository,userRepositoryAlias,'dir');
  const aliasedManifest=join(userRepositoryAlias,'knowledge','artifact-manifest.json');
  const aliasedOutput=join(userRepositoryAlias,'caller-alias.tar');
  const telemetry=join(physicalSandbox,'caller-alias-telemetry.jsonl');
  const rejected=await runCli(physicalSandbox,aliasedManifest,aliasedOutput,{entry:physicalPacker,env:{NODE_OPTIONS:`--require=${TELEMETRY_HELPER}`,TASK11_ARTIFACT_TARGET:join(physicalRepository,'a'),TASK11_ARTIFACT_TELEMETRY:telemetry}});
  await capture('caller-created repository symlink exits nonzero',async()=>{assert.equal(rejected.signal,null);assert.notEqual(rejected.status,0);});
  await capture('caller-created repository symlink has one explicit error',async()=>{assert.equal(rejected.stdout,'');assert.equal(rejected.stderr,'ARTIFACT_MANIFEST_INVALID\n');});
  await capture('caller-created repository symlink creates no artifact',()=>expectMissing(aliasedOutput));
  await capture('caller-created repository symlink is rejected before source read',()=>expectMissing(telemetry));

  const linkedPacker=join(physicalSandbox,'caller-created-packer-link.mjs');
  await symlink(physicalPacker,linkedPacker,'file');
  const linkedOutput=join(physicalRepository,'linked-entry.tar');
  const linkedRun=await runCli(physicalRepository,physicalManifest,linkedOutput,{entry:linkedPacker});
  await capture('symlinked packer direct invocation cannot silently succeed',async()=>{assert.equal(linkedRun.signal,null);assert.equal(linkedRun.status,0,linkedRun.stderr);assert.equal(linkedRun.stdout,'');assert.equal(linkedRun.stderr,'');});
  await capture('symlinked packer direct invocation produces the archive',async()=>{assert.deepEqual(archiveEntries(await readFile(linkedOutput)).map((row)=>row.path),['a']);});

  if(failures.length>0)assert.fail('TASK13_PATH_IDENTITY_RED\n'+failures.join('\n'));
 });

 test('canonical 0644 archive is a runnable Skill closure after fresh production install',async(t)=>{
  const failures=[];
  const sourceCli=join(ROOT,'scripts','ux-evaluate.mjs');
  const sourceStatus=await stat(sourceCli);
  assert.notEqual(sourceStatus.mode&0o111,0,'source checkout CLI must remain executable');
  const gitMode=await runProcess('git',['ls-files','--stage','--','scripts/ux-evaluate.mjs'],ROOT);
  assert.equal(gitMode.status,0,gitMode.stderr);
  assert.match(gitMode.stdout,/^100755 [0-9a-f]{40} 0\tscripts\/ux-evaluate\.mjs\n$/u,'source Git CLI mode must remain exactly 100755');

  const root=await tempRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const archive=join(ROOT,'.task13-runtime-'+process.pid+'-'+Date.now()+'.tar');
  t.after(()=>rm(archive,{force:true}));
  const packed=await runCli(ROOT,join(ROOT,'knowledge','artifact-manifest.json'),archive);
  assert.equal(packed.signal,null);assert.equal(packed.status,0,packed.stderr);assert.equal(packed.stdout,'');assert.equal(packed.stderr,'');
  const rows=archiveEntries(await readFile(archive));
  assert.equal(rows.length,56,'the distributable archive must contain the exact 56-path closure');
  for(const row of rows){
   assert.deepEqual(row.modeField,Buffer.from('0000644\0','ascii'),row.path);
   assert.equal(row.mode,0o644,row.path);
  }

  const extracted=join(root,'extracted');await mkdir(extracted);
  for(const row of rows){
   const target=join(extracted,...row.path.split('/'));
   await mkdir(dirname(target),{recursive:true});
   await writeFile(target,row.content,{mode:row.mode});
   await chmod(target,row.mode);
  }
  for(const row of rows){
   const extractedStatus=await stat(join(extracted,...row.path.split('/')));
   assert.equal(extractedStatus.mode&0o777,0o644,row.path);
  }
  const pkg=JSON.parse(await readFile(join(extracted,'package.json'),'utf8'));
  assert.equal(pkg.bin['ux-evaluate'],'scripts/ux-evaluate.mjs');
  assert.equal(pkg.scripts['ux:evaluate'],'node scripts/ux-evaluate.mjs');
  assert.equal(pkg.scripts['skill:check'],'node scripts/validate-skill.mjs');

  const installed=await runProcess('pnpm',['install','--offline','--prod','--frozen-lockfile','--ignore-scripts'],extracted);
  if(installed.signal!==null||installed.status!==0)failures.push('production install:status '+installed.status+' stderr '+installed.stderr.trim());
  const extractedCliStatus=await stat(join(extracted,'scripts','ux-evaluate.mjs'));
  if((extractedCliStatus.mode&0o777)!==0o644)failures.push('production install changed canonical CLI mode to '+(extractedCliStatus.mode&0o777).toString(8));

  const skill=await runProcess('pnpm',['--silent','skill:check'],extracted);
  if(skill.signal!==null||skill.status!==0||skill.stderr!==''||!/^skill=ok name=improving-product-ux modes=4\n$/u.test(skill.stdout)){
   failures.push('skill:check:status '+skill.status+' stdout '+JSON.stringify(skill.stdout)+' stderr '+JSON.stringify(skill.stderr));
  }
  for(const mode of ['guide','scan','refactor','verify']){
   const input=await readFile(join(ROOT,'evals','parity',mode+'.json'));
   const result=await runProcess('pnpm',['--silent','ux:evaluate','--mode',mode,'--input','-','--output','json'],extracted,input);
   let output;try{output=JSON.parse(result.stdout);}catch{}
   if(result.signal!==null||result.status!==0||result.stderr!==''||output===undefined||result.stdout!==JSON.stringify(output)+'\n')failures.push('documented '+mode+':status '+result.status+' stderr '+JSON.stringify(result.stderr));
  }
  if(failures.length>0)assert.fail('TASK13_CANONICAL_0644_RUNTIME_RED:'+failures.join('|'));
 });

}
