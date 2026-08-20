import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { canonicalize } from 'json-canonicalize';
import { evaluate } from '../../evaluator/index.mjs';
import { replayClosure, snapshotClosureDigest } from '../../scripts/capture-snapshot-closure.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const domainSha = (domain, value) => createHash('sha256').update(domain).update(jcs(value)).digest('hex');
const jcs = (value) => Buffer.from(canonicalize(value), 'utf8');
const clone = (value) => structuredClone(value);
const closureIssue = Object.freeze({
  code: 'RULE_EVALUATION_ERROR',
  instance_pointer: '/snapshot_closure',
  dependency_id: null,
});

const serializeReplay = (replay) => ({
  run_status: replay.run_status,
  run_issues: clone(replay.run_issues),
  release_gate: replay.release_gate,
  live_network_events: replay.live_network_events,
  responses: replay.responses.map(({ body, ...row }) => ({
    ...clone(row),
    body_bytes_base64: body === null ? null : Buffer.from(body).toString('base64'),
  })),
  observations: replay.observations.map(({ bytes, ...row }) => ({
    ...clone(row),
    artifact_bytes_base64: Buffer.from(bytes).toString('base64'),
  })),
});

const sourceIdentity = (bundle, closure) => ({
  target_snapshot_id: bundle.target_snapshot.target_snapshot_id,
  target_kind: 'black_box_site',
  canonical_locator: bundle.target_snapshot.canonical_locator,
  entry_url: closure?.entry_url ?? null,
  snapshot_digest: closure?.manifest_digest ?? null,
});

const buildCompleteTask9Result = async (bundle) => {
  const profile = {
    replay_profile_id: 'task10-black-box-profile',
    viewport_width_css_px: 1280,
    viewport_height_css_px: 720,
    device_scale_factor: 1,
    input_modality: 'keyboard',
    prefers_reduced_motion: 'no-preference',
    prefers_contrast: 'no-preference',
    color_scheme: 'light',
    locale: 'en',
    timezone: 'UTC',
    assistive_technology_id: 'none',
    browser_engine_digest: sha(Buffer.from('task10-browser-engine')),
  };
  const taskScript = {
    task_script_id: 'task10-black-box-task-v1',
    steps: [{
      step_id: 'visit',
      required_replay_profile_ids: [profile.replay_profile_id],
      instruction: 'Replay the registered read-only page.',
    }],
  };
  const taskBytes = jcs(taskScript);
  const taskDigest = sha(taskBytes);
  const headers = {
    headers: [{
      sequence: 0,
      name_lower_ascii: 'content-type',
      value_bytes_base64: Buffer.from('text/html; charset=utf-8').toString('base64'),
    }],
  };
  const headerBytes = jcs(headers);
  const bodyBytes = Buffer.from('<!doctype html><title>Task 10 closure</title>', 'utf8');
  const observationBytes = Buffer.from('task10-observation-bytes', 'utf8');
  const headerDigest = sha(headerBytes);
  const bodyDigest = sha(bodyBytes);
  const observationDigest = sha(observationBytes);
  const artifactRows = [
    [taskDigest, taskBytes],
    [headerDigest, headerBytes],
    [bodyDigest, bodyBytes],
    [observationDigest, observationBytes],
  ].map(([digest, bytes]) => ({
    locator: 'cas/' + digest,
    digest,
    bytes_base64: bytes.toString('base64'),
  })).sort((left, right) => Buffer.compare(Buffer.from(left.locator), Buffer.from(right.locator)));

  const closure = {
    closure_version: 'snapshot-closure-v1',
    entry_url: 'https://example.test/task10',
    task_script_digest: taskDigest,
    capture_environment_digest: sha(Buffer.from('task10-capture-environment')),
    captured_at: '2026-08-20T00:00:00.000Z',
    authenticated: false,
    replay_profiles: [profile],
    network_records: [{
      replay_profile_id: profile.replay_profile_id,
      sequence: 0,
      task_step_id: 'visit',
      request_method: 'GET',
      request_url: 'https://example.test/task10',
      redirect_chain: [],
      final_url: 'https://example.test/task10',
      network_kind: 'document',
      disposition: 'captured',
      response_status: 200,
      header_digest: headerDigest,
      content_addressed_header_artifact_locator: 'cas/' + headerDigest,
      raw_body_digest: bodyDigest,
      content_addressed_body_artifact_locator: 'cas/' + bodyDigest,
    }],
    observation_records: [{
      replay_profile_id: profile.replay_profile_id,
      task_step_id: 'visit',
      evidence_kind: 'dom_snapshot',
      ordinal: 0,
      artifact_digest: observationDigest,
      content_addressed_artifact_locator: 'cas/' + observationDigest,
    }],
    outbound_effect_ledger_digest: sha(jcs([])),
    completeness_status: 'complete',
    manifest_digest: '',
  };
  closure.manifest_digest = snapshotClosureDigest(closure);
  bundle.target_snapshot.snapshot_digest = closure.manifest_digest;

  const artifactMap = new Map(artifactRows.map((row) => [
    row.locator,
    Buffer.from(row.bytes_base64, 'base64'),
  ]));
  const replay = await replayClosure(closure, {
    async get(locator) {
      return artifactMap.get(locator) ?? null;
    },
  });
  return {
    closure,
    closure_bytes_base64: jcs(closure).toString('base64'),
    cas_artifacts: artifactRows,
    source_identity: sourceIdentity(bundle, closure),
    completeness_status: 'complete',
    run_status: 'completed',
    release_gate: 'no_release',
    run_issues: [],
    replay_evidence: serializeReplay(replay),
  };
};

const unavailableResult = (bundle) => ({
  closure: null,
  closure_bytes_base64: null,
  cas_artifacts: [],
  source_identity: sourceIdentity(bundle, null),
  completeness_status: 'incomplete',
  run_status: 'target_unavailable',
  release_gate: 'no_release',
  run_issues: [clone(closureIssue)],
  replay_evidence: null,
});

const assertNoRelease = (projection, label, issues) => {
  if (projection.release_recommendation?.status !== 'no_release') issues.push(label + ':release');
  if (projection.run_status === 'completed_clear') issues.push(label + ':clear');
  if (!projection.run_issues?.some((row) =>
    row.code === closureIssue.code
    && row.instance_pointer === closureIssue.instance_pointer
    && row.dependency_id === null
  )) issues.push(label + ':run_issue');
  if (!projection.coverage_gaps?.some((row) =>
    row.reason_code === 'SNAPSHOT_CLOSURE_UNAVAILABLE'
    && row.release_critical === true
  )) issues.push(label + ':coverage_gap');
};

test('TASK10_TASK9_PROVENANCE_RED binds real closure replay and fails closed', async () => {
  const issues = [];
  const [golden, inputSchema] = await Promise.all([
    readFile(new URL('../golden/high-risk-delete.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../schemas/core/evaluation-input.schema.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);

  for (const schema of [inputSchema, inputSchema.$defs?.EvaluationInputBundle]) {
    if (!schema?.required?.includes('snapshot_closure_result')) issues.push('schema:required-channel');
    if (!Object.hasOwn(schema?.properties ?? {}, 'snapshot_closure_result')) issues.push('schema:closed-channel');
  }

  const blackBox = clone(golden.bundle);
  blackBox.target_snapshot = {
    target_snapshot_id: 'task10-black-box-snapshot',
    target_kind: 'black_box_site',
    canonical_locator: 'public-sites/task10-example',
    snapshot_digest: '0'.repeat(64),
  };
  blackBox.research_state = {
    research_state_id: 'task10-black-box-research',
    status: 'authorized',
    authorization_ref: 'task10-read-only',
  };
  blackBox.adapter_evidence = [];
  const complete = await buildCompleteTask9Result(blackBox);

  const expectNoRelease = async (label, result) => {
    const bundle = clone(blackBox);
    if (result.closure?.manifest_digest) bundle.target_snapshot.snapshot_digest = result.closure.manifest_digest;
    bundle.snapshot_closure_result = clone(result);
    try {
      assertNoRelease((await evaluate(bundle)).semantic_projection, label, issues);
    } catch (error) {
      issues.push(label + ':rejected:' + (error?.code ?? error?.name ?? 'unknown'));
    }
  };

  await expectNoRelease('missing-closure', unavailableResult(blackBox));

  const incomplete = clone(complete);
  incomplete.closure.completeness_status = 'incomplete';
  incomplete.closure.manifest_digest = snapshotClosureDigest(incomplete.closure);
  incomplete.closure_bytes_base64 = jcs(incomplete.closure).toString('base64');
  incomplete.source_identity = sourceIdentity(blackBox, incomplete.closure);
  incomplete.completeness_status = 'incomplete';
  incomplete.run_status = 'target_unavailable';
  incomplete.run_issues = [clone(closureIssue)];
  incomplete.replay_evidence = null;
  await expectNoRelease('incomplete-closure', incomplete);

  const casMismatch = clone(complete);
  casMismatch.cas_artifacts.find((row) => row.digest === complete.closure.network_records[0].raw_body_digest).bytes_base64 =
    Buffer.from('tampered-body').toString('base64');
  await expectNoRelease('cas-mismatch', casMismatch);

  const replayMismatch = clone(complete);
  replayMismatch.replay_evidence.live_network_events = 1;
  await expectNoRelease('replay-mismatch', replayMismatch);

  const sourceMismatch = clone(complete);
  sourceMismatch.source_identity.snapshot_digest = 'f'.repeat(64);
  await expectNoRelease('source-digest-mismatch', sourceMismatch);

  const closureBytesMismatch = clone(complete);
  closureBytesMismatch.closure_bytes_base64 = Buffer.from(
    JSON.stringify(closureBytesMismatch.closure, null, 2),
    'utf8',
  ).toString('base64');
  await expectNoRelease('closure-bytes-mismatch', closureBytesMismatch);

  const completeBundle = clone(blackBox);
  completeBundle.snapshot_closure_result = clone(complete);
  try {
    const evaluated = await evaluate(completeBundle);
    const repeated = await evaluate(clone(completeBundle));
    const projection = evaluated.semantic_projection;
    const verification = projection.snapshot_closure_verification;
    if (projection.release_recommendation?.status === 'no_release') issues.push('complete:no-release');
    if (projection.run_issues?.some((row) => row.instance_pointer === '/snapshot_closure')) issues.push('complete:run-issue');
    if (projection.coverage_gaps?.some((row) => row.reason_code === 'SNAPSHOT_CLOSURE_UNAVAILABLE')) issues.push('complete:coverage-gap');
    if (!verification || verification.closure_manifest_digest !== complete.closure.manifest_digest) issues.push('complete:closure-binding');
    if (verification?.closure_bytes_digest !== sha(jcs(complete.closure))) issues.push('complete:closure-bytes-digest');
    if (verification?.source_material_digest !== sha(jcs(complete))) issues.push('complete:source-material-digest');
    if (verification?.cas_artifact_set_digest !== domainSha('ux-skill:snapshot-cas-artifacts:v1', complete.cas_artifacts)) issues.push('complete:cas-binding');
    if (verification?.replay_evidence_digest !== domainSha('ux-skill:snapshot-replay-evidence:v1', complete.replay_evidence)) issues.push('complete:replay-binding');
    if (verification?.source_identity_digest !== domainSha('ux-skill:snapshot-source-identity:v1', complete.source_identity)) issues.push('complete:source-binding');
    if (!verification?.snapshot_closure_verification_id?.startsWith('scv_')) issues.push('complete:verification-id');
    if (!jcs(projection).equals(jcs(repeated.semantic_projection)) || evaluated.semantic_digest !== repeated.semantic_digest) issues.push('complete:repeat');
  } catch (error) {
    issues.push('complete:rejected:' + (error?.code ?? error?.name ?? 'unknown'));
  }

  const absentChannel = clone(blackBox);
  delete absentChannel.snapshot_closure_result;
  try {
    await evaluate(absentChannel);
    issues.push('black-box:absent-channel-accepted');
  } catch (error) {
    if (error?.code !== 'INVALID_EVALUATION_INPUT') issues.push('black-box:absent-channel-wrong-error');
  }

  const hulian = clone(golden.non_black_box_blocked_bundle);
  hulian.snapshot_closure_result = null;
  try {
    const projection = (await evaluate(hulian)).semantic_projection;
    if (projection.run_issues?.some((row) => row.instance_pointer === '/snapshot_closure')) issues.push('hulian:surrogate-run-issue');
    if (projection.coverage_gaps?.some((row) => row.reason_code === 'SNAPSHOT_CLOSURE_UNAVAILABLE')) issues.push('hulian:surrogate-gap');
  } catch (error) {
    issues.push('hulian:null-channel-rejected:' + (error?.code ?? error?.name ?? 'unknown'));
  }

  const pinned = clone(golden.bundle);
  pinned.target_snapshot.target_kind = 'pinned_repository';
  pinned.snapshot_closure_result = null;
  try {
    const projection = (await evaluate(pinned)).semantic_projection;
    if (projection.run_issues?.some((row) => row.instance_pointer === '/snapshot_closure')) issues.push('pinned:mixed-run-issue');
  } catch (error) {
    issues.push('pinned:null-channel-rejected:' + (error?.code ?? error?.name ?? 'unknown'));
  }

  for (const [label, bundle] of [['hulian-mixed', clone(golden.bundle)], ['pinned-mixed', clone(pinned)]]) {
    bundle.snapshot_closure_result = clone(complete);
    try {
      await evaluate(bundle);
      issues.push(label + ':accepted');
    } catch (error) {
      if (error?.code !== 'INVALID_EVALUATION_INPUT') issues.push(label + ':wrong-error');
    }
  }

  assert.deepEqual(issues, []);
});


test('TASK10_REREVIEW_BLOCKERS_RED pins source authority and closes normalized errors', async () => {
  const issues = [];
  const [golden, evaluatorManifest, outputSchema] = await Promise.all([
    readFile(new URL('../golden/high-risk-delete.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../evaluator/manifest.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../schemas/evaluator/output.schema.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);

  const blackBox = clone(golden.bundle);
  blackBox.target_snapshot = {
    target_snapshot_id: 'task10-black-box-snapshot',
    target_kind: 'black_box_site',
    canonical_locator: 'public-sites/task10-example',
    snapshot_digest: '0'.repeat(64),
  };
  blackBox.research_state = {
    research_state_id: 'task10-black-box-research',
    status: 'authorized',
    authorization_ref: 'task10-read-only',
  };
  blackBox.adapter_evidence = [];
  const complete = await buildCompleteTask9Result(blackBox);
  const completeBundle = clone(blackBox);
  completeBundle.snapshot_closure_result = clone(complete);

  const expectedSource = {
    source_authority_id: 'task10-example-source-v1',
    target_snapshot_id: 'task10-black-box-snapshot',
    target_kind: 'black_box_site',
    canonical_locator: 'public-sites/task10-example',
    entry_url: 'https://example.test/task10',
    task_script_digest: '0ec48f7f3851c7e948824663e9d0f787dd74b40587eaf424663db483b63f0d4b',
    capture_environment_digest: '478b2ce5472830245aca689bc2880dab4398aeb8656c69f6c6b99c7bf18dc24c',
    allowed_snapshot_digests: ['5ba077ceb4c541a38eb64e9bd8c0579b5688cacc44a83248f84e11c2e0fb951b'],
  };
  if (complete.closure.manifest_digest !== expectedSource.allowed_snapshot_digests[0]) {
    issues.push('fixture:closure-digest-drift');
  }
  if (complete.closure.task_script_digest !== expectedSource.task_script_digest) {
    issues.push('fixture:task-script-digest-drift');
  }
  if (complete.closure.capture_environment_digest !== expectedSource.capture_environment_digest) {
    issues.push('fixture:capture-environment-digest-drift');
  }

  const registryRef = evaluatorManifest.snapshot_source_registry;
  if (
    registryRef?.path !== 'evaluator/snapshot-source-registry.json'
    || !/^[0-9a-f]{64}$/.test(registryRef?.file_digest ?? '')
  ) {
    issues.push('authority:manifest-registry-ref');
  } else {
    try {
      const registryBytes = await readFile(new URL('../../' + registryRef.path, import.meta.url));
      if (sha(registryBytes) !== registryRef.file_digest) issues.push('authority:registry-raw-digest');
      const registry = JSON.parse(registryBytes.toString('utf8'));
      if (registry.registry_version !== 'snapshot-source-registry-v1') {
        issues.push('authority:registry-version');
      }
      const registered = registry.sources?.find((row) =>
        row.source_authority_id === expectedSource.source_authority_id
      );
      if (!registered || !jcs(registered).equals(jcs(expectedSource))) {
        issues.push('authority:registered-source-row');
      }
    } catch (error) {
      issues.push('authority:registry-unreadable:' + (error?.code ?? error?.name ?? 'unknown'));
    }
  }

  try {
    const evaluated = await evaluate(clone(completeBundle));
    const projection = evaluated.semantic_projection;
    if (projection.release_recommendation?.status === 'no_release') issues.push('authority:valid-no-release');
    if (projection.run_issues?.some((row) => row.instance_pointer === '/snapshot_closure')) {
      issues.push('authority:valid-run-issue');
    }
    if (projection.evaluator_digest !== domainSha('ux-skill:evaluator:v1', evaluatorManifest)) {
      issues.push('authority:evaluator-digest');
    }
  } catch (error) {
    issues.push('authority:valid-rejected:' + (error?.code ?? error?.name ?? 'unknown'));
  }

  const relabeled = clone(completeBundle);
  relabeled.target_snapshot.target_snapshot_id = 'different-target';
  relabeled.target_snapshot.canonical_locator = 'public-sites/different-target';
  relabeled.snapshot_closure_result.source_identity.target_snapshot_id = 'different-target';
  relabeled.snapshot_closure_result.source_identity.canonical_locator = 'public-sites/different-target';
  try {
    assertNoRelease((await evaluate(relabeled)).semantic_projection, 'authority:coordinated-relabel', issues);
  } catch (error) {
    issues.push('authority:coordinated-relabel-rejected:' + (error?.code ?? error?.name ?? 'unknown'));
  }

  const unregistered = clone(completeBundle);
  const unregisteredUrl = 'https://unregistered.example.test/task10';
  unregistered.snapshot_closure_result.closure.entry_url = unregisteredUrl;
  unregistered.snapshot_closure_result.closure.network_records[0].request_url = unregisteredUrl;
  unregistered.snapshot_closure_result.closure.network_records[0].final_url = unregisteredUrl;
  unregistered.snapshot_closure_result.closure.manifest_digest =
    snapshotClosureDigest(unregistered.snapshot_closure_result.closure);
  unregistered.snapshot_closure_result.closure_bytes_base64 =
    jcs(unregistered.snapshot_closure_result.closure).toString('base64');
  unregistered.snapshot_closure_result.source_identity.entry_url = unregisteredUrl;
  unregistered.snapshot_closure_result.source_identity.snapshot_digest =
    unregistered.snapshot_closure_result.closure.manifest_digest;
  unregistered.target_snapshot.snapshot_digest =
    unregistered.snapshot_closure_result.closure.manifest_digest;
  unregistered.snapshot_closure_result.replay_evidence.responses[0].request_url = unregisteredUrl;
  unregistered.snapshot_closure_result.replay_evidence.responses[0].final_url = unregisteredUrl;
  try {
    assertNoRelease((await evaluate(unregistered)).semantic_projection, 'authority:unregistered-source', issues);
  } catch (error) {
    issues.push('authority:unregistered-source-rejected:' + (error?.code ?? error?.name ?? 'unknown'));
  }

  const mixed = clone(golden.bundle);
  mixed.snapshot_closure_result = clone(complete);
  const mixedError = [{
    stage: 'collections',
    code: 'INVARIANT_SNAPSHOT_CLOSURE_TARGET_KIND',
    instance_pointer: '/snapshot_closure_result',
    invariant_or_schema_id: 'SnapshotClosureTargetBinding-v1',
    params_jcs: '{"target_kind":"hulianui_contract"}',
  }];
  try {
    await evaluate(mixed);
    issues.push('errors:mixed-target-accepted');
  } catch (error) {
    if (
      error?.code !== 'INVALID_EVALUATION_INPUT'
      || !jcs(error.errors).equals(jcs(mixedError))
    ) {
      issues.push('errors:mixed-target-row:' + JSON.stringify(error?.errors ?? null));
    }
  }

  const policyMismatch = clone(golden.bundle);
  policyMismatch.policy_digests.decision_policy_digest = '0'.repeat(64);
  const policyError = [{
    stage: 'policy',
    code: 'INVARIANT_POLICY_DIGEST_MISMATCH',
    instance_pointer: '/policy_digests',
    invariant_or_schema_id: 'Task10PolicyDigest-v1',
    params_jcs: jcs({ expected: golden.bundle.policy_digests }).toString('utf8'),
  }];
  try {
    await evaluate(policyMismatch);
    issues.push('errors:policy-digest-accepted');
  } catch (error) {
    if (
      error?.code !== 'INVALID_EVALUATION_INPUT'
      || !jcs(error.errors).equals(jcs(policyError))
    ) {
      issues.push('errors:policy-digest-row:' + JSON.stringify(error?.errors ?? null));
    }
  }

  const normalizedError = outputSchema.$defs?.NormalizedError;
  let validateNormalizedError;
  try {
    validateNormalizedError = new Ajv2020({
      allErrors: true,
      strict: true,
      allowUnionTypes: true,
    }).compile(normalizedError);
  } catch (error) {
    issues.push('errors:schema-uncompilable:' + (error?.message ?? error?.name ?? 'unknown'));
  }
  if (validateNormalizedError) {
    const row = (code, stage = 'semantic') => ({
      stage,
      code,
      instance_pointer: '/probe',
      invariant_or_schema_id: 'Task10NormalizedErrorDomain-v1',
      params_jcs: '{}',
    });
    const exactCodes = [
      'PARSE_ERROR',
      'UNICODE_NOT_NFC',
      'REQUIRED_MISSING',
      'ADDITIONAL_PROPERTY',
      'TYPE_MISMATCH',
      'ENUM_MISMATCH',
      'FORMAT_INVALID',
      'PATH_INVALID',
      'AST_OP_REQUIRED',
      'AST_OP_UNKNOWN',
      'DUPLICATE_ID_CONFLICT',
      'REF_MISSING',
      'SUPPRESSED_BY_STAGE',
    ];
    for (const code of [...exactCodes, 'IJSON_NON_JSON_VALUE', 'INVARIANT_PROBE']) {
      if (!validateNormalizedError(row(code))) issues.push('errors:normative-code-rejected:' + code);
    }
    if (!validateNormalizedError(row('INVARIANT_POLICY_DIGEST_MISMATCH', 'policy'))) {
      issues.push('errors:policy-stage-rejected');
    }
    for (const code of [
      'TARGET_KIND_MISMATCH',
      'POLICY_DIGEST_MISMATCH',
      'UNREGISTERED_CODE',
      'IJSON',
      'INVARIANT',
    ]) {
      if (validateNormalizedError(row(code))) issues.push('errors:off-domain-code-accepted:' + code);
    }
  }

  assert.deepEqual(issues, []);
});
