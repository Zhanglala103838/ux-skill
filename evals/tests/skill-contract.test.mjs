import test from 'node:test';
import assert from 'node:assert/strict';
import {access,cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import YAML from 'yaml';

const PRODUCTION_PATHS=['SKILL.md','agents/openai.yaml','scripts/validate-skill.mjs'];
let validateSkill;
let entryFailure;
try{
 for(const path of PRODUCTION_PATHS)await access(path);
 ({validateSkill}=await import('../../scripts/validate-skill.mjs'));
 if(typeof validateSkill!=='function')throw new TypeError('validateSkill export missing');
}catch(error){entryFailure=error;}

if(entryFailure){
 test('TASK12_SKILL_ROUTER_RED',()=>{
  assert.fail('TASK12_SKILL_ROUTER_RED:'+(entryFailure?.code??entryFailure?.name??'MISSING'));
 });
}else{
 const EXPECTED_COMMAND='pnpm ux:evaluate -- --mode <mode> --input - --output json';
 const EXPECTED_METADATA={
  interface:{
   display_name:'Evidence-aware Product UX',
   short_description:'Evidence-bounded guidance for digital product UX',
   default_prompt:'Use $improving-product-ux to guide, scan, refactor, or verify this product experience.'
  },
  policy:{allow_implicit_invocation:true}
 };
 const read=(path,root=process.cwd())=>readFile(join(root,path),'utf8');
 const run=(file,args=[])=>new Promise((resolve)=>{
  const child=spawn(process.execPath,[file,...args],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let stdout='';let stderr='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',(chunk)=>{stdout+=chunk;});child.stderr.on('data',(chunk)=>{stderr+=chunk;});
  child.on('close',(status,signal)=>resolve({status,signal,stdout,stderr}));
 });

 async function copyInto(root,path){
  const target=join(root,path);await mkdir(dirname(target),{recursive:true});await cp(path,target);
 }
 async function withRepository(callback){
  const root=await mkdtemp(join(tmpdir(),'ux-skill-contract-'));
  try{
   const manifest=JSON.parse(await read('knowledge/manifest.json'));
   const paths=[
    'SKILL.md','agents/openai.yaml','package.json','scripts/ux-evaluate.mjs',
    'knowledge/manifest.json',...manifest.files.map((row)=>row.path)
   ];
   for(const path of [...new Set(paths)])await copyInto(root,path);
   return await callback(root);
  }finally{await rm(root,{recursive:true,force:true});}
 }

 test('Skill frontmatter, progressive router, CLI boundary, and two-track response are lean and explicit',async()=>{
  const skill=await read('SKILL.md');
  const match=/^---\n([\s\S]*?)\n---\n/.exec(skill);
  assert.ok(match,'frontmatter must be first and LF-delimited');
  assert.deepEqual(Object.keys(YAML.parse(match[1])),['name','description']);
  const frontmatter=YAML.parse(match[1]);
  assert.equal(frontmatter.name,'improving-product-ux');
  assert.equal(typeof frontmatter.description,'string');
  assert.ok(frontmatter.description.length>0&&frontmatter.description.length<=1024);
  assert.ok(skill.split('\n').length<500);
  assert.equal(skill.split(EXPECTED_COMMAND).length-1,1);
  assert.match(skill,/knowledge\/manifest\.json/);
  assert.match(skill,/routes\[request_mode\]\.paths/);
  assert.doesNotMatch(skill,/references\/[a-z0-9-]+\.md/u,'the router must not duplicate manifest paths');
  for(const mode of ['guide','scan','refactor','verify'])assert.match(skill,new RegExp('\\b'+mode+'\\b'));
  assert.match(skill,/Assurance/);
  assert.match(skill,/Inquiry/);
  assert.match(skill,/authoriz/iu);
  assert.match(skill,/external effect/iu);
  assert.match(skill,/missing|gap/iu);
  assert.match(skill,/fail closed|stop before/iu);
 });

 test('OpenAI metadata is exact, minimal, quoted, and explicitly invokes the Skill',async()=>{
  const source=await read('agents/openai.yaml');
  assert.deepEqual(YAML.parse(source),EXPECTED_METADATA);
  assert.deepEqual(Object.keys(YAML.parse(source)),['interface','policy']);
  assert.deepEqual(Object.keys(YAML.parse(source).interface),['display_name','short_description','default_prompt']);
  assert.match(source,/^  display_name: "[^"]+"$/m);
  assert.match(source,/^  short_description: "[^"]+"$/m);
  assert.match(source,/^  default_prompt: "[^"]*\$improving-product-ux[^"]*"$/m);
  assert.ok(EXPECTED_METADATA.interface.short_description.length>=25&&EXPECTED_METADATA.interface.short_description.length<=64);
 });

 test('validator and package entrypoint accept the exact committed Skill',async()=>{
  await validateSkill({repositoryRoot:process.cwd()});
  const packageJson=JSON.parse(await read('package.json'));
  assert.equal(packageJson.scripts['skill:check'],'node scripts/validate-skill.mjs');
  const result=await run('scripts/validate-skill.mjs');
  assert.equal(result.signal,null);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/^skill=ok\b/m);
  assert.equal(result.stderr,'');
 });

 test('validator fails closed on unsupported frontmatter, unquoted metadata, missing CLI, route drift, and hardcoded references',async()=>{
  const cases=[
   ['unsupported frontmatter','SKILL_FRONTMATTER_FIELDS_INVALID',async(root)=>{
    const path=join(root,'SKILL.md');const source=await read('SKILL.md',root);
    await writeFile(path,source.replace('description:','metadata: forbidden\ndescription:'),'utf8');
   }],
   ['unquoted metadata','SKILL_METADATA_STRING_UNQUOTED',async(root)=>{
    const path=join(root,'agents/openai.yaml');const source=await read('agents/openai.yaml',root);
    await writeFile(path,source.replace('display_name: "Evidence-aware Product UX"','display_name: Evidence-aware Product UX'),'utf8');
   }],
   ['missing CLI','SKILL_CLI_MISSING',async(root)=>{await rm(join(root,'scripts/ux-evaluate.mjs'));}],
   ['route drift','SKILL_ROUTE_INVALID',async(root)=>{
    const path=join(root,'knowledge/manifest.json');const manifest=JSON.parse(await read('knowledge/manifest.json',root));
    manifest.routes.guide.paths.pop();await writeFile(path,JSON.stringify(manifest)+'\n','utf8');
   }],
   ['hardcoded reference','SKILL_REFERENCE_PATH_FORBIDDEN',async(root)=>{
    const path=join(root,'SKILL.md');const source=await read('SKILL.md',root);
    await writeFile(path,source+'\nRead references/context-model.md directly.\n','utf8');
   }]
  ];
  for(const [label,code,mutate] of cases){
   await withRepository(async(root)=>{
    await mutate(root);
    await assert.rejects(()=>validateSkill({repositoryRoot:root}),(error)=>{
     assert.equal(error?.code,code,label);return true;
    });
   });
  }
 });
}
