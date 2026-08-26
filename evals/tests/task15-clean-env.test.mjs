import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {evaluate} from '../../evaluator/index.mjs';
import {deleteBundle,hulianDeleteBundle} from '../helpers/fixtures.mjs';
import {assertKnowledgeFileSnapshot,checkKnowledge} from '../../scripts/check-knowledge.mjs';
import {packCanonicalUstar} from '../../scripts/pack-ustar.mjs';
import {validateSkill} from '../../scripts/validate-skill.mjs';
import {captureRegistryDigest,createCaptureRegistry,runCaptureCli} from '../../scripts/capture-snapshot-closure.mjs';
import {recordBaseline} from '../../scripts/run-red-baseline.mjs';

const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const WORKFLOWS=join(ROOT,'.github','workflows');
const ACTIONS=Object.freeze({
 'actions/checkout':'11d5960a326750d5838078e36cf38b85af677262',
 'actions/setup-node':'49933ea5288caeca8642d1e84afbd3f7d6820020',
 'pnpm/action-setup':'fc06bc1257f339d1d5d8b3a19a8cae5388b55320',
 'actions/upload-artifact':'ea165f8d65b6e75b540449e92b4886f43607fa02'
});
const REQUIRED_JOBS=['golden','pack-repro','release-report','unit'];
const WARNING='Zero findings does not mean UX is good, compliant, successful, or satisfying.';
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const run=(entry)=>new Promise((done)=>{
 const child=spawn(process.execPath,[entry],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
 const stdout=[],stderr=[];
 child.stdout.on('data',(chunk)=>stdout.push(chunk));
 child.stderr.on('data',(chunk)=>stderr.push(chunk));
 child.once('error',(error)=>done({code:null,error,stdout:'',stderr:''}));
 child.once('close',(code,signal)=>done({code,signal,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')}));
});
const workflowIssues=(source,label)=>{
 const issues=[];let workflow;
 try{workflow=parse(source);}catch(error){return[label+':yaml:'+(error?.code??error?.name)];}
 if(workflow?.permissions?.contents!=='read'||Object.keys(workflow.permissions??{}).length!==1)issues.push(label+':permissions');
 if(!workflow?.concurrency?.group||workflow.concurrency['cancel-in-progress']!==true)issues.push(label+':concurrency');
 if(workflow?.defaults?.run?.shell!=='bash')issues.push(label+':default-shell');
 const jobs=workflow?.jobs;
 if(!jobs||typeof jobs!=='object')return[...issues,label+':jobs-missing'];
 for(const [jobName,job] of Object.entries(jobs)){
  if(job?.['runs-on']!=='ubuntu-latest')issues.push(label+':runs-on:'+jobName);
  if(!Number.isInteger(job?.['timeout-minutes'])||job['timeout-minutes']<1||job['timeout-minutes']>30)issues.push(label+':timeout:'+jobName);
  if(job?.['continue-on-error']!==undefined)issues.push(label+':job-continue-on-error:'+jobName);
  if(job?.permissions!==undefined)issues.push(label+':job-permissions:'+jobName);
  if(job?.if!==undefined)issues.push(label+':job-if:'+jobName);
  const steps=Array.isArray(job?.steps)?job.steps:[];
  for(const step of steps){
   if(step?.['continue-on-error']!==undefined)issues.push(label+':continue-on-error:'+jobName);
   if(label==='ci'&&step?.if!==undefined&&!(jobName==='release-report'&&typeof step?.uses==='string'&&step.uses.startsWith('actions/upload-artifact@')&&step.if==='always()'))issues.push(label+':step-if:'+jobName);
   if(typeof step?.uses==='string'){
    const [repo,commit]=step.uses.split('@');
    if(ACTIONS[repo]!==commit||!/^[0-9a-f]{40}$/u.test(commit??''))issues.push(label+':mutable-action:'+step.uses);
   }
  }
 }
 const flattened=JSON.stringify(workflow);
 if(/(?:npm\s+publish|gh\s+release|create-release)/iu.test(flattened))issues.push(label+':publishes');
 return issues;
};
const prepareBundles=async()=>{
 const golden=JSON.parse(await readFile(new URL('../golden/high-risk-delete.json',import.meta.url),'utf8')).bundle;
 return[deleteBundle(),hulianDeleteBundle()].map((fixture)=>{
  const bundle=structuredClone(fixture);
  for(const field of ['source_registry_refs','evidence','claims','policy_digests'])bundle[field]=structuredClone(golden[field]);
  return bundle;
 });
};
const checkOutputs=async(issues)=>{
 for(const bundle of await prepareBundles()){
  let output;
  try{output=await evaluate(bundle);}catch(error){issues.push('prohibited:evaluate:'+(error?.code??error?.name));continue;}
  const actual=JSON.stringify(output);
  for(const claim of ['wcag_conformant','user_success','ux_good'])if(actual.includes(JSON.stringify(claim)))issues.push('prohibited:'+claim);
  if(output.assurance?.warning!==WARNING)issues.push('prohibited:warning');
 }
};
const systemAliasFor=async(physical)=>{
 for(const [lexical,target] of [['/tmp','/private/tmp'],['/var','/private/var']]){
  let actual;try{actual=await realpath(lexical);}catch{continue;}
  if(actual!==target)continue;
  if(physical===target||physical.startsWith(target+'/'))return resolve(lexical,relative(target,physical));
 }
 return physical;
};
const captureRegistryFixture=async(root)=>{
 await mkdir(root,{recursive:true});
 const runner='export async function run() {}\n';
 const transport='export async function request() {}\n';
 await writeFile(join(root,'runner.mjs'),runner);
 await writeFile(join(root,'transport.mjs'),transport);
 const manifest={registry_version:'snapshot-capture-registry-v1',entries:[{case_id:'RW-TASK15-PATH-001',task_script_digest:'1'.repeat(64),runner_path:'runner.mjs',runner_digest:sha(Buffer.from(runner)),runner_module_closure:[{relative_path:'runner.mjs',raw_sha256:sha(Buffer.from(runner))}],transport_path:'transport.mjs',transport_digest:sha(Buffer.from(transport)),transport_module_closure:[{relative_path:'transport.mjs',raw_sha256:sha(Buffer.from(transport))}]}],registry_digest:''};
 manifest.registry_digest=captureRegistryDigest(manifest);
 const manifestPath=join(root,'capture-registry.json');
 await writeFile(manifestPath,JSON.stringify(manifest)+'\n');
 return manifestPath;
};
const expectKnowledgeOptions=async(issues)=>{
 const nullPrototype=Object.create(null);
 Object.defineProperty(nullPrototype,'repositoryRoot',{value:ROOT,enumerable:true,writable:true,configurable:true});
 try{await checkKnowledge(nullPrototype);}catch(error){issues.push('knowledge:null-prototype:'+(error?.code??error?.name));}
 let getterCalls=0;
 const getter={};
 Object.defineProperty(getter,'repositoryRoot',{enumerable:true,get(){getterCalls+=1;return ROOT;}});
 try{await checkKnowledge(getter);issues.push('knowledge:getter-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_OPTIONS_INVALID')issues.push('knowledge:getter-code:'+(error?.code??error?.name));}
 if(getterCalls!==0)issues.push('knowledge:getter-executed:'+getterCalls);
 const trap=()=>{throw new Error('TRAP_EXECUTED');};
 for(const [label,options] of [['proxy',new Proxy({repositoryRoot:ROOT},{ownKeys:trap})],['inherited',Object.create({repositoryRoot:ROOT})],['symbol',{[Symbol('repositoryRoot')]:ROOT}],['extra',{repositoryRoot:ROOT,extra:true}]]){
  try{await checkKnowledge(options);issues.push('knowledge:'+label+'-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_OPTIONS_INVALID')issues.push('knowledge:'+label+'-code:'+(error?.code??error?.name));}
 }
 let statGetterCalls=0;
 const getterStat={get size(){statGetterCalls+=1;return 1n;},dev:1n,ino:1n};
 try{assertKnowledgeFileSnapshot(getterStat,{size:1n,dev:1n,ino:1n},1,'fixture');issues.push('knowledge:stat-getter-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_FILE_CHANGED_DURING_READ')issues.push('knowledge:stat-getter-code:'+(error?.code??error?.name));}
 if(statGetterCalls!==0)issues.push('knowledge:stat-getter-executed:'+statGetterCalls);
 for(const field of ['size','dev','ino']){
  for(const kind of ['object','function','symbol']){
   let coercionCalls=0,hostile;
   if(kind==='object')hostile={
    [Symbol.toPrimitive](){coercionCalls+=1;return 1n;},
    valueOf(){coercionCalls+=1;return 1n;},
    toString(){coercionCalls+=1;return '1';}
   };
   if(kind==='function'){
    hostile=function hostileStatValue(){coercionCalls+=1;};
    Object.defineProperty(hostile,Symbol.toPrimitive,{value(){coercionCalls+=1;return 1n;}});
   }
   if(kind==='symbol')hostile=Symbol('hostile-stat-value');
   const before={size:1n,dev:1n,ino:1n},after={size:1n,dev:1n,ino:1n};before[field]=hostile;after[field]=hostile;
   try{assertKnowledgeFileSnapshot(before,after,1,'fixture');issues.push('knowledge:stat-'+field+'-'+kind+'-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_FILE_CHANGED_DURING_READ')issues.push('knowledge:stat-'+field+'-'+kind+'-code:'+(error?.code??error?.name));}
   if(coercionCalls!==0)issues.push('knowledge:stat-'+field+'-'+kind+'-coerced:'+coercionCalls);
  }
  for(const [kind,primitive,sizeBytesRead] of [['number',1,1],['string','1',1],['boolean',true,1],['null',null,0],['undefined',undefined,1]]){
   const before={size:1n,dev:1n,ino:1n},after={size:1n,dev:1n,ino:1n};before[field]=primitive;after[field]=primitive;
   const bytesRead=field==='size'?sizeBytesRead:1;
   try{assertKnowledgeFileSnapshot(before,after,bytesRead,'fixture');issues.push('knowledge:stat-'+field+'-'+kind+'-primitive-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_FILE_CHANGED_DURING_READ')issues.push('knowledge:stat-'+field+'-'+kind+'-primitive-code:'+(error?.code??error?.name));}
  }
  const negativeBefore={size:1n,dev:1n,ino:1n},negativeAfter={size:1n,dev:1n,ino:1n};negativeBefore[field]=-1n;negativeAfter[field]=-1n;
  try{assertKnowledgeFileSnapshot(negativeBefore,negativeAfter,field==='size'?0:1,'fixture');issues.push('knowledge:stat-'+field+'-negative-bigint-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_FILE_CHANGED_DURING_READ')issues.push('knowledge:stat-'+field+'-negative-bigint-code:'+(error?.code??error?.name));}
  let boxedCoercionCalls=0;
  const boxed=Object(1n);
  Object.defineProperty(boxed,Symbol.toPrimitive,{configurable:true,get(){boxedCoercionCalls+=1;throw new Error('BOXED_BIGINT_COERCION_EXECUTED');}});
  const boxedBefore={size:1n,dev:1n,ino:1n},boxedAfter={size:1n,dev:1n,ino:1n};boxedBefore[field]=boxed;boxedAfter[field]=boxed;
  try{assertKnowledgeFileSnapshot(boxedBefore,boxedAfter,1,'fixture');issues.push('knowledge:stat-'+field+'-boxed-bigint-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_FILE_CHANGED_DURING_READ')issues.push('knowledge:stat-'+field+'-boxed-bigint-code:'+(error?.code??error?.name));}
  if(boxedCoercionCalls!==0)issues.push('knowledge:stat-'+field+'-boxed-bigint-coerced:'+boxedCoercionCalls);
 }
 let pathCoercionCalls=0;
 const hostilePath={
  [Symbol.toPrimitive](){pathCoercionCalls+=1;throw new Error('PATH_COERCION_EXECUTED');},
  valueOf(){pathCoercionCalls+=1;throw new Error('PATH_VALUE_OF_EXECUTED');},
  toString(){pathCoercionCalls+=1;throw new Error('PATH_TO_STRING_EXECUTED');}
 };
 try{assertKnowledgeFileSnapshot({size:1n,dev:1n,ino:1n},{size:2n,dev:1n,ino:1n},1,hostilePath);issues.push('knowledge:stat-hostile-path-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_FILE_CHANGED_DURING_READ')issues.push('knowledge:stat-hostile-path-code:'+(error?.code??error?.name));}
 if(pathCoercionCalls!==0)issues.push('knowledge:stat-hostile-path-coerced:'+pathCoercionCalls);
};
const expectPackBufferBoundaries=(issues)=>{
 for(const property of ['buffer','byteLength','length']){
  let getterCalls=0;
  const hostile=Buffer.from('x');
  Object.defineProperty(hostile,property,{configurable:true,get(){getterCalls+=1;throw new Error('BUFFER_SHADOW_GETTER_EXECUTED');}});
  try{packCanonicalUstar([{path:'fixture.txt',content:hostile}]);issues.push('pack:buffer-'+property+'-getter-accepted');}catch(error){if(error?.code!=='USTAR_INPUT_INVALID')issues.push('pack:buffer-'+property+'-getter-code:'+(error?.code??error?.name));}
  if(getterCalls!==0)issues.push('pack:buffer-'+property+'-getter-executed:'+getterCalls);
  const dataShadow=Buffer.from('x');
  Object.defineProperty(dataShadow,property,{configurable:true,value:property==='length'?0:null});
  try{packCanonicalUstar([{path:'fixture.txt',content:dataShadow}]);issues.push('pack:buffer-'+property+'-data-shadow-accepted');}catch(error){if(error?.code!=='USTAR_INPUT_INVALID')issues.push('pack:buffer-'+property+'-data-shadow-code:'+(error?.code??error?.name));}
 }
 try{packCanonicalUstar([{path:'fixture.txt',content:Buffer.from('x')}]);}catch(error){issues.push('pack:plain-buffer-rejected:'+(error?.code??error?.name));}
};
const expectCaptureBoundaries=async(issues)=>{
 let argvTrapCalls=0;
 const argvProxy=new Proxy([],{get(){argvTrapCalls+=1;throw new Error('ARGV_TRAP_EXECUTED');}});
 if(await runCaptureCli(argvProxy)!==64)issues.push('capture:argv-proxy-code');
 if(argvTrapCalls!==0)issues.push('capture:argv-proxy-trap:'+argvTrapCalls);
 const probeRoot=await mkdtemp(join(await realpath(tmpdir()),'ux-task15-capture-options-'));
 try{
  const outputPath=join(probeRoot,'output.json');
  const argv=['--case',join(probeRoot,'missing-case.json'),'--cas',join(probeRoot,'cas'),'--output',outputPath];
  for(const [label,dependencies,getCalls] of [
   ['getter',Object.defineProperty({},'registry',{enumerable:true,get(){getCalls.value+=1;return null;}}),{value:0}],
   ['proxy',null,{value:0}]
  ]){
   let value=dependencies;
   if(label==='proxy')value=new Proxy({},{get(){getCalls.value+=1;throw new Error('DEPENDENCY_TRAP_EXECUTED');}});
   const code=await runCaptureCli(argv,value);
   if(code!==2)issues.push('capture:dependencies-'+label+'-code:'+code);
   if(getCalls.value!==0)issues.push('capture:dependencies-'+label+'-trap:'+getCalls.value);
  }
 }finally{await rm(probeRoot,{recursive:true,force:true});}
 const physicalRoot=await mkdtemp(join(await realpath(tmpdir()),'ux-task15-capture-root-'));
 const aliasRoot=physicalRoot+'-caller-alias';
 try{
  const physicalManifest=await captureRegistryFixture(physicalRoot);
  try{await createCaptureRegistry(physicalManifest);}catch(error){issues.push('capture:physical-root:'+(error?.code??error?.name));}
  const systemManifest=await systemAliasFor(physicalManifest);
  if(systemManifest!==physicalManifest){try{await createCaptureRegistry(systemManifest);}catch(error){issues.push('capture:system-alias:'+(error?.code??error?.name));}}
  await symlink(physicalRoot,aliasRoot,'dir');
  try{await createCaptureRegistry(join(aliasRoot,'capture-registry.json'));issues.push('capture:caller-root-symlink-accepted');}catch(error){if(error?.code!=='CAPTURE_REGISTRY_INVALID')issues.push('capture:caller-root-symlink-code:'+(error?.code??error?.name));}
 }finally{await rm(aliasRoot,{force:true});await rm(physicalRoot,{recursive:true,force:true});}
};
const expectBaselineBoundary=(issues)=>{
 let trapCalls=0;
 const proxy=new Proxy([],{get(){trapCalls+=1;throw new Error('BASELINE_TRAP_EXECUTED');}});
 try{recordBaseline(proxy);issues.push('baseline:proxy-accepted');}catch(error){if(error?.message!=='BASELINE_CATALOG_NOT_ARRAY')issues.push('baseline:proxy-code:'+(error?.code??error?.message));}
 if(trapCalls!==0)issues.push('baseline:proxy-trap:'+trapCalls);
};
const expectRootAndEntrypointBoundaries=async(issues)=>{
 const physicalRoot=await realpath(ROOT),systemRoot=await systemAliasFor(physicalRoot);
 if(systemRoot!==physicalRoot){
  try{await checkKnowledge({repositoryRoot:systemRoot});}catch(error){issues.push('knowledge:system-alias:'+(error?.code??error?.name));}
  try{await validateSkill({repositoryRoot:systemRoot});}catch(error){issues.push('skill:system-alias:'+(error?.code??error?.name));}
 }
 const hostileRoot=await mkdtemp(join(await realpath(tmpdir()),'ux-task15-root-symlink-'));
 try{
  const directAlias=join(hostileRoot,'direct-root-alias');
  const parentAlias=join(hostileRoot,'parent-alias');
  await symlink(ROOT,directAlias,'dir');
  await symlink(dirname(ROOT),parentAlias,'dir');
  const nestedAlias=join(parentAlias,basename(ROOT));
  for(const [label,repositoryRoot] of [['direct',directAlias],['nested',nestedAlias]]){
   try{await checkKnowledge({repositoryRoot});issues.push('knowledge:'+label+'-root-symlink-accepted');}catch(error){if(error?.code!=='KNOWLEDGE_SYMLINK_PATH_COMPONENT')issues.push('knowledge:'+label+'-root-symlink-code:'+(error?.code??error?.name));}
   try{await validateSkill({repositoryRoot});issues.push('skill:'+label+'-root-symlink-accepted');}catch(error){if(error?.code!=='SKILL_REPOSITORY_ROOT_INVALID')issues.push('skill:'+label+'-root-symlink-code:'+(error?.code??error?.name));}
  }
 }finally{await rm(hostileRoot,{recursive:true,force:true});}
 const aliasRoot=await mkdtemp(join(await realpath(tmpdir()),'ux-task15-entry-'));
 try{
  const contracts=[
   ['check-knowledge.mjs',0,(result)=>/^knowledge_manifest=ok /u.test(result.stdout)],
   ['validate-skill.mjs',0,(result)=>/^skill=ok /u.test(result.stdout)],
   ['capture-snapshot-closure.mjs',64,(result)=>result.stdout===''],
   ['check-vector-catalog.mjs',0,(result)=>result.stdout==='vector_catalog=ok count=100\n'],
   ['run-red-baseline.mjs',0,(result)=>result.stdout.endsWith('green=0 red=100 release=no_release\n')]
  ];
  for(const [name,code,stdoutOk] of contracts){
   const alias=join(aliasRoot,name);await symlink(join(ROOT,'scripts',name),alias,'file');
   const result=await run(alias);
   if(result.code!==code||result.signal!==null||result.stderr!==''||!stdoutOk(result))issues.push('entrypoint:'+name+':'+result.code+':'+JSON.stringify(result.stdout)+':'+JSON.stringify(result.stderr));
  }
 }finally{await rm(aliasRoot,{recursive:true,force:true});}
};
const expectWorkflows=async(issues)=>{
 let ciSource='';
 try{ciSource=await readFile(join(WORKFLOWS,'ci.yml'),'utf8');}catch{issues.push('ci:missing');}
 if(ciSource){
  issues.push(...workflowIssues(ciSource,'ci'));
  const workflow=parse(ciSource),trigger=workflow?.on,jobs=workflow?.jobs??{};
  const triggerKeys=trigger&&typeof trigger==='object'?Object.keys(trigger).sort():[];
  const expectedBranch=['main','implementation/v0.1-vertical-slice'];
  const emptyTrigger=(value)=>value===null||(value&&typeof value==='object'&&Object.keys(value).length===0);
  if(JSON.stringify(triggerKeys)!==JSON.stringify(['pull_request','push','workflow_dispatch'])||JSON.stringify(trigger?.push?.branches)!==JSON.stringify(expectedBranch)||Object.keys(trigger?.push??{}).length!==1||JSON.stringify(trigger?.pull_request?.branches)!==JSON.stringify(expectedBranch)||Object.keys(trigger?.pull_request??{}).length!==1||!emptyTrigger(trigger?.workflow_dispatch))issues.push('ci:triggers');
  if(JSON.stringify(Object.keys(jobs).sort())!==JSON.stringify(REQUIRED_JOBS))issues.push('ci:job-set');
  for(const name of REQUIRED_JOBS){
   const steps=Array.isArray(jobs[name]?.steps)?jobs[name].steps:[],runs=steps.map((step)=>step?.run).filter((value)=>typeof value==='string'),uses=steps.map((step)=>step?.uses).filter((value)=>typeof value==='string');
   const checkoutIndexes=steps.map((step,index)=>step?.uses?.startsWith('actions/checkout@')?index:-1).filter((index)=>index>=0);
   const pnpmIndex=steps.findIndex((step)=>step?.uses?.startsWith('pnpm/action-setup@'));
   const nodeIndex=steps.findIndex((step)=>step?.uses?.startsWith('actions/setup-node@'));
   if(checkoutIndexes.length<1||pnpmIndex<0||nodeIndex<=pnpmIndex||checkoutIndexes.some((index)=>index>=pnpmIndex))issues.push('ci:setup-order:'+name);
   if(name!=='pack-repro'&&!runs.includes('pnpm install --frozen-lockfile'))issues.push('ci:frozen:'+name);
   const node=steps[nodeIndex],pnpm=steps[pnpmIndex];
   if(node?.with?.['node-version']!=='22.22.2'||node?.with?.cache!=='pnpm'||(name==='pack-repro'&&node?.with?.['cache-dependency-path']!=='source-a/pnpm-lock.yaml'))issues.push('ci:node-config:'+name);
   if(String(pnpm?.with?.version)!=='8.15.5'||pnpm?.with?.run_install!==false)issues.push('ci:pnpm-config:'+name);
  }
  const unitSteps=Array.isArray(jobs.unit?.steps)?jobs.unit.steps:[],unitRuns=unitSteps.map((step)=>step?.run).filter(Boolean);
  if(!unitRuns.includes('pnpm vectors:check')||!unitRuns.includes('pnpm test'))issues.push('ci:unit-commands');
  const goldenSteps=Array.isArray(jobs.golden?.steps)?jobs.golden.steps:[];
  if(!goldenSteps.map((step)=>step?.run).filter(Boolean).includes('pnpm test'))issues.push('ci:golden-command');
  const packSteps=Array.isArray(jobs['pack-repro']?.steps)?jobs['pack-repro'].steps:[];
  const checkoutPaths=packSteps.filter((step)=>step?.uses?.startsWith('actions/checkout@')).map((step)=>step?.with?.path).sort();
  const installPaths=packSteps.filter((step)=>step?.run==='pnpm install --frozen-lockfile').map((step)=>step?.['working-directory']).sort();
  const packPaths=packSteps.filter((step)=>step?.run==='pnpm artifact:pack -- knowledge/artifact-manifest.json ux-skill.tar').map((step)=>step?.['working-directory']).sort();
  if(JSON.stringify(checkoutPaths)!==JSON.stringify(['source-a','source-b'])||JSON.stringify(installPaths)!==JSON.stringify(['source-a','source-b'])||JSON.stringify(packPaths)!==JSON.stringify(['source-a','source-b']))issues.push('ci:pack-repro-independent-sources');
  if(!packSteps.some((step)=>step?.run==='cmp --silent source-a/ux-skill.tar source-b/ux-skill.tar'&&step?.if===undefined)||!packSteps.some((step)=>step?.run==='sha256sum source-a/ux-skill.tar source-b/ux-skill.tar'&&step?.if===undefined)||!packSteps.some((step)=>step?.run==='cp source-a/ux-skill.tar ux-skill.tar'&&step?.if===undefined))issues.push('ci:pack-repro-evidence');
  const canonicalUpload=packSteps.find((step)=>step?.uses?.startsWith('actions/upload-artifact@'));
  if(canonicalUpload?.with?.path!=='ux-skill.tar'||canonicalUpload?.with?.['compression-level']!==0||canonicalUpload?.with?.['if-no-files-found']!=='error')issues.push('ci:tar-upload');
  const releaseSteps=Array.isArray(jobs['release-report']?.steps)?jobs['release-report'].steps:[],gateIndex=releaseSteps.findIndex((step)=>step?.run==='pnpm release:check'),uploadIndex=releaseSteps.findIndex((step)=>step?.uses?.startsWith('actions/upload-artifact@'));
  if(gateIndex<0||uploadIndex!==gateIndex+1||releaseSteps[gateIndex]?.if!==undefined||releaseSteps[gateIndex]?.['continue-on-error']!==undefined||releaseSteps[uploadIndex]?.if!=='always()'||releaseSteps[uploadIndex]?.with?.path!=='release-gate-report.json'||releaseSteps[uploadIndex]?.with?.['if-no-files-found']!=='error')issues.push('ci:release-report-order');
 }
 let implementationSource=null;
 try{implementationSource=await readFile(join(WORKFLOWS,'implementation-ci.yml'),'utf8');issues.push(...workflowIssues(implementationSource,'implementation-ci'));}catch{}
 let markerPresent=false;
 for(const name of ['expected-red-patterns.txt','diagnostic-tests.txt']){try{await readFile(join(ROOT,'.github',name),'utf8');markerPresent=true;}catch{}}
 if(!markerPresent&&implementationSource!==null)issues.push('implementation-ci:present-after-marker-cleanup');
};

test('TASK15_CLEAN_ENV_RED closes CI, claim, path, and exported API contracts',async()=>{
 const issues=[];
 await expectWorkflows(issues);
 await checkOutputs(issues);
 try{await readFile(join(ROOT,'evals','tests','no-prohibited-claims.test.mjs'),'utf8');}catch{issues.push('prohibited-test:missing');}
 await expectKnowledgeOptions(issues);
 expectPackBufferBoundaries(issues);
 await expectCaptureBoundaries(issues);
 expectBaselineBoundary(issues);
 await expectRootAndEntrypointBoundaries(issues);
 assert.deepEqual(issues,[],`TASK15_CLEAN_ENV_RED:${issues.join('|')}`);
});
