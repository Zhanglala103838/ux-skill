import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBySchema, validateInput } from '../../evaluator/validation.mjs';
import { fixtureWithRedirectHop } from '../helpers/fixtures.mjs';

test('headers is required and nested objects reject unknown fields', () => {
  const missing = validateBySchema('CanonicalResponseHeaders', {});
  assert.deepEqual(missing.errors.map((e) => [e.code,e.instance_pointer]), [['REQUIRED_MISSING','/headers']]);
  const extra = validateBySchema('RedirectHop', fixtureWithRedirectHop({note:'x'}));
  assert.deepEqual(extra.errors.map((e) => e.code), ['ADDITIONAL_PROPERTY']);
});

test('NFC, collection, reference, tagged-union, and suppression errors are normative', () => {
  const nfc=validateBySchema('ReplayProfile',{replay_profile_id:'e\u0301'});
  assert.deepEqual(nfc.errors.map((e)=>e.code),['UNICODE_NOT_NFC']);
  const tagged=validateBySchema('AstNode',{node_id:'n',op:'unknown'});
  assert.deepEqual(tagged.errors.map((e)=>e.code),['AST_OP_UNKNOWN']);
  const result=validateInput({scenario_profiles:[{scenario_profile_id:'a'},{scenario_profile_id:'a',note:'conflict'}],scenario_profile_id:'missing'});
  assert.deepEqual(result.errors.map((e)=>e.code),['DUPLICATE_ID_CONFLICT','REF_MISSING','SUPPRESSED_BY_STAGE']);
});
