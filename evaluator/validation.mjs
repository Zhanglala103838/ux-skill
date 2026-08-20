import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ARTIFACT_READ_LIMITS, assertIJson, assertCanonicalRelativePath, canonicalSet, jcsBytes, parseArtifactJson, readArtifactBytes } from './canonical.mjs';
import { validateTask5DependencyEvaluation } from './dependency-decision.mjs';

const schemaPaths=[
 '../schemas/adapters/hulian-component-doc-v1.schema.json','../schemas/adapters/hulian-evaluation-request-v1.schema.json',
 '../schemas/core/authority.schema.json','../schemas/core/claims.schema.json','../schemas/core/evaluation-input.schema.json','../schemas/core/candidate-solver-input.schema.json',
 '../schemas/core/real-world-case.schema.json','../schemas/core/snapshot-closure.schema.json','../schemas/evaluator/output.schema.json',
 '../schemas/evaluator/rule.schema.json','../schemas/evaluator/semantic-projection.schema.json'
];
const schemas=await Promise.all(schemaPaths.map(async(schemaFile)=>parseArtifactJson(await readArtifactBytes(new URL(schemaFile,import.meta.url),{maxBytes:ARTIFACT_READ_LIMITS.JSON_MAX_BYTES}),schemaFile)));
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true,validateFormats:true,verbose:false,messages:false,unicodeRegExp:true});
addFormats(ajv);
ajv.addFormat('canonical-relative-path',{type:'string',validate(value){try{assertCanonicalRelativePath(value);return true;}catch{return false;}}});
for(const schema of schemas)ajv.addSchema(schema);

const schemaIds=Object.freeze({
 EvaluationInputBundle:'https://ux-skill.invalid/schemas/core/evaluation-input.schema.json',
 CandidateSolverInput:'https://ux-skill.invalid/schemas/core/candidate-solver-input.schema.json',
 CanonicalResponseHeaders:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/CanonicalResponseHeaders',
 HeaderItem:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/HeaderItem',
 ReplayProfile:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/ReplayProfile',
 RedirectHop:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/RedirectHop',
 NetworkRecord:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/NetworkRecord',
 ObservationRecord:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json#/$defs/ObservationRecord',
 SnapshotClosureManifest:'https://ux-skill.invalid/schemas/core/snapshot-closure.schema.json',
 AstNode:'https://ux-skill.invalid/schemas/evaluator/rule.schema.json#/$defs/AstNode',
 Rule:'https://ux-skill.invalid/schemas/evaluator/rule.schema.json',
 AuthorityBundle:'https://ux-skill.invalid/schemas/core/authority.schema.json',
 ClaimsBundle:'https://ux-skill.invalid/schemas/core/claims.schema.json',
 EvaluationOutput:'https://ux-skill.invalid/schemas/evaluator/output.schema.json',
 SemanticProjection:'https://ux-skill.invalid/schemas/evaluator/semantic-projection.schema.json',
 HulianComponentDocV1:'https://ux-skill.invalid/schemas/adapters/hulian-component-doc-v1.schema.json',
 HulianEvaluationRequestV1:'https://ux-skill.invalid/schemas/adapters/hulian-evaluation-request-v1.schema.json',
 RealWorldRegressionCase:'https://ux-skill.invalid/schemas/core/real-world-case.schema.json'
});
const pointerToken=(value)=>String(value).replaceAll('~','~0').replaceAll('/','~1');
const params=(value)=>jcsBytes(value).toString('utf8');
const normalizedError=(stage,code,instance_pointer,invariant_or_schema_id,details={})=>({stage,code,instance_pointer,invariant_or_schema_id,params_jcs:params(details)});
const errorKey=(row)=>[row.stage,row.code,row.instance_pointer,row.invariant_or_schema_id,row.params_jcs];
const sortedErrors=(errors)=>canonicalSet(errors,errorKey);
const isPlainObject=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const defensiveCopy=(value)=>structuredClone(value);

const nfcErrors=(value,pointer='',out=[])=>{
 if(typeof value==='string'){if(value.normalize('NFC')!==value)out.push(normalizedError('nfc','UNICODE_NOT_NFC',pointer,'IJSON-NFC-v1'));return out;}
 if(!value||typeof value!=='object')return out;
 if(Array.isArray(value)){value.forEach((item,index)=>nfcErrors(item,`${pointer}/${index}`,out));return out;}
 for(const [key,child] of Object.entries(value)){
  const childPointer=`${pointer}/${pointerToken(key)}`;
  if(key.normalize('NFC')!==key)out.push(normalizedError('nfc','UNICODE_NOT_NFC',childPointer,'IJSON-NFC-v1'));
  nfcErrors(child,childPointer,out);
 }
 return out;
};

const keywordCode=(raw)=>{
 if(raw.keyword==='required')return 'REQUIRED_MISSING';
 if(raw.keyword==='additionalProperties')return 'ADDITIONAL_PROPERTY';
 if(raw.keyword==='type')return 'TYPE_MISMATCH';
 if(raw.keyword==='enum'||raw.keyword==='const')return 'ENUM_MISMATCH';
 if(raw.keyword==='format')return raw.params.format==='canonical-relative-path'?'PATH_INVALID':'FORMAT_INVALID';
 if(['pattern','minimum','maximum','exclusiveMinimum','minLength','minItems','maxItems','contentEncoding'].includes(raw.keyword))return 'FORMAT_INVALID';
 return 'INVARIANT_SCHEMA_DIAGNOSTIC';
};
const normalizeAjvErrors=(schemaId,rawErrors)=>{
 const grouped=new Map();
 for(const raw of rawErrors){
  if(raw.keyword==='anyOf'||raw.keyword==='oneOf')continue;
  let pointer=raw.instancePath||'';
  const code=keywordCode(raw);
  let details;
  if(raw.keyword==='required'){
   pointer+=`/${pointerToken(raw.params.missingProperty)}`;
   details={missingProperty:raw.params.missingProperty};
  }else if(raw.keyword==='additionalProperties'){
   pointer+=`/${pointerToken(raw.params.additionalProperty)}`;
   details={additionalProperty:raw.params.additionalProperty};
  }else if(raw.keyword==='type')details={expected:raw.params.type};
  else if(raw.keyword==='enum')details={allowed:raw.params.allowedValues};
  else if(raw.keyword==='const')details={allowed:[raw.params.allowedValue]};
  else if(raw.keyword==='format')details={format:raw.params.format};
  else if(code==='FORMAT_INVALID')details={constraint:raw.keyword};
  else details={keyword:raw.keyword};
  const groupKey=params([pointer,code]);
  const current=grouped.get(groupKey);
  if(!current){grouped.set(groupKey,{pointer,code,details,expectedTypes:raw.keyword==='type'?[raw.params.type]:[]});continue;}
  if(raw.keyword==='type'&&!current.expectedTypes.includes(raw.params.type))current.expectedTypes.push(raw.params.type);
 }
 const out=[];
 for(const row of grouped.values()){
  if(row.expectedTypes.length>1)row.details={expected:row.expectedTypes};
  out.push(normalizedError('schema',row.code,row.pointer,schemaId,row.details));
 }
 return out;
};

const assessedPredicateConfig=Object.freeze({
 ClaimsBundle:{definition:'AssessedPredicate',outer:'status'},
 EvaluationOutput:{definition:'AssessedPredicate',outer:'admissible_conclusion'},
 SemanticProjection:{definition:'AssessedPredicate',outer:'admissible_conclusion'}
});
const predicateSchemas=new Map();
for(const [schemaId,config] of Object.entries(assessedPredicateConfig)){
 const owner=schemas.find((schema)=>schema.$id===schemaIds[schemaId]);
 const branches=owner.$defs[config.definition].oneOf;
 predicateSchemas.set(schemaId,new Map(branches.map((branch,index)=>[
  branch.properties.relation_kind.const,
  ajv.compile({$ref:`${owner.$id}#/$defs/${config.definition}/oneOf/${index}`})
 ])));
}
const predicatePlaceholder=(kind)=>{
 const value={relation_kind:kind,subject_id:'subject',value:'value',context_id:'context',time_scope_id:'time'};
 if(['normative','causal','associational','predictive','reported_experience','observed_signal'].includes(kind)){value.predicate_id='predicate';value.population_id='population';}
 if(kind==='causal'){value.intervention_id='intervention';value.counterfactual_id='counterfactual';value.effect_estimand_id='estimand';}
 if(kind==='predictive')value.future_target_id='future-target';
 return value;
};
const assessedPredicateErrors=(schemaId,value,candidate)=>{
 const config=assessedPredicateConfig[schemaId],validators=predicateSchemas.get(schemaId),out=[];
 if(!config||!isPlainObject(value)||!Array.isArray(value.claim_assessments))return out;
 value.claim_assessments.forEach((assessment,index)=>{
  if(!isPlainObject(assessment)||!Object.hasOwn(assessment,'assessed_predicate'))return;
  const pointer=`/claim_assessments/${index}/assessed_predicate`,outer=assessment[config.outer],predicate=assessment.assessed_predicate;
  if(outer==='unresolved'){
   if(predicate!==null)out.push(normalizedError('schema','TYPE_MISMATCH',pointer,schemaId,{expected:'null'}));
   if(isPlainObject(candidate.claim_assessments?.[index]))candidate.claim_assessments[index].assessed_predicate=null;
   return;
  }
  if(!validators.has(outer))return;
  if(!isPlainObject(predicate)){
   out.push(normalizedError('schema','TYPE_MISMATCH',pointer,schemaId,{expected:'object'}));
   candidate.claim_assessments[index].assessed_predicate=predicatePlaceholder(outer);
   return;
  }
  if(!Object.hasOwn(predicate,'relation_kind')){
   out.push(normalizedError('schema','REQUIRED_MISSING',`${pointer}/relation_kind`,schemaId,{missingProperty:'relation_kind'}));
   candidate.claim_assessments[index].assessed_predicate=predicatePlaceholder(outer);
   return;
  }
  const relation=predicate.relation_kind,selected=validators.get(relation);
  if(!selected){
   out.push(normalizedError('schema','ENUM_MISMATCH',`${pointer}/relation_kind`,schemaId,{allowed:[...validators.keys()]}));
   candidate.claim_assessments[index].assessed_predicate=predicatePlaceholder(outer);
   return;
  }
  selected(defensiveCopy(predicate));
  out.push(...normalizeAjvErrors(schemaId,(selected.errors||[]).map((raw)=>({...raw,instancePath:`${pointer}${raw.instancePath||''}`}))));
  if(relation!==outer)out.push(normalizedError('schema','ENUM_MISMATCH',`${pointer}/relation_kind`,schemaId,{allowed:[outer]}));
  candidate.claim_assessments[index].assessed_predicate=predicatePlaceholder(outer);
 });
 return out;
};
const ruleEvaluationSchemaIds=new Set(['EvaluationOutput','SemanticProjection']);
const ruleEvaluationValidators=new Map();
for(const schemaId of ruleEvaluationSchemaIds){
 const owner=schemas.find((schema)=>schema.$id===schemaIds[schemaId]),branches=owner.$defs.RuleEvaluation.oneOf;
 ruleEvaluationValidators.set(schemaId,new Map(branches.map((branch,index)=>[
  branch.properties.terminal.const+'|'+branch.properties.outcome.const,
  ajv.compile({$ref:`${owner.$id}#/$defs/RuleEvaluation/oneOf/${index}`})
 ])));
}
const placeholderRuleEvaluation={rule_id:'validation-placeholder',rule_version:'1.0.0',release_critical:false,finding_type:'usability',terminal:'completed',outcome:'pass',reason_code:'CHECK_PASS',trace:[],dependency_trace:[],run_issue:null};
const ruleEvaluationErrors=(schemaId,value,candidate)=>{
 const out=[],validators=ruleEvaluationValidators.get(schemaId);
 if(!validators||!isPlainObject(value)||!Array.isArray(value.rule_evaluations))return out;
 value.rule_evaluations.forEach((evaluation,index)=>{
  const pointer=`/rule_evaluations/${index}`;
  if(!isPlainObject(evaluation)){out.push(normalizedError('schema','TYPE_MISMATCH',pointer,schemaId,{expected:'object'}));candidate.rule_evaluations[index]=placeholderRuleEvaluation;return;}
  for(const field of ['terminal','outcome'])if(!Object.hasOwn(evaluation,field))out.push(normalizedError('schema','REQUIRED_MISSING',`${pointer}/${field}`,schemaId,{missingProperty:field}));
  const selected=validators.get(evaluation.terminal+'|'+evaluation.outcome);
  if(selected){
   selected(defensiveCopy(evaluation));
   out.push(...normalizeAjvErrors(schemaId,(selected.errors||[]).map((raw)=>({...raw,instancePath:`${pointer}${raw.instancePath||''}`}))));
   const coherence=validateTask5DependencyEvaluation(evaluation);
   if(!coherence.ok&&!['TRACE_NOT_ARRAY','TRACE_ITEM_INVALID'].includes(coherence.reason))out.push(normalizedError('schema','INVARIANT_SCHEMA_DIAGNOSTIC',coherence.field?`${pointer}/${coherence.field}`:pointer,'Task5DependencyDecision-v1',{reason:coherence.reason}));
  }
  else if(Object.hasOwn(evaluation,'terminal')&&Object.hasOwn(evaluation,'outcome')){
   const allowed=[...validators.keys()].filter((key)=>key.startsWith(evaluation.terminal+'|')).map((key)=>key.split('|')[1]);
   out.push(normalizedError('schema','ENUM_MISMATCH',`${pointer}/outcome`,schemaId,{allowed}));
  }
  candidate.rule_evaluations[index]=placeholderRuleEvaluation;
 });
 return out;
};

const ruleSchema=schemas.find((schema)=>schema.$id==='https://ux-skill.invalid/schemas/evaluator/rule.schema.json');
const astBranchValidators=new Map(ruleSchema.$defs.AstNode.oneOf.map((branch,index)=>[
 branch.properties.op.const,
 ajv.compile({$ref:`${ruleSchema.$id}#/$defs/AstNode/oneOf/${index}`})
]));
const placeholderAst={node_id:'validation-placeholder',op:'literal',value:true};
const astNodeErrors=(node,pointer='')=>{
 if(!isPlainObject(node))return[normalizedError('schema','TYPE_MISMATCH',pointer,'AstNode',{expected:'object'})];
 if(!Object.hasOwn(node,'op'))return[normalizedError('schema','AST_OP_REQUIRED',`${pointer}/op`,'AST-v1',{missingProperty:'op'})];
 const validate=astBranchValidators.get(node.op);
 if(!validate)return[normalizedError('schema','AST_OP_UNKNOWN',`${pointer}/op`,'AST-v1',{op:node.op})];
 const candidate=defensiveCopy(node),nested=[];
 if((node.op==='all'||node.op==='any')&&Array.isArray(node.children)){
  node.children.forEach((child,index)=>nested.push(...astNodeErrors(child,`${pointer}/children/${index}`)));
  candidate.children=node.children.map(()=>placeholderAst);
 }
 if(node.op==='not'&&Object.hasOwn(node,'child')){
  nested.push(...astNodeErrors(node.child,`${pointer}/child`));
  candidate.child=placeholderAst;
 }
 validate(candidate);
 const branchRows=normalizeAjvErrors('AstNode',(validate.errors||[]).map((raw)=>({...raw,instancePath:`${pointer}${raw.instancePath||''}`})));
 return[...branchRows,...nested];
};
const ruleAstFields=['applicability','exclusion','precondition','check'];

const schemaErrors=(schemaId,value)=>{
 if(!Object.hasOwn(schemaIds,schemaId))return[normalizedError('schema','INVARIANT_SCHEMA_ID_UNKNOWN','','SchemaRegistry-v1',{schema_id:schemaId})];
 if(schemaId==='AstNode')return astNodeErrors(value);
 const validate=ajv.getSchema(schemaIds[schemaId]);
 if(!validate)return[normalizedError('schema','INVARIANT_SCHEMA_ID_UNKNOWN','','SchemaRegistry-v1',{schema_id:schemaId})];
 let candidate=value,tagged=[];
 if((Object.hasOwn(assessedPredicateConfig,schemaId)||ruleEvaluationSchemaIds.has(schemaId))&&isPlainObject(value))candidate=defensiveCopy(value);
 if(Object.hasOwn(assessedPredicateConfig,schemaId)&&isPlainObject(value))tagged.push(...assessedPredicateErrors(schemaId,value,candidate));
 if(ruleEvaluationSchemaIds.has(schemaId)&&isPlainObject(value))tagged.push(...ruleEvaluationErrors(schemaId,value,candidate));
 if(schemaId==='Rule'&&isPlainObject(value)){
  candidate=defensiveCopy(value);
  for(const field of ruleAstFields)if(Object.hasOwn(value,field)){
   tagged.push(...astNodeErrors(value[field],`/${field}`));
   candidate[field]=placeholderAst;
  }
 }
 validate(candidate);
 return [...normalizeAjvErrors(schemaId,validate.errors||[]),...tagged];
};

const schemaErrorAt=(schemaRows,pointer)=>schemaRows.some((row)=>row.stage==='schema'&&(row.instance_pointer===pointer||row.instance_pointer.startsWith(`${pointer}/`)));
const collectionInvariant=(schemaId)=>schemaId==='EvaluationOutput'||schemaId==='SemanticProjection'?'OutputCollectionRegistry-v1':'InputCollectionRegistry-v1';
const normalizeSet=(owner,field,keyOf,keyPointer,pathPrefix,invariant,out)=>{
 const items=owner?.[field];
 if(!Array.isArray(items))return;
 const seen=new Map();let conflict=false,unusableKey=false;
 items.forEach((item,index)=>{
  let key;
  try{key=keyOf(item);}catch{unusableKey=true;return;}
  if(key===undefined){unusableKey=true;return;}
  let keyBytes,itemBytes;
  try{keyBytes=params(key);itemBytes=params(item);}catch{unusableKey=true;return;}
  if(seen.has(keyBytes)&&seen.get(keyBytes)!==itemBytes){
   const suffix=keyPointer?`/${pointerToken(keyPointer)}`:'';
   out.push(normalizedError('collections','DUPLICATE_ID_CONFLICT',`${pathPrefix}/${index}${suffix}`,invariant,{key}));
   conflict=true;
  }else if(!seen.has(keyBytes))seen.set(keyBytes,itemBytes);
 });
 if(!conflict&&!unusableKey)owner[field]=canonicalSet(items,keyOf);
};
const normalizeSequence=(items,pathPrefix,invariant,out)=>{
 if(!Array.isArray(items))return;
 items.forEach((item,index)=>{if(isPlainObject(item)&&Number.isInteger(item.sequence)&&item.sequence!==index)out.push(normalizedError('collections','INVARIANT_SEQUENCE_CONTIGUOUS',`${pathPrefix}/${index}/sequence`,invariant,{actual:item.sequence,expected:index}));});
};
const inputReferenceRelations=Object.freeze([
 {
  check(value,schemaRows,out){
   const sourceInvalid=schemaErrorAt(schemaRows,'/scenario_profile_id');
   const targetInvalid=schemaErrorAt(schemaRows,'/scenario_profiles')||!Array.isArray(value.scenario_profiles);
   if(sourceInvalid||targetInvalid)out.push(normalizedError('collections','SUPPRESSED_BY_STAGE','/scenario_profile_id','ScenarioProfileRef-v1',{prerequisite_stage:'schema'}));
   else if(typeof value.scenario_profile_id==='string'&&!value.scenario_profiles.some((row)=>row?.scenario_profile_id===value.scenario_profile_id))out.push(normalizedError('collections','REF_MISSING','/scenario_profile_id','ScenarioProfileRef-v1',{ref:value.scenario_profile_id}));
 }
 },
 {
  check(value,schemaRows,out){
   if(!Array.isArray(value.evidence))return;
   const targetInvalid=schemaErrorAt(schemaRows,'/source_registry_refs')||!Array.isArray(value.source_registry_refs);
   const sourceIds=targetInvalid?new Set():new Set(value.source_registry_refs);
   value.evidence.forEach((artifact,index)=>{
    if(!isPlainObject(artifact))return;
    const sourcePointer=`/evidence/${index}/source_ref`;
    const sourceInvalid=schemaErrorAt(schemaRows,sourcePointer)||typeof artifact.source_ref!=='string';
    if(sourceInvalid||targetInvalid)out.push(normalizedError('collections','SUPPRESSED_BY_STAGE',sourcePointer,'SourceRegistryRef-v1',{prerequisite_stage:'schema'}));
    else if(!sourceIds.has(artifact.source_ref))out.push(normalizedError('collections','REF_MISSING',sourcePointer,'SourceRegistryRef-v1',{ref:artifact.source_ref}));
   });
  }
 },
 {
  check(value,schemaRows,out){
   if(!Array.isArray(value.claims))return;
   const targetInvalid=schemaErrorAt(schemaRows,'/evidence')||!Array.isArray(value.evidence);
   const evidenceIds=targetInvalid?new Set():new Set(value.evidence.map((row)=>row?.evidence_id));
   value.claims.forEach((claim,claimIndex)=>{
    if(!isPlainObject(claim))return;
    const sourcePointer=`/claims/${claimIndex}/evidence_refs`;
    const sourceInvalid=schemaErrorAt(schemaRows,sourcePointer)||!Array.isArray(claim.evidence_refs);
    if(sourceInvalid||targetInvalid){
     const invalidItems=Array.isArray(claim.evidence_refs)?claim.evidence_refs.map((_,index)=>`${sourcePointer}/${index}`).filter((pointer)=>schemaErrorAt(schemaRows,pointer)):[];
     for(const pointer of invalidItems.length?invalidItems:[sourcePointer])out.push(normalizedError('collections','SUPPRESSED_BY_STAGE',pointer,'EvidenceRef-v1',{prerequisite_stage:'schema'}));
     return;
    }
    claim.evidence_refs.forEach((refValue,refIndex)=>{if(!evidenceIds.has(refValue))out.push(normalizedError('collections','REF_MISSING',`${sourcePointer}/${refIndex}`,'EvidenceRef-v1',{ref:refValue}));});
   });
  }
 }
]);
const normalizeEvaluationInput=(value,schemaRows,out)=>{
 if(!isPlainObject(value))return;
 const invariant='InputCollectionRegistry-v1';
 for(const [field,key] of [['scenario_profiles','scenario_profile_id'],['candidate_universe','solution_id'],['journeys','journey_id'],['evidence','evidence_id'],['studies','study_id'],['claims','claim_id'],['adapter_evidence','adapter_evidence_id']])normalizeSet(value,field,(row)=>isPlainObject(row)?row[key]:undefined,key,`/${field}`,invariant,out);
 normalizeSet(value,'source_registry_refs',(item)=>item,null,'/source_registry_refs',invariant,out);
 if(Array.isArray(value.candidate_universe))value.candidate_universe.forEach((row,index)=>{if(isPlainObject(row))normalizeSet(row,'option_ids',(item)=>item,null,`/candidate_universe/${index}/option_ids`,invariant,out);});
 if(Array.isArray(value.claims))value.claims.forEach((row,index)=>{if(isPlainObject(row)&&!schemaErrorAt(schemaRows,`/claims/${index}/evidence_refs`))normalizeSet(row,'evidence_refs',(item)=>item,null,`/claims/${index}/evidence_refs`,invariant,out);});
 const targetKind=value.target_snapshot?.target_kind;if(!schemaErrorAt(schemaRows,'/target_snapshot/target_kind')&&!schemaErrorAt(schemaRows,'/snapshot_closure_result')&&targetKind!=='black_box_site'&&value.snapshot_closure_result!==null)out.push(normalizedError('collections','INVARIANT_SNAPSHOT_CLOSURE_TARGET_KIND','/snapshot_closure_result','SnapshotClosureTargetBinding-v1',{target_kind:targetKind}));
 for(const relation of inputReferenceRelations)relation.check(value,schemaRows,out);
};
const normalizeSnapshot=(schemaId,value,out)=>{
 if(!isPlainObject(value))return;
 const invariant='InputCollectionRegistry-v1';
 if(schemaId==='CanonicalResponseHeaders'){normalizeSequence(value.headers,'/headers',invariant,out);return;}
 if(schemaId==='NetworkRecord'){normalizeSequence(value.redirect_chain,'/redirect_chain',invariant,out);return;}
 if(schemaId==='SnapshotClosureManifest'){
  normalizeSet(value,'replay_profiles',(row)=>row?.replay_profile_id,'replay_profile_id','/replay_profiles',invariant,out);
  normalizeSet(value,'network_records',(row)=>isPlainObject(row)?[row.replay_profile_id,row.sequence]:undefined,null,'/network_records',invariant,out);
  normalizeSet(value,'observation_records',(row)=>isPlainObject(row)?[row.replay_profile_id,row.task_step_id,row.evidence_kind,row.ordinal]:undefined,null,'/observation_records',invariant,out);
  if(Array.isArray(value.network_records))value.network_records.forEach((row,index)=>normalizeSequence(row?.redirect_chain,`/network_records/${index}/redirect_chain`,invariant,out));
 }
};
const normalizeOutput=(value,invariant,out)=>{
 if(!isPlainObject(value))return;
 const entries=[['rule_evaluations',(row)=>row?.rule_id,'rule_id'],['findings',(row)=>row?.fingerprint??row,'finding_id'],['run_issues',(row)=>isPlainObject(row)?[row.code,row.instance_pointer,row.dependency_id]:undefined,null],['claim_assessments',(row)=>row?.claim_assessment_id,'claim_assessment_id'],['risk_assessments',(row)=>row?.risk_assessment_id,'risk_assessment_id'],['recommendation_assessments',(row)=>row?.recommendation_assessment_id,'recommendation_assessment_id'],['alternatives',(row)=>row?.alternative_id,'alternative_id'],['solutions',(row)=>row?.solution_id,'solution_id'],['unsat_cores',(row)=>row?.constraint_ids??row,null],['resolution_traces',(row)=>row?.resolution_trace_id,'resolution_trace_id'],['coverage_gaps',(row)=>row?.coverage_gap_id,'coverage_gap_id']];
 for(const [field,keyOf,keyPointer] of entries)normalizeSet(value,field,keyOf,keyPointer,`/${field}`,invariant,out);
 if(Array.isArray(value.resolution_traces))value.resolution_traces.forEach((trace,index)=>{normalizeSequence(trace?.nodes,`/resolution_traces/${index}/nodes`,invariant,out);normalizeSequence(trace?.steps,`/resolution_traces/${index}/steps`,invariant,out);});
};
const normalizeGenericBundle=(schemaId,value,out)=>{
 if(!isPlainObject(value))return;
 const invariant=collectionInvariant(schemaId);
 const tables={
  AuthorityBundle:[['authority_roots','authority_root_id'],['grants','grant_id'],['control_principal_edges','control_edge_id'],['party_graph_proofs','proof_id'],['party_inventories','party_inventory_id'],['authorization_decisions','authorization_decision_id'],['execution_envelopes','envelope_id'],['time_authority_policies','time_authority_policy_id'],['capabilities','capability_id'],['capability_ledger_entries','capability_digest'],['invalidations','invalidation_id'],['execution_leases','execution_lease_id'],['external_effect_connectors','connector_id']],
  ClaimsBundle:[['sources','source_id'],['fragments','fragment_id'],['proposition_assessments','assessment_id'],['policy_adoptions','adoption_id'],['claims','claim_id'],['claim_assessments','claim_assessment_id'],['claim_assessment_policies','policy_id']],
  RealWorldRegressionCase:[['hypotheses','hypothesis_id'],['measures','measure_id'],['negative_controls','control_id']]
 };
 for(const [field,key] of tables[schemaId]||[])normalizeSet(value,field,(row)=>row?.[key],key,`/${field}`,invariant,out);
 if(schemaId==='AuthorityBundle'){normalizeSequence(value.acting_edges,'/acting_edges',invariant,out);normalizeSequence(value.approval_decisions,'/approval_decisions',invariant,out);}
};
const collectionStage=(schemaId,value,schemaRows)=>{
 const normalized=defensiveCopy(value),out=[];
 if(schemaId==='EvaluationInputBundle')normalizeEvaluationInput(normalized,schemaRows,out);
 if(['CanonicalResponseHeaders','NetworkRecord','SnapshotClosureManifest'].includes(schemaId))normalizeSnapshot(schemaId,normalized,out);
 if(schemaId==='EvaluationOutput'||schemaId==='SemanticProjection')normalizeOutput(normalized,'OutputCollectionRegistry-v1',out);
 normalizeGenericBundle(schemaId,normalized,out);
 return{value:normalized,errors:out};
};

export const validateBySchema=(schemaId,value)=>{
 try{assertIJson(value);}catch(cause){const code=typeof cause.code==='string'&&cause.code.startsWith('IJSON_')?cause.code:'IJSON_NON_JSON_VALUE';return{ok:false,errors:[normalizedError('parse',code,'','IJSON-v1')]};}
 const nfc=sortedErrors(nfcErrors(value));
 if(nfc.length)return{ok:false,errors:nfc};
 const schemaRows=sortedErrors(schemaErrors(schemaId,value));
 if(!Object.hasOwn(schemaIds,schemaId))return{ok:false,errors:schemaRows};
 const collections=collectionStage(schemaId,value,schemaRows);
 const errors=sortedErrors([...schemaRows,...collections.errors]);
 return errors.length?{ok:false,errors}:{ok:true,value:collections.value};
};
export const validateInput=(value)=>validateBySchema('EvaluationInputBundle',value);
