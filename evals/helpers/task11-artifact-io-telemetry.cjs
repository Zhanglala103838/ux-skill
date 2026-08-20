'use strict';

const fs=require('node:fs');
const fsPromises=require('node:fs/promises');
const {fileURLToPath}=require('node:url');
const {registerHooks,syncBuiltinESMExports}=require('node:module');

const target=process.env.TASK11_ARTIFACT_TARGET?fs.realpathSync.native(process.env.TASK11_ARTIFACT_TARGET):null;
const telemetry=process.env.TASK11_ARTIFACT_TELEMETRY;

const record=(event)=>{
 if(!target||!telemetry)return;
 fs.appendFileSync(telemetry,JSON.stringify(event)+'\n');
};
const asPath=(value)=>{
 if(value instanceof URL)return fileURLToPath(value);
 if(Buffer.isBuffer(value))return value.toString();
 return typeof value==='string'?value:null;
};
const isTarget=(value)=>{
 const path=asPath(value);
 if(path===null||target===null)return false;
 try{return fs.realpathSync.native(path)===target;}catch{return path===target;}
};

const originalReadFile=fsPromises.readFile;
fsPromises.readFile=async function(path,...args){
 if(isTarget(path))record({op:'readFile'});
 return originalReadFile.call(this,path,...args);
};

const originalOpen=fsPromises.open;
fsPromises.open=async function(path,...args){
 const handle=await originalOpen.call(this,path,...args);
 if(!isTarget(path))return handle;
 record({op:'open'});
 return new Proxy(handle,{
  get(object,property){
   if(property==='read')return async(...readArgs)=>{
    const request=readArgs[0]&&typeof readArgs[0]==='object'?readArgs[0].length:readArgs[2];
    const result=await object.read(...readArgs);
    record({op:'read',requested:Number(request??0),actual:Number(result?.bytesRead??0)});
    return result;
   };
   const value=Reflect.get(object,property,object);
   return typeof value==='function'?value.bind(object):value;
  }
 });
};
syncBuiltinESMExports();

registerHooks({
 resolve(specifier,context,nextResolve){
 const resolved=nextResolve(specifier,context);
  if(resolved?.url?.startsWith('file:')&&isTarget(new URL(resolved.url)))record({op:'module_resolve'});
  return resolved;
 }
});
