'use strict';
const fsPromises=require('node:fs/promises');
const {syncBuiltinESMExports}=require('node:module');

const originalOpen=fsPromises.open;
fsPromises.open=async function(path,...rest){
 const handle=await originalOpen.call(this,path,...rest);
 if(String(path)!==process.env.TASK11_RACE_PATH)return handle;
 const mode=process.env.TASK11_RACE_MODE??'resize-after-stat';
 if(mode==='same-size-overwrite'){
  const replacement=await fsPromises.readFile(process.env.TASK11_RACE_REPLACEMENT_PATH);
  const partialBytes=Number(process.env.TASK11_RACE_PARTIAL_BYTES);
  if(!Number.isSafeInteger(partialBytes)||partialBytes<=0)throw new TypeError('TASK11_RACE_PARTIAL_BYTES_INVALID');
  const originalRead=handle.read.bind(handle);let firstRead=true;
  Object.defineProperty(handle,'read',{configurable:true,value:async(buffer,offset,length,position)=>{
   const result=await originalRead(buffer,offset,firstRead?Math.min(length,partialBytes):length,position);
   if(!firstRead)return result;
   firstRead=false;
   const writer=await originalOpen.call(fsPromises,process.env.TASK11_RACE_PATH,'r+');let before;let after;
   try{
    before=await writer.stat({bigint:true});
    if(before.size!==BigInt(replacement.length))throw new TypeError('TASK11_RACE_REPLACEMENT_SIZE_INVALID');
    let written=0;while(written<replacement.length){const row=await writer.write(replacement,written,replacement.length-written,written);if(row.bytesWritten===0)throw new TypeError('TASK11_RACE_WRITE_INCOMPLETE');written+=row.bytesWritten;}
    await writer.sync();after=await writer.stat({bigint:true});
   }finally{await writer.close();}
   const snapshot=(stats)=>({dev:String(stats.dev),ino:String(stats.ino),size:String(stats.size),mtimeNs:String(stats.mtimeNs),ctimeNs:String(stats.ctimeNs)});
   await fsPromises.writeFile(process.env.TASK11_RACE_MARKER_PATH,JSON.stringify({fired:true,firstReadBytes:result.bytesRead,before:snapshot(before),after:snapshot(after)}));
   return result;
  }});
  return handle;
 }
 if(mode!=='resize-after-stat')throw new TypeError('TASK11_RACE_MODE_INVALID');
 const mutationSize=Number(process.env.TASK11_RACE_SIZE);
 if(!Number.isSafeInteger(mutationSize)||mutationSize<0)throw new TypeError('TASK11_RACE_SIZE_INVALID');
 const originalStat=handle.stat.bind(handle);let firstStat=true;
 Object.defineProperty(handle,'stat',{configurable:true,value:async(...args)=>{
  const result=await originalStat(...args);
  if(firstStat){firstStat=false;await fsPromises.truncate(process.env.TASK11_RACE_PATH,mutationSize);}
  return result;
 }});
 return handle;
};
syncBuiltinESMExports();
