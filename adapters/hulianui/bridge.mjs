import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {evaluate} from '../../evaluator/index.mjs';
import {jcsBytes} from '../../evaluator/canonical.mjs';
import {validateBySchema} from '../../evaluator/validation.mjs';
import {mapHulianComponentDoc} from './adapter.mjs';

const CONTRACT=JSON.parse(readFileSync(new URL('./contract.json',import.meta.url),'utf8'));
const invalidRequest=(errors)=>{
 const codes=errors.map((row)=>row.code).join(',');
 const error=new TypeError('INVALID_HULIAN_REQUEST:'+codes);
 error.code='INVALID_HULIAN_REQUEST';error.errors=errors;return error;
};
const adapterEvidence=(canonicalEvidence)=>({
 adapter_evidence_id:CONTRACT.adapter_contract_id,
 adapter_contract_id:CONTRACT.adapter_contract_id,
 artifact_digest:createHash('sha256').update(jcsBytes(canonicalEvidence)).digest('hex')
});

export async function evaluateHulianMcpResult(bundleBase,toolResult){
 if(arguments.length!==2)throw invalidRequest([{stage:'schema',code:'REQUIRED_MISSING',instance_pointer:'',invariant_or_schema_id:'HulianEvaluationRequestV1',params_jcs:'{}'}]);
 const checked=validateBySchema('HulianEvaluationRequestV1',bundleBase);
 if(!checked.ok)throw invalidRequest(checked.errors);
 const canonicalEvidence=mapHulianComponentDoc(toolResult,CONTRACT);
 const member=adapterEvidence(canonicalEvidence);
 const result=await evaluate({...checked.value,adapter_evidence:[member]});
 return{
  ...result,
  audit_sidecar:{
   ...result.audit_sidecar,
   transport:{kind:'hulianui-mcp-bridge',request_mode:checked.value.request_mode,adapter_evidence_count:1,adapter_artifact_digest:member.artifact_digest}
  }
 };
}
