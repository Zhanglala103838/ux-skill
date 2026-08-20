#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {TextDecoder} from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {digestJcs} from '../evaluator/digests.mjs';
import {evaluate} from '../evaluator/index.mjs';
import {parseKnowledgeJson} from './check-knowledge.mjs';

const ROOT=new URL('../',import.meta.url);
const RESPONSE_PATH='schemas/adapters/ux-evaluate-response-v1.schema.json';
const UTF8_BOM=Buffer.from([0xef,0xbb,0xbf]);
const UTF8_DECODER=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});
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
const readStdin=async()=>{const chunks=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);};
const hasLeadingBom=(bytes)=>bytes.length>=UTF8_BOM.length&&bytes.subarray(0,UTF8_BOM.length).equals(UTF8_BOM);
const writeJson=(value)=>process.stdout.write(JSON.stringify(value)+'\n');
const diagnostic=(code)=>process.stderr.write(code+'\n');
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const loadResponseValidator=async()=>{
 const [responseRaw,semanticRaw,manifestRaw,evaluatorManifestRaw]=await Promise.all([
  readFile(new URL(RESPONSE_PATH,ROOT)),readFile(new URL('schemas/evaluator/semantic-projection.schema.json',ROOT)),readFile(new URL('schemas/manifest.json',ROOT)),readFile(new URL('evaluator/manifest.json',ROOT))
 ]);
 const responseSchema=JSON.parse(responseRaw),semanticSchema=JSON.parse(semanticRaw),manifest=JSON.parse(manifestRaw),evaluatorManifest=JSON.parse(evaluatorManifestRaw);
 const rows=manifest.filter((row)=>row.path===RESPONSE_PATH);
 if(rows.length!==1||rows[0].file_digest!==sha(responseRaw))throw new TypeError('RESPONSE_SCHEMA_MANIFEST_INVALID');
 if(evaluatorManifest.schema_manifest_digest!==digestJcs('ux-skill:manifest:v1',manifest))throw new TypeError('RESPONSE_SCHEMA_DOMAIN_DIGEST_INVALID');
 const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
 return ajv.compile(responseSchema);
};
let validateResponse;
try{validateResponse=await loadResponseValidator();}catch{validateResponse=null;}
const emit=(value,status,code=null)=>{
 if(validateResponse===null||!validateResponse(value)){diagnostic(validateResponse===null?'RESPONSE_SCHEMA_INVALID':'RESPONSE_SCHEMA_VALIDATION_FAILED');return 1;}
 writeJson(value);if(code!==null)diagnostic(code);return status;
};
const invalid=(code,status=2)=>emit({run_status:'invalid_input',error_codes:[code]},status,code);
const failed=(code)=>emit({run_status:'failed',error_codes:[code]},1,code);
const errorCode=(error)=>typeof error?.code==='string'&&error.code.length>0?error.code:'EVALUATION_FAILED';

const main=async()=>{
 if(validateResponse===null){diagnostic('RESPONSE_SCHEMA_INVALID');return 1;}
 const parsed=parseArguments(process.argv.slice(2));
 if(parsed.code)return invalid(parsed.code,parsed.status);
 let raw;
 try{raw=parsed.input==='-'?await readStdin():await readFile(parsed.input);}catch{return invalid('INPUT_UNREADABLE');}
 if(hasLeadingBom(raw))return invalid('INPUT_BOM_FORBIDDEN');
 let source;
 try{source=UTF8_DECODER.decode(raw);}catch{return invalid('INPUT_UTF8_INVALID');}
 let bundle;
 try{bundle=parseKnowledgeJson(Buffer.from(source,'utf8'),'<cli-input>','INPUT_JSON_INVALID',{allowDangerousKeys:true});}
 catch(error){return invalid(error?.code==='KNOWLEDGE_JSON_DUPLICATE_KEY'?'INPUT_JSON_DUPLICATE_MEMBER':'INPUT_JSON_INVALID');}
 if(bundle===null||typeof bundle!=='object'||Array.isArray(bundle))return invalid('INPUT_JSON_INVALID');
 if(bundle.request_mode!==parsed.mode)return invalid('MODE_BUNDLE_MISMATCH');
 let result;
 try{result=await evaluate(bundle);}catch(error){const code=errorCode(error);return code==='INVALID_EVALUATION_INPUT'?invalid(code):failed(code);}
 const transport={kind:'cli',request_mode:parsed.mode,request_id:process.env.UX_REQUEST_ID??null,input_kind:parsed.input==='-'?'stdin':'path',output_format:'json'};
 return emit({...result,audit_sidecar:{...result.audit_sidecar,transport}},0);
};

process.exitCode=await main();
