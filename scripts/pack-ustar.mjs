import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {lstat,open,realpath,unlink} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,parse,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types as utilTypes} from 'node:util';
import {assertCanonicalRelativePath} from '../evaluator/canonical.mjs';
import {parseKnowledgeJson} from './strict-json.mjs';

const BLOCK_SIZE=512;
const MAX_ENTRIES=4096;
const MAX_FILE_BYTES=16_777_216;
const MAX_TOTAL_CONTENT_BYTES=33_554_432;
const MAX_ARCHIVE_BYTES=67_108_864;
const MANIFEST_MAX_BYTES=1_048_576;
const MANIFEST_RELATIVE_PATH='knowledge/artifact-manifest.json';
const OPEN_READ_FLAGS=fsConstants.O_RDONLY|fsConstants.O_NONBLOCK|fsConstants.O_NOFOLLOW;
const PROHIBITED_ROOTS=new Set(['.git','.github','.artifacts','coverage','docs','evals','node_modules']);
const TRUSTED_SYSTEM_DIRECTORY_ALIASES=Object.freeze([
  Object.freeze(['/tmp','/private/tmp']),
  Object.freeze(['/var','/private/var'])
]);

function fail(code){
  const error=new Error(code);
  error.code=code;
  throw error;
}

function isDataDescriptor(descriptor){
  return descriptor!==undefined&&descriptor.enumerable===true&&Object.hasOwn(descriptor,'value');
}

function hasGlob(path){
  return path.includes('*')||path.includes('?')||path.includes('[')||path.includes(']')||path.includes('{')||path.includes('}');
}

function ustarPath(path){
  try{assertCanonicalRelativePath(path);}catch{fail('USTAR_PATH_INVALID');}
  if(hasGlob(path))fail('USTAR_PATH_INVALID');
  return path;
}

function snapshotEntries(entries){
  if(arguments.length!==1||utilTypes.isProxy(entries)||!Array.isArray(entries)||Object.getPrototypeOf(entries)!==Array.prototype)fail('USTAR_INPUT_INVALID');
  if(entries.length>MAX_ENTRIES)fail('USTAR_ENTRY_LIMIT');
  const arrayKeys=Reflect.ownKeys(entries);
  for(const key of arrayKeys){
    if(key==='length')continue;
    if(typeof key!=='string')fail('USTAR_INPUT_INVALID');
    const index=Number(key);
    if(!Number.isInteger(index)||index<0||index>=entries.length||String(index)!==key)fail('USTAR_INPUT_INVALID');
  }

  const rows=[];
  const seen=new Set();
  let totalContent=0;
  let archiveLength=BLOCK_SIZE*2;
  for(let index=0;index<entries.length;index+=1){
    if(!Object.hasOwn(entries,index))fail('USTAR_INPUT_INVALID');
    const arrayDescriptor=Object.getOwnPropertyDescriptor(entries,String(index));
    if(!isDataDescriptor(arrayDescriptor))fail('USTAR_INPUT_INVALID');
    const entry=arrayDescriptor.value;
    if(entry===null||typeof entry!=='object'||utilTypes.isProxy(entry))fail('USTAR_INPUT_INVALID');
    const prototype=Object.getPrototypeOf(entry);
    if(prototype!==Object.prototype&&prototype!==null)fail('USTAR_INPUT_INVALID');
    const keys=Reflect.ownKeys(entry);
    if(keys.length!==2||!keys.includes('path')||!keys.includes('content')||keys.some((key)=>typeof key!=='string'))fail('USTAR_INPUT_INVALID');
    const pathDescriptor=Object.getOwnPropertyDescriptor(entry,'path');
    const contentDescriptor=Object.getOwnPropertyDescriptor(entry,'content');
    if(!isDataDescriptor(pathDescriptor)||!isDataDescriptor(contentDescriptor))fail('USTAR_INPUT_INVALID');
    const path=ustarPath(pathDescriptor.value);
    if(seen.has(path))fail('USTAR_DUPLICATE_PATH');
    seen.add(path);
    const content=contentDescriptor.value;
    if(utilTypes.isProxy(content)||!Buffer.isBuffer(content)||Object.getPrototypeOf(content)!==Buffer.prototype||!(content.buffer instanceof ArrayBuffer)||content.buffer.resizable===true)fail('USTAR_INPUT_INVALID');
    const size=content.byteLength;
    if(size>MAX_FILE_BYTES)fail('USTAR_FILE_TOO_LARGE');
    if(totalContent>MAX_TOTAL_CONTENT_BYTES-size)fail('USTAR_TOTAL_TOO_LARGE');
    totalContent+=size;
    const paddedSize=Math.ceil(size/BLOCK_SIZE)*BLOCK_SIZE;
    const contribution=BLOCK_SIZE+paddedSize;
    if(!Number.isSafeInteger(contribution)||archiveLength>MAX_ARCHIVE_BYTES-contribution)fail('USTAR_TOTAL_TOO_LARGE');
    archiveLength+=contribution;
    rows.push({path,pathBytes:Buffer.from(path,'utf8'),content,size});
  }

  rows.sort((left,right)=>Buffer.compare(left.pathBytes,right.pathBytes));
  for(const row of rows)row.snapshot=Buffer.from(row.content);
  return {archiveLength,rows};
}

function writeAscii(target,offset,width,value){
  const bytes=Buffer.from(value,'ascii');
  if(bytes.length!==width)fail('USTAR_INTERNAL_ERROR');
  bytes.copy(target,offset);
}

function createHeader(row){
  const header=Buffer.alloc(BLOCK_SIZE);
  row.pathBytes.copy(header,0);
  writeAscii(header,100,8,'0000644\u0000');
  writeAscii(header,108,8,'0000000\u0000');
  writeAscii(header,116,8,'0000000\u0000');
  writeAscii(header,124,12,row.size.toString(8).padStart(11,'0')+'\u0000');
  writeAscii(header,136,12,'00000000000\u0000');
  header.fill(0x20,148,156);
  header[156]=0x30;
  writeAscii(header,257,6,'ustar\u0000');
  writeAscii(header,263,2,'00');
  let checksum=0;
  for(const byte of header)checksum+=byte;
  writeAscii(header,148,8,checksum.toString(8).padStart(6,'0')+'\u0000 ');
  return header;
}

export function packCanonicalUstar(entries){
  if(arguments.length!==1)fail('USTAR_INPUT_INVALID');
  const snapshot=snapshotEntries(entries);
  const archive=Buffer.alloc(snapshot.archiveLength);
  let offset=0;
  for(const row of snapshot.rows){
    createHeader(row).copy(archive,offset);
    offset+=BLOCK_SIZE;
    row.snapshot.copy(archive,offset);
    offset+=Math.ceil(row.size/BLOCK_SIZE)*BLOCK_SIZE;
  }
  if(offset+BLOCK_SIZE*2!==archive.length)fail('USTAR_INTERNAL_ERROR');
  return archive;
}

function sameSnapshot(before,after,byteLength){
  return before.isFile()&&after.isFile()
    &&before.dev===after.dev
    &&before.ino===after.ino
    &&before.size===after.size
    &&before.mtimeNs===after.mtimeNs
    &&before.ctimeNs===after.ctimeNs
    &&before.nlink===after.nlink
    &&before.nlink===1n
    &&before.size===BigInt(byteLength);
}

async function normalizeSystemDirectoryAlias(path){
  for(const [alias,physical] of TRUSTED_SYSTEM_DIRECTORY_ALIASES){
    if(path!==alias&&!path.startsWith(alias+sep))continue;
    let status;let actual;
    try{[status,actual]=await Promise.all([lstat(alias),realpath(alias)]);}catch{return path;}
    if(status.isSymbolicLink()&&actual===physical)return resolve(physical,relative(alias,path));
  }
  return path;
}

async function requireAuthenticDirectory(path,code){
  const normalized=await normalizeSystemDirectoryAlias(path);
  const volume=parse(normalized).root;
  if(volume==='')fail(code);
  const tail=relative(volume,normalized);
  const segments=tail===''?[]:tail.split(sep);
  let current=volume;
  for(const segment of segments){
    current=join(current,segment);
    const status=await safeLstat(current,code);
    if(status.isSymbolicLink()||!status.isDirectory())fail(code);
  }
  let physical;
  try{physical=await realpath(normalized);}catch{fail(code);}
  if(physical!==normalized)fail(code);
  return physical;
}

async function safeLstat(path,code){
  try{return await lstat(path,{bigint:true});}catch{fail(code);}
}

async function requireDirectoryComponents(root,path,code){
  const segments=path===''?[]:path.split('/');
  let current=root;
  for(const segment of segments){
    current=join(current,segment);
    const info=await safeLstat(current,code);
    if(!info.isDirectory()||info.isSymbolicLink())fail(code);
  }
}

async function requireRegularPath(root,path,code){
  const segments=path.split('/');
  await requireDirectoryComponents(root,segments.slice(0,-1).join('/'),code);
  const physical=join(root,...segments);
  const info=await safeLstat(physical,code);
  if(!info.isFile()||info.isSymbolicLink())fail(code);
  return physical;
}

async function readBounded(handle,before,maxBytes,code){
  if(!before.isFile())fail(code);
  if(before.size>BigInt(maxBytes))fail(code);
  const capacity=Number(before.size)+1;
  const allocation=Buffer.allocUnsafe(capacity);
  let bytesRead=0;
  try{
    while(bytesRead<capacity){
      const result=await handle.read(allocation,bytesRead,capacity-bytesRead,bytesRead);
      if(result.bytesRead===0)break;
      bytesRead+=result.bytesRead;
    }
  }catch{fail(code);}
  if(bytesRead!==Number(before.size))fail(code);
  return Buffer.from(allocation.subarray(0,bytesRead));
}

function parseManifest(raw){
  let manifest;
  try{manifest=parseKnowledgeJson(raw,MANIFEST_RELATIVE_PATH,'ARTIFACT_MANIFEST_INVALID');}catch{fail('ARTIFACT_MANIFEST_INVALID');}
  if(manifest===null||typeof manifest!=='object'||Array.isArray(manifest)||Object.getPrototypeOf(manifest)!==Object.prototype)fail('ARTIFACT_MANIFEST_INVALID');
  const keys=Object.keys(manifest);
  if(keys.length!==2||!keys.includes('manifest_version')||!keys.includes('paths'))fail('ARTIFACT_MANIFEST_INVALID');
  if(manifest.manifest_version!=='artifact-manifest-v1'||!Array.isArray(manifest.paths)||manifest.paths.length>MAX_ENTRIES)fail('ARTIFACT_MANIFEST_INVALID');
  let previous=null;
  for(const path of manifest.paths){
    try{assertCanonicalRelativePath(path);}catch{fail('ARTIFACT_MANIFEST_INVALID');}
    if(hasGlob(path))fail('ARTIFACT_MANIFEST_INVALID');
    const first=path.split('/')[0];
    if(PROHIBITED_ROOTS.has(first)||path==='artifact.sha256'||path.endsWith('/artifact.sha256'))fail('ARTIFACT_MANIFEST_INVALID');
    const bytes=Buffer.from(path,'utf8');
    if(previous!==null&&Buffer.compare(previous,bytes)>=0)fail('ARTIFACT_MANIFEST_INVALID');
    previous=bytes;
  }
  return manifest;
}

function relativeWithin(root,path,code){
  const value=relative(root,path);
  if(value===''||isAbsolute(value)||value==='..'||value.startsWith('..'+sep))fail(code);
  const canonical=value.split(sep).join('/');
  try{assertCanonicalRelativePath(canonical);}catch{fail(code);}
  if(hasGlob(canonical))fail(code);
  return canonical;
}

async function openManifest(manifestArgument,retained){
  const requested=resolve(manifestArgument);
  if(basename(requested)!=='artifact-manifest.json'||basename(dirname(requested))!=='knowledge')fail('ARTIFACT_MANIFEST_INVALID');
  const lexicalRoot=dirname(dirname(requested));
  const root=await requireAuthenticDirectory(lexicalRoot,'ARTIFACT_MANIFEST_INVALID');
  await requireDirectoryComponents(root,'knowledge','ARTIFACT_MANIFEST_INVALID');
  const physical=join(root,'knowledge','artifact-manifest.json');
  let handle;
  try{handle=await open(physical,OPEN_READ_FLAGS);}catch{fail('ARTIFACT_MANIFEST_INVALID');}
  retained.push({handle,path:MANIFEST_RELATIVE_PATH,physical});
  let before;
  try{before=await handle.stat({bigint:true});}catch{fail('ARTIFACT_MANIFEST_INVALID');}
  if(!before.isFile()||before.nlink!==1n||before.size>BigInt(MANIFEST_MAX_BYTES))fail('ARTIFACT_MANIFEST_INVALID');
  let content;
  try{content=await readBounded(handle,before,MANIFEST_MAX_BYTES,'ARTIFACT_MANIFEST_INVALID');}catch{fail('ARTIFACT_MANIFEST_INVALID');}
  let after;
  try{after=await handle.stat({bigint:true});}catch{fail('ARTIFACT_MANIFEST_INVALID');}
  if(!sameSnapshot(before,after,content.length))fail('ARTIFACT_MANIFEST_INVALID');
  const record=retained[retained.length-1];
  Object.assign(record,{before,content});
  return {lexicalRoot,root,record,manifest:parseManifest(content)};
}

async function openSource(root,path,retained,seenInodes){
  const physical=await requireRegularPath(root,path,'ARTIFACT_INPUT_UNSAFE');
  let handle;
  try{handle=await open(physical,OPEN_READ_FLAGS);}catch{fail('ARTIFACT_INPUT_UNSAFE');}
  const record={handle,path,physical};
  retained.push(record);
  let before;
  try{before=await handle.stat({bigint:true});}catch{fail('ARTIFACT_INPUT_UNSAFE');}
  if(!before.isFile())fail('ARTIFACT_INPUT_UNSAFE');
  if(before.nlink!==1n)fail('ARTIFACT_INPUT_ALIAS');
  if(before.size>BigInt(MAX_FILE_BYTES))fail('ARTIFACT_INPUT_TOO_LARGE');
  const inode=String(before.dev)+':'+String(before.ino);
  if(seenInodes.has(inode))fail('ARTIFACT_INPUT_ALIAS');
  seenInodes.add(inode);
  record.before=before;
  return record;
}

async function verifyRetained(record){
  let after;
  try{after=await record.handle.stat({bigint:true});}catch{fail('ARTIFACT_INPUT_CHANGED');}
  if(!sameSnapshot(record.before,after,record.content.length))fail('ARTIFACT_INPUT_CHANGED');
  let lexical;
  try{lexical=await lstat(record.physical,{bigint:true});}catch{fail('ARTIFACT_INPUT_CHANGED');}
  if(!sameSnapshot(record.before,lexical,record.content.length))fail('ARTIFACT_INPUT_CHANGED');
  let resolved;
  try{resolved=await realpath(record.physical);}catch{fail('ARTIFACT_INPUT_CHANGED');}
  if(resolved!==record.physical)fail('ARTIFACT_INPUT_CHANGED');
}

async function outputLocation(root,lexicalRoot,outputArgument,relativePath){
  const requested=resolve(outputArgument);
  const parentRelative=dirname(relativePath)==='.'?'':dirname(relativePath);
  await requireDirectoryComponents(root,parentRelative,'ARTIFACT_OUTPUT_UNSAFE');
  const physicalParent=parentRelative===''?root:join(root,...parentRelative.split('/'));
  let resolvedParent;
  try{resolvedParent=await realpath(physicalParent);}catch{fail('ARTIFACT_OUTPUT_UNSAFE');}
  if(resolvedParent!==physicalParent)fail('ARTIFACT_OUTPUT_UNSAFE');
  const expectedLexical=resolve(lexicalRoot,...relativePath.split('/'));
  if(requested!==expectedLexical)fail('ARTIFACT_OUTPUT_UNSAFE');
  return join(resolvedParent,basename(relativePath));
}

async function existingPath(path){
  try{return await lstat(path,{bigint:true});}
  catch(error){if(error?.code==='ENOENT')return null;throw error;}
}

async function removeOwnPartial(path,snapshot){
  if(snapshot===null)return;
  try{
    const current=await lstat(path,{bigint:true});
    if(current.isFile()&&current.dev===snapshot.dev&&current.ino===snapshot.ino)await unlink(path);
  }catch{}
}

async function writeExclusive(path,bytes){
  let handle;
  let createdSnapshot=null;
  try{
    if(await existingPath(path)!==null)fail('ARTIFACT_OUTPUT_UNSAFE');
    try{handle=await open(path,fsConstants.O_CREAT|fsConstants.O_EXCL|fsConstants.O_WRONLY|fsConstants.O_NOFOLLOW,0o600);}
    catch{fail('ARTIFACT_OUTPUT_UNSAFE');}
    try{createdSnapshot=await handle.stat({bigint:true});}catch{fail('ARTIFACT_OUTPUT_UNSAFE');}
    let offset=0;
    while(offset<bytes.length){
      let result;
      try{result=await handle.write(bytes,offset,bytes.length-offset,offset);}catch{fail('ARTIFACT_OUTPUT_WRITE_FAILED');}
      if(result.bytesWritten===0)fail('ARTIFACT_OUTPUT_WRITE_FAILED');
      offset+=result.bytesWritten;
    }
    try{await handle.sync();}catch{fail('ARTIFACT_OUTPUT_WRITE_FAILED');}
    try{await handle.close();}catch{fail('ARTIFACT_OUTPUT_WRITE_FAILED');}
    handle=undefined;
    const final=await safeLstat(path,'ARTIFACT_OUTPUT_WRITE_FAILED');
    if(!final.isFile()||final.nlink!==1n||final.dev!==createdSnapshot.dev||final.ino!==createdSnapshot.ino||final.size!==BigInt(bytes.length))fail('ARTIFACT_OUTPUT_WRITE_FAILED');
  }catch(error){
    if(handle!==undefined)await handle.close().catch(()=>{});
    await removeOwnPartial(path,createdSnapshot);
    throw error;
  }
}

async function packFromManifest(manifestArgument,outputArgument){
  const retained=[];
  try{
    const opened=await openManifest(manifestArgument,retained);
    const outputRequested=resolve(outputArgument);
    const outputRelative=relativeWithin(opened.lexicalRoot,outputRequested,'ARTIFACT_OUTPUT_UNSAFE');
    if(opened.manifest.paths.includes(outputRelative))fail('ARTIFACT_OUTPUT_SELF');

    const manifestInode=String(opened.record.before.dev)+':'+String(opened.record.before.ino);
    const seenInodes=new Set([manifestInode]);
    const sourceRecords=[];
    let totalContent=0;
    for(const path of opened.manifest.paths){
      let record;
      if(path===MANIFEST_RELATIVE_PATH){
        record=opened.record;
      }else{
        record=await openSource(opened.root,path,retained,seenInodes);
      }
      if(totalContent>MAX_TOTAL_CONTENT_BYTES-Number(record.before.size))fail('ARTIFACT_INPUT_TOO_LARGE');
      totalContent+=Number(record.before.size);
      sourceRecords.push(record);
    }

    for(const record of sourceRecords){
      if(record!==opened.record)record.content=await readBounded(record.handle,record.before,MAX_FILE_BYTES,'ARTIFACT_INPUT_CHANGED');
    }
    const archive=packCanonicalUstar(sourceRecords.map((record)=>({path:record.path,content:record.content})));
    createHash('sha256').update('ux-skill:artifact:v1','utf8').update(archive).digest();
    for(const record of retained)await verifyRetained(record);
    const outputPhysical=await outputLocation(opened.root,opened.lexicalRoot,outputArgument,outputRelative);
    await writeExclusive(outputPhysical,archive);
  }finally{
    await Promise.all(retained.map((record)=>record.handle.close().catch(()=>{})));
  }
}

async function main(){
  let argumentsList=process.argv.slice(2);
  if(argumentsList[0]==='--')argumentsList=argumentsList.slice(1);
  if(argumentsList.length!==2||argumentsList.includes('--'))fail('ARTIFACT_ARGUMENT_INVALID');
  await packFromManifest(argumentsList[0],argumentsList[1]);
}

async function isDirectEntry(argument){
  if(argument===undefined)return false;
  try{
    const [requested,module]=await Promise.all([
      realpath(resolve(argument)),
      realpath(fileURLToPath(import.meta.url))
    ]);
    return requested===module;
  }catch{return false;}
}

if(await isDirectEntry(process.argv[1])){
  try{await main();}
  catch(error){
    const code=typeof error?.code==='string'&&error.code.startsWith('ARTIFACT_')?error.code:'ARTIFACT_PACK_FAILED';
    process.stderr.write(code+'\n');
    process.exitCode=1;
  }
}
