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
const [responseSchema,semanticSchema,fixtureBytes]=await Promise.all([
 readFile(RESPONSE_URL,'utf8').then(JSON.parse),
 readFile(SEMANTIC_URL,'utf8').then(JSON.parse),
 readFile(FIXTURE_URL)
]);
const fixtureText=fixtureBytes.toString('utf8');
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,unicodeRegExp:true});addFormats(ajv);ajv.addSchema(semanticSchema);
const validateResponse=ajv.compile(responseSchema);

const replaceOnce=(source,needle,replacement,label)=>{const at=source.indexOf(needle);assert.notEqual(at,-1,label);assert.equal(source.indexOf(needle,at+needle.length),-1,label+':unique-anchor');return source.slice(0,at)+replacement+source.slice(at+needle.length);};
const prependRoot=(member)=>replaceOnce(fixtureText,'{','{'+member+',','root');
const invokeBoth=async(bytes)=>{
 const stdin=await runCli(['--mode','scan','--input','-','--output','json'],bytes);
 const directory=await mkdtemp(join(tmpdir(),'ux-skill-task11-duplicate-'));
 try{const input=join(directory,'input.json');await writeFile(input,bytes);const file=await runCli(['--mode','scan','--input',input,'--output','json']);return[['stdin',stdin],['file',file]];}
 finally{await rm(directory,{recursive:true,force:true});}
};
const expectCanonicalInvalid=(row,code,label)=>{
 assert.equal(row.status,2,label+':exit');assert.equal(row.signal,null,label+':signal');assert.deepEqual(row.json,{run_status:'invalid_input',error_codes:[code]},label+':json');
 assert.equal(row.stdout,JSON.stringify(row.json)+'\n',label+':stdout');assert.equal(row.stderr,code+'\n',label+':stderr');assert.equal(validateResponse(row.json),true,label+':schema:'+JSON.stringify(validateResponse.errors));
 for(const forbidden of ['audit_sidecar','assurance','inquiry','semantic_projection','semantic_digest'])assert.equal(Object.hasOwn(row.json,forbidden),false,label+':'+forbidden);
};

test('TASK11_JSON_DUPLICATE_MEMBER_RED rejects duplicate decoded member names at any depth before evaluation',async()=>{
 const inquiryAnchor='  "inquiry_draft": {\n    "inquiry_draft_id": "inq-delete",';
 const scenarioAnchor='  "scenario_profiles": [\n    {\n      "scenario_profile_id": "admin-delete",';
 const cases=[
  ['root-equal',prependRoot('"request_mode":"scan"')],
  ['root-conflicting',prependRoot('"request_mode":"guide"')],
  ['root-escaped-equivalent',prependRoot('"request_\\u006dode":"scan"')],
  ['nested-equal',replaceOnce(fixtureText,inquiryAnchor,'  "inquiry_draft": {\n    "inquiry_draft_id": "inq-delete",\n    "inquiry_draft_id": "inq-delete",','nested-equal')],
  ['nested-conflicting',replaceOnce(fixtureText,inquiryAnchor,'  "inquiry_draft": {\n    "inquiry_draft_id": "other",\n    "inquiry_draft_id": "inq-delete",','nested-conflicting')],
  ['array-object-equal',replaceOnce(fixtureText,scenarioAnchor,'  "scenario_profiles": [\n    {\n      "scenario_profile_id": "admin-delete",\n      "scenario_profile_id": "admin-delete",','array-equal')],
  ['array-object-conflicting',replaceOnce(fixtureText,scenarioAnchor,'  "scenario_profiles": [\n    {\n      "scenario_profile_id": "other",\n      "scenario_profile_id": "admin-delete",','array-conflicting')]
 ];
 assert.equal(new Set(cases.map(([,source])=>source)).size,cases.length);
 for(const [label,source] of cases)for(const [route,row] of await invokeBoth(Buffer.from(source,'utf8')))expectCanonicalInvalid(row,'INPUT_JSON_DUPLICATE_MEMBER',label+':'+route);
});

test('prototype-sensitive member names remain schema-rejected without pollution',async()=>{
 assert.equal(Object.hasOwn(Object.prototype,'polluted'),false);
 for(const key of ['__proto__','constructor','prototype']){
  const source=prependRoot(JSON.stringify(key)+':{"polluted":true}');
  for(const [route,row] of await invokeBoth(Buffer.from(source,'utf8')))expectCanonicalInvalid(row,'INVALID_EVALUATION_INPUT',key+':'+route);
  assert.equal(Object.hasOwn(Object.prototype,'polluted'),false,key);
 }
});

test('valid duplicate-free multibyte NFC JSON preserves stdin and file semantic parity',async()=>{
 const source=replaceOnce(fixtureText,'MCP_TRANSPORT_TEXT_DO_NOT_HASH','界面é','nfc');assert.equal(source.normalize('NFC'),source);
 const rows=await invokeBoth(Buffer.from(source,'utf8'));for(const [route,row] of rows){assert.equal(row.status,0,route+':'+row.stderr);assert.equal(row.stderr,'',route);assert.equal(row.stdout,JSON.stringify(row.json)+'\n',route);assert.equal(validateResponse(row.json),true,route+':'+JSON.stringify(validateResponse.errors));}
 assert.deepEqual(rows[0][1].json.semantic_projection,rows[1][1].json.semantic_projection);assert.equal(rows[0][1].json.semantic_digest,rows[1][1].json.semantic_digest);
});
