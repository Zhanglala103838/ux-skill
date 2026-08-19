import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { canonicalize } from 'json-canonicalize';
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
  const { captureClosure, replayClosure, runCaptureCli, snapshotClosureDigest } = closureApi;
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

  test('TASK9_REPLAY_ELIGIBILITY_RED', async () => {
    const issues = [];
    const expect = (condition, label) => { if (!condition) issues.push(label); };
    const one = profile('boundary-profile');
    const oneCase = (taskScript) => ({
      case_id: 'RW-BOUNDARY-001',
      canonical_locator: 'https://example.invalid/',
      task_script: taskScript,
    });
    const baseTask = (instruction = 'read') => ({
      task_script_id: 'boundary-v1',
      steps: [{ step_id: 'read', instruction, required_replay_profile_ids: [one.replay_profile_id] }],
    });
    const onePayload = (overrides = {}) => ({
      ...capturePayload(),
      replay_profiles: [structuredClone(one)],
      network_events: [{
        replay_profile_id: one.replay_profile_id,
        sequence: 0,
        task_step_id: 'read',
        request_method: 'GET',
        request_url: 'https://example.invalid/',
        redirect_chain: [],
        final_url: 'https://example.invalid/',
        network_kind: 'document',
        disposition: 'captured',
        response_status: 200,
        response_headers: [{ sequence: 0, name: 'x-boundary', value_bytes_base64: b64('ok') }],
        raw_body_bytes_base64: b64('body'),
      }],
      observation_events: [{
        replay_profile_id: one.replay_profile_id,
        task_step_id: 'read',
        evidence_kind: 'dom_snapshot',
        ordinal: 0,
        artifact_bytes_base64: b64('observation'),
      }],
      ...overrides,
    });
    const sizedTask = (size) => {
      const empty = baseTask('');
      const overhead = Buffer.byteLength(canonicalize(empty));
      const result = baseTask('x'.repeat(size - overhead));
      assert.equal(Buffer.byteLength(canonicalize(result)), size);
      return result;
    };
    const sizedHeaders = (size) => {
      for (let nameLength = 1; nameLength <= 32; nameLength += 1) {
        for (let rawLength = Math.floor(size * 3 / 4) - 128; rawLength < Math.floor(size * 3 / 4) + 16; rawLength += 1) {
          const rows = [{ sequence: 0, name: `x${'a'.repeat(nameLength - 1)}`, value_bytes_base64: Buffer.alloc(rawLength).toString('base64') }];
          const normalized = { headers: rows.map((row) => ({ sequence: row.sequence, name_lower_ascii: row.name, value_bytes_base64: row.value_bytes_base64 })) };
          if (Buffer.byteLength(canonicalize(normalized)) === size) return rows;
        }
      }
      throw new Error(`unable to size headers to ${size}`);
    };
    const runCapture = async (taskScript, payload, cas = makeCas()) => {
      try { return { manifest: await captureClosure(oneCase(taskScript), browser(cas, payload)), cas }; }
      catch (error) { return { error, cas }; }
    };
    const artifactCases = [
      ['task', (size) => [sizedTask(size), onePayload()]],
      ['header', (size) => [baseTask(), onePayload({ network_events: [{ ...onePayload().network_events[0], response_headers: sizedHeaders(size) }] })]],
      ['body', (size) => [baseTask(), onePayload({ network_events: [{ ...onePayload().network_events[0], raw_body_bytes_base64: Buffer.alloc(size).toString('base64') }] })]],
      ['observation', (size) => [baseTask(), onePayload({ observation_events: [{ ...onePayload().observation_events[0], artifact_bytes_base64: Buffer.alloc(size).toString('base64') }] })]],
    ];
    for (const [kind, build] of artifactCases) {
      const [boundaryTask, boundaryPayload] = build(1_048_576);
      const boundary = await runCapture(boundaryTask, boundaryPayload);
      expect(boundary.manifest?.completeness_status === 'complete', `${kind}:exact-limit-not-complete`);
      if (boundary.manifest?.completeness_status === 'complete') {
        try { await replayClosure(boundary.manifest, boundary.cas); }
        catch { issues.push(`${kind}:exact-limit-not-replayable`); }
      }
      const [overTask, overPayload] = build(1_048_577);
      const over = await runCapture(overTask, overPayload);
      expect(over.manifest?.completeness_status === 'incomplete', `${kind}:over-limit-not-incomplete`);
    }

    const emptyNetwork = await runCapture(baseTask(), onePayload({ network_events: [] }));
    expect(emptyNetwork.manifest?.completeness_status === 'incomplete', 'empty-network-certified-complete');

    const casModes = {
      noop: { async put() {}, async get() { return null; } },
      mutate: { rows: new Map(), async put(locator, value) { this.rows.set(locator, Buffer.from(value).fill(0)); }, async get(locator) { return this.rows.get(locator) ?? null; } },
      throw: { async put() { throw new Error('put failed'); }, async get() { return null; } },
      readback_miss: { rows: new Map(), async put(locator, value) { this.rows.set(locator, Buffer.from(value)); }, async get() { return null; } },
      digest_mismatch: { rows: new Map(), async put(locator, value) { this.rows.set(locator, Buffer.concat([Buffer.from(value), Buffer.from('x')])); }, async get(locator) { return this.rows.get(locator) ?? null; } },
    };
    for (const [mode, cas] of Object.entries(casModes)) {
      const result = await runCapture(baseTask(), onePayload(), cas);
      expect(result.manifest?.completeness_status === 'incomplete', `cas-${mode}-not-incomplete`);
    }
    const countingCas = makeCas();
    const putCounts = new Map();
    const originalPut = countingCas.put.bind(countingCas);
    countingCas.put = async (locator, value) => { putCounts.set(locator, (putCounts.get(locator) ?? 0) + 1); await originalPut(locator, value); };
    const counted = await runCapture(baseTask(), onePayload(), countingCas);
    const taskLocator = `cas/${counted.manifest?.task_script_digest}`;
    expect(putCounts.get(taskLocator) === 1, 'task-script-not-routed-once-through-put');
    if (counted.manifest?.completeness_status === 'complete') {
      try { await replayClosure(counted.manifest, countingCas); }
      catch { issues.push('complete-does-not-imply-immediate-replay'); }
    }

    const shared = { leaf: 'x' };
    let browserCalls = 0;
    let casCalls = 0;
    const guardedCas = { async put() { casCalls += 1; }, async get() { casCalls += 1; return null; } };
    const guardedBrowser = { cas: guardedCas, async capture() { browserCalls += 1; return onePayload(); } };
    const sharedCase = { ...oneCase(baseTask()), hostile: [shared, shared] };
    await assert.rejects(() => captureClosure(sharedCase, guardedBrowser), /CAPTURE_INPUT_INVALID/).catch(() => issues.push('case-shared-dag-accepted'));
    expect(browserCalls === 0 && casCalls === 0, 'case-preflight-ran-after-browser-or-cas');
    const driverShared = [];
    const sharedPayload = onePayload();
    sharedPayload.network_events[0].redirect_chain = driverShared;
    sharedPayload.hostile = driverShared;
    casCalls = 0;
    await assert.rejects(() => captureClosure(oneCase(baseTask()), { cas: guardedCas, async capture() { return sharedPayload; } }), /CAPTURE_INPUT_INVALID/).catch(() => issues.push('driver-shared-dag-accepted'));
    expect(casCalls === 0, 'driver-preflight-ran-after-cas');
    const good = await runCapture(baseTask(), onePayload());
    const replayShared = structuredClone(good.manifest);
    replayShared.network_records.push({ ...structuredClone(replayShared.network_records[0]), replay_profile_id: one.replay_profile_id, sequence: 1 });
    replayShared.manifest_digest = snapshotClosureDigest(replayShared);
    const sharedRedirects = [];
    replayShared.network_records[0].redirect_chain = sharedRedirects;
    replayShared.network_records[1].redirect_chain = sharedRedirects;
    let replayGets = 0;
    await assert.rejects(() => replayClosure(replayShared, { async get(locator) { replayGets += 1; return good.cas.get(locator); } }), /TARGET_UNAVAILABLE/).catch(() => issues.push('replay-shared-dag-accepted'));
    expect(replayGets === 0, 'replay-preflight-ran-after-cas');

    for (const [label, hostile] of [
      ['cycle', (() => { const value = {}; value.self = value; return value; })()],
      ['proxy', new Proxy({}, {})],
      ['accessor', Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('getter invoked'); } })],
      ['depth', (() => { let value = {}; for (let index = 0; index < 80; index += 1) value = { child: value }; return value; })()],
      ['nodes', Object.fromEntries(Array.from({ length: 33_000 }, (_, index) => [`k${index}`, null]))],
      ['string-bytes', 'x'.repeat(1_500_000)],
      ['typed-bytes', new Uint8Array(1_048_577)],
    ]) {
      browserCalls = 0;
      await assert.rejects(() => captureClosure({ ...oneCase(baseTask()), hostile }, { ...guardedBrowser, async capture() { browserCalls += 1; return onePayload(); } }), /CAPTURE_INPUT_INVALID/).catch(() => issues.push(`preflight-${label}-accepted`));
      expect(browserCalls === 0, `preflight-${label}-called-browser`);
    }

    const cliDir = await mkdtemp(join(tmpdir(), 'task9-cli-red-'));
    try {
      const casePath = join(cliDir, 'case.json');
      const casPath = join(cliDir, 'cas');
      const outputPath = join(cliDir, 'output.json');
      await writeFile(casePath, `${JSON.stringify(oneCase(baseTask()))}\n`);
      const child = await new Promise((resolve) => {
        const proc = spawn(process.execPath, ['scripts/capture-snapshot-closure.mjs', '--case', casePath, '--cas', casPath, '--output', outputPath], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        proc.stdout.on('data', (chunk) => { stdout += chunk; });
        proc.stderr.on('data', (chunk) => { stderr += chunk; });
        proc.on('close', (code) => resolve({ code, stdout, stderr }));
      });
      let wrapper;
      try { wrapper = JSON.parse(await readFile(outputPath, 'utf8')); } catch {}
      expect(child.code === 2, 'cli-target-unavailable-exit-not-2');
      expect(wrapper?.closure === null && wrapper?.completeness_status === 'incomplete' && wrapper?.run_status === 'target_unavailable' && wrapper?.release_gate === 'no_release' && Array.isArray(wrapper?.run_issues) && wrapper.run_issues.length > 0, 'cli-target-unavailable-wrapper-not-closed');
    } finally {
      await rm(cliDir, { recursive: true, force: true });
    }

    assert.deepEqual(issues, [], `TASK9_REPLAY_ELIGIBILITY_RED:${issues.join(',')}`);
  });

  test('TASK9_TASK_RUNNER_RED', async () => {
    const issues = [];
    const serverPaths = [];
    const server = createServer((request, response) => {
      serverPaths.push(request.url);
      const bodies = {
        '/': '<main>ENTRY_ONLY</main>',
        '/one': '<main>STEP_ONE</main>',
        '/two': '<main>STEP_TWO UNIQUE_MARKER</main>',
      };
      const body = bodies[request.url] ?? '<main>NOT_FOUND</main>';
      response.writeHead(bodies[request.url] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'x-route': request.url });
      response.end(body);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const root = await mkdtemp(join(tmpdir(), 'task9-runner-red-'));
    const publicDir = join(root, 'evals', 'public-cases');
    const fixtureDir = join(root, 'evals', 'fixtures');
    const localProfile = profile('local-runner-profile', { browser_engine_digest: d('e') });
    const taskScript = {
      task_script_id: 'local-two-route-v1',
      steps: [
        { step_id: 'visit-one', instruction: 'Navigate to /one and observe STEP_ONE.', required_replay_profile_ids: [localProfile.replay_profile_id] },
        { step_id: 'visit-two', instruction: 'Navigate to /two and observe UNIQUE_MARKER.', required_replay_profile_ids: [localProfile.replay_profile_id] },
      ],
    };
    const fixture = {
      closure_version: 'snapshot-closure-v1',
      entry_url: `${origin}/`,
      task_script_digest: d('1'),
      capture_environment_digest: d('2'),
      captured_at: '2026-08-20T00:00:00Z',
      authenticated: false,
      replay_profiles: [localProfile],
      network_records: [],
      observation_records: [],
      outbound_effect_ledger_digest: d('3'),
      completeness_status: 'incomplete',
      manifest_digest: '',
    };
    fixture.manifest_digest = snapshotClosureDigest(fixture);
    const localCase = { case_id: 'RW-LOCAL-TWO-ROUTE-001', canonical_locator: `${origin}/`, snapshot_closure_digest: fixture.manifest_digest, task_script: taskScript };
    const transport = {
      async request({ method, url }) {
        assert.ok(['GET', 'HEAD'].includes(method));
        return await new Promise((resolve, reject) => {
          const request = httpRequest(url, { method }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
              status: response.statusCode,
              final_url: url,
              headers: response.rawHeaders.reduce((rows, value, index, all) => index % 2 === 0 ? [...rows, { sequence: rows.length, name: value, value_bytes_base64: Buffer.from(all[index + 1], 'latin1').toString('base64') }] : rows, []),
              body: Buffer.concat(chunks),
            }));
          });
          request.once('error', reject);
          request.end();
        });
      },
    };
    const runner = async ({ profiles, steps, executeStep }) => {
      for (const row of profiles) {
        for (const step of steps) {
          const route = step.step_id === 'visit-one' ? '/one' : '/two';
          await executeStep({ replay_profile_id: row.replay_profile_id, task_step_id: step.step_id }, async ({ request, observe }) => {
            const response = await request({ method: 'GET', url: `${origin}${route}` });
            await observe({ evidence_kind: 'dom_snapshot', bytes: response.body });
          });
        }
      }
    };
    const partialRunner = async ({ profiles, executeStep }) => {
      await executeStep({ replay_profile_id: profiles[0].replay_profile_id, task_step_id: 'visit-one' }, async ({ request, observe }) => {
        const response = await request({ method: 'GET', url: `${origin}/one` });
        await observe({ evidence_kind: 'dom_snapshot', bytes: response.body });
      });
    };
    try {
      await mkdir(publicDir, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      const casePath = join(publicDir, 'local.json');
      await writeFile(casePath, `${JSON.stringify(localCase)}\n`);
      await writeFile(join(fixtureDir, `${localCase.case_id}.snapshot-closure.json`), `${JSON.stringify(fixture)}\n`);
      const invoke = async (name, selectedRunner) => {
        const casPath = join(root, `cas-${name}`), outputPath = join(root, `output-${name}.json`);
        const exitCode = await runCaptureCli(['--case', casePath, '--cas', casPath, '--output', outputPath], {
          taskRunners: selectedRunner ? new Map([[localCase.case_id, selectedRunner]]) : new Map(),
          transport,
        });
        let wrapper;
        try { wrapper = JSON.parse(await readFile(outputPath, 'utf8')); } catch {}
        return { casPath, exitCode, wrapper };
      };
      serverPaths.length = 0;
      const positive = await invoke('positive', runner);
      if (positive.exitCode !== 0 || positive.wrapper?.completeness_status !== 'complete' || positive.wrapper?.run_status !== 'completed' || positive.wrapper?.release_gate !== 'no_release') issues.push('registered-runner-did-not-complete');
      if (serverPaths.join(',') !== '/one,/two') issues.push(`registered-runner-paths:${serverPaths.join(',')}`);
      const positiveSteps = positive.wrapper?.closure?.network_records?.map((row) => row.task_step_id);
      if (JSON.stringify(positiveSteps) !== JSON.stringify(['visit-one', 'visit-two'])) issues.push('network-not-bound-to-active-step');
      const observations = positive.wrapper?.closure?.observation_records ?? [];
      if (observations.length !== 2 || observations[0]?.artifact_digest === observations[1]?.artifact_digest) issues.push('step-observations-not-distinct');
      const markerObservation = observations.find((row) => row.task_step_id === 'visit-two');
      let markerBytes = '';
      try { markerBytes = await readFile(join(positive.casPath, markerObservation.content_addressed_artifact_locator.slice(4)), 'utf8'); } catch {}
      if (!markerBytes.includes('UNIQUE_MARKER')) issues.push('step-two-marker-not-captured');

      serverPaths.length = 0;
      const partial = await invoke('partial', partialRunner);
      if (partial.exitCode !== 2 || partial.wrapper?.completeness_status !== 'incomplete' || partial.wrapper?.run_status !== 'target_unavailable' || partial.wrapper?.release_gate !== 'no_release') issues.push('skipped-step-not-closed');
      if (serverPaths.join(',') !== '/one') issues.push(`partial-runner-synthesized-navigation:${serverPaths.join(',')}`);
      if (partial.wrapper?.closure?.observation_records?.some((row) => row.task_step_id === 'visit-two')) issues.push('skipped-step-observation-synthesized');

      serverPaths.length = 0;
      const absent = await invoke('absent', null);
      if (absent.exitCode !== 2 || absent.wrapper?.closure !== null || absent.wrapper?.run_status !== 'target_unavailable' || absent.wrapper?.release_gate !== 'no_release') issues.push('missing-runner-not-closed');
      if (serverPaths.length !== 0) issues.push('missing-runner-touched-target');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
    assert.deepEqual(issues, [], `TASK9_TASK_RUNNER_RED:${issues.join(',')}`);
  });
}
