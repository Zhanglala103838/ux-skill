import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalize } from 'json-canonicalize';

const DOMAIN='ux-skill:snapshot-closure:v1';
export const SNAPSHOT_LIMITS=Object.freeze({maxProfiles:16,maxTaskSteps:128,maxNetworkRecords:4096,maxObservationRecords:4096,maxRedirectHops:32,maxHeaders:256,maxArtifactBytes:1048576,maxTotalArtifactBytes:33554432,maxUrlBytes:8192});
const L=SNAPSHOT_LIMITS;
const MK=['closure_version','entry_url','task_script_digest','capture_environment_digest','captured_at','authenticated','replay_profiles','network_records','observation_records','outbound_effect_ledger_digest','completeness_status','manifest_digest'];
const PK=['replay_profile_id','viewport_width_css_px','viewport_height_css_px','device_scale_factor','input_modality','prefers_reduced_motion','prefers_contrast','color_scheme','locale','timezone','assistive_technology_id','browser_engine_digest'];
const NK=['replay_profile_id','sequence','task_step_id','request_method','request_url','redirect_chain','final_url','network_kind','disposition','response_status','header_digest','content_addressed_header_artifact_locator','raw_body_digest','content_addressed_body_artifact_locator'];
const OK=['replay_profile_id','task_step_id','evidence_kind','ordinal','artifact_digest','content_addressed_artifact_locator'];
const HK=['sequence','name_lower_ascii','value_bytes_base64'];
const HX=/^[0-9a-f]{64}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HN=/^[a-z0-9!#$%&'*+.^_\x60|~-]+$/;
const E=(code,result)=>Object.assign(new TypeError(code),{code,...(result?{result}:{})});
const bad=()=>{throw E('CAPTURE_INPUT_INVALID')};
const unavailable=()=>{throw E('TARGET_UNAVAILABLE',{run_status:'target_unavailable',run_issues:[{code:'RULE_EVALUATION_ERROR',instance_pointer:'/snapshot_closure',dependency_id:null}],release_gate:'no_release'})};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&!utilTypes.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype;
const nfc=s=>{
  if(typeof s!=='string'||s.normalize('NFC')!==s)bad();
  for(let i=0;i<s.length;i++){const u=s.charCodeAt(i);if(u>=0xd800&&u<=0xdbff){const n=s.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))bad()}else if(u>=0xdc00&&u<=0xdfff)bad()}
  return s;
};
const snap=(v,active=new WeakSet())=>{
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='string')return nfc(v);
  if(typeof v==='number'){if(!Number.isFinite(v)||(Number.isInteger(v)&&!Number.isSafeInteger(v)))bad();return v}
  if(typeof v!=='object'||utilTypes.isProxy(v)||active.has(v))bad();
  active.add(v);
  try{
    if(Array.isArray(v)){
      if(Object.getPrototypeOf(v)!==Array.prototype)bad();
      for(const k of Reflect.ownKeys(v)){if(k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||String(Number(k))!==k||!d?.enumerable||!Object.hasOwn(d,'value'))bad()}
      return v.map(x=>snap(x,active));
    }
    if(!plain(v))bad();const out={};
    for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d?.enumerable||!Object.hasOwn(d,'value'))bad();nfc(k);out[k]=snap(d.value,active)}
    return out;
  }finally{active.delete(v)}
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
const put=async(cas,b,state)=>{state.total+=b.length;if(state.total>L.maxTotalArtifactBytes){state.incomplete=true;return null}const h=sha(b),p=loc(h);await cas.put(p,Buffer.from(b));return[h,p]};
const get=async(cas,p,h)=>{if(p!==loc(h))unavailable();let b;try{b=await cas.get(p)}catch{unavailable()}if(!(b instanceof Uint8Array)||b.length>L.maxArtifactBytes)unavailable();b=Buffer.from(b);if(sha(b)!==h)unavailable();return b};
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
  const tb=jb(ts),td=sha(tb);await browser.cas.put(loc(td),tb);
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
  for(const p of ps){const seq=nr.filter(x=>x.replay_profile_id===p.replay_profile_id).map(x=>x.sequence);if(seq.some((x,i)=>x!==i))inc()}
  for(const s of ts.steps)for(const id of s.required_replay_profile_ids)if(!or.some(x=>x.task_step_id===s.step_id&&x.replay_profile_id===id))inc();
  const m={closure_version:'snapshot-closure-v1',entry_url:c.canonical_locator,task_script_digest:td,capture_environment_digest:raw.capture_environment_digest,captured_at:raw.captured_at,authenticated:false,replay_profiles:ps,network_records:nr,observation_records:or,outbound_effect_ledger_digest:sha(jb(raw.outbound_effects)),completeness_status:state.incomplete?'incomplete':'complete',manifest_digest:''};m.manifest_digest=snapshotClosureDigest(m);return m;
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
  const observations=[];
  for(const r of m.observation_records){if(!exact(r,OK)||!pids.has(r.replay_profile_id)||!steps.get(r.task_step_id)?.has(r.replay_profile_id)||!['screenshot','dom_snapshot','accessibility_tree','interaction_trace','performance_trace','content_extract'].includes(r.evidence_kind)||!Number.isInteger(r.ordinal)||r.ordinal<0||!dg(r.artifact_digest))unavailable();observations.push({...r,bytes:await get(cas,r.content_addressed_artifact_locator,r.artifact_digest)})}
  for(const s of ts.steps)for(const id of s.required_replay_profile_ids)if(!m.observation_records.some(x=>x.task_step_id===s.step_id&&x.replay_profile_id===id))unavailable();
  return{run_status:'completed',run_issues:[],release_gate:'eligible',live_network_events:0,responses,observations};
}
