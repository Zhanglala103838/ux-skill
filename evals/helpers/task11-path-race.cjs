'use strict';
const fsPromises=require('node:fs/promises');
const {syncBuiltinESMExports}=require('node:module');

const originalOpen=fsPromises.open;
fsPromises.open=async function(path,...rest){
 const handle=await originalOpen.call(this,path,...rest);
 if(String(path)!==process.env.TASK11_RACE_PATH)return handle;
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
