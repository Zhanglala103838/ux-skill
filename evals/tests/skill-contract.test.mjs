import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access,cp,mkdir,mkdtemp,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
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
  const canonicalTemporaryRoot=await realpath(tmpdir());
  const created=await mkdtemp(join(canonicalTemporaryRoot,'ux-skill-contract-'));
  const root=await realpath(created);
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

 test('TASK12_PORTABLE_UTF8_RED keeps portable real roots and every Skill text surface byte-strict',async()=>{
  const failures=[];
  const malformed=[
   ['ff',Buffer.from([0xff])],
   ['continuation',Buffer.from([0x80])],
   ['overlong',Buffer.from([0xc0,0xaf])],
   ['truncated',Buffer.from([0xe2,0x82])]
  ];
  const expectCode=async(label,expectedCode,operation)=>{
   try{await operation();failures.push(label+':accepted');}
   catch(error){if(error?.code!==expectedCode)failures.push(label+':expected '+expectedCode+' got '+(error?.code??error?.name));}
  };
  const expectPass=async(label,operation)=>{
   try{await operation();}catch(error){failures.push(label+':unexpected '+(error?.code??error?.name));}
  };

  await withRepository(async(root)=>{
   if(await realpath(root)!==root)failures.push('temporary root is not canonical');
   const alias=root+'-user-symlink';
   try{
    await symlink(root,alias,'dir');
    await expectCode('user-created root symlink','SKILL_REPOSITORY_ROOT_INVALID',()=>validateSkill({repositoryRoot:alias}));
   }finally{await rm(alias,{force:true});}

   const skillPath=join(root,'SKILL.md');
   const metadataPath=join(root,'agents/openai.yaml');
   const referencePath='references/context-model.md';
   const manifestPath=join(root,'knowledge/manifest.json');
   const originalSkill=await readFile(skillPath);
   const originalMetadata=await readFile(metadataPath);
   const originalReference=await readFile(join(root,referencePath));
   const originalManifest=await readFile(manifestPath);
   const descriptionOffset=originalSkill.indexOf(Buffer.from('description:'));
   const descriptionEnd=originalSkill.indexOf(0x0a,descriptionOffset);
   assert.ok(descriptionOffset>=0&&descriptionEnd>descriptionOffset);

   const reset=async()=>{
    await Promise.all([
     writeFile(skillPath,originalSkill),
     writeFile(metadataPath,originalMetadata),
     writeFile(join(root,referencePath),originalReference),
     writeFile(manifestPath,originalManifest)
    ]);
   };
   const rebindReference=async(bytes)=>{
    await writeFile(join(root,referencePath),bytes);
    const manifest=JSON.parse(originalManifest.toString('utf8'));
    manifest.files.find((row)=>row.path===referencePath).file_digest=createHash('sha256').update(bytes).digest('hex');
    await writeFile(manifestPath,JSON.stringify(manifest)+'\n','utf8');
   };

   for(const [name,bytes] of malformed){
    await reset();
    await writeFile(skillPath,Buffer.concat([originalSkill.subarray(0,descriptionEnd),bytes,originalSkill.subarray(descriptionEnd)]));
    await expectCode('Skill frontmatter '+name,'SKILL_TEXT_UTF8_INVALID',()=>validateSkill({repositoryRoot:root}));
    await reset();
    await writeFile(skillPath,Buffer.concat([originalSkill,Buffer.from('\ninvalid: '),bytes,Buffer.from('\n')]));
    await expectCode('Skill body '+name,'SKILL_TEXT_UTF8_INVALID',()=>validateSkill({repositoryRoot:root}));
    await reset();
    await writeFile(metadataPath,Buffer.concat([originalMetadata,Buffer.from('# invalid '),bytes,Buffer.from('\n')]));
    await expectCode('metadata '+name,'SKILL_METADATA_UTF8_INVALID',()=>validateSkill({repositoryRoot:root}));
    await reset();
    await rebindReference(Buffer.concat([originalReference,Buffer.from('\ninvalid: '),bytes,Buffer.from('\n')]));
    await expectCode('reference '+name,'SKILL_REFERENCE_UTF8_INVALID',()=>validateSkill({repositoryRoot:root}));
   }

   await reset();await writeFile(skillPath,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),originalSkill]));
   await expectCode('Skill BOM','SKILL_TEXT_BOM_FORBIDDEN',()=>validateSkill({repositoryRoot:root}));
   await reset();await writeFile(metadataPath,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),originalMetadata]));
   await expectCode('metadata BOM','SKILL_METADATA_BOM_FORBIDDEN',()=>validateSkill({repositoryRoot:root}));
   await reset();await rebindReference(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),originalReference]));
   await expectCode('reference BOM','SKILL_REFERENCE_BOM_FORBIDDEN',()=>validateSkill({repositoryRoot:root}));

   await reset();
   await writeFile(skillPath,Buffer.concat([originalSkill,Buffer.from('\n补充：无障碍 ✅\n','utf8')]));
   await writeFile(metadataPath,Buffer.concat([originalMetadata,Buffer.from('# 多语言元数据 ✅\n','utf8')]));
   await rebindReference(Buffer.concat([originalReference,Buffer.from('\n多语言参考 ✅\n','utf8')]));
   await expectPass('valid multibyte NFC',()=>validateSkill({repositoryRoot:root}));

   await reset();await writeFile(skillPath,Buffer.concat([originalSkill,Buffer.from('\ne\u0301\n','utf8')]));
   await expectCode('Skill non-NFC','SKILL_TEXT_INVALID',()=>validateSkill({repositoryRoot:root}));
   await reset();await writeFile(metadataPath,Buffer.concat([originalMetadata,Buffer.from('# e\u0301\n','utf8')]));
   await expectCode('metadata non-NFC','SKILL_METADATA_INVALID',()=>validateSkill({repositoryRoot:root}));
   await reset();await rebindReference(Buffer.concat([originalReference,Buffer.from('\ne\u0301\n','utf8')]));
   await expectCode('reference non-NFC','SKILL_REFERENCE_UNICODE_INVALID',()=>validateSkill({repositoryRoot:root}));

   await reset();
   await writeFile(skillPath,originalSkill.toString('utf8').replace('name: improving-product-ux\n','name: improving-product-ux\nname: improving-product-ux\n'),'utf8');
   await expectCode('duplicate Skill frontmatter key','SKILL_FRONTMATTER_INVALID',()=>validateSkill({repositoryRoot:root}));
   await reset();
   await writeFile(metadataPath,originalMetadata.toString('utf8').replace('  display_name: "Evidence-aware Product UX"\n','  display_name: "Evidence-aware Product UX"\n  display_name: "Evidence-aware Product UX"\n'),'utf8');
   await expectCode('duplicate metadata key','SKILL_METADATA_INVALID',()=>validateSkill({repositoryRoot:root}));
   await reset();
  });

  if(failures.length>0)assert.fail('TASK12_PORTABLE_UTF8_RED:'+failures.join('|'));
 });
}
