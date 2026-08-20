import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalize } from 'json-canonicalize';
import { evaluate } from '../../evaluator/index.mjs';
import { replayClosure, snapshotClosureDigest } from '../../scripts/capture-snapshot-closure.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
    const projection = (await evaluate(completeBundle)).semantic_projection;
    if (projection.release_recommendation?.status === 'no_release') issues.push('complete:no-release');
    if (projection.run_issues?.some((row) => row.instance_pointer === '/snapshot_closure')) issues.push('complete:run-issue');
    if (projection.coverage_gaps?.some((row) => row.reason_code === 'SNAPSHOT_CLOSURE_UNAVAILABLE')) issues.push('complete:coverage-gap');
  } catch (error) {
    issues.push('complete:rejected:' + (error?.code ?? error?.name ?? 'unknown'));
  }

  const absentChannel = clone(blackBox);
  try {
    await evaluate(absentChannel);
    issues.push('black-box:absent-channel-accepted');
  } catch (error) {
    if (error?.code !== 'INVALID_EVALUATION_INPUT') issues.push('black-box:absent-channel-wrong-error');
  }

  const hulian = clone(golden.task9_incomplete_bundle);
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
