import test from 'node:test';
import assert from 'node:assert/strict';
import {link,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

let releaseModule;
try{releaseModule=await import('../../scripts/check-release.mjs');}catch{}

if(releaseModule===undefined){
 test.skip('Task 14 release tests activate after the intentional RED entrypoint exists',()=>{});
}else{
 const ROOT=fileURLToPath(new URL('../..',import.meta.url));
 const SCRIPT=fileURLToPath(new URL('../../scripts/check-release.mjs',import.meta.url));
 const REPORT=join(ROOT,'release-gate-report.json');
 const currentGeneration={generation_id:'gen-001',behavior_version:'0.1.0'};
 const greenCatalog=()=>[
  {vector_id:'A',outcome:'green'},
  {vector_id:'B',outcome:'green'}
 ];
 const completeCase=(case_id,target_kind,portfolio_role='fixed_anchor')=>({
  case_id,target_kind,portfolio_role,baseline_status:'pass',verify_status:'pass'
 });
 const completeCases=()=>[
  completeCase('RW-HULIAN-DELETE-001','hulianui_contract'),
  completeCase('RW-WEBSITE-APPLE-001','black_box_site'),
  completeCase('RW-WEBSITE-GOVUK-001','black_box_site'),
  completeCase('RW-ADMIN-APPSMITH-001','pinned_repository'),
  completeCase('RW-DOCS-STRIPE-001','black_box_site','rotation_candidate')
 ];
 const releasable=()=>({
  catalog:greenCatalog(),
  holdout:{status:'pass',generation_id:'gen-001',behavior_version:'0.1.0'},
  currentGeneration,
  publicCases:completeCases(),
  rotationSelection:{generation_id:'gen-001',selected_case_id:'RW-DOCS-STRIPE-001'},
  parity:{semantic_parity:1,adapter_evidence_parity:1},
  golden:{matched:true},
  prohibitedClaims:{count:0},
  releaseCritical:{false_passes:0}
 });
 const run=(args)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:ROOT,env:{LANG:'C',LC_ALL:'C',TZ:'UTC'},stdio:['ignore','pipe','pipe']});
  const stdout=[];const stderr=[];
  child.stdout.on('data',(chunk)=>stdout.push(chunk));
  child.stderr.on('data',(chunk)=>stderr.push(chunk));
  child.on('error',reject);
  child.on('close',(status,signal)=>resolve({status,signal,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')}));
 });

 test('red vectors missing holdout and absent real-world coverage produce the exact canonical plan failure',()=>{
  const report=releaseModule.checkRelease({
   catalog:[{vector_id:'A',outcome:'red'}],
   holdout:{status:'missing'},
   publicCases:[]
  });
  assert.deepEqual(report,{status:'no_release',reason_codes:['HOLDOUT_MISSING','REAL_WORLD_REQUIRED','VECTOR_RED']});
 });

 test('only current-generation pass plus every required baseline and verify pair can release',()=>{
  assert.deepEqual(releaseModule.checkRelease(releasable()),{status:'release',reason_codes:[]});
  for(const mutate of [
   (value)=>{value.holdout.generation_id='gen-old';},
   (value)=>{value.holdout.behavior_version='0.0.9';},
   (value)=>{value.holdout.status='failed';},
   (value)=>{value.publicCases=value.publicCases.filter((row)=>row.case_id!=='RW-HULIAN-DELETE-001');},
   (value)=>{value.publicCases.find((row)=>row.case_id==='RW-WEBSITE-APPLE-001').verify_status='missing';},
   (value)=>{value.publicCases=value.publicCases.filter((row)=>row.target_kind!=='pinned_repository');},
   (value)=>{value.rotationSelection.selected_case_id='RW-WEBSITE-IKEA-001';}
  ]){
   const input=releasable();mutate(input);
   assert.equal(releaseModule.checkRelease(input).status,'no_release');
  }
 });

 test('release reasons are UTF-8 canonical unique and every supplied semantic gate fails closed',()=>{
  const input=releasable();
  input.catalog=[{vector_id:'A',outcome:'red'},{vector_id:'B',outcome:'red'}];
  input.holdout={status:'contaminated',generation_id:'gen-001',behavior_version:'0.1.0'};
  input.publicCases=[completeCase('RW-WEBSITE-APPLE-001','black_box_site'),completeCase('RW-WEBSITE-APPLE-001','black_box_site')];
  input.parity={semantic_parity:0,adapter_evidence_parity:0};
  input.golden={matched:false};
  input.prohibitedClaims={count:2};
  input.releaseCritical={false_passes:1};
  assert.deepEqual(releaseModule.checkRelease(input),{
   status:'no_release',
   reason_codes:[
    'ADAPTER_EVIDENCE_PARITY_FAILED',
    'GOLDEN_MISMATCH',
    'HOLDOUT_CONTAMINATED',
    'PARITY_FAILED',
    'PROHIBITED_CLAIM',
    'REAL_WORLD_REQUIRED',
    'RELEASE_CRITICAL_FALSE_PASS',
    'VECTOR_RED'
   ]
  });
 });

 test('duplicate catalog identities and query-budget exhaustion cannot pass',()=>{
  const input=releasable();
  input.catalog=[{vector_id:'A',outcome:'green'},{vector_id:'A',outcome:'green'}];
  input.holdout={status:'QUERY_BUDGET_EXHAUSTED',generation_id:'gen-001',behavior_version:'0.1.0'};
  assert.deepEqual(releaseModule.checkRelease(input),{
   status:'no_release',
   reason_codes:['HOLDOUT_QUERY_BUDGET_EXHAUSTED','VECTOR_CATALOG_INVALID']
  });
 });

 test('holdout private details are neither inspected nor exposed',()=>{
  const input=releasable();
  input.holdout={
   ...input.holdout,
   secret:'do-not-return',
   case_details:[{case_id:'private-case',error:'private-error'}],
   aggregate_metrics:{private_metric:1}
  };
  const report=releaseModule.checkRelease(input);
  assert.deepEqual(report,{status:'release',reason_codes:[]});
  assert.equal(JSON.stringify(report).includes('private'),false);
  assert.equal(JSON.stringify(report).includes('secret'),false);
 });

 test('checkRelease rejects accessors and Proxy inputs without executing them',()=>{
  let getterCalls=0;
  const accessor={holdout:{status:'missing'},publicCases:[]};
  Object.defineProperty(accessor,'catalog',{enumerable:true,get(){getterCalls+=1;throw new Error('GETTER_EXECUTED');}});
  assert.throws(()=>releaseModule.checkRelease(accessor),(error)=>error?.code==='RELEASE_INPUT_INVALID');
  assert.equal(getterCalls,0);
  const proxy=new Proxy({catalog:[],holdout:{status:'missing'},publicCases:[]},{ownKeys(){throw new Error('PROXY_EXECUTED');}});
  assert.throws(()=>releaseModule.checkRelease(proxy),(error)=>error?.code==='RELEASE_INPUT_INVALID');
 });

 test('import-only is inert and direct entry writes the exact current no_release report with exit one',async(t)=>{
  t.after(()=>rm(REPORT,{force:true}));
  await rm(REPORT,{force:true});
  const imported=await run(['--input-type=module','--eval','await import('+JSON.stringify(pathToFileURL(SCRIPT).href)+')']);
  assert.deepEqual(imported,{status:0,signal:null,stdout:'',stderr:''});
  await assert.rejects(readFile(REPORT),(error)=>error?.code==='ENOENT');

  const direct=await run([SCRIPT]);
  const expected={status:'no_release',reason_codes:['HOLDOUT_MISSING','REAL_WORLD_REQUIRED','VECTOR_RED']};
  assert.equal(direct.status,1,direct.stderr);
  assert.equal(direct.signal,null);
  assert.equal(direct.stdout,JSON.stringify(expected)+'\n');
  assert.equal(direct.stderr,'');
  assert.equal(await readFile(REPORT,'utf8'),JSON.stringify(expected)+'\n');
 });

 test('direct entry refuses a symlink report target without changing its referent',async(t)=>{
  const victim=join(tmpdir(),'ux-skill-task14-report-victim-'+process.pid+'.json');
  t.after(async()=>{await rm(REPORT,{force:true});await rm(victim,{force:true});});
  await rm(REPORT,{force:true});await rm(victim,{force:true});
  await writeFile(victim,'unchanged\n','utf8');
  await symlink(victim,REPORT);
  const direct=await run([SCRIPT]);
  assert.equal(direct.status,2);
  assert.equal(direct.stdout,'');
  assert.equal(direct.stderr,'RELEASE_REPORT_WRITE_FAILED\n');
  assert.equal(await readFile(victim,'utf8'),'unchanged\n');
 });

 test('direct entry refuses a hard-link report target without changing its peer',async(t)=>{
  const victim=join(tmpdir(),'ux-skill-task14-report-hardlink-'+process.pid+'.json');
  t.after(async()=>{await rm(REPORT,{force:true});await rm(victim,{force:true});});
  await rm(REPORT,{force:true});await rm(victim,{force:true});
  await writeFile(victim,'unchanged\n','utf8');
  await link(victim,REPORT);
  const direct=await run([SCRIPT]);
  assert.equal(direct.status,2);
  assert.equal(direct.stdout,'');
  assert.equal(direct.stderr,'RELEASE_REPORT_WRITE_FAILED\n');
  assert.equal(await readFile(victim,'utf8'),'unchanged\n');
 });
}
