import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {evaluate} from '../../evaluator/index.mjs';
import {deleteBundle,hulianDeleteBundle} from '../helpers/fixtures.mjs';
import {assertKnowledgeFileSnapshot,checkKnowledge} from '../../scripts/check-knowledge.mjs';
import {validateSkill} from '../../scripts/validate-skill.mjs';
import {captureRegistryDigest,createCaptureRegistry,runCaptureCli} from '../../scripts/capture-snapshot-closure.mjs';
import {recordBaseline} from '../../scripts/run-red-baseline.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
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
  if(!Number.isInteger(job?.['timeout-minutes'])||job['timeout-minutes']<1||job['timeout-minutes']>30)issues.push(label+':timeout:'+jobName);
  const steps=Array.isArray(job?.steps)?job.steps:[];
  for(const step of steps){
   if(step?.['continue-on-error']!==undefined)issues.push(label+':continue-on-error:'+jobName);
   if(typeof step?.uses==='string'){
    const [repo,commit]=step.uses.split('@');
    if(ACTIONS[repo]!==commit||!/^[0-9a-f]{40}$/u.test(commit??''))issues.push(label+':mutable-action:'+step.uses);
   }
  }
 }
 const flattened=JSON.stringify(workflow);
 if(/(?:npm\\s+publish|gh\\s+release|create-release)/iu.test(flattened))issues.push(label+':publishes');
 return issues;
};
const prepareBundles=async()=>{
 const golden=JSON.parse(await readFile(new URL('../golden/high-risk-delete.json',import.meta.url),'utf8')).bundle;
 return[deleteBundle(),hulianDeleteBundle()].map((fixture)=>{
  const bundle=structuredClone(fixture);
  bundle.policy_digests=structuredClone(golden.policy_digests);
  for(const claim of bundle.claims)claim.relation_kind=claim.claim_kind;
  return bundle;
 });
};
const checkOutputs=async(issues)=>{
 for(const bundle of await prepareBundles()){
  let output;
  try{output=await evaluate(bundle);}catch(error){issues.push('prohibited:evaluate:'+(error?.code??error?.name));continue;}
  const actual=JSON.stringify({assurance:output.assurance,semantic_projection:output.semantic_projection});
  for(const claim of ['wcag_conformant','user_success','ux_good'])if(actual.includes(JSON.stringify(claim)))issues.push('prohibited:'+claim);
  if(output.assurance?.release_status!=='no_release')issues.push('prohibited:release-status:'+output.assurance?.release_status);
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
  const jobs=parse(ciSource)?.jobs??{};
  if(JSON.stringify(Object.keys(jobs).sort())!==JSON.stringify(REQUIRED_JOBS))issues.push('ci:job-set');
  for(const name of REQUIRED_JOBS){
   const steps=Array.isArray(jobs[name]?.steps)?jobs[name].steps:[],runs=steps.map((step)=>step?.run).filter((value)=>typeof value==='string'),uses=steps.map((step)=>step?.uses).filter((value)=>typeof value==='string');
   const pnpmIndex=steps.findIndex((step)=>step?.uses?.startsWith('pnpm/action-setup@'));
   const nodeIndex=steps.findIndex((step)=>step?.uses?.startsWith('actions/setup-node@'));
   if(!uses.some((value)=>value.startsWith('actions/checkout@'))||pnpmIndex<0||nodeIndex<=pnpmIndex)issues.push('ci:setup-order:'+name);
   if(!runs.includes('pnpm install --frozen-lockfile'))issues.push('ci:frozen:'+name);
   const node=steps[nodeIndex],pnpm=steps[pnpmIndex];
   if(node?.with?.['node-version']!=='22.22.2'||node?.with?.cache!=='pnpm')issues.push('ci:node-config:'+name);
   if(String(pnpm?.with?.version)!=='8.15.5'||pnpm?.with?.run_install!==false)issues.push('ci:pnpm-config:'+name);
  }
  const unitRuns=jobs.unit.steps.map((step)=>step?.run).filter(Boolean);
  if(!unitRuns.includes('pnpm vectors:check')||!unitRuns.includes('pnpm test'))issues.push('ci:unit-commands');
  if(!jobs.golden.steps.map((step)=>step?.run).filter(Boolean).includes('pnpm test'))issues.push('ci:golden-command');
  const packSteps=jobs['pack-repro'].steps,packRuns=packSteps.map((step)=>step?.run).filter(Boolean);
  if(!packRuns.includes('pnpm artifact:pack -- knowledge/artifact-manifest.json ux-skill.tar')||!packRuns.some((value)=>value.includes('repro-source')&&value.includes('artifact:pack'))||!packRuns.some((value)=>value.includes('cmp ')))issues.push('ci:pack-repro-commands');
  const canonicalUpload=packSteps.find((step)=>step?.uses?.startsWith('actions/upload-artifact@'));
  if(canonicalUpload?.with?.path!=='ux-skill.tar'||canonicalUpload?.with?.['compression-level']!==0)issues.push('ci:tar-upload');
  const releaseSteps=jobs['release-report'].steps,gateIndex=releaseSteps.findIndex((step)=>step?.run==='pnpm release:check'),uploadIndex=releaseSteps.findIndex((step)=>step?.uses?.startsWith('actions/upload-artifact@'));
  if(gateIndex<0||uploadIndex!==gateIndex+1||releaseSteps[gateIndex]?.['continue-on-error']!==undefined||releaseSteps[uploadIndex]?.if!=='always()'||releaseSteps[uploadIndex]?.with?.path!=='release-gate-report.json'||releaseSteps[uploadIndex]?.with?.['if-no-files-found']!=='error')issues.push('ci:release-report-order');
 }
 try{issues.push(...workflowIssues(await readFile(join(WORKFLOWS,'implementation-ci.yml'),'utf8'),'implementation-ci'));}catch{}
};

test('TASK15_CLEAN_ENV_RED closes CI, claim, path, and exported API contracts',async()=>{
 const issues=[];
 await expectWorkflows(issues);
 await checkOutputs(issues);
 try{await readFile(join(ROOT,'evals','tests','no-prohibited-claims.test.mjs'),'utf8');}catch{issues.push('prohibited-test:missing');}
 await expectKnowledgeOptions(issues);
 await expectCaptureBoundaries(issues);
 expectBaselineBoundary(issues);
 await expectRootAndEntrypointBoundaries(issues);
 assert.deepEqual(issues,[],`TASK15_CLEAN_ENV_RED:${issues.join('|')}`);
});
