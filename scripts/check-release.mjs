#!/usr/bin/env node
import {constants as fsConstants,readFileSync} from 'node:fs';
import {lstat,open,readFile,realpath,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types as utilTypes} from 'node:util';
import {jcsBytes} from '../evaluator/canonical.mjs';
import {parseKnowledgeJson} from './strict-json.mjs';
import {loadVectorCatalog} from './check-vector-catalog.mjs';
import {recordBaseline} from './run-red-baseline.mjs';
import {evaluateThreeTransports,transportParityContext} from '../evals/helpers/transports.mjs';

const MODULE_PATH=await realpath(fileURLToPath(import.meta.url));
const ROOT=await realpath(resolve(dirname(MODULE_PATH),'..'));
const REPORT_PATH=join(ROOT,'release-gate-report.json');
const MODES=Object.freeze(['guide','scan','refactor','verify']);
const HOLDOUT_PATH='evals/holdout-commitments.json';
const VECTOR_CATALOG_PATH='evals/vector-catalog.json';
const CURRENT_BEHAVIOR_VERSION='0.1.0';
const PUBLIC_CASE_PATHS=Object.freeze([
 'evals/public-cases/apple.json',
 'evals/public-cases/govuk.json',
 'evals/public-cases/ikea.json',
 'evals/public-cases/stripe.json'
]);
const REQUIRED_ROTATION_IDS=new Set(['RW-DOCS-STRIPE-001','RW-WEBSITE-IKEA-001']);
const fail=(code)=>{const error=new TypeError(code);error.code=code;throw error;};
const committedCatalog=parseKnowledgeJson(readFileSync(join(ROOT,...VECTOR_CATALOG_PATH.split('/'))),VECTOR_CATALOG_PATH,'RELEASE_INPUT_INVALID',{allowDangerousKeys:true});
if(!Array.isArray(committedCatalog)||committedCatalog.length!==100)fail('RELEASE_INPUT_INVALID');
const IMMUTABLE_VECTOR_IDS=Object.freeze(committedCatalog.map((row)=>{
 if(row===null||typeof row!=='object'||Array.isArray(row)||typeof row.vector_id!=='string'||row.vector_id.length===0)return fail('RELEASE_INPUT_INVALID');
 return row.vector_id;
}));
if(new Set(IMMUTABLE_VECTOR_IDS).size!==IMMUTABLE_VECTOR_IDS.length)fail('RELEASE_INPUT_INVALID');
const IMMUTABLE_VECTOR_ID_SET=new Set(IMMUTABLE_VECTOR_IDS);
const isRecord=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&!utilTypes.isProxy(value)&&(Reflect.getPrototypeOf(value)===Object.prototype||Reflect.getPrototypeOf(value)===null);

function ownData(record,key,required=false){
 if(!isRecord(record))fail('RELEASE_INPUT_INVALID');
 let descriptor;
 try{descriptor=Reflect.getOwnPropertyDescriptor(record,key);}catch{fail('RELEASE_INPUT_INVALID');}
 if(descriptor===undefined){
  if(required)fail('RELEASE_INPUT_INVALID');
  return undefined;
 }
 if(descriptor.enumerable!==true||!Object.hasOwn(descriptor,'value')||Object.hasOwn(descriptor,'get')||Object.hasOwn(descriptor,'set'))fail('RELEASE_INPUT_INVALID');
 return descriptor.value;
}

function arrayData(value){
 if(!Array.isArray(value)||utilTypes.isProxy(value))fail('RELEASE_INPUT_INVALID');
 const result=[];
 for(let index=0;index<value.length;index+=1){
  const descriptor=Reflect.getOwnPropertyDescriptor(value,String(index));
  if(descriptor===undefined||descriptor.enumerable!==true||!Object.hasOwn(descriptor,'value')||Object.hasOwn(descriptor,'get')||Object.hasOwn(descriptor,'set'))fail('RELEASE_INPUT_INVALID');
  result.push(descriptor.value);
 }
 return result;
}

function canonicalReasons(reasons){
 const unique=[...new Set(reasons)];
 unique.sort((left,right)=>Buffer.compare(Buffer.from(JSON.stringify(left),'utf8'),Buffer.from(JSON.stringify(right),'utf8')));
 return unique;
}

function strippedResponse(value){
 if(!isRecord(value))fail('PARITY_INPUT_INVALID');
 const output={};
 let keys;
 try{keys=Reflect.ownKeys(value);}catch{fail('PARITY_INPUT_INVALID');}
 for(const key of keys){
  if(typeof key!=='string')fail('PARITY_INPUT_INVALID');
  const descriptor=Reflect.getOwnPropertyDescriptor(value,key);
  if(descriptor===undefined||descriptor.enumerable!==true||!Object.hasOwn(descriptor,'value')||Object.hasOwn(descriptor,'get')||Object.hasOwn(descriptor,'set'))fail('PARITY_INPUT_INVALID');
  if(key!=='audit_sidecar')output[key]=safeJson(descriptor.value,new Set(),0);
 }
 return output;
}

function safeJson(value,ancestors,depth){
 if(depth>128)fail('PARITY_INPUT_INVALID');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){
  if(!Number.isFinite(value)||Object.is(value,-0))fail('PARITY_INPUT_INVALID');
  return value;
 }
 if(typeof value!=='object'||utilTypes.isProxy(value)||ancestors.has(value))fail('PARITY_INPUT_INVALID');
 const next=new Set(ancestors);next.add(value);
 if(Array.isArray(value)){
  const output=[];
  for(const item of arrayData(value))output.push(safeJson(item,next,depth+1));
  return output;
 }
 if(!isRecord(value))fail('PARITY_INPUT_INVALID');
 const output={};
 let keys;
 try{keys=Reflect.ownKeys(value);}catch{fail('PARITY_INPUT_INVALID');}
 for(const key of keys){
  if(typeof key!=='string')fail('PARITY_INPUT_INVALID');
  const descriptor=Reflect.getOwnPropertyDescriptor(value,key);
  if(descriptor===undefined||descriptor.enumerable!==true||!Object.hasOwn(descriptor,'value')||Object.hasOwn(descriptor,'get')||Object.hasOwn(descriptor,'set'))fail('PARITY_INPUT_INVALID');
  output[key]=safeJson(descriptor.value,next,depth+1);
 }
 return output;
}

function transportRows(transports){
 if(!isRecord(transports))fail('PARITY_INPUT_INVALID');
 const keys=Reflect.ownKeys(transports);
 if(keys.length!==3||!['skill','cli','mcp'].every((key)=>keys.includes(key))||keys.some((key)=>typeof key!=='string'))fail('PARITY_INPUT_INVALID');
 return ['skill','cli','mcp'].map((key)=>{
  const descriptor=Reflect.getOwnPropertyDescriptor(transports,key);
  if(descriptor===undefined||descriptor.enumerable!==true||!Object.hasOwn(descriptor,'value')||Object.hasOwn(descriptor,'get')||Object.hasOwn(descriptor,'set'))fail('PARITY_INPUT_INVALID');
  return strippedResponse(descriptor.value);
 });
}

function inputDigestOf(response){
 const projection=ownData(response,'semantic_projection',true);
 const digest=ownData(projection,'input_digest',true);
 if(typeof digest!=='string'||!/^[0-9a-f]{64}$/u.test(digest))fail('PARITY_INPUT_INVALID');
 return digest;
}

export function checkParity(transports){
 let rows;
 try{rows=transportRows(transports);}catch(error){if(error?.code==='PARITY_INPUT_INVALID')throw error;fail('PARITY_INPUT_INVALID');}
 const context=transportParityContext(transports);
 if(context===null)fail('PARITY_PROVENANCE_REQUIRED');
 const semanticRows=[...rows,strippedResponse(context.oracle)];
 const semanticBytes=semanticRows.map((row)=>jcsBytes(row));
 const semanticParity=semanticBytes.every((bytes)=>Buffer.compare(bytes,semanticBytes[0])===0)?1:0;
 const evidence=Object.values(context.adapterEvidence).map((value)=>jcsBytes(safeJson(value,new Set(),0)));
 const adapterParity=evidence.every((bytes)=>Buffer.compare(bytes,evidence[0])===0)?1:0;
 return{semantic_parity:semanticParity,adapter_evidence_parity:adapterParity};
}

function vectorReasons(catalog,reasons){
 const rows=arrayData(catalog);
 const ids=new Set();let duplicate=false;let allGreenCurrent=true;
 for(const row of rows){
  const id=ownData(row,'vector_id',true);
  const outcome=ownData(row,'outcome',true);
  if(typeof id!=='string'||id.length===0)fail('RELEASE_INPUT_INVALID');
  if(ids.has(id))duplicate=true;
  ids.add(id);
  if(outcome!=='green'||ownData(row,'behavior_version')!==CURRENT_BEHAVIOR_VERSION)allGreenCurrent=false;
 }
 if(duplicate){reasons.push('VECTOR_CATALOG_INVALID');return;}
 const exactIdentity=rows.length===IMMUTABLE_VECTOR_IDS.length&&ids.size===IMMUTABLE_VECTOR_IDS.length&&[...ids].every((id)=>IMMUTABLE_VECTOR_ID_SET.has(id));
 if(!exactIdentity||!allGreenCurrent)reasons.push('VECTOR_RED');
}

function holdoutReasons(holdout,current,reasons){
 const status=ownData(holdout,'status',true);
 if(status==='missing'){reasons.push('HOLDOUT_MISSING');return;}
 if(status==='QUERY_BUDGET_EXHAUSTED'){reasons.push('HOLDOUT_QUERY_BUDGET_EXHAUSTED');return;}
 if(status==='contaminated'){reasons.push('HOLDOUT_CONTAMINATED');return;}
 if(status!=='pass'){reasons.push('HOLDOUT_FAILED');return;}
 if(current===undefined){reasons.push('HOLDOUT_NOT_CURRENT');return;}
 const currentGeneration=ownData(current,'generation_id',true);
 const currentBehavior=ownData(current,'behavior_version',true);
 if(ownData(holdout,'generation_id',true)!==currentGeneration||ownData(holdout,'behavior_version',true)!==currentBehavior)reasons.push('HOLDOUT_NOT_CURRENT');
}

function completeCase(row,id,kind){
 return ownData(row,'case_id')===id&&ownData(row,'target_kind')===kind&&ownData(row,'baseline_status')==='pass'&&ownData(row,'verify_status')==='pass';
}

function realWorldComplete(publicCases,rotation,current){
 const rows=arrayData(publicCases);
 const hulian=rows.some((row)=>completeCase(row,'RW-HULIAN-DELETE-001','hulianui_contract'));
 const apple=rows.some((row)=>completeCase(row,'RW-WEBSITE-APPLE-001','black_box_site'));
 const govuk=rows.some((row)=>completeCase(row,'RW-WEBSITE-GOVUK-001','black_box_site'));
 const repository=rows.some((row)=>ownData(row,'target_kind')==='pinned_repository'&&ownData(row,'baseline_status')==='pass'&&ownData(row,'verify_status')==='pass');
 if(rotation===undefined||current===undefined)return false;
 const selected=ownData(rotation,'selected_case_id',true);
 const generation=ownData(rotation,'generation_id',true);
 if(!REQUIRED_ROTATION_IDS.has(selected)||generation!==ownData(current,'generation_id',true))return false;
 const rotationCase=rows.some((row)=>completeCase(row,selected,'black_box_site')&&ownData(row,'portfolio_role',true)==='rotation_candidate');
 return hulian&&apple&&govuk&&repository&&rotationCase;
}

export function checkRelease(inputs){
 try{
  if(!isRecord(inputs))fail('RELEASE_INPUT_INVALID');
  const reasons=[];
  vectorReasons(ownData(inputs,'catalog',true),reasons);
  const current=ownData(inputs,'currentGeneration');
  holdoutReasons(ownData(inputs,'holdout',true),current,reasons);
  if(!realWorldComplete(ownData(inputs,'publicCases',true),ownData(inputs,'rotationSelection'),current))reasons.push('REAL_WORLD_REQUIRED');
  const parity=ownData(inputs,'parity');
  if(parity!==undefined){
   if(ownData(parity,'semantic_parity',true)!==1)reasons.push('PARITY_FAILED');
   if(ownData(parity,'adapter_evidence_parity',true)!==1)reasons.push('ADAPTER_EVIDENCE_PARITY_FAILED');
  }
  const golden=ownData(inputs,'golden');
  if(golden!==undefined&&ownData(golden,'matched',true)!==true)reasons.push('GOLDEN_MISMATCH');
  const prohibited=ownData(inputs,'prohibitedClaims');
  if(prohibited!==undefined&&ownData(prohibited,'count',true)!==0)reasons.push('PROHIBITED_CLAIM');
  const critical=ownData(inputs,'releaseCritical');
  if(critical!==undefined&&ownData(critical,'false_passes',true)!==0)reasons.push('RELEASE_CRITICAL_FALSE_PASS');
  const reasonCodes=canonicalReasons(reasons);
  return{status:reasonCodes.length===0?'release':'no_release',reason_codes:reasonCodes};
 }catch(error){
  if(error?.code==='RELEASE_INPUT_INVALID')throw error;
  fail('RELEASE_INPUT_INVALID');
 }
}

async function readCommittedJson(path){
 const bytes=await readFile(join(ROOT,...path.split('/')));
 try{return parseKnowledgeJson(bytes,path,'RELEASE_INPUT_INVALID',{allowDangerousKeys:true});}
 catch{fail('RELEASE_INPUT_INVALID');}
}

async function buildCurrentReport(){
 const catalog=recordBaseline(await loadVectorCatalog()).rows;
 const holdout=await readCommittedJson(HOLDOUT_PATH);
 const publicCases=await Promise.all(PUBLIC_CASE_PATHS.map(readCommittedJson));
 const transports=await Promise.all(MODES.map((mode)=>evaluateThreeTransports('evals/parity/'+mode+'.json')));
 const reports=transports.map(checkParity);
 const parity={
  semantic_parity:reports.every((row)=>row.semantic_parity===1)?1:0,
  adapter_evidence_parity:reports.every((row)=>row.adapter_evidence_parity===1)?1:0
 };
 return checkRelease({catalog,holdout,publicCases,parity});
}

async function targetSafe(){
 try{
  const status=await lstat(REPORT_PATH);
  if(status.isSymbolicLink()||!status.isFile()||status.nlink!==1||await realpath(REPORT_PATH)!==REPORT_PATH)fail('RELEASE_REPORT_WRITE_FAILED');
 }catch(error){if(error?.code!=='ENOENT')fail('RELEASE_REPORT_WRITE_FAILED');}
}

async function writeReport(report){
 const source=JSON.stringify(report)+'\n';
 const temporary=join(ROOT,'.release-gate-report.'+process.pid+'.'+randomUUID()+'.tmp');
 let handle;
 try{
  handle=await open(temporary,fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL|fsConstants.O_NOFOLLOW,0o600);
  const status=await handle.stat();
  if(!status.isFile()||status.nlink!==1)fail('RELEASE_REPORT_WRITE_FAILED');
  await handle.writeFile(source,'utf8');
  await handle.sync();
  await handle.close();handle=undefined;
  await rename(temporary,REPORT_PATH);
 }catch{fail('RELEASE_REPORT_WRITE_FAILED');}
 finally{if(handle!==undefined)await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}

async function isDirect(){
 if(!process.argv[1])return false;
 try{return await realpath(process.argv[1])===MODULE_PATH;}catch{return false;}
}

if(await isDirect()){
 try{await targetSafe();}catch{process.stderr.write('RELEASE_REPORT_WRITE_FAILED\n');process.exitCode=2;}
 if(process.exitCode!==2){
  let report;let status;
  try{report=await buildCurrentReport();status=report.status==='release'?0:1;}
  catch{report={status:'no_release',reason_codes:['RELEASE_GATE_INTERNAL_ERROR']};status=2;}
  try{
   await writeReport(report);
   process.exitCode=status;
  }catch{
   process.stderr.write('RELEASE_REPORT_WRITE_FAILED\n');
   process.exitCode=2;
  }
 }
}
