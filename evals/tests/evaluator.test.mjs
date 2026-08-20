import test from'node:test';
import assert from'node:assert/strict';
import{createHash}from'node:crypto';
import{readFile}from'node:fs/promises';
import{canonicalSet,jcsBytes}from'../../evaluator/canonical.mjs';
import{digestJcs}from'../../evaluator/digests.mjs';
import{EXPECTED_EVALUATOR_MODULE_PATHS,assertEvaluatorManifestMatchesImportClosure}from'../helpers/import-closure.mjs';
let api,importFailure;try{api=await import('../../evaluator/index.mjs')}catch(error){importFailure=error}
if(importFailure)test('TASK10_EVALUATOR_RED',()=>assert.fail('TASK10_EVALUATOR_RED:'+(importFailure?.code??importFailure?.name??'IMPORT_FAILED')));
else{
 const{evaluate}=api,golden=JSON.parse(await readFile(new URL('../golden/high-risk-delete.json',import.meta.url),'utf8'));
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const exact=(v,k,m)=>assert.deepEqual(Object.keys(v).sort(),[...k].sort(),m);
 const invalid=(b,s)=>assert.rejects(()=>evaluate(b),e=>{assert.equal(e?.code,'INVALID_EVALUATION_INPUT');assert.ok(e.errors?.length);if(s)assert.equal(e.errors[0].stage,s);return true});
 test('evaluate(bundle) is the sole public semantic authority',()=>{assert.deepEqual(Object.keys(api),['evaluate']);assert.equal(evaluate.length,1)});
 test('high-risk delete replays five times to one byte-equal golden semantic digest',async()=>{
  const out=await Promise.all(Array.from({length:5},()=>evaluate(structuredClone(golden.bundle))));
  assert.equal(new Set(out.map(x=>x.semantic_digest)).size,1);
  for(const x of out){exact(x,['assurance','inquiry','semantic_projection','semantic_digest','audit_sidecar'],'EvaluationResult');assert.equal(x.semantic_digest,x.semantic_projection.semantic_digest);assert.match(x.assurance.warning,/does not mean UX is good/i);assert.equal(x.inquiry.authoritative,false);assert.equal(x.semantic_projection.inquiry_validation.authoritative,false);const p=structuredClone(x.semantic_projection);delete p.semantic_digest;assert.equal(x.semantic_digest,digestJcs('ux-skill:semantic:v1',p));assert.ok(jcsBytes(x.semantic_projection).equals(jcsBytes(golden.expected_semantic_projection)))}
 });
 test('only one complete bundle may carry adapter evidence',async()=>{
  const schema=JSON.parse(await readFile('schemas/core/evaluation-input.schema.json','utf8'));
  for(const field of schema.required){const b=structuredClone(golden.bundle);delete b[field];await invalid(b)}
  await assert.rejects(()=>evaluate(structuredClone(golden.bundle),{adapter_evidence:golden.bundle.adapter_evidence}),e=>e?.code==='OUT_OF_BAND_EVIDENCE_FORBIDDEN');
  await invalid({...structuredClone(golden.bundle),adapter_result:{text:'MCP_TEXT_OUT_OF_BAND'}},'schema')
 });
 test('validation order is parse/I-JSON then NFC then schema then collections',async()=>{
  const cycle=structuredClone(golden.bundle);cycle.self=cycle;await invalid(cycle,'parse');
  const nfc=structuredClone(golden.bundle);nfc.scenario_profile_id='e\u0301';
  await assert.rejects(()=>evaluate(nfc),e=>{assert.deepEqual([...new Set(e.errors.map(x=>x.stage))],['nfc']);return true});
  const b=structuredClone(golden.bundle);delete b.scenario_profile_id;
  await assert.rejects(()=>evaluate(b),e=>{assert.ok(e.errors.some(x=>x.stage==='schema'&&x.code==='REQUIRED_MISSING'));assert.ok(e.errors.some(x=>x.stage==='collections'&&x.code==='SUPPRESSED_BY_STAGE'));return true})
 });
 test('all manifests and the canonical nine-module evaluator closure are raw-byte authenticated',async()=>{
  const[m,s,k,p,d]=await Promise.all(['evaluator/manifest.json','schemas/manifest.json','knowledge/manifest.json','knowledge/policy-manifest.json'].map(x=>readFile(x,'utf8').then(JSON.parse)).concat(readFile('knowledge/decision-policies.json')));
  exact(m,['behavior_version','evaluator_files','schema_manifest_digest','knowledge_manifest_digest','policy_manifest_digest'],'manifest');
  assert.deepEqual(m.evaluator_files.map(x=>x.path),EXPECTED_EVALUATOR_MODULE_PATHS);
  await assertEvaluatorManifestMatchesImportClosure({repositoryRoot:process.cwd(),manifestPaths:m.evaluator_files.map(x=>x.path)});
  for(const row of m.evaluator_files)assert.equal(row.file_digest,sha(await readFile(row.path)),row.path);
  for(const row of s)assert.equal(row.file_digest,sha(await readFile(row.path)),row.path);
  for(const row of k.files)assert.equal(row.file_digest,sha(await readFile(row.path)),row.path);
  for(const row of p.policy_files)assert.equal(row.file_digest,sha(await readFile(row.path)),row.path);
  assert.equal(m.schema_manifest_digest,digestJcs('ux-skill:manifest:v1',s));assert.equal(m.knowledge_manifest_digest,digestJcs('ux-skill:knowledge:v1',k.files));assert.equal(m.policy_manifest_digest,digestJcs('ux-skill:manifest:v1',p));assert.notEqual(m.policy_manifest_digest,sha(d));
  assert.equal((await evaluate(structuredClone(golden.bundle))).semantic_projection.evaluator_digest,digestJcs('ux-skill:evaluator:v1',m))
 });
 test('canonical-set input permutations preserve registry-ordered semantic bytes',async()=>{
  const b=structuredClone(golden.bundle),fields=['scenario_profiles','candidate_universe','journeys','source_registry_refs','evidence','studies','claims','adapter_evidence'];for(const f of fields)b[f]?.reverse();for(const x of b.candidate_universe??[])x.option_ids.reverse();for(const x of b.claims??[])x.evidence_refs.reverse();
  const a=(await evaluate(structuredClone(golden.bundle))).semantic_projection,z=(await evaluate(b)).semantic_projection;assert.ok(jcsBytes(a).equals(jcsBytes(z)));
  const map={rule_evaluations:x=>x.rule_id,findings:x=>x.fingerprint,run_issues:x=>[x.code,x.instance_pointer,x.dependency_id],claim_assessments:x=>x.claim_assessment_id,risk_assessments:x=>x.risk_assessment_id,recommendation_assessments:x=>x.recommendation_assessment_id,resolution_traces:x=>x.resolution_trace_id,coverage_gaps:x=>x.coverage_gap_id};for(const[f,key]of Object.entries(map))assert.deepEqual(a[f],canonicalSet(a[f],key),f)
 });
 test('public materialization is non-lossy and Task5 shapes are exact',async()=>{
  const p=(await evaluate(structuredClone(golden.bundle))).semantic_projection;
  for(const x of p.rule_evaluations)exact(x,['rule_id','rule_version','release_critical','finding_type','terminal','outcome','reason_code','trace','dependency_trace','run_issue'],'RuleEvaluation');
  for(const x of p.findings)exact(x,['finding_id','fingerprint','fingerprint_full_digest','finding_type','emission_reason_code','rule_id','rule_version'],'Finding');
  for(const x of p.run_issues)exact(x,['code','instance_pointer','dependency_id'],'RunIssue');
  for(const x of p.claim_assessments){for(const f of['source_material_digest','policy_id','checks','dimension_scores','evidence_grade','assessed_predicate'])assert.ok(Object.hasOwn(x,f),f);assert.ok(x.checks.every(y=>y&&typeof y==='object'))}
  for(const x of p.risk_assessments){assert.match(x.finding_id,/^f_[0-9a-f]{32}$/);assert.equal(p.findings.filter(y=>y.finding_id===x.finding_id).length,1)}
  for(const x of p.recommendation_assessments){for(const f of['authority_ceiling','evidence_ceiling','risk_ceiling','reversibility_ceiling','minimum_ceiling','output_kind'])assert.ok(Object.hasOwn(x,f),f);assert.notEqual(x.recommendation===null,x.research_question===null)}
  assert.deepEqual(p.release_recommendation.condition_ids,p.release_recommendation.conditions.map(x=>x.condition_id))
 });
 test('semantic projection excludes volatile localized MCP and Inquiry text',async()=>{
  const p=(await evaluate(structuredClone(golden.bundle))).semantic_projection;for(const f of['audit_sidecar','assurance','inquiry','inquiry_draft','wall_clock_started_at','wall_clock_finished_at','localized_messages','mcp_text'])assert.equal(Object.hasOwn(p,f),false,f);if(golden.bundle.inquiry_draft?.text)assert.equal(JSON.stringify(p).includes(golden.bundle.inquiry_draft.text),false);assert.equal(JSON.stringify(p).includes('MCP_TRANSPORT_TEXT_DO_NOT_HASH'),false)
 });
 test('non-black-box research and adapter state never synthesize Task9 closure failure',async()=>{const p=(await evaluate(structuredClone(golden.non_black_box_blocked_bundle))).semantic_projection;assert.ok(!p.run_issues.some(x=>x.instance_pointer==='/snapshot_closure'));assert.ok(!p.coverage_gaps.some(x=>x.reason_code==='SNAPSHOT_CLOSURE_UNAVAILABLE'))})
}
