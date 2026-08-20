#!/usr/bin/env node
import {constants as fsConstants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder,types as utilTypes} from 'node:util';
import {fromMarkdown} from 'mdast-util-from-markdown';
import YAML from 'yaml';
import {loadKnowledgeManifest,parseKnowledgeJson} from './check-knowledge.mjs';

const MODULE_PATH=fileURLToPath(import.meta.url);
const DEFAULT_ROOT=resolve(dirname(MODULE_PATH),'..');
const MAX_TEXT_BYTES=262_144;
const MAX_REFERENCE_BYTES=1_048_576;
const UTF8_BOM=Buffer.from([0xef,0xbb,0xbf]);
const UTF8_DECODER=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});
const OPEN_FLAGS=fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW;
const SKILL_NAME='improving-product-ux';
const COMMAND='pnpm --silent ux:evaluate --mode <mode> --input - --output json';
const MODES=Object.freeze(['guide','scan','refactor','verify']);
const LINKS=Object.freeze(['knowledge/manifest.json','scripts/ux-evaluate.mjs']);
const LINK_SYNTAX=Object.freeze([
 Object.freeze({source:'[knowledge manifest]('+LINKS[0]+')',destination:LINKS[0]}),
 Object.freeze({source:'[CLI]('+LINKS[1]+')',destination:LINKS[1]})
]);
const EXPECTED_METADATA=Object.freeze({
 interface:Object.freeze({
  display_name:'Evidence-aware Product UX',
  short_description:'Evidence-bounded guidance for digital product UX',
  default_prompt:'Use $improving-product-ux to guide, scan, refactor, or verify this product experience.'
 }),
 policy:Object.freeze({allow_implicit_invocation:true})
});
const YAML_STRING=Object.freeze({kind:'string',quoted:false});
const YAML_QUOTED_STRING=Object.freeze({kind:'string',quoted:true});
const YAML_BOOLEAN=Object.freeze({kind:'boolean'});
const YAML_SKILL_SCHEMA=Object.freeze({kind:'map',entries:Object.freeze({
 name:YAML_STRING,
 description:YAML_STRING
})});
const YAML_METADATA_SCHEMA=Object.freeze({kind:'map',entries:Object.freeze({
 interface:Object.freeze({kind:'map',entries:Object.freeze({
  display_name:YAML_QUOTED_STRING,
  short_description:YAML_QUOTED_STRING,
  default_prompt:YAML_QUOTED_STRING
 })}),
 policy:Object.freeze({kind:'map',entries:Object.freeze({allow_implicit_invocation:YAML_BOOLEAN})})
})});

const fail=(code)=>{const error=new TypeError(code);error.code=code;throw error;};
const isRecord=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sameKeys=(value,keys)=>isRecord(value)&&JSON.stringify(Object.keys(value))===JSON.stringify(keys);
const sameData=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const snapshotEqual=(left,right)=>left.isFile()&&right.isFile()&&left.dev===right.dev&&left.ino===right.ino&&left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs;

function normalizeOptions(options){
 try{
  if(options===undefined)return undefined;
  if(options===null||typeof options!=='object'||Array.isArray(options)||utilTypes.isProxy(options))throw new TypeError();
  const prototype=Reflect.getPrototypeOf(options);
  if(prototype!==Object.prototype&&prototype!==null)throw new TypeError();
  const keys=Reflect.ownKeys(options);
  if(keys.length===0)return undefined;
  if(keys.length!==1||keys[0]!=='repositoryRoot')throw new TypeError();
  const descriptor=Reflect.getOwnPropertyDescriptor(options,'repositoryRoot');
  if(descriptor===undefined||descriptor.enumerable!==true||!Object.hasOwn(descriptor,'value')||Object.hasOwn(descriptor,'get')||Object.hasOwn(descriptor,'set')||typeof descriptor.value!=='string')throw new TypeError();
  return descriptor.value;
 }catch{fail('SKILL_OPTIONS_INVALID');}
}

async function resolveRoot(supplied=DEFAULT_ROOT){
 if(supplied.includes('\0')||supplied.normalize('NFC')!==supplied||!isAbsolute(supplied)||resolve(supplied)!==supplied)fail('SKILL_REPOSITORY_ROOT_INVALID');
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

function decodeText(bytes,{utf8Code,bomCode,unicodeCode}){
 if(bytes.length>=UTF8_BOM.length&&bytes.subarray(0,UTF8_BOM.length).equals(UTF8_BOM))fail(bomCode);
 let source;
 try{source=UTF8_DECODER.decode(bytes);}catch{fail(utf8Code);}
 if(source.normalize('NFC')!==source)fail(unicodeCode);
 return source;
}

function yamlNodeIsUnadorned(node){
 return YAML.isNode(node)&&node.tag===undefined&&node.anchor===undefined&&!YAML.isAlias(node);
}

function validateYamlScalar(node,schema,code){
 if(!yamlNodeIsUnadorned(node)||!YAML.isScalar(node))fail(code);
 if(schema.kind==='boolean'){
  if(typeof node.value!=='boolean'||node.type!=='PLAIN')fail(code);
  return;
 }
 if(schema.kind!=='string'||typeof node.value!=='string'||!['PLAIN','QUOTE_SINGLE','QUOTE_DOUBLE'].includes(node.type))fail(code);
 if(schema.quoted&&!['QUOTE_SINGLE','QUOTE_DOUBLE'].includes(node.type))fail(code);
}

function validateYamlNode(node,schema,code){
 if(schema.kind==='string'||schema.kind==='boolean'){
  validateYamlScalar(node,schema,code);
  return;
 }
 if(schema.kind==='seq'){
  if(!yamlNodeIsUnadorned(node)||!YAML.isSeq(node)||node.flow===true)fail(code);
  for(const item of node.items)validateYamlNode(item,schema.items,code);
  return;
 }
 if(schema.kind!=='map'||!yamlNodeIsUnadorned(node)||!YAML.isMap(node)||node.flow===true)fail(code);
 const seen=new Set();
 for(const pair of node.items){
  if(!YAML.isPair(pair)||pair.srcToken?.explicitKey===true)fail(code);
  const key=pair.key;
  if(!yamlNodeIsUnadorned(key)||!YAML.isScalar(key)||typeof key.value!=='string'||!['PLAIN','QUOTE_SINGLE','QUOTE_DOUBLE'].includes(key.type))fail(code);
  if(key.value.normalize('NFC')!==key.value||key.value==='<<'||seen.has(key.value))fail(code);
  seen.add(key.value);
  const childSchema=schema.entries[key.value];
  if(childSchema===undefined){
   validateYamlScalar(pair.value,YAML_STRING,code);
   continue;
  }
  validateYamlNode(pair.value,childSchema,code);
 }
}

function validateYamlDirectives(document,code){
 const directives=document.directives;
 const tagHandles=Object.keys(directives?.tags??{});
 if(directives===undefined||directives.docStart!==null||directives.docEnd!==false||directives.yaml?.explicit!==false||directives.yaml?.version!=='1.2'||!sameData(tagHandles,['!!'])||directives.tags['!!']!=='tag:yaml.org,2002:')fail(code);
}

function parseYaml(source,code,schema){
 let document;
 try{document=YAML.parseDocument(source,{version:'1.2',schema:'core',strict:true,uniqueKeys:true,stringKeys:true,merge:false,customTags:[],maxAliasCount:0,keepSourceTokens:true});}catch{fail(code);}
 if(document.errors.length>0||document.warnings.length>0)fail(code);
 validateYamlDirectives(document,code);
 validateYamlNode(document.contents,schema,code);
 let value;
 try{value=document.toJS({maxAliasCount:0});}catch{fail(code);}
 return value;
}

function validateVisibleTextSurface(surface){
 let precedingBackslashes=0;
 for(const character of surface){
  if(character==='\\'){precedingBackslashes++;continue;}
  if((character==='['||character===']'||character==='<')&&precedingBackslashes%2===0)fail('SKILL_LINK_INVALID');
  precedingBackslashes=0;
 }
 const rawScheme=/(?:^|[^A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,31}:(?=[^ \t\n*_])/u;
 const protocolRelative=/\/\/(?=\S)/u;
 const htmlResource=/\b(?:href|src|srcset|action|formaction|poster)\s*=/iu;
 const encodedAlias=/%[0-9A-Fa-f]{2}/u;
 const backslashPath=/(?:^|[\s("'=])(?:[A-Za-z]:|\.{1,2})\\/u;
 const resourceExtension=/\.(?:md|json|mjs|ya?ml)(?=$|[?#\s),.;:!])/iu;
 const localPath=/(?:^|[\s("'=])(?:\.{0,2}[\\/]|[A-Za-z0-9._%+-]+[\\/])(?=\S)/u;
 const webHost=/(?:^|[\s("'=])www\./iu;
 if(rawScheme.test(surface)||protocolRelative.test(surface)||htmlResource.test(surface)||encodedAlias.test(surface)||backslashPath.test(surface)||resourceExtension.test(surface)||localPath.test(surface)||webHost.test(surface))fail('SKILL_LINK_INVALID');
}

function isClosedHtmlComment(value){
 if(!value.startsWith('<!--')||!value.endsWith('-->'))return false;
 const inner=value.slice(4,-3);
 return !inner.includes('<!--')&&!inner.includes('-->')&&!inner.startsWith('>')&&!inner.startsWith('->')&&!inner.endsWith('<!-');
}

function nodePositionIsValid(node,source){
 const start=node?.position?.start?.offset;
 const end=node?.position?.end?.offset;
 return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start&&end<=source.length;
}

function parseActiveMarkdown(source){
 let tree;
 try{tree=fromMarkdown(source);}catch{fail('SKILL_MARKDOWN_INVALID');}
 if(tree?.type!=='root'||!nodePositionIsValid(tree,source)||tree.position.start.offset!==0||tree.position.end.offset!==source.length)fail('SKILL_MARKDOWN_INVALID');
 const links=[];
 const blockContainers=new Set(['root','blockquote','list','listItem','table','tableRow']);
 const inlineContainers=new Set(['paragraph','heading','emphasis','strong','delete','tableCell']);

 const render=(node)=>{
  if(!isRecord(node)||typeof node.type!=='string'||!nodePositionIsValid(node,source))fail('SKILL_MARKDOWN_INVALID');
  if(node.type==='text'){
   if(typeof node.value!=='string')fail('SKILL_MARKDOWN_INVALID');
   return node.value;
  }
  if(node.type==='break'||node.type==='thematicBreak')return'\n';
  if(node.type==='code'||node.type==='inlineCode')return'';
  if(node.type==='html'){
   if(typeof node.value!=='string'||!isClosedHtmlComment(node.value))fail('SKILL_LINK_INVALID');
   return'';
  }
  if(node.type==='link'){
   if(typeof node.url!=='string'||node.title!==null||!Array.isArray(node.children))fail('SKILL_LINK_INVALID');
   const exact=LINK_SYNTAX.find((row)=>row.destination===node.url&&row.source===source.slice(node.position.start.offset,node.position.end.offset));
   if(exact===undefined)fail('SKILL_LINK_INVALID');
   links.push(exact.destination);
   return node.children.map(render).join('');
  }
  if(node.type==='image'||node.type==='imageReference'||node.type==='linkReference'||node.type==='definition')fail('SKILL_LINK_INVALID');
  if(!Array.isArray(node.children))fail('SKILL_MARKDOWN_INVALID');
  if(blockContainers.has(node.type))return node.children.map(render).filter(Boolean).join('\n');
  if(inlineContainers.has(node.type))return node.children.map(render).join('');
  fail('SKILL_MARKDOWN_INVALID');
 };

 const text=render(tree);
 return Object.freeze({text,links:Object.freeze(links)});
}

function removeValidatedSemanticSyntax(source){
 let surface=source;
 for(const literal of [COMMAND,'routes[request_mode].paths']){
  surface=surface.split(literal).join('');
 }
 return surface;
}

function validateMetadataPrompt(prompt){
 if(typeof prompt!=='string'||prompt!==EXPECTED_METADATA.interface.default_prompt)fail('SKILL_METADATA_INVALID');
 if((prompt.split('$'+SKILL_NAME).length-1)!==1)fail('SKILL_METADATA_DEFAULT_PROMPT_INVALID');
 if(/[\r\n`\[\]<>]/u.test(prompt)||/(?:^|\s)(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:|\/\/)(?=\S)/u.test(prompt))fail('SKILL_METADATA_DEFAULT_PROMPT_INVALID');
}

function validateSkillSource(source){
 if(source.includes('\r'))fail('SKILL_TEXT_INVALID');
 const frontmatter=/^---\n([\s\S]*?)\n---\n/.exec(source);
 if(frontmatter===null)fail('SKILL_FRONTMATTER_INVALID');
 const value=parseYaml(frontmatter[1],'SKILL_FRONTMATTER_INVALID',YAML_SKILL_SCHEMA);
 const body=source.slice(frontmatter[0].length);
 if(!sameKeys(value,['name','description']))fail('SKILL_FRONTMATTER_FIELDS_INVALID');
 if(value.name!==SKILL_NAME)fail('SKILL_NAME_INVALID');
 if(typeof value.description!=='string'||value.description.length===0||value.description.length>1024)fail('SKILL_DESCRIPTION_INVALID');
 const triggers=[/digital product/iu,/design/iu,/UX review/iu,/migrat/iu,/refactor/iu,/verif/iu,/website/iu,/Admin/iu,/cross-platform/iu,/HulianUI/iu,/brand art/iu,/physical-space/iu,/legal/iu,/medical/iu];
 if(triggers.some((pattern)=>!pattern.test(value.description)))fail('SKILL_DESCRIPTION_INVALID');
 if(source.split('\n').length>=500)fail('SKILL_TOO_LONG');
 const markdown=parseActiveMarkdown(body);
 const activeBody=markdown.text;
 if((activeBody.split(COMMAND).length-1)!==1)fail('SKILL_CLI_CONTRACT_INVALID');
 if(!sameData(markdown.links,LINKS))fail('SKILL_LINK_INVALID');
 if(!activeBody.includes('routes[request_mode].paths')||!markdown.links.includes('knowledge/manifest.json'))fail('SKILL_ROUTE_INSTRUCTION_INVALID');
 if(/references\/[a-z0-9-]+\.md/u.test(activeBody))fail('SKILL_REFERENCE_PATH_FORBIDDEN');
 for(const mode of MODES)if(!new RegExp('\\b'+mode+'\\b','u').test(activeBody))fail('SKILL_MODE_INVALID');
 const requirements=[/Assurance/u,/Inquiry/u,/authoriz/iu,/external effect/iu,/missing|gap/iu,/fail closed|stop before/iu,/compare/iu,/audit/iu,/release/iu,/no_release/u];
 if(requirements.some((pattern)=>!pattern.test(activeBody)))fail('SKILL_WORKFLOW_INVALID');
 validateVisibleTextSurface(removeValidatedSemanticSyntax(activeBody));
 if(activeBody.includes('\n|---'))fail('SKILL_SEMANTIC_TABLE_FORBIDDEN');
 return Object.freeze({name:value.name,links:markdown.links});
}

function validateMetadataSource(source){
 if(source.includes('\r'))fail('SKILL_METADATA_INVALID');
 const lines=new Set(source.split('\n'));
 const quotedLines=[
  '  display_name: "Evidence-aware Product UX"',
  '  short_description: "Evidence-bounded guidance for digital product UX"',
  '  default_prompt: "Use $improving-product-ux to guide, scan, refactor, or verify this product experience."'
 ];
 if(quotedLines.some((line)=>!lines.has(line)))fail('SKILL_METADATA_STRING_UNQUOTED');
 const value=parseYaml(source,'SKILL_METADATA_INVALID',YAML_METADATA_SCHEMA);
 if(!sameKeys(value,['interface','policy'])||!sameKeys(value.interface,['display_name','short_description','default_prompt'])||!sameKeys(value.policy,['allow_implicit_invocation']))fail('SKILL_METADATA_FIELDS_INVALID');
 if(!sameData(value,EXPECTED_METADATA))fail('SKILL_METADATA_INVALID');
 const length=value.interface.short_description.length;
 if(length<25||length>64)fail('SKILL_METADATA_SHORT_DESCRIPTION_INVALID');
 validateMetadataPrompt(value.interface.default_prompt);
 return value;
}

async function validatePackage(root){
 const loaded=await readSecure(root,'package.json','SKILL_PACKAGE_MISSING');let value;
 try{value=parseKnowledgeJson(loaded.bytes,'package.json','SKILL_PACKAGE_INVALID',{allowDangerousKeys:true});}catch{fail('SKILL_PACKAGE_INVALID');}
 if(!isRecord(value)||!isRecord(value.scripts)||value.scripts['skill:check']!=='node scripts/validate-skill.mjs'||value.scripts['ux:evaluate']!=='node scripts/ux-evaluate.mjs')fail('SKILL_PACKAGE_INVALID');
}

export async function validateSkill(options){
 const suppliedRoot=normalizeOptions(options);
 const root=await resolveRoot(suppliedRoot);
 const [skillFile,metadataFile,cliFile]=await Promise.all([
  readSecure(root,'SKILL.md','SKILL_FILE_MISSING'),
  readSecure(root,'agents/openai.yaml','SKILL_METADATA_MISSING'),
  readSecure(root,'scripts/ux-evaluate.mjs','SKILL_CLI_MISSING')
 ]);
 if((Number(cliFile.status.mode)&0o111)===0)fail('SKILL_CLI_NOT_EXECUTABLE');
 const skillSource=decodeText(skillFile.bytes,{utf8Code:'SKILL_TEXT_UTF8_INVALID',bomCode:'SKILL_TEXT_BOM_FORBIDDEN',unicodeCode:'SKILL_TEXT_INVALID'});
 const metadataSource=decodeText(metadataFile.bytes,{utf8Code:'SKILL_METADATA_UTF8_INVALID',bomCode:'SKILL_METADATA_BOM_FORBIDDEN',unicodeCode:'SKILL_METADATA_INVALID'});
 const skill=validateSkillSource(skillSource);
 validateMetadataSource(metadataSource);
 await validatePackage(root);
 let manifest;
 try{manifest=await loadKnowledgeManifest({repositoryRoot:root});}catch{fail('SKILL_ROUTE_INVALID');}
 if(!sameData(Object.keys(manifest.routes),MODES)||MODES.some((mode)=>!isRecord(manifest.routes[mode])||!Array.isArray(manifest.routes[mode].paths)))fail('SKILL_ROUTE_INVALID');
 const referencePaths=new Set(MODES.flatMap((mode)=>manifest.routes[mode].paths));
 for(const path of referencePaths){
  const reference=await readSecure(root,path,'SKILL_REFERENCE_MISSING',MAX_REFERENCE_BYTES);
  decodeText(reference.bytes,{utf8Code:'SKILL_REFERENCE_UTF8_INVALID',bomCode:'SKILL_REFERENCE_BOM_FORBIDDEN',unicodeCode:'SKILL_REFERENCE_UNICODE_INVALID'});
 }
 return Object.freeze({name:skill.name,modes:Object.freeze([...MODES]),links:skill.links});
}

if(process.argv[1]&&resolve(process.argv[1])===MODULE_PATH){
 try{const result=await validateSkill();process.stdout.write('skill=ok name='+result.name+' modes='+result.modes.length+'\n');}
 catch(error){process.stderr.write((error?.code??'SKILL_VALIDATION_FAILED')+'\n');process.exitCode=1;}
}
