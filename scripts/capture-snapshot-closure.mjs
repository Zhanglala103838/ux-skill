import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { types as utilTypes } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { init as initModuleLexer, parse as parseModule } from 'es-module-lexer';
import { canonicalize } from 'json-canonicalize';

const DOMAIN='ux-skill:snapshot-closure:v1';
export const SNAPSHOT_LIMITS=Object.freeze({maxProfiles:16,maxTaskSteps:128,maxNetworkRecords:4096,maxObservationRecords:4096,maxRedirectHops:32,maxHeaders:256,maxArtifactBytes:1048576,maxTotalArtifactBytes:33554432,maxUrlBytes:8192,maxInputDepth:64,maxInputNodes:32768,maxInputStringBytes:1398104,maxInputBytes:50331648});
const L=SNAPSHOT_LIMITS;
const MK=['closure_version','entry_url','task_script_digest','capture_environment_digest','captured_at','authenticated','replay_profiles','network_records','observation_records','outbound_effect_ledger_digest','completeness_status','manifest_digest'];
const PK=['replay_profile_id','viewport_width_css_px','viewport_height_css_px','device_scale_factor','input_modality','prefers_reduced_motion','prefers_contrast','color_scheme','locale','timezone','assistive_technology_id','browser_engine_digest'];
const NK=['replay_profile_id','sequence','task_step_id','request_method','request_url','redirect_chain','final_url','network_kind','disposition','response_status','header_digest','content_addressed_header_artifact_locator','raw_body_digest','content_addressed_body_artifact_locator'];
const OK=['replay_profile_id','task_step_id','evidence_kind','ordinal','artifact_digest','content_addressed_artifact_locator'];
const HK=['sequence','name_lower_ascii','value_bytes_base64'];
const HX=/^[0-9a-f]{64}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HN=/^[a-z0-9!#$%&'*+.^_\x60|~-]+$/;
const REGISTRY_DOMAIN='ux-skill:capture-registry:v1';
const MODULE_ROW_KEYS=['relative_path','raw_sha256'];
const registryState=new WeakMap();
const E=(code,result)=>Object.assign(new TypeError(code),{code,...(result?{result}:{})});
const bad=()=>{throw E('CAPTURE_INPUT_INVALID')};
const unavailable=()=>{throw E('TARGET_UNAVAILABLE',{run_status:'target_unavailable',run_issues:[{code:'RULE_EVALUATION_ERROR',instance_pointer:'/snapshot_closure',dependency_id:null}],release_gate:'no_release'})};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&!utilTypes.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype;
const nfc=s=>{
  if(typeof s!=='string'||s.normalize('NFC')!==s)bad();
  for(let i=0;i<s.length;i++){const u=s.charCodeAt(i);if(u>=0xd800&&u<=0xdbff){const n=s.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))bad()}else if(u>=0xdc00&&u<=0xdfff)bad()}
  return s;
};
const snap=(root)=>{
  const seen=new WeakSet(),budget={nodes:0,bytes:0};let result;
  const charge=(count)=>{budget.bytes+=count;if(budget.bytes>L.maxInputBytes)bad()};
  const stack=[{value:root,depth:0,assign:value=>{result=value}}];
  while(stack.length){
    const {value,depth,assign}=stack.pop();budget.nodes+=1;if(budget.nodes>L.maxInputNodes||depth>L.maxInputDepth)bad();
    if(value===null){charge(4);assign(null);continue}
    if(typeof value==='boolean'){charge(value?4:5);assign(value);continue}
    if(typeof value==='string'){const size=Buffer.byteLength(nfc(value));if(size>L.maxInputStringBytes)bad();charge(size);assign(value);continue}
    if(typeof value==='number'){if(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))bad();charge(24);assign(value);continue}
    if(typeof value!=='object'||utilTypes.isProxy(value)||seen.has(value))bad();seen.add(value);
    if(Array.isArray(value)){
      if(Object.getPrototypeOf(value)!==Array.prototype)bad();const keys=Reflect.ownKeys(value),members=[];
      for(const key of keys){if(key==='length')continue;if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(key))bad();const index=Number(key),descriptor=Object.getOwnPropertyDescriptor(value,key);if(index>=value.length||!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))bad();members.push([index,descriptor.value])}
      if(members.length!==value.length)bad();members.sort((a,b)=>a[0]-b[0]);for(let index=0;index<members.length;index+=1)if(members[index][0]!==index)bad();
      const output=new Array(value.length);assign(output);charge(2+value.length);
      for(let index=members.length-1;index>=0;index-=1){const [memberIndex,memberValue]=members[index];stack.push({value:memberValue,depth:depth+1,assign:copy=>{output[memberIndex]=copy}})}continue;
    }
    if(!plain(value))bad();const output={};assign(output);charge(2);const members=[];
    for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))bad();const size=Buffer.byteLength(nfc(key));if(size>L.maxInputStringBytes)bad();charge(size+3);members.push([key,descriptor.value])}
    for(let index=members.length-1;index>=0;index-=1){const [key,memberValue]=members[index];stack.push({value:memberValue,depth:depth+1,assign:copy=>{output[key]=copy}})}
  }
  return result;
};
const jb=v=>Buffer.from(canonicalize(snap(v)),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
const dsha=(d,b)=>createHash('sha256').update(Buffer.from(d)).update(b).digest('hex');
const cmp=(a,b)=>Buffer.compare(jb(a),jb(b));
const exact=(v,ks)=>plain(v)&&Object.keys(v).sort().join('\0')===[...ks].sort().join('\0');
const dg=v=>typeof v==='string'&&HX.test(v);
const url=v=>{if(typeof v!=='string'||Buffer.byteLength(v)>L.maxUrlBytes)return false;try{return['http:','https:'].includes(new URL(v).protocol)}catch{return false}};
const cb64=v=>typeof v==='string'&&v.length<=Math.ceil(L.maxArtifactBytes/3)*4+4&&B64.test(v)&&Buffer.from(v,'base64').toString('base64')===v;
const bytes=v=>{if(!cb64(v))bad();const b=Buffer.from(v,'base64');if(b.length>L.maxArtifactBytes)throw Object.assign(E('CAPTURE_ARTIFACT_TOO_LARGE'),{policyViolation:true});return b};
const loc=h=>'cas/'+h;
const profile=p=>{
  if(!exact(p,PK)||!p.replay_profile_id||!Number.isInteger(p.viewport_width_css_px)||p.viewport_width_css_px<1||!Number.isInteger(p.viewport_height_css_px)||p.viewport_height_css_px<1||typeof p.device_scale_factor!=='number'||!Number.isFinite(p.device_scale_factor)||p.device_scale_factor<=0||!['keyboard','pointer','touch'].includes(p.input_modality)||!['reduce','no-preference'].includes(p.prefers_reduced_motion)||!['no-preference','more','less','custom'].includes(p.prefers_contrast)||!['light','dark'].includes(p.color_scheme)||!p.locale||!p.timezone||!p.assistive_technology_id||!dg(p.browser_engine_digest))bad();
  for(const k of['replay_profile_id','locale','timezone','assistive_technology_id'])nfc(p[k]);return p;
};
const task=t=>{
  if(!exact(t,['task_script_id','steps'])||!t.task_script_id||!Array.isArray(t.steps)||t.steps.length<1||t.steps.length>L.maxTaskSteps)bad();
  const seen=new Set();
  for(const s of t.steps){if(!exact(s,['step_id','required_replay_profile_ids','instruction'])||!s.step_id||seen.has(s.step_id)||typeof s.instruction!=='string'||!Array.isArray(s.required_replay_profile_ids)||s.required_replay_profile_ids.length<1||s.required_replay_profile_ids.some(x=>typeof x!=='string'||!x)||new Set(s.required_replay_profile_ids).size!==s.required_replay_profile_ids.length)bad();seen.add(s.step_id);s.required_replay_profile_ids=[...s.required_replay_profile_ids].sort(cmp)}
  return t;
};
const cset=(rows,keyOf,inc)=>{
  const rows2=rows.map(row=>({row,key:keyOf(row)})).sort((a,b)=>cmp(a.key,b.key)),out=[];let prev;
  for(const x of rows2){if(prev&&jb(prev.key).equals(jb(x.key))){inc();continue}out.push(x.row);prev=x}return out;
};
const canonHeaders=rows=>{
  if(!Array.isArray(rows)||rows.length>L.maxHeaders)bad();
  return{headers:rows.map((r,sequence)=>{if(!plain(r)||r.sequence!==sequence)bad();const raw=r.name??r.name_lower_ascii;if(typeof raw!=='string'||!/^[\x21-\x7e]+$/.test(raw))bad();const name=raw.toLowerCase();if(!HN.test(name)||!cb64(r.value_bytes_base64))bad();return{sequence,name_lower_ascii:name,value_bytes_base64:r.value_bytes_base64}})}
};
const checkHeaders=v=>{if(!exact(v,['headers'])||!Array.isArray(v.headers)||v.headers.length>L.maxHeaders)unavailable();v.headers.forEach((r,i)=>{if(!exact(r,HK)||r.sequence!==i||!HN.test(r.name_lower_ascii)||!cb64(r.value_bytes_base64))unavailable()});return v};
const put=async(cas,b,state)=>{
  if(!(b instanceof Uint8Array)||utilTypes.isProxy(b)||b.length>L.maxArtifactBytes||state.total+b.length>L.maxTotalArtifactBytes){state.incomplete=true;return null}
  const bytes=Buffer.from(b),h=sha(bytes),p=loc(h);
  try{
    await cas.put(p,Buffer.from(bytes));const stored=await cas.get(p);
    if(!(stored instanceof Uint8Array)||utilTypes.isProxy(stored)||stored.length>L.maxArtifactBytes)throw E('CAS_READBACK_INVALID');
    const verified=Buffer.from(stored);if(sha(verified)!==h||!verified.equals(bytes))throw E('CAS_READBACK_MISMATCH');
  }catch{state.incomplete=true;return null}
  state.total+=bytes.length;return[h,p];
};
const get=async(cas,p,h)=>{if(p!==loc(h))unavailable();let b;try{b=await cas.get(p)}catch{unavailable()}if(!(b instanceof Uint8Array)||utilTypes.isProxy(b)||b.length>L.maxArtifactBytes)unavailable();try{b=Buffer.from(b)}catch{unavailable()}if(sha(b)!==h)unavailable();return b};
export const snapshotClosureDigest=m=>{const v=snap(m);delete v.manifest_digest;return dsha(DOMAIN,jb(v))};

export async function captureClosure(caseManifest,browser){
  if(!browser||typeof browser.capture!=='function'||!browser.cas||typeof browser.cas.put!=='function'||typeof browser.cas.get!=='function')throw E('CAPTURE_DRIVER_INVALID');
  const c=snap(caseManifest);if(!plain(c)||!c.case_id||!url(c.canonical_locator)||!plain(c.task_script))bad();const ts=task(snap(c.task_script));
  let captured;try{captured=await browser.capture(snap(c))}catch(cause){throw Object.assign(E('CAPTURE_DRIVER_FAILED'),{cause})}const raw=snap(captured)
  if(!plain(raw)||!dg(raw.capture_environment_digest)||typeof raw.captured_at!=='string'||!Number.isFinite(Date.parse(raw.captured_at))||typeof raw.authenticated!=='boolean'||!Array.isArray(raw.replay_profiles)||raw.replay_profiles.length<1||raw.replay_profiles.length>L.maxProfiles||!Array.isArray(raw.network_events)||raw.network_events.length>L.maxNetworkRecords||!Array.isArray(raw.observation_events)||raw.observation_events.length>L.maxObservationRecords||!Array.isArray(raw.outbound_effects)||!Array.isArray(raw.transport_events)||typeof raw.live_replay!=='boolean')bad();
  const state={incomplete:raw.authenticated||raw.live_replay||raw.outbound_effects.length>0,total:0},inc=()=>{state.incomplete=true},forbidden=new Set(['beacon','sse','websocket','download','login','cart','key_creation','api_effect']);
  for(const e of raw.transport_events){if(!plain(e)||typeof e.kind!=='string')bad();if(forbidden.has(e.kind))inc();else bad()}
  const ps=cset(raw.replay_profiles.map(profile),x=>x.replay_profile_id,inc),pids=new Set(ps.map(x=>x.replay_profile_id)),steps=new Map(ts.steps.map(x=>[x.step_id,new Set(x.required_replay_profile_ids)]));
  for(const s of ts.steps)for(const id of s.required_replay_profile_ids)if(!pids.has(id))inc();
  const tb=jb(ts),td=sha(tb);await put(browser.cas,tb,state);
  const network=[];
  for(const e of raw.network_events){
    if(!plain(e))bad();if(!['GET','HEAD'].includes(e.request_method)){inc();continue}
    if(!pids.has(e.replay_profile_id)||!steps.get(e.task_step_id)?.has(e.replay_profile_id)){inc();continue}
    if(!Number.isInteger(e.sequence)||e.sequence<0||!url(e.request_url)||!url(e.final_url)||!['document','script','style','image','font','xhr','fetch','other'].includes(e.network_kind)||!['captured','blocked_by_policy'].includes(e.disposition)||!Array.isArray(e.redirect_chain)||e.redirect_chain.length>L.maxRedirectHops)bad();
    const redirects=[];
    for(let i=0;i<e.redirect_chain.length;i++){const h=e.redirect_chain[i];if(!plain(h)||h.sequence!==i||!Number.isInteger(h.status)||h.status<100||h.status>599||!url(h.url)||!url(h.location))bad();const a=await put(browser.cas,jb(canonHeaders(h.response_headers)),state);if(!a)break;redirects.push({sequence:i,status:h.status,url:h.url,location:h.location,header_digest:a[0],content_addressed_header_artifact_locator:a[1]})}
    if(redirects.length!==e.redirect_chain.length){inc();continue}
    const common={replay_profile_id:e.replay_profile_id,sequence:e.sequence,task_step_id:e.task_step_id,request_method:e.request_method,request_url:e.request_url,redirect_chain:redirects,final_url:e.final_url,network_kind:e.network_kind};
    if(e.disposition==='blocked_by_policy'){if(e.response_status!==null||e.response_headers!=null||e.raw_body_bytes_base64!=null)inc();network.push({...common,disposition:'blocked_by_policy',response_status:null,header_digest:null,content_addressed_header_artifact_locator:null,raw_body_digest:null,content_addressed_body_artifact_locator:null});continue}
    if(!Number.isInteger(e.response_status)||e.response_status<100||e.response_status>599)bad();
    try{const ha=await put(browser.cas,jb(canonHeaders(e.response_headers)),state),ba=await put(browser.cas,bytes(e.raw_body_bytes_base64),state);if(!ha||!ba){inc();continue}network.push({...common,disposition:'captured',response_status:e.response_status,header_digest:ha[0],content_addressed_header_artifact_locator:ha[1],raw_body_digest:ba[0],content_addressed_body_artifact_locator:ba[1]})}catch(x){if(x?.policyViolation){inc();continue}throw x}
  }
  const obs=[];
  for(const e of raw.observation_events){
    if(!plain(e)||!pids.has(e.replay_profile_id)||!steps.get(e.task_step_id)?.has(e.replay_profile_id)||!['screenshot','dom_snapshot','accessibility_tree','interaction_trace','performance_trace','content_extract'].includes(e.evidence_kind)||!Number.isInteger(e.ordinal)||e.ordinal<0)bad();
    try{const a=await put(browser.cas,bytes(e.artifact_bytes_base64),state);if(!a){inc();continue}obs.push({replay_profile_id:e.replay_profile_id,task_step_id:e.task_step_id,evidence_kind:e.evidence_kind,ordinal:e.ordinal,artifact_digest:a[0],content_addressed_artifact_locator:a[1]})}catch(x){if(x?.policyViolation){inc();continue}throw x}
  }
  const nr=cset(network,x=>[x.replay_profile_id,x.sequence],inc),or=cset(obs,x=>[x.replay_profile_id,x.task_step_id,x.evidence_kind,x.ordinal],inc);
  for(const p of ps){const seq=nr.filter(x=>x.replay_profile_id===p.replay_profile_id).map(x=>x.sequence);if(seq.length<1||seq.some((x,i)=>x!==i))inc()}
  const observationOwners=new Map();for(const row of or){const key=`${row.replay_profile_id}\0${row.artifact_digest}`,owner=observationOwners.get(key);if(owner!==undefined&&owner!==row.task_step_id)inc();observationOwners.set(key,row.task_step_id)}
  for(const s of ts.steps)for(const id of s.required_replay_profile_ids){if(!nr.some(x=>x.task_step_id===s.step_id&&x.replay_profile_id===id))inc();if(!or.some(x=>x.task_step_id===s.step_id&&x.replay_profile_id===id))inc()}
  const m={closure_version:'snapshot-closure-v1',entry_url:c.canonical_locator,task_script_digest:td,capture_environment_digest:raw.capture_environment_digest,captured_at:raw.captured_at,authenticated:false,replay_profiles:ps,network_records:nr,observation_records:or,outbound_effect_ledger_digest:sha(jb(raw.outbound_effects)),completeness_status:state.incomplete?'incomplete':'complete',manifest_digest:''};m.manifest_digest=snapshotClosureDigest(m);
  if(!state.incomplete){try{const replay=await replayClosure(m,browser.cas);if(replay.run_status!=='completed'||replay.release_gate!=='eligible'||replay.live_network_events!==0)inc()}catch{inc()}if(state.incomplete){m.completeness_status='incomplete';m.manifest_digest=snapshotClosureDigest(m)}}return m;
}
const ordered=(rows,key)=>{const copy=[...rows].sort((a,b)=>cmp(key(a),key(b)));if(!jb(rows).equals(jb(copy)))unavailable();for(let i=1;i<rows.length;i++)if(jb(key(rows[i-1])).equals(jb(key(rows[i]))))unavailable()};
export async function replayClosure(input,cas){
  if(!cas||typeof cas.get!=='function')unavailable();let m;try{m=snap(input)}catch{unavailable()}
  if(!exact(m,MK)||m.closure_version!=='snapshot-closure-v1'||!url(m.entry_url)||!dg(m.task_script_digest)||!dg(m.capture_environment_digest)||typeof m.captured_at!=='string'||!Number.isFinite(Date.parse(m.captured_at))||m.authenticated!==false||!Array.isArray(m.replay_profiles)||m.replay_profiles.length<1||m.replay_profiles.length>L.maxProfiles||!Array.isArray(m.network_records)||m.network_records.length>L.maxNetworkRecords||!Array.isArray(m.observation_records)||m.observation_records.length>L.maxObservationRecords||!dg(m.outbound_effect_ledger_digest)||!['complete','incomplete'].includes(m.completeness_status)||!dg(m.manifest_digest)||snapshotClosureDigest(m)!==m.manifest_digest||m.completeness_status!=='complete')unavailable();
  try{m.replay_profiles.forEach(profile)}catch{unavailable()}ordered(m.replay_profiles,x=>x.replay_profile_id);const pids=new Set(m.replay_profiles.map(x=>x.replay_profile_id));
  const tb=await get(cas,loc(m.task_script_digest),m.task_script_digest);let ts;try{ts=JSON.parse(tb);if(!jb(ts).equals(tb))unavailable();task(ts)}catch{unavailable()}
  const steps=new Map(ts.steps.map(x=>[x.step_id,new Set(x.required_replay_profile_ids)]));for(const s of ts.steps)for(const id of s.required_replay_profile_ids)if(!pids.has(id))unavailable();
  ordered(m.network_records,x=>[x.replay_profile_id,x.sequence]);ordered(m.observation_records,x=>[x.replay_profile_id,x.task_step_id,x.evidence_kind,x.ordinal]);
  const responses=[];
  for(const r of m.network_records){
    if(!exact(r,NK)||!pids.has(r.replay_profile_id)||!steps.get(r.task_step_id)?.has(r.replay_profile_id)||!Number.isInteger(r.sequence)||r.sequence<0||!['GET','HEAD'].includes(r.request_method)||!url(r.request_url)||!url(r.final_url)||!['document','script','style','image','font','xhr','fetch','other'].includes(r.network_kind)||!['captured','blocked_by_policy'].includes(r.disposition)||!Array.isArray(r.redirect_chain)||r.redirect_chain.length>L.maxRedirectHops)unavailable();
    const redirects=[];
    for(let i=0;i<r.redirect_chain.length;i++){const h=r.redirect_chain[i];if(!exact(h,['sequence','status','url','location','header_digest','content_addressed_header_artifact_locator'])||h.sequence!==i||!Number.isInteger(h.status)||h.status<100||h.status>599||!url(h.url)||!url(h.location)||!dg(h.header_digest))unavailable();const b=await get(cas,h.content_addressed_header_artifact_locator,h.header_digest);let hh;try{hh=JSON.parse(b);if(!jb(hh).equals(b))unavailable();checkHeaders(hh)}catch{unavailable()}redirects.push({...h,headers:hh})}
    if(r.disposition==='blocked_by_policy'){if([r.response_status,r.header_digest,r.content_addressed_header_artifact_locator,r.raw_body_digest,r.content_addressed_body_artifact_locator].some(x=>x!==null))unavailable();responses.push({...r,redirects,headers:null,body:null});continue}
    if(!Number.isInteger(r.response_status)||r.response_status<100||r.response_status>599||!dg(r.header_digest)||!dg(r.raw_body_digest))unavailable();
    const hb=await get(cas,r.content_addressed_header_artifact_locator,r.header_digest),body=await get(cas,r.content_addressed_body_artifact_locator,r.raw_body_digest);let hh;try{hh=JSON.parse(hb);if(!jb(hh).equals(hb))unavailable();checkHeaders(hh)}catch{unavailable()}responses.push({...r,redirects,headers:hh,body});
  }
  for(const p of m.replay_profiles){const seq=m.network_records.filter(x=>x.replay_profile_id===p.replay_profile_id).map(x=>x.sequence);if(seq.length<1||seq.some((x,i)=>x!==i))unavailable()}
  const observations=[],observationOwners=new Map();
  for(const r of m.observation_records){if(!exact(r,OK)||!pids.has(r.replay_profile_id)||!steps.get(r.task_step_id)?.has(r.replay_profile_id)||!['screenshot','dom_snapshot','accessibility_tree','interaction_trace','performance_trace','content_extract'].includes(r.evidence_kind)||!Number.isInteger(r.ordinal)||r.ordinal<0||!dg(r.artifact_digest))unavailable();const key=`${r.replay_profile_id}\0${r.artifact_digest}`,owner=observationOwners.get(key);if(owner!==undefined&&owner!==r.task_step_id)unavailable();observationOwners.set(key,r.task_step_id);observations.push({...r,bytes:await get(cas,r.content_addressed_artifact_locator,r.artifact_digest)})}
  for(const s of ts.steps)for(const id of s.required_replay_profile_ids){if(!m.network_records.some(x=>x.task_step_id===s.step_id&&x.replay_profile_id===id))unavailable();if(!m.observation_records.some(x=>x.task_step_id===s.step_id&&x.replay_profile_id===id))unavailable()}
  return{run_status:'completed',run_issues:[],release_gate:'eligible',live_network_events:0,responses,observations};
}

const CLI_ISSUE=Object.freeze({code:'RULE_EVALUATION_ERROR',instance_pointer:'/snapshot_closure',dependency_id:null});
const cliUnavailable=(closure=null)=>({closure,completeness_status:'incomplete',run_status:'target_unavailable',release_gate:'no_release',run_issues:[CLI_ISSUE]});
const parseCli=(argv)=>{
  if(argv[0]==='--')argv=argv.slice(1);
  const values=new Map();
  for(let index=0;index<argv.length;index+=2){const flag=argv[index],value=argv[index+1];if(!['--case','--registry','--cas','--output'].includes(flag)||typeof value!=='string'||value.startsWith('--')||values.has(flag))throw E('CLI_INPUT_INVALID');values.set(flag,value)}
  if(!values.has('--case')||!values.has('--cas')||!values.has('--output'))throw E('CLI_INPUT_INVALID');return{casePath:resolve(values.get('--case')),registryPath:values.has('--registry')?resolve(values.get('--registry')):null,casPath:resolve(values.get('--cas')),outputPath:resolve(values.get('--output'))};
};
const safeCasName=locator=>{const match=/^cas\/([0-9a-f]{64})$/.exec(locator);if(!match)throw E('CAS_LOCATOR_INVALID');return match[1]};
const fileCas=async(rootInput)=>{
  await mkdir(rootInput,{recursive:true,mode:0o700});const root=await realpath(rootInput);
  const target=locator=>join(root,safeCasName(locator));
  return{
    async put(locator,bytes){
      const destination=target(locator),temporary=join(root,`.${safeCasName(locator)}.${process.pid}.${createHash('sha256').update(String(Date.now())+Math.random()).digest('hex')}.tmp`);let handle;
      try{handle=await open(temporary,fsConstants.O_CREAT|fsConstants.O_EXCL|fsConstants.O_WRONLY|fsConstants.O_NOFOLLOW,0o600);await handle.writeFile(Buffer.from(bytes));await handle.sync();await handle.close();handle=null;await rename(temporary,destination)}finally{if(handle)await handle.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{})}
    },
    async get(locator){
      let handle;try{handle=await open(target(locator),fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size>L.maxArtifactBytes)return null;return await handle.readFile()}catch{return null}finally{if(handle)await handle.close().catch(()=>{})}
    },
  };
};
const writeJsonAtomic=async(outputPath,value)=>{
  const parent=dirname(outputPath);await mkdir(parent,{recursive:true});const temporary=join(parent,`.${basename(outputPath)}.${process.pid}.${Date.now()}.tmp`);let handle;
  try{handle=await open(temporary,fsConstants.O_CREAT|fsConstants.O_EXCL|fsConstants.O_WRONLY|fsConstants.O_NOFOLLOW,0o600);await handle.writeFile(Buffer.from(`${canonicalize(value)}\n`));await handle.sync();await handle.close();handle=null;await rename(temporary,outputPath)}finally{if(handle)await handle.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{})}
};
const seedProfiles=async(casePath,c)=>{
  const fixturePath=resolve(dirname(casePath),'..','fixtures',`${c.case_id}.snapshot-closure.json`);let fixture;
  try{fixture=JSON.parse(await readFile(fixturePath,'utf8'))}catch{throw E('CAPTURE_PROFILE_FIXTURE_UNAVAILABLE')}
  const copy=snap(fixture);if(!Array.isArray(copy.replay_profiles)||copy.replay_profiles.length<1||copy.manifest_digest!==c.snapshot_closure_digest||snapshotClosureDigest(copy)!==copy.manifest_digest)throw E('CAPTURE_PROFILE_FIXTURE_INVALID');return copy.replay_profiles;
};
export const captureRegistryDigest=manifest=>{const value=snap(manifest);delete value.registry_digest;return dsha(REGISTRY_DOMAIN,jb(value))};
const registryPath=async(root,relative)=>{
  if(typeof relative!=='string'||relative.length<1||relative.includes('\\')||relative.startsWith('/')||relative.split('/').some(part=>part===''||part==='.'||part==='..'))throw E('CAPTURE_REGISTRY_PATH_INVALID');
  const candidate=resolve(root,relative);if(candidate!==root&&!candidate.startsWith(root+sep))throw E('CAPTURE_REGISTRY_PATH_INVALID');const stat=await lstat(candidate);if(!stat.isFile()||stat.isSymbolicLink())throw E('CAPTURE_REGISTRY_PATH_INVALID');const actual=await realpath(candidate);if(actual!==candidate)throw E('CAPTURE_REGISTRY_PATH_INVALID');return candidate;
};
const canonicalModuleRelative=value=>{
  if(typeof value!=='string'||value.length<1||Buffer.byteLength(value)>L.maxUrlBytes||value.normalize('NFC')!==value||value.includes('\\')||value.startsWith('/')||value.split('/').some(part=>part===''||part==='.'||part==='..')||!value.endsWith('.mjs'))throw E('CAPTURE_MODULE_PATH_INVALID');return value;
};
const modulePath=(root,value)=>{
  canonicalModuleRelative(value);
  const candidate=resolve(root,value);if(candidate===root||!candidate.startsWith(root+sep))throw E('CAPTURE_MODULE_PATH_INVALID');return candidate;
};
const relativeModulePath=(root,candidate)=>{const value=relative(root,candidate).split(sep).join('/');modulePath(root,value);return value};
const moduleRows=(value)=>{
  if(!Array.isArray(value)||value.length<1||value.length>L.maxInputNodes)throw E('CAPTURE_MODULE_CLOSURE_INVALID');
  const rows=value.map(row=>{if(!exact(row,MODULE_ROW_KEYS)||!dg(row.raw_sha256))throw E('CAPTURE_MODULE_CLOSURE_INVALID');canonicalModuleRelative(row.relative_path);return row});
  const ordered=[...rows].sort((a,b)=>Buffer.compare(Buffer.from(a.relative_path),Buffer.from(b.relative_path)));if(!jb(rows).equals(jb(ordered)))throw E('CAPTURE_MODULE_CLOSURE_INVALID');
  for(let index=1;index<rows.length;index+=1)if(rows[index-1].relative_path===rows[index].relative_path)throw E('CAPTURE_MODULE_CLOSURE_INVALID');return rows;
};
const moduleClosureDigest=(role,rows)=>dsha(`ux-skill:${role}-module-closure:v1`,jb(rows));
const inspectModuleClosure=async(root,entryRelative,declaredInput,role)=>{
  const declared=moduleRows(declaredInput),declaredByPath=new Map(declared.map(row=>[row.relative_path,row])),entryPath=relativeModulePath(root,modulePath(root,entryRelative));if(!declaredByPath.has(entryPath))throw E('CAPTURE_MODULE_CLOSURE_INCOMPLETE');
  await initModuleLexer;
  const queue=[entryPath],discovered=new Map(),edges=new Map(),realPaths=new Set();let total=0,entryExports=[];
  while(queue.length){
    const relativePath=queue.shift();if(discovered.has(relativePath))continue;const declaredRow=declaredByPath.get(relativePath);if(!declaredRow)throw E('CAPTURE_MODULE_UNREGISTERED');
    let absolutePath,rawBytes,actualPath;try{absolutePath=await registryPath(root,relativePath);actualPath=await realpath(absolutePath);rawBytes=await readFile(absolutePath)}catch{throw E('CAPTURE_MODULE_PATH_INVALID')}
    if(realPaths.has(actualPath))throw E('CAPTURE_MODULE_REALPATH_ALIAS');realPaths.add(actualPath);total+=rawBytes.length;if(rawBytes.length>L.maxArtifactBytes||total>L.maxTotalArtifactBytes)throw E('CAPTURE_MODULE_TOO_LARGE');if(sha(rawBytes)!==declaredRow.raw_sha256)throw E('CAPTURE_REGISTRY_DIGEST_MISMATCH');
    let source,imports,exports;try{source=new TextDecoder('utf-8',{fatal:true}).decode(rawBytes);[imports,exports]=parseModule(source)}catch{throw E('CAPTURE_MODULE_PARSE_INVALID')}
    const ambient=role==='runner'?/\b(?:fetch|WebSocket|EventSource|XMLHttpRequest|process|require|globalThis|global|eval|Function)\b/u:/\b(?:WebSocket|EventSource|XMLHttpRequest|process|require|globalThis|global|eval|Function)\b/u;if(ambient.test(source))throw E('CAPTURE_MODULE_AMBIENT_AUTHORITY');if(relativePath===entryPath)entryExports=exports.map(row=>typeof row==='string'?row:row.n);
    const localTargets=[],localSeen=new Set();
    for(const item of imports){
      if(item.d===-2)throw E('CAPTURE_MODULE_IMPORT_INVALID');const specifier=item.n;if(typeof specifier!=='string'||specifier.length<1)throw E('CAPTURE_MODULE_DYNAMIC_IMPORT_INVALID');
      if(!specifier.startsWith('./')&&!specifier.startsWith('../'))throw E('CAPTURE_MODULE_EXTERNAL_IMPORT_INVALID');
      if(specifier.includes('\\')||specifier.includes('?')||specifier.includes('#')||specifier.includes('%'))throw E('CAPTURE_MODULE_IMPORT_INVALID');const candidate=resolve(dirname(absolutePath),specifier);if(candidate===root||!candidate.startsWith(root+sep))throw E('CAPTURE_MODULE_ROOT_ESCAPE');const target=relativeModulePath(root,candidate);if(localSeen.has(target))throw E('CAPTURE_MODULE_DUPLICATE_IMPORT');localSeen.add(target);localTargets.push(target);
    }
    edges.set(relativePath,localTargets);discovered.set(relativePath,Object.freeze({relative_path:relativePath,absolute_path:absolutePath,raw_sha256:declaredRow.raw_sha256,raw_bytes:Buffer.from(rawBytes)}));for(const target of localTargets)if(!discovered.has(target))queue.push(target);
  }
  if(discovered.size!==declared.length||declared.some(row=>!discovered.has(row.relative_path)))throw E('CAPTURE_MODULE_CLOSURE_INCOMPLETE');if(!entryExports.includes(role==='runner'?'run':'request'))throw E('CAPTURE_REGISTRY_IMPLEMENTATION_INVALID');
  const indegree=new Map([...discovered.keys()].map(path=>[path,0]));for(const targets of edges.values())for(const target of targets)indegree.set(target,(indegree.get(target)??0)+1);const ready=[...indegree].filter(([,count])=>count===0).map(([path])=>path);let visited=0;while(ready.length){const path=ready.pop();visited+=1;for(const target of edges.get(path)??[]){const next=indegree.get(target)-1;indegree.set(target,next);if(next===0)ready.push(target)}}if(visited!==discovered.size)throw E('CAPTURE_MODULE_CYCLE');
  return Object.freeze({role,root,entry_path:entryPath,rows:Object.freeze(declared.map(row=>Object.freeze({...row}))),files:Object.freeze([...discovered.values()]),digest:moduleClosureDigest(role,declared)});
};
const verifyModuleClosure=async(closure)=>{
  for(const file of closure.files){let absolutePath,rawBytes;try{absolutePath=await registryPath(closure.root,file.relative_path);rawBytes=await readFile(absolutePath)}catch{throw E('CAPTURE_MODULE_CHANGED')};if(absolutePath!==file.absolute_path||sha(rawBytes)!==file.raw_sha256||!rawBytes.equals(file.raw_bytes))throw E('CAPTURE_MODULE_CHANGED')}
};
const stageModuleClosure=async(closure)=>{
  const stageRoot=await realpath(await mkdtemp(join(tmpdir(),`ux-skill-${closure.role}-${closure.digest}-`)));let loaded=false;
  try{
    for(const file of closure.files){const destination=join(stageRoot,...file.relative_path.split('/'));await mkdir(dirname(destination),{recursive:true,mode:0o700});let handle;try{handle=await open(destination,fsConstants.O_CREAT|fsConstants.O_EXCL|fsConstants.O_WRONLY|fsConstants.O_NOFOLLOW,0o400);await handle.writeFile(file.raw_bytes);await handle.sync();await handle.close();handle=null}catch(error){if(handle)await handle.close().catch(()=>{});throw error}}
    const staged=Object.freeze({root:stageRoot,entry_path:closure.entry_path,files:Object.freeze(closure.files.map(file=>Object.freeze({relative_path:file.relative_path,raw_sha256:file.raw_sha256,raw_bytes:Buffer.from(file.raw_bytes)}))),digest:closure.digest});await verifyStagedClosure(staged);loaded=true;return staged;
  }finally{if(!loaded)await rm(stageRoot,{recursive:true,force:true}).catch(()=>{})}
};
const verifyStagedClosure=async(staged)=>{for(const file of staged.files){let absolutePath,rawBytes;try{absolutePath=await registryPath(staged.root,file.relative_path);rawBytes=await readFile(absolutePath)}catch{throw E('CAPTURE_MODULE_STAGE_CHANGED')};if(sha(rawBytes)!==file.raw_sha256||!rawBytes.equals(file.raw_bytes))throw E('CAPTURE_MODULE_STAGE_CHANGED')}};
const INVOCATION_WORKER_SOURCE=`
const {parentPort,workerData}=require('node:worker_threads');
const {AsyncLocalStorage}=require('node:async_hooks');
const authority=new AsyncLocalStorage(),nativeFetch=globalThis.fetch.bind(globalThis),pending=new Map();let callSequence=0,runner,transport;
const fault=value=>({name:value?.name??'Error',message:value?.message??String(value),code:value?.code??null});
const denied=()=>Object.assign(new Error('CAPTURE_NETWORK_AUTHORITY_DENIED'),{code:'CAPTURE_NETWORK_AUTHORITY_DENIED'});
Object.defineProperty(globalThis,'fetch',{value:(...args)=>authority.getStore()?.active===true?nativeFetch(...args):Promise.reject(denied()),writable:false,configurable:false});
for(const name of ['WebSocket','EventSource','XMLHttpRequest'])if(name in globalThis)Object.defineProperty(globalThis,name,{value:function(){throw denied()},writable:false,configurable:false});
const callMain=(kind,payload={})=>new Promise((resolve,reject)=>{const id=++callSequence;pending.set(id,{resolve,reject});parentPort.postMessage({type:'bridge',kind,id,...payload})});
const executeStep=async(identity,work)=>{
  const stepId=await callMain('step-open',{identity}),handles=new WeakMap();let workError;
  const request=async input=>{const response=await callMain('step-request',{step_id:stepId,input}),opaque=response.observation_handle_ids.map(handleId=>{const handle=Object.freeze({});handles.set(handle,handleId);return handle});return Object.freeze({status:response.status,final_url:response.final_url,observation_handles:Object.freeze(opaque)})};
  const observe=async input=>{const handleId=handles.get(input?.handle);if(!handleId)throw Object.assign(new Error('TASK_RUNNER_OBSERVATION_HANDLE_INVALID'),{code:'TASK_RUNNER_OBSERVATION_HANDLE_INVALID'});await callMain('step-observe',{step_id:stepId,evidence_kind:input.evidence_kind,handle_id:handleId})};
  try{await work(Object.freeze({request,observe}))}catch(error){workError=error}
  try{await callMain('step-close',{step_id:stepId,failed:Boolean(workError)})}catch(error){if(!workError)workError=error}if(workError)throw workError;
};
const respond=(id,ok,value)=>parentPort.postMessage(ok?{type:'result',id,ok:true,value}:{type:'result',id,ok:false,error:fault(value)});
parentPort.on('message',message=>{
  if(message.type==='bridge-result'){const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);message.ok?waiter.resolve(message.value):waiter.reject(Object.assign(new Error(message.error?.message??'CAPTURE_WORKER_BRIDGE_FAILED'),{code:message.error?.code??'CAPTURE_WORKER_BRIDGE_FAILED'}));return}
  if(message.type==='transport-request'){const lease={active:true};void(async()=>{let ok=false,value;try{value=await authority.run(lease,()=>transport.request(message.input));ok=true}catch(error){value=error}finally{lease.active=false}respond(message.id,ok,value)})();return}
  if(message.type==='runner-run'){Promise.resolve(runner.run(Object.freeze({profiles:message.profiles,steps:message.steps,executeStep}))).then(()=>respond(message.id,true,null),error=>respond(message.id,false,error))}
});
(async()=>{runner=await import(workerData.runnerUrl);transport=await import(workerData.transportUrl);if(typeof runner.run!=='function'||typeof transport.request!=='function')throw Object.assign(new Error('CAPTURE_REGISTRY_IMPLEMENTATION_INVALID'),{code:'CAPTURE_REGISTRY_IMPLEMENTATION_INVALID'});parentPort.postMessage({type:'ready'})})().catch(error=>{parentPort.postMessage({type:'load-error',error:fault(error)})});
`;
const startInvocationWorker=async(runnerStage,transportStage)=>{
  const worker=new Worker(INVOCATION_WORKER_SOURCE,{eval:true,workerData:{runnerUrl:`${pathToFileURL(join(runnerStage.root,...runnerStage.entry_path.split('/'))).href}?closure=${runnerStage.digest}`,transportUrl:`${pathToFileURL(join(transportStage.root,...transportStage.entry_path.split('/'))).href}?closure=${transportStage.digest}`}}),pending=new Map(),sessions=new Map();let sequence=0,activeRun=null,closed=false;
  const fail=error=>{if(closed)return;closed=true;for(const waiter of pending.values())waiter.reject(error);pending.clear();for(const session of sessions.values())session.finishReject(error);sessions.clear()};
  const reply=(id,ok,value)=>worker.postMessage(ok?{type:'bridge-result',id,ok:true,value}:{type:'bridge-result',id,ok:false,error:{message:value?.message??String(value),code:value?.code??null}});
  const bridge=async message=>{
    try{
      if(!activeRun)throw E('TASK_RUNNER_INACTIVE_STEP');
      if(message.kind==='step-open'){
        const stepId=`step-${++activeRun.stepSequence}`;let readyResolve,readyReject,finishResolve,finishReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject}),finish=new Promise((resolve,reject)=>{finishResolve=resolve;finishReject=reject}),session={stepId,handles:new Map(),handleSequence:0,finishResolve,finishReject,capabilities:null,execution:null};sessions.set(stepId,session);
        session.execution=Promise.resolve().then(()=>activeRun.executeStep(message.identity,async capabilities=>{session.capabilities=capabilities;readyResolve();await finish})).catch(error=>{readyReject(error);throw error});void session.execution.catch(()=>{});try{await ready}catch(error){sessions.delete(stepId);throw error}reply(message.id,true,stepId);return;
      }
      const session=sessions.get(message.step_id);if(!session?.capabilities)throw E('TASK_RUNNER_INACTIVE_STEP');
      if(message.kind==='step-request'){const response=await session.capabilities.request(message.input),ids=response.observation_handles.map(handle=>{const id=`handle-${++session.handleSequence}`;session.handles.set(id,handle);return id});reply(message.id,true,{status:response.status,final_url:response.final_url,observation_handle_ids:ids});return}
      if(message.kind==='step-observe'){const handle=session.handles.get(message.handle_id);if(!handle)throw E('TASK_RUNNER_OBSERVATION_HANDLE_INVALID');await session.capabilities.observe({evidence_kind:message.evidence_kind,handle});reply(message.id,true,null);return}
      if(message.kind==='step-close'){message.failed?session.finishReject(E('TASK_RUNNER_WORK_FAILED')):session.finishResolve();try{await session.execution}catch(error){if(!message.failed)throw error}finally{sessions.delete(message.step_id)}reply(message.id,true,null);return}
      throw E('TASK_RUNNER_WORKER_PROTOCOL_INVALID');
    }catch(error){reply(message.id,false,error)}
  };
  worker.on('message',message=>{if(message.type==='result'){const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);message.ok?waiter.resolve(message.value):waiter.reject(Object.assign(E(message.error?.code??'CAPTURE_INVOCATION_FAILED'),{cause:message.error}));return}if(message.type==='bridge'){void bridge(message)}});
  worker.on('error',fail);worker.on('exit',code=>{if(code!==0)fail(E('CAPTURE_INVOCATION_WORKER_EXIT'))});
  try{await new Promise((resolve,reject)=>{const ready=message=>{if(message.type==='ready'){worker.off('message',ready);resolve()}else if(message.type==='load-error'){worker.off('message',ready);reject(Object.assign(E(message.error?.code??'CAPTURE_INVOCATION_LOAD_FAILED'),{cause:message.error}))}};worker.on('message',ready);worker.once('error',reject)})}catch(error){await worker.terminate().catch(()=>{});throw error}
  const rpc=(type,payload)=>new Promise((resolve,reject)=>{if(closed){reject(E('CAPTURE_INVOCATION_CLOSED'));return}const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({type,id,...payload})});
  return Object.freeze({worker,request:input=>rpc('transport-request',{input}),async run({profiles,steps,executeStep}){if(activeRun)throw E('TASK_RUNNER_CONCURRENT_RUN');activeRun={executeStep,stepSequence:0};try{await rpc('runner-run',{profiles,steps})}finally{activeRun=null}}});
};
const disposeInvocation=async invocation=>{if(!invocation)return;if(invocation.invocationWorker)await invocation.invocationWorker.terminate().catch(()=>{});await Promise.all([invocation.runnerStage?.root,invocation.transportStage?.root].filter(Boolean).map(root=>rm(root,{recursive:true,force:true}).catch(()=>{})))};
const loadInvocation=async registration=>{
  await verifyModuleClosure(registration.runnerClosure);await verifyModuleClosure(registration.transportClosure);const runnerStage=await stageModuleClosure(registration.runnerClosure);let transportStage,client;
  try{transportStage=await stageModuleClosure(registration.transportClosure);client=await startInvocationWorker(runnerStage,transportStage);await verifyModuleClosure(registration.runnerClosure);await verifyModuleClosure(registration.transportClosure);await verifyStagedClosure(runnerStage);await verifyStagedClosure(transportStage);return Object.freeze({...registration,runnerStage,transportStage,invocationWorker:client.worker,run:client.run,request:client.request})}
  catch(error){if(client?.worker)await client.worker.terminate().catch(()=>{});await Promise.all([runnerStage.root,transportStage?.root].filter(Boolean).map(stageRoot=>rm(stageRoot,{recursive:true,force:true}).catch(()=>{})));throw error}
};
export async function createCaptureRegistry(manifestPath){
  const absolute=resolve(manifestPath),manifestStat=await lstat(absolute);if(!manifestStat.isFile()||manifestStat.isSymbolicLink()||manifestStat.size>L.maxArtifactBytes)throw E('CAPTURE_REGISTRY_INVALID');const root=await realpath(dirname(absolute)),manifest=snap(JSON.parse(await readFile(absolute,'utf8')));
  if(!exact(manifest,['registry_version','entries','registry_digest'])||manifest.registry_version!=='snapshot-capture-registry-v1'||!Array.isArray(manifest.entries)||manifest.entries.length<1||manifest.entries.length>L.maxProfiles||!dg(manifest.registry_digest)||captureRegistryDigest(manifest)!==manifest.registry_digest)throw E('CAPTURE_REGISTRY_INVALID');
  const entries=new Map(),orderedEntries=[...manifest.entries].sort((a,b)=>cmp([a.case_id,a.task_script_digest],[b.case_id,b.task_script_digest]));if(!jb(manifest.entries).equals(jb(orderedEntries)))throw E('CAPTURE_REGISTRY_INVALID');
  for(const entry of manifest.entries){
    if(!exact(entry,['case_id','task_script_digest','runner_path','runner_digest','runner_module_closure','transport_path','transport_digest','transport_module_closure'])||typeof entry.case_id!=='string'||!entry.case_id||!dg(entry.task_script_digest)||!dg(entry.runner_digest)||!dg(entry.transport_digest)||entries.has(entry.case_id))throw E('CAPTURE_REGISTRY_INVALID');
    const runnerClosure=await inspectModuleClosure(root,entry.runner_path,entry.runner_module_closure,'runner'),transportClosure=await inspectModuleClosure(root,entry.transport_path,entry.transport_module_closure,'transport');if(runnerClosure.rows.find(row=>row.relative_path===entry.runner_path)?.raw_sha256!==entry.runner_digest||transportClosure.rows.find(row=>row.relative_path===entry.transport_path)?.raw_sha256!==entry.transport_digest)throw E('CAPTURE_REGISTRY_DIGEST_MISMATCH');
    const registration=Object.freeze({...entry,registry_digest:manifest.registry_digest,runner_closure_digest:runnerClosure.digest,transport_closure_digest:transportClosure.digest,runnerClosure,transportClosure});entries.set(entry.case_id,registration);
  }
  const registry=Object.freeze({registry_version:manifest.registry_version,registry_digest:manifest.registry_digest});registryState.set(registry,Object.freeze({entries}));return registry;
}
const taskRunnerDriver=(cas,profiles,registration)=>{
  if(!plain(registration)||!dg(registration.task_script_digest)||!dg(registration.registry_digest)||!dg(registration.runner_closure_digest)||!dg(registration.transport_closure_digest)||typeof registration.run!=='function'||typeof registration.request!=='function')throw E('TASK_RUNNER_UNAVAILABLE');
  return{cas,async capture(c){
    const ts=task(snap(c.task_script)),taskDigest=sha(jb(ts));if(taskDigest!==registration.task_script_digest)throw E('TASK_RUNNER_UNSUPPORTED_INSTRUCTION');
    const expectedByProfile=new Map(profiles.map(row=>[row.replay_profile_id,ts.steps.filter(step=>step.required_replay_profile_ids.includes(row.replay_profile_id)).map(step=>step.step_id)]));
    const nextByProfile=new Map(profiles.map(row=>[row.replay_profile_id,0])),executed=new Set(),network=[],observations=[],sequenceByProfile=new Map(profiles.map(row=>[row.replay_profile_id,0])),handleState=new WeakMap();let active=null;
    const executeStep=async(identity,work)=>{
      const id=snap(identity);if(!exact(id,['replay_profile_id','task_step_id'])||typeof work!=='function'||active)throw E('TASK_RUNNER_INVALID');
      const expected=expectedByProfile.get(id.replay_profile_id),next=nextByProfile.get(id.replay_profile_id);if(!expected||expected[next]!==id.task_step_id)throw E('TASK_RUNNER_STEP_ORDER');const key=`${id.replay_profile_id}\0${id.task_step_id}`;if(executed.has(key))throw E('TASK_RUNNER_STEP_DUPLICATE');
      const state={...id,requests:0,observations:0,ordinals:new Map()};active=state;
      const request=async(input)=>{
        if(active!==state)throw E('TASK_RUNNER_INACTIVE_STEP');const value=snap(input),keys=Object.keys(value).sort().join('\0');if(!plain(value)||(keys!=='method\0url'&&keys!=='method\0network_kind\0url')||!['GET','HEAD'].includes(value.method)||!url(value.url)||value.network_kind!==undefined&&!['document','script','style','image','font','xhr','fetch','other'].includes(value.network_kind))throw E('TASK_RUNNER_REQUEST_INVALID');
        const response=await registration.request(snap(value));if(!plain(response)||!exact(response,['status','final_url','headers','body','redirect_chain','observation_artifacts'])||!Number.isInteger(response.status)||response.status<100||response.status>599||!url(response.final_url)||!Array.isArray(response.headers)||!Array.isArray(response.redirect_chain)||response.redirect_chain.length>L.maxRedirectHops||!Array.isArray(response.observation_artifacts)||!(response.body instanceof Uint8Array)||utilTypes.isProxy(response.body)||response.body.length>L.maxArtifactBytes)throw E('TASK_RUNNER_RESPONSE_INVALID');
        const headers=snap(response.headers);canonHeaders(headers);const redirects=[];let expectedUrl=value.url;
        for(let index=0;index<response.redirect_chain.length;index+=1){const hop=response.redirect_chain[index];if(!plain(hop)||!exact(hop,['sequence','status','url','location','response_headers'])||hop.sequence!==index||!Number.isInteger(hop.status)||hop.status<300||hop.status>399||!url(hop.url)||!url(hop.location)||hop.url!==expectedUrl||!Array.isArray(hop.response_headers))throw E('TASK_RUNNER_REDIRECT_INVALID');const hopHeaders=snap(hop.response_headers),canonical=canonHeaders(hopHeaders),locations=canonical.headers.filter(row=>row.name_lower_ascii==='location').map(row=>Buffer.from(row.value_bytes_base64,'base64').toString('latin1'));if(locations.length<1||!locations.some(location=>{try{return new URL(location,hop.url).href===hop.location}catch{return false}}))throw E('TASK_RUNNER_REDIRECT_INVALID');redirects.push({sequence:index,status:hop.status,url:hop.url,location:hop.location,response_headers:hopHeaders});expectedUrl=hop.location}
        if(response.final_url!==expectedUrl)throw E('TASK_RUNNER_REDIRECT_INCOMPLETE');const body=Buffer.from(response.body),sequence=sequenceByProfile.get(state.replay_profile_id);sequenceByProfile.set(state.replay_profile_id,sequence+1);network.push({replay_profile_id:state.replay_profile_id,sequence,task_step_id:state.task_step_id,request_method:value.method,request_url:value.url,redirect_chain:redirects,final_url:response.final_url,network_kind:value.network_kind??'document',disposition:'captured',response_status:response.status,response_headers:headers,raw_body_bytes_base64:body.toString('base64')});state.requests+=1;
        const observationHandles=[];for(const artifact of response.observation_artifacts){if(!plain(artifact)||!exact(artifact,['evidence_kind','artifact_bytes'])||!['screenshot','dom_snapshot','accessibility_tree','interaction_trace','performance_trace','content_extract'].includes(artifact.evidence_kind)||!(artifact.artifact_bytes instanceof Uint8Array)||utilTypes.isProxy(artifact.artifact_bytes)||artifact.artifact_bytes.length>L.maxArtifactBytes)throw E('TASK_RUNNER_OBSERVATION_INVALID');const handle=Object.freeze({});handleState.set(handle,{state,evidence_kind:artifact.evidence_kind,bytes:Buffer.from(artifact.artifact_bytes),used:false});observationHandles.push(handle)}return Object.freeze({status:response.status,final_url:response.final_url,observation_handles:Object.freeze(observationHandles)});
      };
      const observe=async(input)=>{
        if(active!==state||!plain(input)||!exact(input,['evidence_kind','handle'])||!['screenshot','dom_snapshot','accessibility_tree','interaction_trace','performance_trace','content_extract'].includes(input.evidence_kind))throw E('TASK_RUNNER_OBSERVATION_INVALID');const evidence=handleState.get(input.handle);if(!evidence||evidence.state!==state||evidence.used||evidence.evidence_kind!==input.evidence_kind)throw E('TASK_RUNNER_OBSERVATION_HANDLE_INVALID');evidence.used=true;
        const ordinal=state.ordinals.get(input.evidence_kind)??0;state.ordinals.set(input.evidence_kind,ordinal+1);observations.push({replay_profile_id:state.replay_profile_id,task_step_id:state.task_step_id,evidence_kind:input.evidence_kind,ordinal,artifact_bytes_base64:evidence.bytes.toString('base64')});state.observations+=1;
      };
      try{await work(Object.freeze({request,observe}))}finally{active=null}if(state.requests<1||state.observations<1)throw E('TASK_RUNNER_STEP_INCOMPLETE');executed.add(key);nextByProfile.set(id.replay_profile_id,next+1);
    };
    await registration.run(Object.freeze({profiles:snap(profiles),steps:snap(ts.steps),executeStep}));if(active)throw E('TASK_RUNNER_INACTIVE_STEP');
    for(const [profileId,steps] of expectedByProfile)if(nextByProfile.get(profileId)!==steps.length)throw E('TASK_RUNNER_PARTIAL');
    const observationOwners=new Map();for(const row of observations){const key=`${row.replay_profile_id}\0${sha(Buffer.from(row.artifact_bytes_base64,'base64'))}`,owner=observationOwners.get(key);if(owner!==undefined&&owner!==row.task_step_id)throw E('TASK_RUNNER_OBSERVATION_REUSED');observationOwners.set(key,row.task_step_id)}
    return{capture_environment_digest:dsha('ux-skill:capture-environment:v1',jb({registry_digest:registration.registry_digest,runner_digest:registration.runner_closure_digest,transport_digest:registration.transport_closure_digest})),captured_at:new Date().toISOString(),authenticated:false,replay_profiles:snap(profiles),network_events:network,observation_events:observations,outbound_effects:[],transport_events:[],live_replay:false};
  }};
};
export async function runCaptureCli(argv=process.argv.slice(2),dependencies={}){
  let options;try{options=parseCli(argv)}catch{return 64}let wrapper=cliUnavailable(),invocation;
  try{const registry=dependencies?.registry??(options.registryPath?await createCaptureRegistry(options.registryPath):null),state=registryState.get(registry);if(!state)throw E('TASK_RUNNER_UNAVAILABLE');const c=snap(JSON.parse(await readFile(options.casePath,'utf8'))),profiles=await seedProfiles(options.casePath,c),registration=state.entries.get(c.case_id);if(!registration)throw E('TASK_RUNNER_UNAVAILABLE');invocation=await loadInvocation(registration);const cas=await fileCas(options.casPath),driver=taskRunnerDriver(cas,profiles,invocation),closure=await captureClosure(c,driver);wrapper=closure.completeness_status==='complete'?{closure,completeness_status:'complete',run_status:'completed',release_gate:'no_release',run_issues:[]}:cliUnavailable(closure)}catch{wrapper=cliUnavailable()}finally{if(invocation)await disposeInvocation(invocation)}
  try{await writeJsonAtomic(options.outputPath,wrapper)}catch{return 74}return wrapper.run_status==='completed'?0:2;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runCaptureCli();
