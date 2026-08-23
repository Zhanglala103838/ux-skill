import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluate} from '../../evaluator/index.mjs';
import {jcsBytes} from '../../evaluator/canonical.mjs';
import {evaluateHulianMcpResult} from '../../adapters/hulianui/bridge.mjs';
import {mapHulianComponentDoc} from '../../adapters/hulianui/adapter.mjs';
import {parseKnowledgeJson} from '../../scripts/strict-json.mjs';
import {validateSkill} from '../../scripts/validate-skill.mjs';
import {runCli} from './process.mjs';

const MODULE_PATH=await realpath(fileURLToPath(import.meta.url));
const ROOT=await realpath(resolve(dirname(MODULE_PATH),'../..'));
const ALLOWED_PATHS=Object.freeze(new Map([
 ['evals/parity/guide.json','guide'],
 ['evals/parity/scan.json','scan'],
 ['evals/parity/refactor.json','refactor'],
 ['evals/parity/verify.json','verify']
]));
const CONTRACT_PATH='adapters/hulianui/contract.json';
const TOOL_RESULT_PATH='adapters/hulianui/fixture.json';
const MAX_BYTES=1_048_576;
const OPEN_FLAGS=fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW;
const CONTEXT=new WeakMap();
const fail=(code)=>{const error=new TypeError(code);error.code=code;throw error;};
const sameSnapshot=(left,right)=>left.isFile()&&right.isFile()&&left.dev===right.dev&&left.ino===right.ino&&left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs;

async function readExact(path,invalidCode){
 const absolute=join(ROOT,...path.split('/'));
 let current=ROOT;
 try{
  for(const segment of path.split('/')){
   current=join(current,segment);
   const status=await lstat(current);
   if(status.isSymbolicLink())fail(invalidCode);
  }
  if(await realpath(absolute)!==absolute)fail(invalidCode);
 }catch(error){if(error?.code===invalidCode)throw error;fail(invalidCode);}
 let handle;
 try{handle=await open(absolute,OPEN_FLAGS);}catch{fail(invalidCode);}
 try{
  const before=await handle.stat({bigint:true});
  if(!before.isFile()||before.size>BigInt(MAX_BYTES))fail(invalidCode);
  const buffer=Buffer.allocUnsafe(Number(before.size)+1);let total=0;
  while(total<buffer.length){
   const result=await handle.read(buffer,total,buffer.length-total,total);
   if(result.bytesRead===0)break;
   total+=result.bytesRead;
  }
  const after=await handle.stat({bigint:true});
  if(total>MAX_BYTES||BigInt(total)!==before.size||!sameSnapshot(before,after))fail(invalidCode);
  return buffer.subarray(0,total);
 }finally{await handle.close().catch(()=>{});}
}

function parseExact(bytes,path,code){
 try{return parseKnowledgeJson(bytes,path,code,{allowDangerousKeys:true});}
 catch{fail(code);}
}

function runSkill(mode,input){
 return new Promise((resolve,reject)=>{
  const child=spawn('pnpm',['--silent','ux:evaluate','--mode',mode,'--input','-','--output','json'],{
   cwd:ROOT,
   env:{...process.env,LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:'task14-skill'},
   stdio:['pipe','pipe','pipe']
  });
  const stdout=[];const stderr=[];
  child.stdout.on('data',(chunk)=>stdout.push(chunk));
  child.stderr.on('data',(chunk)=>stderr.push(chunk));
  child.on('error',reject);
  child.on('close',(status,signal)=>{
   const stdoutText=Buffer.concat(stdout).toString('utf8');
   const stderrText=Buffer.concat(stderr).toString('utf8');
   let json;
   try{json=JSON.parse(stdoutText);}catch{fail('PARITY_SKILL_OUTPUT_INVALID');}
   resolve({status,signal,stdout:stdoutText,stderr:stderrText,json});
  });
  child.stdin.end(input);
 });
}

const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const sameBytes=(left,right)=>Buffer.compare(jcsBytes(left),jcsBytes(right))===0;

export async function evaluateThreeTransports(path){
 if(typeof path!=='string'||!ALLOWED_PATHS.has(path))fail('PARITY_PATH_INVALID');
 const mode=ALLOWED_PATHS.get(path);
 const bundle=parseExact(await readExact(path,'PARITY_FIXTURE_INVALID'),path,'PARITY_FIXTURE_INVALID');
 if(bundle===null||typeof bundle!=='object'||Array.isArray(bundle)||bundle.request_mode!==mode||!Array.isArray(bundle.adapter_evidence)||bundle.adapter_evidence.length!==1)fail('PARITY_FIXTURE_INVALID');
 const bundleBytes=jcsBytes(bundle);
 const bundleBefore=Buffer.from(bundleBytes);

 const [contract,toolResult]=await Promise.all([
  readExact(CONTRACT_PATH,'PARITY_ADAPTER_FIXTURE_INVALID').then((bytes)=>parseExact(bytes,CONTRACT_PATH,'PARITY_ADAPTER_FIXTURE_INVALID')),
  readExact(TOOL_RESULT_PATH,'PARITY_ADAPTER_FIXTURE_INVALID').then((bytes)=>parseExact(bytes,TOOL_RESULT_PATH,'PARITY_ADAPTER_FIXTURE_INVALID'))
 ]);
 const canonicalEvidence=mapHulianComponentDoc(structuredClone(toolResult),structuredClone(contract));
 const mappedMember={
  adapter_evidence_id:contract.adapter_contract_id,
  adapter_contract_id:contract.adapter_contract_id,
  artifact_digest:sha(jcsBytes(canonicalEvidence))
 };
 if(!sameBytes(bundle.adapter_evidence,[mappedMember]))fail('PARITY_ADAPTER_EVIDENCE_MISMATCH');

 await validateSkill({repositoryRoot:ROOT});
 const cliArguments=['--mode',mode,'--input','-','--output','json'];
 const [cli,skill,direct]=await Promise.all([
  runCli(cliArguments,Buffer.from(bundleBytes)),
  runSkill(mode,Buffer.from(bundleBytes)),
  evaluate(structuredClone(bundle))
 ]);
 if(cli.status!==0||cli.signal!==null||cli.stderr!==''||skill.status!==0||skill.signal!==null||skill.stderr!=='')fail('PARITY_TRANSPORT_FAILED');

 const base=structuredClone(bundle);
 delete base.adapter_evidence;
 const baseBefore=Buffer.from(jcsBytes(base));
 const toolCopy=structuredClone(toolResult);
 const toolBefore=Buffer.from(jcsBytes(toolCopy));
 const mcp=await evaluateHulianMcpResult(base,toolCopy);
 if(Buffer.compare(bundleBefore,jcsBytes(bundle))!==0||Buffer.compare(baseBefore,jcsBytes(base))!==0||Buffer.compare(toolBefore,jcsBytes(toolCopy))!==0)fail('PARITY_INPUT_MUTATED');

 const result=Object.freeze({skill:skill.json,cli:cli.json,mcp});
 CONTEXT.set(result,Object.freeze({
  oracle:direct,
  adapterEvidence:Object.freeze({
   skill:structuredClone(bundle.adapter_evidence),
   cli:structuredClone(bundle.adapter_evidence),
   mcp:Object.freeze([mappedMember])
  })
 }));
 return result;
}

export function transportParityContext(transports){
 return CONTEXT.get(transports)??null;
}
