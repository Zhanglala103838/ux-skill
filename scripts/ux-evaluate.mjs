#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {evaluate} from '../evaluator/index.mjs';

const MODES=new Set(['guide','scan','refactor','verify']);
const SWITCHES=new Map([['--mode','mode'],['--input','input'],['--output','output']]);
const fail=(code,status=2)=>({code,status});
const parseArguments=(argv)=>{
 const values={mode:[],input:[],output:[]};
 for(let index=0;index<argv.length;index+=1){
  const key=SWITCHES.get(argv[index]);
  if(key===undefined)return fail('ARGUMENT_UNKNOWN');
  if(index+1>=argv.length||SWITCHES.has(argv[index+1]))return fail(key.toUpperCase()+'_VALUE_REQUIRED');
  values[key].push(argv[index+1]);index+=1;
 }
 if(values.mode.length>1)return fail('MODE_MULTIPLE');
 if(values.mode.length===1&&!MODES.has(values.mode[0]))return fail('MODE_INVALID');
 if(values.input.length>1)return fail('INPUT_MULTIPLE');
 if(values.output.length>1)return fail('OUTPUT_MULTIPLE');
 if(values.mode.length===0)return fail('MODE_REQUIRED');
 if(values.output.length===0)return fail('OUTPUT_REQUIRED');
 if(values.output[0]!=='json')return fail('OUTPUT_INVALID');
 if(values.input.length===0)return fail('INPUT_REQUIRED');
 return{mode:values.mode[0],input:values.input[0],output:values.output[0]};
};
const readStdin=async()=>{const chunks=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8');};
const writeJson=(value)=>process.stdout.write(JSON.stringify(value)+'\n');
const diagnostic=(code)=>process.stderr.write(code+'\n');
const invalid=(code,status=2)=>{writeJson({run_status:'invalid_input',error_codes:[code]});diagnostic(code);return status;};
const failed=(code)=>{writeJson({run_status:'failed',error_codes:[code]});diagnostic(code);return 1;};
const errorCode=(error)=>typeof error?.code==='string'&&error.code.length>0?error.code:'EVALUATION_FAILED';

const main=async()=>{
 const parsed=parseArguments(process.argv.slice(2));
 if(parsed.code)return invalid(parsed.code,parsed.status);
 let source;
 try{source=parsed.input==='-'?await readStdin():await readFile(parsed.input,'utf8');}catch{return invalid('INPUT_UNREADABLE');}
 let bundle;
 try{bundle=JSON.parse(source);}catch{return invalid('INPUT_JSON_INVALID');}
 if(bundle===null||typeof bundle!=='object'||Array.isArray(bundle))return invalid('INPUT_JSON_INVALID');
 if(bundle.request_mode!==parsed.mode)return invalid('MODE_BUNDLE_MISMATCH');
 let result;
 try{result=await evaluate(bundle);}catch(error){const code=errorCode(error);return code==='INVALID_EVALUATION_INPUT'?invalid(code):failed(code);}
 const transport={kind:'cli',request_mode:parsed.mode,request_id:process.env.UX_REQUEST_ID??null,input_kind:parsed.input==='-'?'stdin':'path',output_format:'json'};
 writeJson({...result,audit_sidecar:{...result.audit_sidecar,transport}});
 return 0;
};

process.exitCode=await main();
