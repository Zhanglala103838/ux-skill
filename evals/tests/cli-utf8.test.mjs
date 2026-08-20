import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {runCli} from '../helpers/process.mjs';

const RESPONSE_URL=new URL('../../schemas/adapters/ux-evaluate-response-v1.schema.json',import.meta.url);
const SEMANTIC_URL=new URL('../../schemas/evaluator/semantic-projection.schema.json',import.meta.url);
const FIXTURE_URL=new URL('../parity/scan.json',import.meta.url);
const TOKEN=Buffer.from('MCP_TRANSPORT_TEXT_DO_NOT_HASH');
const [responseSchema,semanticSchema,fixtureBytes]=await Promise.all([
 readFile(RESPONSE_URL,'utf8').then(JSON.parse),
 readFile(SEMANTIC_URL,'utf8').then(JSON.parse),
 readFile(FIXTURE_URL)
]);
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
const validateResponse=ajv.compile(responseSchema);

const replaceToken=(replacement)=>{
 const at=fixtureBytes.indexOf(TOKEN);assert.notEqual(at,-1);
 return Buffer.concat([fixtureBytes.subarray(0,at),Buffer.from(replacement),fixtureBytes.subarray(at+TOKEN.length)]);
};
const invokeBoth=async(bytes)=>{
 const stdin=await runCli(['--mode','scan','--input','-','--output','json'],bytes);
 const directory=await mkdtemp(join(tmpdir(),'ux-skill-task11-utf8-'));
 try{
  const input=join(directory,'input.json');await writeFile(input,bytes);
  const file=await runCli(['--mode','scan','--input',input,'--output','json']);
  return[['stdin',stdin],['file',file]];
 }finally{await rm(directory,{recursive:true,force:true});}
};
const expectCanonicalInvalid=(row,code,label)=>{
 assert.equal(row.status,2,label+':exit');assert.equal(row.signal,null,label+':signal');
 assert.deepEqual(row.json,{run_status:'invalid_input',error_codes:[code]},label+':json');
 assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');assert.equal(row.stderr,code+'\n',label+':stderr');
 assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));
 for(const forbidden of ['audit_sidecar','assurance','inquiry','semantic_projection','semantic_digest'])assert.equal(Object.hasOwn(row.json,forbidden),false,label+':'+forbidden);
};

test('TASK11_UTF8_BYTES_RED malformed UTF-8 and BOM fail before evaluation for stdin and file',async()=>{
 const malformed=[
  ['ff',Buffer.from([0xff])],
  ['80',Buffer.from([0x80])],
  ['overlong',Buffer.from([0xc0,0xaf])],
  ['truncated',Buffer.from([0xe2,0x82])],
  ['lone-continuation',Buffer.from([0x61,0xbf])]
 ];
 assert.equal(new Set(malformed.map(([,bytes])=>bytes.toString('hex'))).size,malformed.length);
 for(const [label,replacement] of malformed){
  const bytes=replaceToken(replacement);assert.throws(()=>new TextDecoder('utf-8',{fatal:true}).decode(bytes),TypeError,label+':precondition');
  for(const [route,row] of await invokeBoth(bytes))expectCanonicalInvalid(row,'INPUT_UTF8_INVALID',label+':'+route);
 }
 const bom=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),fixtureBytes]);assert.doesNotThrow(()=>new TextDecoder('utf-8',{fatal:true}).decode(bom));
 for(const [route,row] of await invokeBoth(bom))expectCanonicalInvalid(row,'INPUT_BOM_FORBIDDEN','bom:'+route);
});

test('valid multibyte NFC input preserves stdin and file semantic parity',async()=>{
 const bytes=replaceToken(Buffer.from('界面é','utf8'));const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assert.equal(decoded.normalize('NFC'),decoded);
 const rows=await invokeBoth(bytes);for(const [route,row] of rows){assert.equal(row.status,0,route+':'+row.stderr);assert.equal(row.stderr,'',route);assert.equal(row.stdout,JSON.stringify(row.json)+'\n',route);assert.equal(validateResponse(row.json),true,route+':'+JSON.stringify(validateResponse.errors));}
 assert.deepEqual(rows[0][1].json.semantic_projection,rows[1][1].json.semantic_projection);assert.equal(rows[0][1].json.semantic_digest,rows[1][1].json.semantic_digest);
});
