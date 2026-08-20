#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {open,readFile} from 'node:fs/promises';
import {TextDecoder} from 'node:util';

const ROOT=new URL('../',import.meta.url);
const RESPONSE_PATH='schemas/adapters/ux-evaluate-response-v1.schema.json';
const SEMANTIC_PATH='schemas/evaluator/semantic-projection.schema.json';
const RESPONSE_SCHEMA_CLOSURE=Object.freeze([
 Object.freeze({path:RESPONSE_PATH,id:'https://ux-skill.invalid/schemas/adapters/ux-evaluate-response-v1.schema.json'}),
 Object.freeze({path:SEMANTIC_PATH,id:'https://ux-skill.invalid/schemas/evaluator/semantic-projection.schema.json'})
]);
const MAX_BYTES=1_048_576;
const MAX_BYTES_BIGINT=BigInt(MAX_BYTES);
const PATH_OPEN_FLAGS=fsConstants.O_RDONLY|fsConstants.O_NONBLOCK|fsConstants.O_NOFOLLOW;
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
const inputFailure=(code)=>Object.assign(new TypeError(code),{code});
const readStdin=async()=>{
 const chunks=[];let total=0;
 for await(const chunk of process.stdin){
  const length=chunk.byteLength;
  if(length>MAX_BYTES-total){process.stdin.destroy();throw inputFailure('INPUT_TOO_LARGE');}
  chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));total+=length;
 }
 return Buffer.concat(chunks,total);
};
const readPath=async(path)=>{
 let handle;
 try{handle=await open(path,PATH_OPEN_FLAGS);}catch{throw inputFailure('INPUT_UNREADABLE');}
 try{
  const before=await handle.stat({bigint:true});
  if(!before.isFile())throw inputFailure('INPUT_UNREADABLE');
  if(before.size>MAX_BYTES_BIGINT)throw inputFailure('INPUT_TOO_LARGE');
  const bytes=Buffer.allocUnsafe(Math.min(Number(before.size)+1,MAX_BYTES+1));let total=0;
  while(total<bytes.length){const {bytesRead}=await handle.read(bytes,total,bytes.length-total,total);if(bytesRead===0)break;total+=bytesRead;}
  if(total>MAX_BYTES)throw inputFailure('INPUT_TOO_LARGE');
  const after=await handle.stat({bigint:true});
  if(!after.isFile())throw inputFailure('INPUT_UNREADABLE');
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw inputFailure('INPUT_UNREADABLE');
  if(after.size>MAX_BYTES_BIGINT)throw inputFailure('INPUT_TOO_LARGE');
  if(before.size!==BigInt(total))throw inputFailure('INPUT_UNREADABLE');
  return bytes.subarray(0,total);
 }catch(error){
  if(error?.code==='INPUT_TOO_LARGE'||error?.code==='INPUT_UNREADABLE')throw error;
  throw inputFailure('INPUT_UNREADABLE');
 }finally{try{await handle.close();}catch{}}
};
const hasLeadingBom=(bytes)=>bytes.length>=UTF8_BOM.length&&bytes.subarray(0,UTF8_BOM.length).equals(UTF8_BOM);
const writeJson=(value)=>process.stdout.write(JSON.stringify(value)+'\n');
const diagnostic=(code)=>process.stderr.write(code+'\n');
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const isCanonicalRelativePath=(path)=>typeof path==='string'&&/^schemas\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.schema\.json$/u.test(path);
const verifyResponseSchemaClosure=(loaded,manifest)=>{
 if(loaded.length!==RESPONSE_SCHEMA_CLOSURE.length)throw new TypeError('RESPONSE_SCHEMA_CLOSURE_INVALID');
 const schemasById=new Map();
 for(const entry of loaded){
  if(!isCanonicalRelativePath(entry.path)||entry.schema?.$id!==entry.id||schemasById.has(entry.id))throw new TypeError('RESPONSE_SCHEMA_CLOSURE_INVALID');
  const rows=manifest.filter((row)=>row?.path===entry.path);
  if(rows.length!==1||rows[0].file_digest!==sha(entry.raw))throw new TypeError('RESPONSE_SCHEMA_MANIFEST_INVALID');
  schemasById.set(entry.id,entry.schema);
 }
 const visited=new Set();
 const visit=(id)=>{
  if(visited.has(id))return;const schema=schemasById.get(id);if(schema===undefined)throw new TypeError('RESPONSE_SCHEMA_CLOSURE_INVALID');visited.add(id);
  const walk=(value)=>{
   if(value===null||typeof value!=='object')return;
   if(typeof value.$ref==='string'&&!value.$ref.startsWith('#')){const target=new URL(value.$ref,id);target.hash='';if(target.hostname!=='ux-skill.invalid'||!schemasById.has(target.href))throw new TypeError('RESPONSE_SCHEMA_CLOSURE_INVALID');visit(target.href);}
   for(const child of Array.isArray(value)?value:Object.values(value))walk(child);
  };
  walk(schema);
 };
 visit(RESPONSE_SCHEMA_CLOSURE[0].id);
 if(visited.size!==RESPONSE_SCHEMA_CLOSURE.length||RESPONSE_SCHEMA_CLOSURE.some((entry)=>!visited.has(entry.id)))throw new TypeError('RESPONSE_SCHEMA_CLOSURE_INVALID');
};
let parseKnowledgeJson=null;
let evaluatorManifestBootstrapFailure=false;
const loadResponseValidator=async()=>{
 const [{default:Ajv2020},{default:addFormats},strictJson,responseRaw,semanticRaw,manifestRaw]=await Promise.all([
  import('ajv/dist/2020.js'),import('ajv-formats'),import('./strict-json.mjs'),
  readFile(new URL(RESPONSE_PATH,ROOT)),readFile(new URL(SEMANTIC_PATH,ROOT)),readFile(new URL('schemas/manifest.json',ROOT))
 ]);
 parseKnowledgeJson=strictJson.parseKnowledgeJson;const responseSchemaManifestDigest=strictJson.responseSchemaManifestDigest;
 const responseSchema=parseKnowledgeJson(responseRaw,RESPONSE_PATH,'RESPONSE_SCHEMA_INVALID'),semanticSchema=parseKnowledgeJson(semanticRaw,SEMANTIC_PATH,'RESPONSE_SCHEMA_INVALID'),manifest=parseKnowledgeJson(manifestRaw,'schemas/manifest.json','RESPONSE_SCHEMA_INVALID');
 let evaluatorManifest=null;
 try{evaluatorManifest=parseKnowledgeJson(await readFile(new URL('evaluator/manifest.json',ROOT)),'evaluator/manifest.json','ARTIFACT_JSON_INVALID');}catch{evaluatorManifestBootstrapFailure=true;}
 verifyResponseSchemaClosure([
  {...RESPONSE_SCHEMA_CLOSURE[0],raw:responseRaw,schema:responseSchema},
  {...RESPONSE_SCHEMA_CLOSURE[1],raw:semanticRaw,schema:semanticSchema}
 ],manifest);
 const schemaManifestDigest=responseSchemaManifestDigest(manifest);
 if(schemaManifestDigest!==strictJson.RESPONSE_SCHEMA_MANIFEST_DIGEST)throw new TypeError('RESPONSE_SCHEMA_DOMAIN_DIGEST_INVALID');
 if(evaluatorManifest!==null&&evaluatorManifest.schema_manifest_digest!==schemaManifestDigest)evaluatorManifestBootstrapFailure=true;
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
const isArtifactIoFailure=(error)=>error!==null&&typeof error==='object'&&typeof error.errno==='number'&&typeof error.syscall==='string'&&typeof error.path==='string';
const ARTIFACT_MODULE_CODES=new Set(['ERR_MODULE_NOT_FOUND','ERR_UNKNOWN_FILE_EXTENSION','ERR_UNSUPPORTED_DIR_IMPORT']);
const normalizeEvaluatorInitializationFailure=(error)=>error?.code==='ARTIFACT_VERIFICATION_FAILED'||isArtifactIoFailure(error)||error?.name==='SyntaxError'||ARTIFACT_MODULE_CODES.has(error?.code)?'ARTIFACT_VERIFICATION_FAILED':'EVALUATION_FAILED';
const normalizeEvaluationFailure=(error)=>{
 if(error?.code==='INVALID_EVALUATION_INPUT')return{kind:'invalid',code:'INVALID_EVALUATION_INPUT'};
 if(error?.code==='ARTIFACT_VERIFICATION_FAILED'||isArtifactIoFailure(error))return{kind:'failed',code:'ARTIFACT_VERIFICATION_FAILED'};
 return{kind:'failed',code:'EVALUATION_FAILED'};
};

const main=async()=>{
 if(validateResponse===null){diagnostic('RESPONSE_SCHEMA_INVALID');return 1;}
 const parsed=parseArguments(process.argv.slice(2));
 if(parsed.code)return invalid(parsed.code,parsed.status);
 let raw;
 try{raw=parsed.input==='-'?await readStdin():await readPath(parsed.input);}catch(error){return invalid(error?.code==='INPUT_TOO_LARGE'?'INPUT_TOO_LARGE':'INPUT_UNREADABLE');}
 if(hasLeadingBom(raw))return invalid('INPUT_BOM_FORBIDDEN');
 let source;
 try{source=UTF8_DECODER.decode(raw);}catch{return invalid('INPUT_UTF8_INVALID');}
 let bundle;
 try{bundle=parseKnowledgeJson(Buffer.from(source,'utf8'),'<cli-input>','INPUT_JSON_INVALID',{allowDangerousKeys:true});}
 catch(error){return invalid(error?.code==='KNOWLEDGE_JSON_DUPLICATE_KEY'?'INPUT_JSON_DUPLICATE_MEMBER':'INPUT_JSON_INVALID');}
 if(bundle===null||typeof bundle!=='object'||Array.isArray(bundle))return invalid('INPUT_JSON_INVALID');
 if(bundle.request_mode!==parsed.mode)return invalid('MODE_BUNDLE_MISMATCH');
 if(evaluatorManifestBootstrapFailure)return failed('ARTIFACT_VERIFICATION_FAILED');
 let evaluate;
 try{({evaluate}=await import('../evaluator/index.mjs'));}catch(error){return failed(normalizeEvaluatorInitializationFailure(error));}
 let result;
 try{result=await evaluate(bundle);}catch(error){const failure=normalizeEvaluationFailure(error);return failure.kind==='invalid'?invalid(failure.code):failed(failure.code);}
 const transport={kind:'cli',request_mode:parsed.mode,request_id:process.env.UX_REQUEST_ID??null,input_kind:parsed.input==='-'?'stdin':'path',output_format:'json'};
 return emit({...result,audit_sidecar:{...result.audit_sidecar,transport}},0);
};

process.exitCode=await main();
