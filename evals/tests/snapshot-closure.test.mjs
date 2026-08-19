import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateBySchema } from '../../evaluator/validation.mjs';

let closureApi;
let importFailure;
try {
  closureApi = await import('../../scripts/capture-snapshot-closure.mjs');
} catch (error) {
  importFailure = error;
}

if (importFailure) {
  test('TASK9_SNAPSHOT_CLOSURE_RED', () => {
    assert.fail(`TASK9_SNAPSHOT_CLOSURE_RED:${importFailure?.code ?? importFailure?.name ?? 'IMPORT_FAILED'}`);
  });
} else {
  const { captureClosure, replayClosure, snapshotClosureDigest } = closureApi;
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const b64 = (value) => Buffer.from(value).toString('base64');
  const d = (char) => char.repeat(64);
  const profile = (id, overrides = {}) => ({
    replay_profile_id: id,
    viewport_width_css_px: 1440,
    viewport_height_css_px: 900,
    device_scale_factor: 2,
    input_modality: 'keyboard',
    prefers_reduced_motion: 'no-preference',
    prefers_contrast: 'no-preference',
    color_scheme: 'light',
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    assistive_technology_id: 'none',
    browser_engine_digest: d('a'),
    ...overrides,
  });
  const appleProfiles = [
    profile('apple-desktop-keyboard-standard'),
    profile('apple-desktop-keyboard-reduced', { prefers_reduced_motion: 'reduce' }),
    profile('apple-mobile-touch-standard', {
      viewport_width_css_px: 390,
      viewport_height_css_px: 844,
      device_scale_factor: 3,
      input_modality: 'touch',
    }),
  ];
  const caseManifest = (profiles = appleProfiles) => ({
    case_id: 'RW-WEBSITE-APPLE-001',
    canonical_locator: 'https://www.apple.com.cn/',
    task_script: {
      task_script_id: 'apple-read-only-v1',
      steps: [{
        step_id: 'discover',
        instruction: 'find product paths without effects',
        required_replay_profile_ids: profiles.map((row) => row.replay_profile_id),
      }],
    },
  });
  const makeCas = () => {
    const rows = new Map();
    return {
      rows,
      async put(locator, bytes) {
        assert.match(locator, /^cas\/[0-9a-f]{64}$/);
        rows.set(locator, Buffer.from(bytes));
      },
      async get(locator) {
        const value = rows.get(locator);
        return value === undefined ? null : Buffer.from(value);
      },
    };
  };
  const capturePayload = (overrides = {}) => ({
    capture_environment_digest: d('b'),
    captured_at: '2026-08-18T06:03:22Z',
    authenticated: false,
    replay_profiles: structuredClone(appleProfiles),
    network_events: appleProfiles.map((row, index) => ({
      replay_profile_id: row.replay_profile_id,
      sequence: 0,
      task_step_id: 'discover',
      request_method: 'GET',
      request_url: 'https://www.apple.com.cn/',
      redirect_chain: [],
      final_url: 'https://www.apple.com.cn/',
      network_kind: 'document',
      disposition: 'captured',
      response_status: 200,
      response_headers: [
        { sequence: 0, name: 'Content-Security-Policy', value_bytes_base64: b64("script-src 'none'") },
        { sequence: 1, name: 'Content-Language', value_bytes_base64: b64('zh-CN') },
      ],
      raw_body_bytes_base64: b64(`<html data-profile="${index}"></html>`),
    })),
    observation_events: appleProfiles.map((row) => ({
      replay_profile_id: row.replay_profile_id,
      task_step_id: 'discover',
      evidence_kind: 'dom_snapshot',
      ordinal: 0,
      artifact_bytes_base64: b64(`<main>${row.replay_profile_id}</main>`),
    })),
    outbound_effects: [],
    transport_events: [],
    live_replay: false,
    ...overrides,
  });
  const browser = (cas, payload) => ({
    cas,
    async capture() {
      return structuredClone(payload);
    },
  });
  const capture = async (payload = capturePayload()) => {
    const cas = makeCas();
    const manifest = await captureClosure(caseManifest(), browser(cas, payload));
    return { manifest, cas };
  };
  const assertUnavailable = async (manifest, cas, mutation) => {
    const next = structuredClone(manifest);
    await mutation(next, cas);
    await assert.rejects(
      () => replayClosure(next, cas),
      (error) => error?.code === 'TARGET_UNAVAILABLE'
        && error?.result?.run_status === 'target_unavailable'
        && error?.result?.release_gate === 'no_release'
        && error?.result?.run_issues?.length === 1,
    );
  };

  test('capture stores exact header/body/observation bytes and replay never uses live network', async () => {
    const { manifest, cas } = await capture();
    assert.equal(manifest.completeness_status, 'complete');
    assert.equal(manifest.authenticated, false);
    assert.deepEqual(manifest.replay_profiles, [...appleProfiles].sort((a, b) => Buffer.compare(Buffer.from(JSON.stringify(a.replay_profile_id)), Buffer.from(JSON.stringify(b.replay_profile_id)))));
    assert.deepEqual(
      manifest.network_records.map((row) => [row.replay_profile_id, row.sequence]),
      appleProfiles.map((row) => [row.replay_profile_id, 0]).sort((a, b) => Buffer.compare(Buffer.from(JSON.stringify(a)), Buffer.from(JSON.stringify(b)))),
    );
    const record = manifest.network_records.find((row) => row.replay_profile_id === 'apple-desktop-keyboard-standard');
    const headerBytes = await cas.get(record.content_addressed_header_artifact_locator);
    assert.equal(sha(headerBytes), record.header_digest);
    const headers = JSON.parse(headerBytes);
    assert.deepEqual(headers.headers.map((row) => row.name_lower_ascii), ['content-security-policy', 'content-language']);
    assert.equal(Buffer.from(headers.headers[0].value_bytes_base64, 'base64').toString(), "script-src 'none'");
    const replay = await replayClosure(manifest, cas);
    assert.equal(replay.run_status, 'completed');
    assert.equal(replay.release_gate, 'eligible');
    assert.equal(replay.live_network_events, 0);
    assert.deepEqual(replay.responses[0].headers, headers);
  });

  test('missing or tampered CAS bytes, manifest digest, and canonical ordering fail closed', async () => {
    const { manifest, cas } = await capture();
    const first = manifest.network_records[0];
    const observation = manifest.observation_records[0];
    await assertUnavailable(manifest, cas, async (_next, nextCas) => nextCas.rows.delete(first.content_addressed_header_artifact_locator));
    const { manifest: bodyManifest, cas: bodyCas } = await capture();
    await assertUnavailable(bodyManifest, bodyCas, async (_next, nextCas) => nextCas.rows.set(bodyManifest.network_records[0].content_addressed_body_artifact_locator, Buffer.from('tamper')));
    const { manifest: observationManifest, cas: observationCas } = await capture();
    await assertUnavailable(observationManifest, observationCas, async (_next, nextCas) => nextCas.rows.delete(observationManifest.observation_records[0].content_addressed_artifact_locator));
    await assertUnavailable(manifest, cas, async (next) => { next.manifest_digest = d('f'); });
    await assertUnavailable(manifest, cas, async (next) => { next.network_records.reverse(); });
    await assertUnavailable(manifest, cas, async (next) => { next.replay_profiles.reverse(); });
    assert.ok(observation.artifact_digest);
  });

  test('network key/profile coverage is exact and profile identity is never ordinal', async () => {
    const { manifest, cas } = await capture();
    await assertUnavailable(manifest, cas, async (next) => { next.network_records[0].sequence = 1; });
    await assertUnavailable(manifest, cas, async (next) => { next.network_records[0].replay_profile_id = next.replay_profiles[1].replay_profile_id; });
    await assertUnavailable(manifest, cas, async (next) => { next.observation_records.pop(); });
    await assertUnavailable(manifest, cas, async (next) => { next.replay_profiles[0].replay_profile_id = '0'; });
    const duplicate = capturePayload();
    duplicate.replay_profiles.push(structuredClone(duplicate.replay_profiles[0]));
    const { manifest: incomplete } = await capture(duplicate);
    assert.equal(incomplete.completeness_status, 'incomplete');
  });

  test('capture blocks every mutating, streaming, authenticated, download, or live-replay path', async () => {
    const prohibited = [
      ['POST', null], ['PUT', null], ['PATCH', null], ['DELETE', null],
      ['GET', 'beacon'], ['GET', 'sse'], ['GET', 'websocket'], ['GET', 'download'],
      ['GET', 'login'], ['GET', 'cart'], ['GET', 'key_creation'], ['GET', 'api_effect'],
    ];
    for (const [method, eventKind] of prohibited) {
      const payload = capturePayload();
      payload.network_events[0].request_method = method;
      if (eventKind) payload.transport_events.push({ kind: eventKind, url: 'https://effect.invalid/' });
      const { manifest } = await capture(payload);
      assert.equal(manifest.completeness_status, 'incomplete', `${method}/${eventKind}`);
      await assert.rejects(() => replayClosure(manifest, makeCas()), (error) => error?.code === 'TARGET_UNAVAILABLE' && error?.result?.release_gate === 'no_release');
    }
    for (const overrides of [{ authenticated: true }, { live_replay: true }, { outbound_effects: [{ kind: 'submit' }] }]) {
      const { manifest } = await capture(capturePayload(overrides));
      assert.equal(manifest.completeness_status, 'incomplete');
    }
  });

  test('hostile driver and CAS inputs fail total, bounded, path-safe, and Unicode-safe', async () => {
    const cas = makeCas();
    for (const badBrowser of [null, {}, { cas }, { capture: async () => capturePayload() }]) {
      await assert.rejects(() => captureClosure(caseManifest(), badBrowser), /CAPTURE_DRIVER_INVALID/);
    }
    const hostile = [
      { network_events: 'not-an-array' },
      { observation_events: [null] },
      { replay_profiles: [profile('e\u0301')] },
      { capture_environment_digest: d('g') },
    ];
    for (const override of hostile) {
      await assert.rejects(
        () => captureClosure(caseManifest(), browser(makeCas(), capturePayload(override))),
        /CAPTURE_INPUT_INVALID/,
      );
    }
    const traversal = capturePayload();
    traversal.network_events[0].content_addressed_body_artifact_locator = '../outside';
    const { manifest } = await capture(traversal);
    assert.equal(manifest.network_records.some((row) => JSON.stringify(row).includes('../outside')), false);
    const oversized = capturePayload({ observation_events: capturePayload().observation_events.map((row) => ({ ...row, artifact_bytes_base64: b64('x'.repeat(1_048_577)) })) });
    const { manifest: bounded } = await capture(oversized);
    assert.equal(bounded.completeness_status, 'incomplete');
  });

  test('the capture module is driver-injected and independent of Playwright/evaluator runtime', async () => {
    const source = await readFile('scripts/capture-snapshot-closure.mjs', 'utf8');
    assert.doesNotMatch(source, /from ['"](?:playwright|\.\.\/evaluator\/index\.mjs)['"]/);
    assert.doesNotMatch(source, /\b(?:fetch|WebSocket|EventSource)\s*\(/);
  });

  test('public black-box cases freeze exact safe boundaries and profile IDs', async () => {
    const cases = Object.fromEntries(await Promise.all(
      ['govuk', 'apple', 'ikea', 'stripe'].map(async (name) => [name, JSON.parse(await readFile(`evals/public-cases/${name}.json`, 'utf8'))]),
    ));
    assert.equal(cases.govuk.case_id, 'RW-WEBSITE-GOVUK-001');
    assert.equal(cases.apple.case_id, 'RW-WEBSITE-APPLE-001');
    assert.equal(cases.ikea.case_id, 'RW-WEBSITE-IKEA-001');
    assert.equal(cases.stripe.case_id, 'RW-DOCS-STRIPE-001');
    const ids = cases.apple.task_script.steps.flatMap((step) => step.required_replay_profile_ids);
    assert.deepEqual([...new Set(ids)].sort(), appleProfiles.map((row) => row.replay_profile_id).sort());
    assert.match(cases.govuk.seed_state, /anonymous/i);
    assert.match(cases.ikea.seed_state, /Beijing.*no-geolocation/i);
    assert.match(cases.ikea.prohibited_effects.join(' '), /cart|checkout|login/i);
    assert.match(cases.stripe.prohibited_effects.join(' '), /login|key|API/i);
    for (const row of Object.values(cases)) {
      assert.equal(row.target_kind, 'black_box_site');
      assert.equal(row.comparison_policy, 'within_case_only');
      assert.equal(row.immutable_ref, null);
      assert.match(row.snapshot_closure_digest, /^[0-9a-f]{64}$/);
      assert.equal(JSON.stringify(row).includes('discovery_curl_as_closure'), false);
      const closure = JSON.parse(await readFile(`evals/fixtures/${row.case_id}.snapshot-closure.json`, 'utf8'));
      assert.equal(validateBySchema('SnapshotClosureManifest', closure).ok, true);
      assert.equal(validateBySchema('RealWorldRegressionCase', row).ok, true);
      assert.equal(snapshotClosureDigest(closure), row.snapshot_closure_digest);
      assert.equal(closure.completeness_status, 'incomplete');
    }
  });
}
