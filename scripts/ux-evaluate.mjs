#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {open} from 'node:fs/promises';
import {TextDecoder} from 'node:util';

const ROOT=new URL('../',import.meta.url);
const RESPONSE_PATH='schemas/adapters/ux-evaluate-response-v1.schema.json';
const SEMANTIC_PATH='schemas/evaluator/semantic-projection.schema.json';
const SCHEMA_MANIFEST_PATH='schemas/manifest.json';
const EVALUATOR_MANIFEST_PATH='evaluator/manifest.json';
const STRICT_JSON_PATH='scripts/strict-json.mjs';
const CANONICAL_PATH='evaluator/canonical.mjs';
const RESPONSE_SCHEMA_CLOSURE=Object.freeze([
 Object.freeze({path:RESPONSE_PATH,id:'https://ux-skill.invalid/schemas/adapters/ux-evaluate-response-v1.schema.json'}),
 Object.freeze({path:SEMANTIC_PATH,id:'https://ux-skill.invalid/schemas/evaluator/semantic-projection.schema.json'})
]);
const MAX_BYTES=1_048_576;
const MAX_BYTES_BIGINT=BigInt(MAX_BYTES);
const PATH_OPEN_FLAGS=fsConstants.O_RDONLY|fsConstants.O_NONBLOCK|fsConstants.O_NOFOLLOW;
const SCHEMA_MANIFEST_RAW_DIGEST='14cef635bc55992ecbfd78cd94f4308f088bd52f1d500d00fcde5faf25f12db4';
const EVALUATOR_MANIFEST_RAW_DIGEST='3fece26c17f2029c5ee595c5e967b005f5269c22cdccad94c4f1562ee1587743';
const EVALUATOR_MANIFEST_SEMANTIC_DIGEST='1d20602f72c7aafd9573e27387893e387d546fd9c02b80fe44fe49cb7d45f012';
const STRICT_JSON_RAW_DIGEST='0d0f7ddd439880a6ec4147bccea2242eab32fc248f9e270890c5d7b5afa3521c';
const CANONICAL_RAW_DIGEST='59ef007f05359bf7c851b2abeeec3910468cf90b4bcf33f18e17912dac369a05';
const EXPECTED_EVALUATOR_MODULES=Object.freeze(['evaluator/authority.mjs','evaluator/canonical.mjs','evaluator/claims.mjs','evaluator/dependency-decision.mjs','evaluator/digests.mjs','evaluator/index.mjs','evaluator/projection.mjs','evaluator/rules-runtime.mjs','evaluator/validation.mjs']);
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
const sameSnapshot=(left,right)=>left.isFile()&&right.isFile()&&left.dev===right.dev&&left.ino===right.ino&&left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs;
const snapshotOf=(stats)=>Object.freeze({dev:stats.dev,ino:stats.ino,size:stats.size,mtimeNs:stats.mtimeNs,ctimeNs:stats.ctimeNs});
const matchesSnapshot=(stats,snapshot)=>stats.isFile()&&stats.dev===snapshot.dev&&stats.ino===snapshot.ino&&stats.size===snapshot.size&&stats.mtimeNs===snapshot.mtimeNs&&stats.ctimeNs===snapshot.ctimeNs;
const readBootstrapArtifact=async(path,expectedSnapshot=null)=>{
 let handle;
 try{
  handle=await open(new URL(path,ROOT),PATH_OPEN_FLAGS);
  const before=await handle.stat({bigint:true});
  if(!before.isFile()||before.size>MAX_BYTES_BIGINT||(expectedSnapshot!==null&&!matchesSnapshot(before,expectedSnapshot)))throw new TypeError('ARTIFACT_BOOTSTRAP_INVALID');
  const bytes=Buffer.allocUnsafe(Number(before.size)+1);let total=0;
  while(total<bytes.length){const{bytesRead}=await handle.read(bytes,total,bytes.length-total,total);if(bytesRead===0)break;total+=bytesRead;}
  const after=await handle.stat({bigint:true});
  if(total>MAX_BYTES||!sameSnapshot(before,after)||after.size!==BigInt(total))throw new TypeError('ARTIFACT_BOOTSTRAP_INVALID');
  return{bytes:bytes.subarray(0,total),snapshot:snapshotOf(after)};
 }catch(error){if(error?.message==='ARTIFACT_BOOTSTRAP_INVALID')throw error;throw new TypeError('ARTIFACT_BOOTSTRAP_INVALID');}
 finally{if(handle!==undefined)await handle.close().catch(()=>{});}
};
const verifyPinnedBootstrap=async(path,digest,expectedSnapshot=null)=>{const loaded=await readBootstrapArtifact(path,expectedSnapshot);if(sha(loaded.bytes)!==digest)throw new TypeError('ARTIFACT_BOOTSTRAP_INVALID');return loaded;};
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
let evaluatorModulePreflight=null;
const loadResponseValidator=async()=>{
 const[responseFile,semanticFile,manifestFile,strictFile,canonicalFile]=await Promise.all([
  readBootstrapArtifact(RESPONSE_PATH),readBootstrapArtifact(SEMANTIC_PATH),verifyPinnedBootstrap(SCHEMA_MANIFEST_PATH,SCHEMA_MANIFEST_RAW_DIGEST),verifyPinnedBootstrap(STRICT_JSON_PATH,STRICT_JSON_RAW_DIGEST),verifyPinnedBootstrap(CANONICAL_PATH,CANONICAL_RAW_DIGEST)
 ]);
 const provisionalManifest=JSON.parse(manifestFile.bytes),provisionalResponse=JSON.parse(responseFile.bytes),provisionalSemantic=JSON.parse(semanticFile.bytes);
 verifyResponseSchemaClosure([
  {...RESPONSE_SCHEMA_CLOSURE[0],raw:responseFile.bytes,schema:provisionalResponse},
  {...RESPONSE_SCHEMA_CLOSURE[1],raw:semanticFile.bytes,schema:provisionalSemantic}
 ],provisionalManifest);
 const[{default:Ajv2020},{default:addFormats},{canonicalize},strictJson]=await Promise.all([import('ajv/dist/2020.js'),import('ajv-formats'),import('json-canonicalize'),import('./strict-json.mjs')]);
 await Promise.all([verifyPinnedBootstrap(STRICT_JSON_PATH,STRICT_JSON_RAW_DIGEST,strictFile.snapshot),verifyPinnedBootstrap(CANONICAL_PATH,CANONICAL_RAW_DIGEST,canonicalFile.snapshot)]);
 parseKnowledgeJson=strictJson.parseKnowledgeJson;const responseSchemaManifestDigest=strictJson.responseSchemaManifestDigest;
 const responseSchema=parseKnowledgeJson(responseFile.bytes,RESPONSE_PATH,'RESPONSE_SCHEMA_INVALID'),semanticSchema=parseKnowledgeJson(semanticFile.bytes,SEMANTIC_PATH,'RESPONSE_SCHEMA_INVALID'),manifest=parseKnowledgeJson(manifestFile.bytes,SCHEMA_MANIFEST_PATH,'RESPONSE_SCHEMA_INVALID');
 const schemaManifestDigest=responseSchemaManifestDigest(manifest);
 if(schemaManifestDigest!==strictJson.RESPONSE_SCHEMA_MANIFEST_DIGEST)throw new TypeError('RESPONSE_SCHEMA_DOMAIN_DIGEST_INVALID');
 const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
 const validator=ajv.compile(responseSchema);
 try{
  const evaluatorFile=await verifyPinnedBootstrap(EVALUATOR_MANIFEST_PATH,EVALUATOR_MANIFEST_RAW_DIGEST);
  const evaluatorManifest=parseKnowledgeJson(evaluatorFile.bytes,EVALUATOR_MANIFEST_PATH,'ARTIFACT_JSON_INVALID');
  const evaluatorDigest=createHash('sha256').update('ux-skill:evaluator-manifest:v1','utf8').update(canonicalize(evaluatorManifest),'utf8').digest('hex');
  const manifestKeys=['behavior_version','evaluator_files','schema_manifest_digest','knowledge_manifest_digest','policy_manifest_digest','snapshot_source_registry'];
  if(evaluatorDigest!==EVALUATOR_MANIFEST_SEMANTIC_DIGEST||evaluatorManifest===null||typeof evaluatorManifest!=='object'||Array.isArray(evaluatorManifest)||Object.keys(evaluatorManifest).length!==manifestKeys.length||!manifestKeys.every((key)=>Object.hasOwn(evaluatorManifest,key))||evaluatorManifest.schema_manifest_digest!==schemaManifestDigest||!Array.isArray(evaluatorManifest.evaluator_files))throw new TypeError('EVALUATOR_MANIFEST_INVALID');
  const paths=evaluatorManifest.evaluator_files.map((row)=>row?.path);
  if(JSON.stringify(paths)!==JSON.stringify(EXPECTED_EVALUATOR_MODULES))throw new TypeError('EVALUATOR_MANIFEST_INVALID');
  const verified=[];
  for(const row of evaluatorManifest.evaluator_files){if(row===null||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==2||!Object.hasOwn(row,'path')||!Object.hasOwn(row,'file_digest')||!/^evaluator\/[a-z0-9-]+\.mjs$/u.test(row.path)||!/^[0-9a-f]{64}$/u.test(row.file_digest))throw new TypeError('EVALUATOR_MANIFEST_INVALID');const loaded=await verifyPinnedBootstrap(row.path,row.file_digest);verified.push(Object.freeze({path:row.path,digest:row.file_digest,snapshot:loaded.snapshot}));}
  evaluatorModulePreflight=Object.freeze(verified);
 }catch{evaluatorManifestBootstrapFailure=true;evaluatorModulePreflight=null;}
 return validator;
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
const verifyEvaluatorAfterImport=async()=>{if(evaluatorModulePreflight===null)throw new TypeError('ARTIFACT_VERIFICATION_FAILED');for(const row of evaluatorModulePreflight)await verifyPinnedBootstrap(row.path,row.digest,row.snapshot);};

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
 try{await verifyEvaluatorAfterImport();}catch{return failed('ARTIFACT_VERIFICATION_FAILED');}
 let result;
 try{result=await evaluate(bundle);}catch(error){const failure=normalizeEvaluationFailure(error);return failure.kind==='invalid'?invalid(failure.code):failed(failure.code);}
 const transport={kind:'cli',request_mode:parsed.mode,request_id:process.env.UX_REQUEST_ID??null,input_kind:parsed.input==='-'?'stdin':'path',output_format:'json'};
 return emit({...result,audit_sidecar:{...result.audit_sidecar,transport}},0);
};

process.exitCode=await main();
