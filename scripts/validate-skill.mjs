#!/usr/bin/env node
import {constants as fsConstants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {loadKnowledgeManifest,parseKnowledgeJson} from './check-knowledge.mjs';

const MODULE_PATH=fileURLToPath(import.meta.url);
const DEFAULT_ROOT=resolve(dirname(MODULE_PATH),'..');
const MAX_TEXT_BYTES=262_144;
const OPEN_FLAGS=fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW;
const SKILL_NAME='improving-product-ux';
const COMMAND='pnpm ux:evaluate -- --mode <mode> --input - --output json';
const MODES=Object.freeze(['guide','scan','refactor','verify']);
const LINKS=Object.freeze(['knowledge/manifest.json','scripts/ux-evaluate.mjs']);
const EXPECTED_METADATA=Object.freeze({
 interface:Object.freeze({
  display_name:'Evidence-aware Product UX',
  short_description:'Evidence-bounded guidance for digital product UX',
  default_prompt:'Use $improving-product-ux to guide, scan, refactor, or verify this product experience.'
 }),
 policy:Object.freeze({allow_implicit_invocation:true})
});

const fail=(code)=>{const error=new TypeError(code);error.code=code;throw error;};
const isRecord=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sameKeys=(value,keys)=>isRecord(value)&&JSON.stringify(Object.keys(value))===JSON.stringify(keys);
const sameData=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const snapshotEqual=(left,right)=>left.isFile()&&right.isFile()&&left.dev===right.dev&&left.ino===right.ino&&left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs;

async function resolveRoot(options){
 if(options!==undefined&&(!isRecord(options)||Object.keys(options).some((key)=>key!=='repositoryRoot')))fail('SKILL_OPTIONS_INVALID');
 const supplied=options?.repositoryRoot??DEFAULT_ROOT;
 if(typeof supplied!=='string'||!isAbsolute(supplied)||resolve(supplied)!==supplied)fail('SKILL_REPOSITORY_ROOT_INVALID');
 let status;let actual;
 try{status=await lstat(supplied);actual=await realpath(supplied);}catch{fail('SKILL_REPOSITORY_ROOT_INVALID');}
 if(status.isSymbolicLink()||!status.isDirectory()||actual!==supplied)fail('SKILL_REPOSITORY_ROOT_INVALID');
 return supplied;
}

async function readSecure(root,path,missingCode,limit=MAX_TEXT_BYTES){
 const absolute=join(root,path);let current=root;
 try{
  for(const segment of path.split('/')){
   current=join(current,segment);const status=await lstat(current);
   if(status.isSymbolicLink())fail('SKILL_PATH_INVALID');
  }
 }catch(error){if(error?.code?.startsWith?.('SKILL_'))throw error;fail(missingCode);}
 let handle;
 try{handle=await open(absolute,OPEN_FLAGS);}catch{fail(missingCode);}
 try{
  const before=await handle.stat({bigint:true});
  if(!before.isFile())fail('SKILL_PATH_INVALID');
  if(before.size>BigInt(limit))fail('SKILL_FILE_TOO_LARGE');
  const buffer=Buffer.allocUnsafe(Number(before.size)+1);let total=0;
  while(total<buffer.length){const{bytesRead}=await handle.read(buffer,total,buffer.length-total,total);if(bytesRead===0)break;total+=bytesRead;}
  const after=await handle.stat({bigint:true});let pathStatus;let actual;
  try{pathStatus=await lstat(absolute,{bigint:true});actual=await realpath(absolute);}catch{fail('SKILL_PATH_INVALID');}
  if(total>limit||actual!==absolute||!snapshotEqual(before,after)||!snapshotEqual(after,pathStatus)||BigInt(total)!==before.size)fail('SKILL_PATH_INVALID');
  return Object.freeze({bytes:buffer.subarray(0,total),status:after});
 }finally{await handle.close().catch(()=>{});}
}

function parseYaml(source,code){
 let document;
 try{document=YAML.parseDocument(source,{strict:true,uniqueKeys:true,maxAliasCount:0});}catch{fail(code);}
 if(document.errors.length>0)fail(code);
 let value;
 try{value=document.toJS({maxAliasCount:0});}catch{fail(code);}
 return value;
}

function validateSkillSource(source){
 if(source.startsWith('\uFEFF')||source.includes('\r')||source.normalize('NFC')!==source)fail('SKILL_TEXT_INVALID');
 const frontmatter=/^---\n([\s\S]*?)\n---\n/.exec(source);
 if(frontmatter===null)fail('SKILL_FRONTMATTER_INVALID');
 const value=parseYaml(frontmatter[1],'SKILL_FRONTMATTER_INVALID');
 if(!sameKeys(value,['name','description']))fail('SKILL_FRONTMATTER_FIELDS_INVALID');
 if(value.name!==SKILL_NAME)fail('SKILL_NAME_INVALID');
 if(typeof value.description!=='string'||value.description.length===0||value.description.length>1024)fail('SKILL_DESCRIPTION_INVALID');
 const triggers=[/digital product/iu,/design/iu,/UX review/iu,/migrat/iu,/refactor/iu,/verif/iu,/website/iu,/Admin/iu,/cross-platform/iu,/HulianUI/iu,/brand art/iu,/physical-space/iu,/legal/iu,/medical/iu];
 if(triggers.some((pattern)=>!pattern.test(value.description)))fail('SKILL_DESCRIPTION_INVALID');
 if(source.split('\n').length>=500)fail('SKILL_TOO_LONG');
 if((source.split(COMMAND).length-1)!==1)fail('SKILL_CLI_CONTRACT_INVALID');
 if(!source.includes('routes[request_mode].paths')||!source.includes('knowledge/manifest.json'))fail('SKILL_ROUTE_INSTRUCTION_INVALID');
 if(/references\/[a-z0-9-]+\.md/u.test(source))fail('SKILL_REFERENCE_PATH_FORBIDDEN');
 for(const mode of MODES)if(!new RegExp('\\b'+mode+'\\b','u').test(source))fail('SKILL_MODE_INVALID');
 const requirements=[/Assurance/u,/Inquiry/u,/authoriz/iu,/external effect/iu,/missing|gap/iu,/fail closed|stop before/iu,/compare/iu,/audit/iu,/release/iu,/no_release/u];
 if(requirements.some((pattern)=>!pattern.test(source)))fail('SKILL_WORKFLOW_INVALID');
 const links=[...source.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/gu)].map((match)=>match[1]);
 if(!sameData(links,LINKS))fail('SKILL_LINK_INVALID');
 if(source.slice(frontmatter[0].length).includes('\n|---'))fail('SKILL_SEMANTIC_TABLE_FORBIDDEN');
 return value;
}

function validateMetadataSource(source){
 if(source.startsWith('\uFEFF')||source.includes('\r')||source.normalize('NFC')!==source)fail('SKILL_METADATA_INVALID');
 for(const key of ['display_name','short_description','default_prompt']){
  const pattern=new RegExp('^  '+key+': "(?:[^"\\]|\\.)*"$','m');
  if(!pattern.test(source))fail('SKILL_METADATA_STRING_UNQUOTED');
 }
 const value=parseYaml(source,'SKILL_METADATA_INVALID');
 if(!sameKeys(value,['interface','policy'])||!sameKeys(value.interface,['display_name','short_description','default_prompt'])||!sameKeys(value.policy,['allow_implicit_invocation']))fail('SKILL_METADATA_FIELDS_INVALID');
 if(!sameData(value,EXPECTED_METADATA))fail('SKILL_METADATA_INVALID');
 const length=value.interface.short_description.length;
 if(length<25||length>64)fail('SKILL_METADATA_SHORT_DESCRIPTION_INVALID');
 if(!value.interface.default_prompt.includes('$'+SKILL_NAME))fail('SKILL_METADATA_DEFAULT_PROMPT_INVALID');
 return value;
}

async function validatePackage(root){
 const loaded=await readSecure(root,'package.json','SKILL_PACKAGE_MISSING');let value;
 try{value=parseKnowledgeJson(loaded.bytes,'package.json','SKILL_PACKAGE_INVALID',{allowDangerousKeys:true});}catch{fail('SKILL_PACKAGE_INVALID');}
 if(!isRecord(value)||!isRecord(value.scripts)||value.scripts['skill:check']!=='node scripts/validate-skill.mjs'||value.scripts['ux:evaluate']!=='node scripts/ux-evaluate.mjs')fail('SKILL_PACKAGE_INVALID');
}

export async function validateSkill(options){
 const root=await resolveRoot(options);
 const [skillFile,metadataFile,cliFile]=await Promise.all([
  readSecure(root,'SKILL.md','SKILL_FILE_MISSING'),
  readSecure(root,'agents/openai.yaml','SKILL_METADATA_MISSING'),
  readSecure(root,'scripts/ux-evaluate.mjs','SKILL_CLI_MISSING')
 ]);
 if((Number(cliFile.status.mode)&0o111)===0)fail('SKILL_CLI_NOT_EXECUTABLE');
 const skill=validateSkillSource(skillFile.bytes.toString('utf8'));
 validateMetadataSource(metadataFile.bytes.toString('utf8'));
 await validatePackage(root);
 let manifest;
 try{manifest=await loadKnowledgeManifest({repositoryRoot:root});}catch{fail('SKILL_ROUTE_INVALID');}
 if(!sameData(Object.keys(manifest.routes),MODES)||MODES.some((mode)=>!isRecord(manifest.routes[mode])||!Array.isArray(manifest.routes[mode].paths)))fail('SKILL_ROUTE_INVALID');
 return Object.freeze({name:skill.name,modes:Object.freeze([...MODES]),links:Object.freeze([...LINKS])});
}

if(process.argv[1]&&resolve(process.argv[1])===MODULE_PATH){
 try{const result=await validateSkill();process.stdout.write('skill=ok name='+result.name+' modes='+result.modes.length+'\n');}
 catch(error){process.stderr.write((error?.code??'SKILL_VALIDATION_FAILED')+'\n');process.exitCode=1;}
}
