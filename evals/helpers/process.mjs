import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const CLI=fileURLToPath(new URL('../../scripts/ux-evaluate.mjs',import.meta.url));
const fixedEnvironment=(requestId)=>({LANG:'C',LC_ALL:'C',TZ:'UTC',UX_REQUEST_ID:requestId});

const invoke=(args,requestId,stdin)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[CLI,...args],{cwd:ROOT,env:fixedEnvironment(requestId),stdio:['pipe','pipe','pipe']});
 const stdout=[];const stderr=[];
 child.stdout.on('data',(chunk)=>stdout.push(chunk));
 child.stderr.on('data',(chunk)=>stderr.push(chunk));
 child.on('error',reject);
 child.on('close',(status,signal)=>{
  const stdoutText=Buffer.concat(stdout).toString('utf8');
  const stderrText=Buffer.concat(stderr).toString('utf8');
  let json;
  try{json=JSON.parse(stdoutText);}catch(error){error.message='CLI_STDOUT_NOT_JSON:'+error.message+' stdout='+JSON.stringify(stdoutText);reject(error);return;}
  resolve({status,signal,stdout:stdoutText,stderr:stderrText,json});
 });
 if(stdin===null||stdin===undefined)child.stdin.end();else child.stdin.end(stdin);
});

export const runCli=(args,stdin=null)=>invoke([...args],'task11-request-a',stdin);
export const runCliWithDifferentRequestId=(args,stdin=null)=>invoke([...args],'task11-request-b',stdin);
