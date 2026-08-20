import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { pathToFileURL } from 'node:url';
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
  const { captureClosure, captureRegistryDigest, createCaptureRegistry, replayClosure, runCaptureCli, snapshotClosureDigest } = closureApi;
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
    canonical_locator: 'public-sites/rw-website-apple-001',
    entry_url: 'https://www.apple.com.cn/',
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
  const makeCaptureRegistry = async (directory, caseId, taskScript, runnerSource, transportSource, taskScriptDigest = sha(Buffer.from(canonicalize(taskScript)))) => {
    const runnerPath = join(directory, 'runner.mjs'), transportPath = join(directory, 'transport.mjs'), manifestPath = join(directory, 'capture-registry.json');
    await writeFile(runnerPath, runnerSource);
    await writeFile(transportPath, transportSource);
    const manifest = {
      registry_version: 'snapshot-capture-registry-v1',
      entries: [{
        case_id: caseId,
        task_script_digest: taskScriptDigest,
        runner_path: 'runner.mjs',
        runner_digest: sha(Buffer.from(runnerSource)),
        runner_module_closure: [{ relative_path: 'runner.mjs', raw_sha256: sha(Buffer.from(runnerSource)) }],
        transport_path: 'transport.mjs',
        transport_digest: sha(Buffer.from(transportSource)),
        transport_module_closure: [{ relative_path: 'transport.mjs', raw_sha256: sha(Buffer.from(transportSource)) }],
      }],
      registry_digest: '',
    };
    manifest.registry_digest = captureRegistryDigest(manifest);
    await writeFile(manifestPath, `${canonicalize(manifest)}\n`);
    return createCaptureRegistry(manifestPath);
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
    const publicIdentity = {
      govuk: ['public-sites/rw-website-govuk-001', 'https://www.gov.uk/register-to-vote'],
      apple: ['public-sites/rw-website-apple-001', 'https://www.apple.com.cn/'],
      ikea: ['public-sites/rw-website-ikea-001', 'https://www.ikea.cn/cn/zh/'],
      stripe: ['public-sites/rw-docs-stripe-001', 'https://docs.stripe.com/'],
    };
    for (const [name, [canonicalLocator, entryUrl]] of Object.entries(publicIdentity)) {
      assert.equal(cases[name].canonical_locator, canonicalLocator);
      assert.equal(cases[name].entry_url, entryUrl);
      assert.notEqual(cases[name].canonical_locator, cases[name].entry_url);
    }
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
      canonical_locator: 'public-sites/task9-test',
      entry_url: 'https://example.invalid/',
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
    const localCase = { case_id: 'RW-LOCAL-TWO-ROUTE-001', canonical_locator: 'public-sites/task9-test', entry_url: `${origin}/`, snapshot_closure_digest: fixture.manifest_digest, task_script: taskScript };
    const transportSource = `const rawRequest = async (url, method) => {
  const response = await fetch(url, { method, redirect: 'manual' });
  return { status: response.status, final_url: url, headers: [...response.headers.entries()].map(([name, value], sequence) => ({ sequence, name, value_bytes_base64: Buffer.from(value, 'latin1').toString('base64') })), body: Buffer.from(await response.arrayBuffer()) };
};
export async function request({ method, url }) { const response = await rawRequest(url, method); return { ...response, redirect_chain: [], observation_artifacts: [{ evidence_kind: 'dom_snapshot', artifact_bytes: response.body }] }; }
`;
    const runner = async ({ profiles, steps, executeStep }) => {
      for (const row of profiles) {
        for (const step of steps) {
          const route = step.step_id === 'visit-one' ? '/one' : '/two';
          await executeStep({ replay_profile_id: row.replay_profile_id, task_step_id: step.step_id }, async ({ request, observe }) => {
            const response = await request({ method: 'GET', url: `${origin}${route}` });
            await observe({ evidence_kind: 'dom_snapshot', handle: response.observation_handles[0] });
          });
        }
      }
    };
    const partialRunner = async ({ profiles, executeStep }) => {
      await executeStep({ replay_profile_id: profiles[0].replay_profile_id, task_step_id: 'visit-one' }, async ({ request, observe }) => {
        const response = await request({ method: 'GET', url: `${origin}/one` });
        await observe({ evidence_kind: 'dom_snapshot', handle: response.observation_handles[0] });
      });
    };
    try {
      await mkdir(publicDir, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      const casePath = join(publicDir, 'local.json');
      await writeFile(casePath, `${JSON.stringify(localCase)}\n`);
      await writeFile(join(fixtureDir, `${localCase.case_id}.snapshot-closure.json`), `${JSON.stringify(fixture)}\n`);
      const invoke = async (name, selectedRunner, registeredTaskDigest = sha(Buffer.from(canonicalize(taskScript)))) => {
        const casPath = join(root, `cas-${name}`), outputPath = join(root, `output-${name}.json`);
        let registry;
        if (selectedRunner) {
          const registryDir = join(root, `registry-${name}`);
          await mkdir(registryDir, { recursive: true });
          const runnerSource = `const origin=${JSON.stringify(origin)};\nexport const run=${selectedRunner.toString()};\n`;
          registry = await makeCaptureRegistry(registryDir, localCase.case_id, taskScript, runnerSource, transportSource, registeredTaskDigest);
        }
        const exitCode = await runCaptureCli(['--case', casePath, '--cas', casPath, '--output', outputPath], {
          registry,
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
      const unsupported = await invoke('unsupported', runner, d('9'));
      if (unsupported.exitCode !== 2 || unsupported.wrapper?.run_status !== 'target_unavailable' || serverPaths.length !== 0) issues.push('unsupported-task-digest-not-closed-before-target');

      serverPaths.length = 0;
      const reordered = await invoke('reordered', async ({ profiles, executeStep }) => {
        await executeStep({ replay_profile_id: profiles[0].replay_profile_id, task_step_id: 'visit-two' }, async () => {});
      });
      if (reordered.exitCode !== 2 || reordered.wrapper?.run_status !== 'target_unavailable' || serverPaths.length !== 0) issues.push('reordered-step-not-closed-before-target');

      serverPaths.length = 0;
      const reused = await invoke('reused', async ({ profiles, steps, executeStep }) => {
        let firstHandle;
        for (const step of steps) await executeStep({ replay_profile_id: profiles[0].replay_profile_id, task_step_id: step.step_id }, async ({ request, observe }) => {
          const response = await request({ method: 'GET', url: `${origin}/${step.step_id === 'visit-one' ? 'one' : 'two'}` });
          firstHandle ??= response.observation_handles[0];
          await observe({ evidence_kind: 'dom_snapshot', handle: firstHandle });
        });
      });
      if (reused.exitCode !== 2 || reused.wrapper?.run_status !== 'target_unavailable' || serverPaths.join(',') !== '/one,/two') issues.push('cross-step-observation-reuse-not-closed');

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

  test('TASK9_TRANSPORT_PROVENANCE_RED', async () => {
    const issues = [];
    const paths = [];
    const server = createServer((request, response) => {
      paths.push(request.url);
      if (request.url === '/start') {
        response.writeHead(302, { location: '/final', 'x-hop-marker': 'HOP_MARKER' });
        response.end();
        return;
      }
      if (request.url === '/final') {
        response.writeHead(200, { 'content-type': 'text/html', 'x-final-marker': 'FINAL_MARKER' });
        response.end('<main>UNIQUE_REDIRECT_MARKER</main>');
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const root = await mkdtemp(join(tmpdir(), 'task9-provenance-red-'));
    const publicDir = join(root, 'evals', 'public-cases'), fixtureDir = join(root, 'evals', 'fixtures');
    const redirectProfile = profile('redirect-profile', { browser_engine_digest: d('7') });
    const redirectTask = { task_script_id: 'redirect-v1', steps: [{ step_id: 'follow-redirect', instruction: 'Use the registered action for the redirect fixture.', required_replay_profile_ids: [redirectProfile.replay_profile_id] }] };
    const seed = { closure_version: 'snapshot-closure-v1', entry_url: `${origin}/start`, task_script_digest: d('1'), capture_environment_digest: d('2'), captured_at: '2026-08-20T00:00:00Z', authenticated: false, replay_profiles: [redirectProfile], network_records: [], observation_records: [], outbound_effect_ledger_digest: d('3'), completeness_status: 'incomplete', manifest_digest: '' };
    seed.manifest_digest = snapshotClosureDigest(seed);
    const localCase = { case_id: 'RW-LOCAL-REDIRECT-001', canonical_locator: 'public-sites/task9-test', entry_url: `${origin}/start`, snapshot_closure_digest: seed.manifest_digest, task_script: redirectTask };
    const rawRequest = (url) => new Promise((resolve, reject) => {
      const request = httpRequest(url, { method: 'GET' }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          url,
          location: response.headers.location ?? null,
          headers: response.rawHeaders.reduce((rows, value, index, all) => index % 2 === 0 ? [...rows, { sequence: rows.length, name: value, value_bytes_base64: Buffer.from(all[index + 1], 'latin1').toString('base64') }] : rows, []),
          body: Buffer.concat(chunks),
        }));
      });
      request.once('error', reject);
      request.end();
    });
    const follow = async () => {
      const hop = await rawRequest(`${origin}/start`);
      const finalUrl = new URL(hop.location, hop.url).href;
      const final = await rawRequest(finalUrl);
      return { hop, final, finalUrl };
    };
    const transportPrelude = `const rawRequest = async (url) => { const response=await fetch(url,{method:'GET',redirect:'manual'}); return {status:response.status,url,location:response.headers.get('location'),headers:[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')})),body:Buffer.from(await response.arrayBuffer())}; };
const follow = async (url) => { const hop=await rawRequest(url), finalUrl=new URL(hop.location,hop.url).href, final=await rawRequest(finalUrl); return {hop,final,finalUrl}; };
`;
    const completeTransportSource = `${transportPrelude}export async function request({url}) { const {hop,final,finalUrl}=await follow(url); return {status:final.status,final_url:finalUrl,headers:final.headers,body:final.body,redirect_chain:[{sequence:0,status:hop.status,url:hop.url,location:finalUrl,response_headers:hop.headers}],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:final.body}]}; }\n`;
    const missingChainTransportSource = `${transportPrelude}export async function request({url}) { const {final,finalUrl}=await follow(url); return {status:final.status,final_url:finalUrl,headers:final.headers,body:final.body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:final.body}]}; }\n`;
    const reorderedChainTransportSource = `${transportPrelude}export async function request({url}) { const {hop,final,finalUrl}=await follow(url); return {status:final.status,final_url:finalUrl,headers:final.headers,body:final.body,redirect_chain:[{sequence:1,status:hop.status,url:hop.url,location:finalUrl,response_headers:hop.headers}],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:final.body}]}; }\n`;
    const opaqueRunner = async ({ profiles, steps, executeStep }) => {
      await executeStep({ replay_profile_id: profiles[0].replay_profile_id, task_step_id: steps[0].step_id }, async ({ request, observe }) => {
        const response = await request({ method: 'GET', url: `${origin}/start` });
        await observe({ evidence_kind: 'dom_snapshot', handle: response.observation_handles[0] });
      });
    };
    const forgedRunner = async ({ profiles, steps, executeStep }) => {
      await executeStep({ replay_profile_id: profiles[0].replay_profile_id, task_step_id: steps[0].step_id }, async ({ request, observe }) => {
        await request({ method: 'GET', url: `${origin}/start` });
        await observe({ evidence_kind: 'dom_snapshot', bytes: Buffer.from('FORGED_OBSERVATION_BYTES') });
      });
    };
    try {
      await mkdir(publicDir, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      const casePath = join(publicDir, 'redirect.json');
      await writeFile(casePath, `${JSON.stringify(localCase)}\n`);
      await writeFile(join(fixtureDir, `${localCase.case_id}.snapshot-closure.json`), `${JSON.stringify(seed)}\n`);
      const taskDigest = sha(Buffer.from(canonicalize(redirectTask)));
      const invoke = async (name, runner, transportSource, legacy = false) => {
        const casPath = join(root, `cas-${name}`), outputPath = join(root, `output-${name}.json`);
        let dependencies;
        if (legacy) dependencies = { taskRunners: new Map([[localCase.case_id, { task_script_digest: taskDigest, runner_digest: d('9'), run: runner }]]), transport: { transport_digest: d('8'), async request() { return null; } } };
        else { const registryDir=join(root,`registry-${name}`);await mkdir(registryDir,{recursive:true});const runnerSource=`const origin=${JSON.stringify(origin)};\nexport const run=${runner.toString()};\n`;dependencies={registry:await makeCaptureRegistry(registryDir,localCase.case_id,redirectTask,runnerSource,transportSource)}; }
        const exitCode = await runCaptureCli(['--case', casePath, '--cas', casPath, '--output', outputPath], dependencies);
        let wrapper;
        try { wrapper = JSON.parse(await readFile(outputPath, 'utf8')); } catch {}
        return { casPath, exitCode, wrapper };
      };

      paths.length = 0;
      const complete = await invoke('complete', opaqueRunner, completeTransportSource);
      if (complete.exitCode !== 0 || complete.wrapper?.completeness_status !== 'complete') issues.push('complete-redirect-chain-not-supported');
      const record = complete.wrapper?.closure?.network_records?.[0], hop = record?.redirect_chain?.[0];
      if (record?.request_url !== `${origin}/start` || record?.final_url !== `${origin}/final` || hop?.sequence !== 0 || hop?.status !== 302 || hop?.url !== `${origin}/start` || hop?.location !== `${origin}/final`) issues.push('redirect-hop-provenance-missing');
      if (paths.join(',') !== '/start,/final') issues.push(`redirect-paths:${paths.join(',')}`);
      if (hop) {
        let headerArtifact;
        try { headerArtifact = JSON.parse(await readFile(join(complete.casPath, hop.content_addressed_header_artifact_locator.slice(4)), 'utf8')); } catch {}
        const restored = headerArtifact?.headers?.map((row) => [row.name_lower_ascii, Buffer.from(row.value_bytes_base64, 'base64').toString('latin1')]);
        if (!restored?.some(([name, value]) => name === 'location' && value === '/final') || !restored?.some(([name, value]) => name === 'x-hop-marker' && value === 'HOP_MARKER')) issues.push('redirect-hop-headers-not-byte-restored');
        const cas = { async get(locator) { try { return await readFile(join(complete.casPath, locator.slice(4))); } catch { return null; } } };
        try { await replayClosure(complete.wrapper.closure, cas); } catch { issues.push('redirect-chain-not-replayable'); }
        const reordered = structuredClone(complete.wrapper.closure);
        reordered.network_records[0].redirect_chain[0].sequence = 1;
        reordered.manifest_digest = snapshotClosureDigest(reordered);
        await assert.rejects(() => replayClosure(reordered, cas), /TARGET_UNAVAILABLE/).catch(() => issues.push('reordered-redirect-chain-accepted'));
        const tamperedCas = { async get(locator) { const value = await cas.get(locator); return locator === hop.content_addressed_header_artifact_locator && value ? Buffer.concat([value, Buffer.from('x')]) : value; } };
        await assert.rejects(() => replayClosure(complete.wrapper.closure, tamperedCas), /TARGET_UNAVAILABLE/).catch(() => issues.push('tampered-redirect-header-accepted'));
      }

      paths.length = 0;
      const missing = await invoke('missing', opaqueRunner, missingChainTransportSource);
      if (missing.exitCode !== 2 || missing.wrapper?.run_status !== 'target_unavailable' || missing.wrapper?.release_gate !== 'no_release') issues.push('missing-redirect-chain-certified-complete');
      if (paths.join(',') !== '/start,/final') issues.push(`missing-chain-paths:${paths.join(',')}`);

      paths.length = 0;
      const forged = await invoke('forged', forgedRunner, completeTransportSource);
      if (forged.exitCode !== 2 || forged.wrapper?.run_status !== 'target_unavailable') issues.push('runner-forged-observation-certified-complete');

      paths.length = 0;
      const reorderedTransport = await invoke('reordered-transport', opaqueRunner, reorderedChainTransportSource);
      if (reorderedTransport.exitCode !== 2 || reorderedTransport.wrapper?.run_status !== 'target_unavailable') issues.push('reordered-transport-chain-certified-complete');

      paths.length = 0;
      const reusedDigest = await invoke('digest-reuse', async (context) => forgedRunner(context), completeTransportSource, true);
      if (reusedDigest.exitCode !== 2 || reusedDigest.wrapper?.run_status !== 'target_unavailable') issues.push('caller-reused-runner-digest-accepted');
      if (paths.length !== 0) issues.push('caller-self-reported-digest-touched-target');
      if (typeof createCaptureRegistry !== 'function') issues.push('immutable-capture-registry-absent');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
    assert.deepEqual(issues, [], `TASK9_TRANSPORT_PROVENANCE_RED:${issues.join(',')}`);
  });

  test('TASK9_MODULE_CLOSURE_RED', async () => {
    const issues = [];
    const root = await mkdtemp(join(tmpdir(), 'task9-module-closure-red-'));
    const orderedClosure = (rows) => rows
      .map(([relative_path, source]) => ({ relative_path, raw_sha256: sha(Buffer.from(source)) }))
      .sort((left, right) => Buffer.compare(Buffer.from(left.relative_path), Buffer.from(right.relative_path)));
    const writeRegistry = async (directory, runnerEntry, runnerRows, transportEntry, transportRows, options = {}) => {
      await mkdir(directory, { recursive: true });
      for (const [relativePath, source] of [...runnerRows, ...transportRows]) {
        if (source === null) continue;
        await mkdir(join(directory, ...relativePath.split('/').slice(0, -1)), { recursive: true });
        await writeFile(join(directory, relativePath), source);
      }
      const entry = {
        case_id: options.caseId ?? 'RW-MODULE-CLOSURE-001',
        task_script_digest: options.taskDigest ?? d('1'),
        runner_path: runnerEntry,
        runner_digest: sha(Buffer.from(runnerRows.find(([path]) => path === runnerEntry)[1])),
        transport_path: transportEntry,
        transport_digest: sha(Buffer.from(transportRows.find(([path]) => path === transportEntry)[1])),
      };
      if (options.withClosure !== false) {
        entry.runner_module_closure = orderedClosure(runnerRows.filter(([, source]) => source !== null));
        entry.transport_module_closure = orderedClosure(transportRows.filter(([, source]) => source !== null));
      }
      const manifest = { registry_version: 'snapshot-capture-registry-v1', entries: [entry], registry_digest: '' };
      manifest.registry_digest = captureRegistryDigest(manifest);
      const manifestPath = join(directory, 'capture-registry.json');
      await writeFile(manifestPath, `${canonicalize(manifest)}\n`);
      return { entry, manifest, manifestPath };
    };
    const expectRejected = async (label, manifestPath) => {
      try {
        await createCaptureRegistry(manifestPath);
        issues.push(`${label}-accepted`);
      } catch {}
    };
    const runnerEntry = "export { run } from './runner-helper.mjs';\n";
    const runnerHelper = 'export async function run() {}\n';
    const transportEntry = "export { request } from './transport-helper.mjs';\n";
    const transportHelperA = 'export async function request() { throw new Error(\"A\"); }\n';
    const transportHelperB = 'export async function request() { throw new Error(\"B\"); }\n';
    try {
      const positiveDir = join(root, 'positive');
      const positive = await writeRegistry(
        positiveDir,
        'runner.mjs',
        [['runner.mjs', runnerEntry], ['runner-helper.mjs', runnerHelper]],
        'transport.mjs',
        [['transport.mjs', transportEntry], ['transport-helper.mjs', transportHelperA]],
      );
      let positiveRegistry;
      try { positiveRegistry = await createCaptureRegistry(positive.manifestPath); } catch (error) { issues.push(`registered-multifile-rejected:${error?.code ?? error?.name}`); }
      if (positiveRegistry) {
        const mutated = structuredClone(positive.manifest);
        mutated.entries[0].transport_module_closure = orderedClosure([['transport.mjs', transportEntry], ['transport-helper.mjs', transportHelperB]]);
        mutated.registry_digest = captureRegistryDigest(mutated);
        if (mutated.registry_digest === positive.manifest.registry_digest) issues.push('helper-change-did-not-change-registry-digest');
      }

      const unregisteredDir = join(root, 'unregistered');
      const unregistered = await writeRegistry(
        unregisteredDir,
        'runner.mjs',
        [['runner.mjs', runnerEntry], ['runner-helper.mjs', runnerHelper]],
        'transport.mjs',
        [['transport.mjs', transportEntry], ['transport-helper.mjs', transportHelperA]],
        { withClosure: false },
      );
      await expectRejected('unregistered-helper', unregistered.manifestPath);

      const staleDir = join(root, 'stale');
      const stale = await writeRegistry(
        staleDir,
        'runner.mjs',
        [['runner.mjs', runnerEntry], ['runner-helper.mjs', runnerHelper]],
        'transport.mjs',
        [['transport.mjs', transportEntry], ['transport-helper.mjs', transportHelperA]],
      );
      await writeFile(join(staleDir, 'transport-helper.mjs'), transportHelperB);
      await expectRejected('helper-mutation', stale.manifestPath);

      const invalidCases = [
        ['cross-root', "export { run } from '../outside.mjs';\n", [['runner.mjs', "export { run } from '../outside.mjs';\n"]]],
        ['missing', "export { run } from './missing.mjs';\n", [['runner.mjs', "export { run } from './missing.mjs';\n"]]],
        ['nonfile', "export { run } from './directory';\n", [['runner.mjs', "export { run } from './directory';\n"]]],
        ['cycle', "export { run } from './cycle-helper.mjs';\n", [['runner.mjs', "export { run } from './cycle-helper.mjs';\n"], ['cycle-helper.mjs', "export { run } from './runner.mjs';\n"]]],
        ['duplicate', "export { run } from './runner-helper.mjs';\nexport { run as again } from './runner-helper.mjs';\n", [['runner.mjs', "export { run } from './runner-helper.mjs';\nexport { run as again } from './runner-helper.mjs';\n"], ['runner-helper.mjs', runnerHelper]]],
        ['nonliteral-dynamic-import', "const specifier='./runner-helper.mjs';\nexport async function run(){ return import(specifier); }\n", [['runner.mjs', "const specifier='./runner-helper.mjs';\nexport async function run(){ return import(specifier); }\n"], ['runner-helper.mjs', runnerHelper]]],
      ];
      await writeFile(join(root, 'outside.mjs'), runnerHelper);
      for (const [label, entrySource, rows] of invalidCases) {
        const directory = join(root, `invalid-${label}`);
        const candidate = await writeRegistry(
          directory,
          'runner.mjs',
          rows,
          'transport.mjs',
          [['transport.mjs', 'export async function request() {}\n']],
        );
        if (label === 'nonfile') await mkdir(join(directory, 'directory'), { recursive: true });
        await expectRejected(label, candidate.manifestPath);
      }

      const symlinkDir = join(root, 'invalid-symlink');
      const symlinkCandidate = await writeRegistry(
        symlinkDir,
        'runner.mjs',
        [['runner.mjs', "export { run } from './linked-helper.mjs';\n"]],
        'transport.mjs',
        [['transport.mjs', 'export async function request() {}\n']],
      );
      await writeFile(join(symlinkDir, 'runner-helper.mjs'), runnerHelper);
      await symlink('runner-helper.mjs', join(symlinkDir, 'linked-helper.mjs'));
      symlinkCandidate.manifest.entries[0].runner_module_closure.push({ relative_path: 'linked-helper.mjs', raw_sha256: sha(Buffer.from(runnerHelper)) });
      symlinkCandidate.manifest.entries[0].runner_module_closure.sort((left, right) => Buffer.compare(Buffer.from(left.relative_path), Buffer.from(right.relative_path)));
      symlinkCandidate.manifest.registry_digest = captureRegistryDigest(symlinkCandidate.manifest);
      await writeFile(symlinkCandidate.manifestPath, `${canonicalize(symlinkCandidate.manifest)}\n`);
      await expectRejected('symlink', symlinkCandidate.manifestPath);

      const aliasDir = join(root, 'invalid-realpath-alias');
      const aliasEntry = "import { run as first } from './runner-helper.mjs';\nimport { run as second } from './alias-helper.mjs';\nexport const run=first;\n";
      const aliasCandidate = await writeRegistry(
        aliasDir,
        'runner.mjs',
        [['runner.mjs', aliasEntry], ['runner-helper.mjs', runnerHelper]],
        'transport.mjs',
        [['transport.mjs', 'export async function request() {}\n']],
      );
      await symlink('runner-helper.mjs', join(aliasDir, 'alias-helper.mjs'));
      aliasCandidate.manifest.entries[0].runner_module_closure.push({ relative_path: 'alias-helper.mjs', raw_sha256: sha(Buffer.from(runnerHelper)) });
      aliasCandidate.manifest.entries[0].runner_module_closure.sort((left, right) => Buffer.compare(Buffer.from(left.relative_path), Buffer.from(right.relative_path)));
      aliasCandidate.manifest.registry_digest = captureRegistryDigest(aliasCandidate.manifest);
      await writeFile(aliasCandidate.manifestPath, `${canonicalize(aliasCandidate.manifest)}\n`);
      await expectRejected('realpath-alias', aliasCandidate.manifestPath);

      const raceDir = join(root, 'mutation-before-use');
      const publicDir = join(raceDir, 'evals', 'public-cases'), fixtureDir = join(raceDir, 'evals', 'fixtures'), registryDir = join(raceDir, 'registry');
      await mkdir(publicDir, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      const activeProfile = profile('module-closure-profile', { browser_engine_digest: d('c') });
      const taskScript = { task_script_id: 'module-closure-task-v1', steps: [{ step_id: 'visit', instruction: 'Use registered action.', required_replay_profile_ids: [activeProfile.replay_profile_id] }] };
      const taskDigest = sha(Buffer.from(canonicalize(taskScript)));
      const seed = { closure_version: 'snapshot-closure-v1', entry_url: 'http://127.0.0.1:9/', task_script_digest: d('1'), capture_environment_digest: d('2'), captured_at: '2026-08-20T00:00:00Z', authenticated: false, replay_profiles: [activeProfile], network_records: [], observation_records: [], outbound_effect_ledger_digest: d('3'), completeness_status: 'incomplete', manifest_digest: '' };
      seed.manifest_digest = snapshotClosureDigest(seed);
      const localCase = { case_id: 'RW-MODULE-CLOSURE-001', canonical_locator: 'public-sites/task9-test', entry_url: seed.entry_url, snapshot_closure_digest: seed.manifest_digest, task_script: taskScript };
      const activeRunnerHelper = "export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:'http://127.0.0.1:9/'});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n";
      const activeTransportHelper = "export async function request({url}){const bytes=Buffer.from('UNREGISTERED_HELPER_EVIDENCE');return{status:200,final_url:url,headers:[],body:bytes,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:bytes}]};}\n";
      const race = await writeRegistry(
        registryDir,
        'runner.mjs',
        [['runner.mjs', runnerEntry], ['runner-helper.mjs', activeRunnerHelper]],
        'transport.mjs',
        [['transport.mjs', transportEntry], ['transport-helper.mjs', activeTransportHelper]],
        { caseId: localCase.case_id, taskDigest },
      );
      let registry;
      try { registry = await createCaptureRegistry(race.manifestPath); } catch {}
      await writeFile(join(registryDir, 'transport-helper.mjs'), `${activeTransportHelper}// MUTATED_AFTER_REGISTRATION\n`);
      await writeFile(join(publicDir, 'module.json'), `${canonicalize(localCase)}\n`);
      await writeFile(join(fixtureDir, `${localCase.case_id}.snapshot-closure.json`), `${canonicalize(seed)}\n`);
      const casPath = join(raceDir, 'cas'), outputPath = join(raceDir, 'output.json');
      if (registry) {
        const exitCode = await runCaptureCli(['--case', join(publicDir, 'module.json'), '--cas', casPath, '--output', outputPath], { registry });
        let casTouched = false;
        try { await access(casPath); casTouched = true; } catch {}
        if (exitCode !== 2 || casTouched) issues.push(`helper-mutation-not-closed-before-target-cas:${exitCode}:${casTouched}`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    assert.deepEqual(issues, [], `TASK9_MODULE_CLOSURE_RED:${issues.join(',')}`);
  });

  test('TASK9_MODULE_LOADER_RED', async () => {
    const issues = [];
    const root = await mkdtemp(join(tmpdir(), 'task9-module-loader-red-'));
    const loaderServer=createServer((request,response)=>{const bodies={'/runner-a':'TRANSPORT_A','/runner-b':'TRANSPORT_B','/benign-entry':'BENIGN_DECLARED_BYTES','/malicious-prepoisoned-entry':'MALICIOUS_PREPOISONED_NAMESPACE'},body=bodies[request.url]??'UNKNOWN';response.writeHead(body==='UNKNOWN'?404:200,{'content-type':'text/plain'});response.end(body)});await new Promise((resolve,reject)=>{loaderServer.once('error',reject);loaderServer.listen(0,'127.0.0.1',resolve)});const loaderOrigin=`http://127.0.0.1:${loaderServer.address().port}`;
    const taskScript = { task_script_id: 'module-loader-task-v1', steps: [{ step_id: 'visit', instruction: 'Use the registered deterministic action.', required_replay_profile_ids: ['module-loader-profile'] }] };
    const taskDigest = sha(Buffer.from(canonicalize(taskScript)));
    const activeProfile = profile('module-loader-profile', { browser_engine_digest: d('e') });
    const runnerEntryDynamic = "export async function run(context){return (await import('./runner-helper.mjs')).run(context);}\n";
    const transportEntryDynamic = "export async function request(input){return (await import('./transport-helper.mjs')).request(input);}\n";
    const runnerHelper = (marker) => `export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:${JSON.stringify(loaderOrigin)}+'/${marker}'});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`;
    const transportHelper = (marker) => `const expected=${JSON.stringify(marker)};export async function request({url}){const response=await fetch(url,{redirect:'manual'}),bytes=Buffer.from(await response.arrayBuffer()),headers=[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));if(bytes.toString()!==expected)throw new Error('TRANSPORT_BYTES_INVALID');return{status:response.status,final_url:url,headers,body:bytes,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:bytes}]};}\n`;
    const rows = (sources) => Object.entries(sources).map(([relative_path, source]) => ({ relative_path, raw_sha256: sha(Buffer.from(source)) })).sort((left, right) => Buffer.compare(Buffer.from(left.relative_path), Buffer.from(right.relative_path)));
    const writeFixture = async (directory, caseId) => {
      const publicDir = join(directory, 'evals', 'public-cases'), fixtureDir = join(directory, 'evals', 'fixtures');
      await mkdir(publicDir, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      const seed = { closure_version: 'snapshot-closure-v1', entry_url: `${loaderOrigin}/`, task_script_digest: d('1'), capture_environment_digest: d('2'), captured_at: '2026-08-20T00:00:00Z', authenticated: false, replay_profiles: [activeProfile], network_records: [], observation_records: [], outbound_effect_ledger_digest: d('3'), completeness_status: 'incomplete', manifest_digest: '' };
      seed.manifest_digest = snapshotClosureDigest(seed);
      const caseManifest = { case_id: caseId, canonical_locator: 'public-sites/task9-test', entry_url: seed.entry_url, snapshot_closure_digest: seed.manifest_digest, task_script: taskScript };
      const casePath = join(publicDir, 'case.json');
      await writeFile(casePath, `${canonicalize(caseManifest)}\n`);
      await writeFile(join(fixtureDir, `${caseId}.snapshot-closure.json`), `${canonicalize(seed)}\n`);
      return casePath;
    };
    const writeRegistry = async (directory, caseId, runnerSources, transportSources) => {
      await mkdir(directory, { recursive: true });
      for (const [relativePath, source] of Object.entries({ ...runnerSources, ...transportSources })) await writeFile(join(directory, relativePath), source);
      const manifest = { registry_version: 'snapshot-capture-registry-v1', entries: [{ case_id: caseId, task_script_digest: taskDigest, runner_path: 'runner.mjs', runner_digest: sha(Buffer.from(runnerSources['runner.mjs'])), runner_module_closure: rows(runnerSources), transport_path: 'transport.mjs', transport_digest: sha(Buffer.from(transportSources['transport.mjs'])), transport_module_closure: rows(transportSources) }], registry_digest: '' };
      manifest.registry_digest = captureRegistryDigest(manifest);
      const manifestPath = join(directory, 'capture-registry.json');
      await writeFile(manifestPath, `${canonicalize(manifest)}\n`);
      return { manifest, manifestPath };
    };
    const invoke = async (directory, casePath, registry, name) => {
      const casPath = join(directory, `cas-${name}`), outputPath = join(directory, `output-${name}.json`);
      const exitCode = await runCaptureCli(['--case', casePath, '--cas', casPath, '--output', outputPath], { registry });
      let wrapper, observation = '';
      try {
        wrapper = JSON.parse(await readFile(outputPath, 'utf8'));
        const locator = wrapper?.closure?.observation_records?.[0]?.content_addressed_artifact_locator;
        if (locator) observation = await readFile(join(casPath, locator.slice(4)), 'utf8');
      } catch {}
      return { casPath, exitCode, observation, wrapper };
    };
    try {
      const cacheRoot = join(root, 'same-process-cache'), registryDir = join(cacheRoot, 'registry'), caseId = 'RW-MODULE-CACHE-001';
      const casePath = await writeFixture(cacheRoot, caseId);
      const runnerA = { 'runner.mjs': runnerEntryDynamic, 'runner-helper.mjs': runnerHelper('runner-a') };
      const transportA = { 'transport.mjs': transportEntryDynamic, 'transport-helper.mjs': transportHelper('TRANSPORT_A') };
      const registryAPath = await writeRegistry(registryDir, caseId, runnerA, transportA);
      const registryA = await createCaptureRegistry(registryAPath.manifestPath);
      const runA = await invoke(cacheRoot, casePath, registryA, 'a');
      if (runA.exitCode !== 0 || runA.wrapper?.closure?.network_records?.[0]?.request_url !== `${loaderOrigin}/runner-a` || runA.observation !== 'TRANSPORT_A') issues.push('registry-a-control-failed');

      const runnerB = { 'runner.mjs': runnerEntryDynamic, 'runner-helper.mjs': runnerHelper('runner-b') };
      const transportB = { 'transport.mjs': transportEntryDynamic, 'transport-helper.mjs': transportHelper('TRANSPORT_B') };
      const registryBPath = await writeRegistry(registryDir, caseId, runnerB, transportB);
      if (registryAPath.manifest.registry_digest === registryBPath.manifest.registry_digest) issues.push('registry-b-identity-did-not-change');
      let registryB;
      try { registryB = await createCaptureRegistry(registryBPath.manifestPath); } catch {}
      if (registryB) {
        const runB = await invoke(cacheRoot, casePath, registryB, 'b');
        if (runB.exitCode !== 0) issues.push(`registry-b-not-executable:${runB.exitCode}`);
        if (runB.wrapper?.closure?.network_records?.[0]?.request_url !== `${loaderOrigin}/runner-b`) issues.push('runner-helper-cache-reused-a');
        if (runB.observation !== 'TRANSPORT_B') issues.push('transport-helper-cache-reused-a');
      }

      const poisonRoot = join(root, 'prepoisoned-entry'), poisonRegistryDir = join(poisonRoot, 'registry'), poisonCaseId = 'RW-MODULE-POISON-001';
      const poisonCasePath = await writeFixture(poisonRoot, poisonCaseId);
      const directRunner = `export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:${JSON.stringify(`${loaderOrigin}/benign-entry`)}});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`;
      const maliciousRunner = directRunner.replace('/benign-entry', '/malicious-prepoisoned-entry');
      const directTransport = (marker) => `const expected=${JSON.stringify(marker)};export async function request({url}){const response=await fetch(url,{redirect:'manual'}),bytes=Buffer.from(await response.arrayBuffer()),headers=[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));if(bytes.toString()!==expected)throw new Error('TRANSPORT_BYTES_INVALID');return{status:response.status,final_url:url,headers,body:bytes,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:bytes}]};}\n`;
      const benignTransport = directTransport('BENIGN_DECLARED_BYTES'), maliciousTransport = directTransport('MALICIOUS_PREPOISONED_NAMESPACE');
      const poisonManifest = await writeRegistry(poisonRegistryDir, poisonCaseId, { 'runner.mjs': directRunner }, { 'transport.mjs': benignTransport });
      const poisonRunnerPath = join(poisonRegistryDir, 'runner.mjs'), poisonTransportPath = join(poisonRegistryDir, 'transport.mjs');
      await writeFile(poisonRunnerPath, maliciousRunner);
      await writeFile(poisonTransportPath, maliciousTransport);
      await import(`${pathToFileURL(poisonRunnerPath).href}?registry=${poisonManifest.manifest.registry_digest}`);
      await import(`${pathToFileURL(poisonTransportPath).href}?registry=${poisonManifest.manifest.registry_digest}`);
      await writeFile(poisonRunnerPath, directRunner);
      await writeFile(poisonTransportPath, benignTransport);
      let poisonedRegistry;
      try { poisonedRegistry = await createCaptureRegistry(poisonManifest.manifestPath); } catch {}
      if (poisonedRegistry) {
        const poisonedRun = await invoke(poisonRoot, poisonCasePath, poisonedRegistry, 'poisoned');
        if (poisonedRun.wrapper?.closure?.network_records?.[0]?.request_url === 'http://127.0.0.1:9/malicious-prepoisoned-entry') issues.push('prepoisoned-runner-entry-namespace-accepted');
        if (poisonedRun.observation === 'MALICIOUS_PREPOISONED_NAMESPACE') issues.push('prepoisoned-entry-namespace-accepted');
        if (poisonedRun.exitCode === 0 && poisonedRun.observation !== 'BENIGN_DECLARED_BYTES') issues.push('declared-entry-bytes-not-executed');
      } else {
        let casTouched = false;
        try { await access(join(poisonRoot, 'cas-poisoned')); casTouched = true; } catch {}
        if (casTouched) issues.push('prepoison-rejection-touched-cas');
      }
    } finally {
      const closing=new Promise(resolve=>loaderServer.close(resolve));loaderServer.closeAllConnections();await closing;await rm(root, { recursive: true, force: true });
    }
    assert.deepEqual(issues, [], `TASK9_MODULE_LOADER_RED:${issues.join(',')}`);
  });

  test('TASK9_STAGE_LIFECYCLE_RED', async () => {
    const issues = [];
    const root = await mkdtemp(join(tmpdir(), 'task9-stage-lifecycle-red-'));
    const staticServer=createServer((request,response)=>{response.writeHead(200,{'content-type':'text/plain'});response.end(request.url)});await new Promise((resolve,reject)=>{staticServer.once('error',reject);staticServer.listen(0,'127.0.0.1',resolve)});const staticOrigin=`http://127.0.0.1:${staticServer.address().port}`;
    const activeProfile = profile('stage-lifecycle-profile', { browser_engine_digest: d('f') });
    const taskScript = { task_script_id: 'stage-lifecycle-v1', steps: [{ step_id: 'visit', instruction: 'Use registered action.', required_replay_profile_ids: [activeProfile.replay_profile_id] }] };
    const taskDigest = sha(Buffer.from(canonicalize(taskScript)));
    const stageNames = async () => new Set((await readdir(tmpdir())).filter((name) => name.startsWith('ux-skill-runner-') || name.startsWith('ux-skill-transport-')));
    const cleanNewStages = async (before, label) => {
      const after = await stageNames(), residual = [...after].filter((name) => !before.has(name));
      if (residual.length) issues.push(`${label}-stage-residue:${residual.length}`);
      await Promise.all(residual.map((name) => rm(join(tmpdir(), name), { recursive: true, force: true })));
    };
    const closureRows = (sources) => Object.entries(sources).map(([relative_path, source]) => ({ relative_path, raw_sha256: sha(Buffer.from(source)) })).sort((left, right) => Buffer.compare(Buffer.from(left.relative_path), Buffer.from(right.relative_path)));
    const writeCase = async (directory, caseId, locator = 'http://127.0.0.1:9/') => {
      const publicDir = join(directory, 'evals', 'public-cases'), fixtureDir = join(directory, 'evals', 'fixtures');
      await mkdir(publicDir, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      const fixture = { closure_version: 'snapshot-closure-v1', entry_url: locator, task_script_digest: d('1'), capture_environment_digest: d('2'), captured_at: '2026-08-20T00:00:00Z', authenticated: false, replay_profiles: [activeProfile], network_records: [], observation_records: [], outbound_effect_ledger_digest: d('3'), completeness_status: 'incomplete', manifest_digest: '' };
      fixture.manifest_digest = snapshotClosureDigest(fixture);
      const casePath = join(publicDir, `${caseId}.json`);
      await writeFile(casePath, `${canonicalize({ case_id: caseId, canonical_locator: 'public-sites/task9-test', entry_url: locator, snapshot_closure_digest: fixture.manifest_digest, task_script: taskScript })}\n`);
      await writeFile(join(fixtureDir, `${caseId}.snapshot-closure.json`), `${canonicalize(fixture)}\n`);
      return casePath;
    };
    const writeRegistry = async (directory, specifications) => {
      await mkdir(directory, { recursive: true });
      const entries = [];
      for (const specification of specifications) {
        for (const [relativePath, source] of Object.entries({ ...specification.runnerSources, ...specification.transportSources })) await writeFile(join(directory, relativePath), source);
        entries.push({ case_id: specification.caseId, task_script_digest: taskDigest, runner_path: specification.runnerPath, runner_digest: sha(Buffer.from(specification.runnerSources[specification.runnerPath])), runner_module_closure: closureRows(specification.runnerSources), transport_path: specification.transportPath, transport_digest: sha(Buffer.from(specification.transportSources[specification.transportPath])), transport_module_closure: closureRows(specification.transportSources) });
      }
      entries.sort((left, right) => Buffer.compare(Buffer.from(canonicalize([left.case_id, left.task_script_digest])), Buffer.from(canonicalize([right.case_id, right.task_script_digest]))));
      const manifest = { registry_version: 'snapshot-capture-registry-v1', entries, registry_digest: '' };
      manifest.registry_digest = captureRegistryDigest(manifest);
      const manifestPath = join(directory, 'capture-registry.json');
      await writeFile(manifestPath, `${canonicalize(manifest)}\n`);
      return manifestPath;
    };
    const directRunner = (url) => `export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:${JSON.stringify(url)}});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`;
    const directTransport = "export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer()),headers=[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));return{status:response.status,final_url:url,headers,body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n";
    const spec = (caseId, prefix, runnerSource, transportSource = directTransport, extraRunner = {}) => ({ caseId, runnerPath: `${prefix}-runner.mjs`, runnerSources: { [`${prefix}-runner.mjs`]: runnerSource, ...extraRunner }, transportPath: `${prefix}-transport.mjs`, transportSources: { [`${prefix}-transport.mjs`]: transportSource } });
    const invoke = async (directory, casePath, registry, name) => runCaptureCli(['--case', casePath, '--cas', join(directory, `cas-${name}`), '--output', join(directory, `output-${name}.json`)], { registry });
    let gateServer;
    try {
      const multiRoot = join(root, 'multi'), multiRegistryDir = join(multiRoot, 'registry'), caseA = 'RW-STAGE-MULTI-A', caseB = 'RW-STAGE-MULTI-B';
      const caseAPath = await writeCase(multiRoot, caseA);
      await writeCase(multiRoot, caseB);
      const multiManifest = await writeRegistry(multiRegistryDir, [spec(caseA, 'a', directRunner(`${staticOrigin}/a`)), spec(caseB, 'b', directRunner(`${staticOrigin}/b`))]);
      const beforeMulti = await stageNames(), multiRegistry = await createCaptureRegistry(multiManifest), multiExit = await invoke(multiRoot, caseAPath, multiRegistry, 'selected-a');
      if (multiExit !== 0) issues.push(`multi-selected-exit:${multiExit}`);
      await cleanNewStages(beforeMulti, 'multi-unselected-entry');

      const failureRoot = join(root, 'construction-failure'), beforeFailure = await stageNames();
      const failureManifest = await writeRegistry(join(failureRoot, 'registry'), [spec('RW-STAGE-CONSTRUCT-A', 'good', directRunner('http://127.0.0.1:9/good')), spec('RW-STAGE-CONSTRUCT-B', 'bad', directRunner('http://127.0.0.1:9/bad'), 'export const notRequest=true;\n')]);
      await assert.rejects(() => createCaptureRegistry(failureManifest)).catch(() => issues.push('construction-failure-accepted'));
      await cleanNewStages(beforeFailure, 'construction-failure');

      for (const [label, runnerSource] of [['partial', 'export async function run(){}\n'], ['throw', "export async function run(){throw new Error('runner-throw');}\n"]]) {
        const branchRoot = join(root, label), caseId = `RW-STAGE-${label.toUpperCase()}`, casePath = await writeCase(branchRoot, caseId), before = await stageNames();
        const manifestPath = await writeRegistry(join(branchRoot, 'registry'), [spec(caseId, label, runnerSource)]), registry = await createCaptureRegistry(manifestPath), exitCode = await invoke(branchRoot, casePath, registry, label);
        if (exitCode !== 2) issues.push(`${label}-exit:${exitCode}`);
        await cleanNewStages(before, label);
      }

      let gateCount = 0, pendingFirst;
      gateServer = createServer((request, response) => {
        if (request.url === '/gate') {
          gateCount += 1;
          if (gateCount === 1) { pendingFirst = response; return; }
          response.writeHead(302, { location: '/second' }); response.end();
          pendingFirst.writeHead(302, { location: '/first' }); pendingFirst.end(); pendingFirst = null; return;
        }
        if (request.url === '/first' || request.url === '/second') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end(request.url); return; }
        response.writeHead(404).end();
      });
      await new Promise((resolve, reject) => { gateServer.once('error', reject); gateServer.listen(0, '127.0.0.1', resolve); });
      const origin = `http://127.0.0.1:${gateServer.address().port}`, concurrentRoot = join(root, 'concurrent'), concurrentCase = 'RW-STAGE-CONCURRENT', concurrentCasePath = await writeCase(concurrentRoot, concurrentCase, `${origin}/gate`);
      const concurrentRunner = `export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:${JSON.stringify(`${origin}/gate`)}});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});if(response.final_url.endsWith('/second')){await new Promise(resolve=>setTimeout(resolve,200));await import('./delayed-helper.mjs');}});}\n`;
      const concurrentTransport = `const headers=response=>[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));export async function request({url}){const hop=await fetch(url,{redirect:'manual'}),location=new URL(hop.headers.get('location'),url).href,final=await fetch(location,{redirect:'manual'}),body=Buffer.from(await final.arrayBuffer());return{status:final.status,final_url:location,headers:headers(final),body,redirect_chain:[{sequence:0,status:hop.status,url,location,response_headers:headers(hop)}],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;
      const concurrentSpec = spec(concurrentCase, 'concurrent', concurrentRunner, concurrentTransport, { 'delayed-helper.mjs': 'export const verified=true;\n' });
      const concurrentManifest = await writeRegistry(join(concurrentRoot, 'registry'), [concurrentSpec]), beforeConcurrent = await stageNames(), concurrentRegistry = await createCaptureRegistry(concurrentManifest);
      const concurrentExits = await Promise.all([invoke(concurrentRoot, concurrentCasePath, concurrentRegistry, 'one'), invoke(concurrentRoot, concurrentCasePath, concurrentRegistry, 'two')]);
      if (JSON.stringify(concurrentExits.sort()) !== JSON.stringify([0, 0])) issues.push(`concurrent-stage-disposed-early:${concurrentExits.join(',')}`);
      await cleanNewStages(beforeConcurrent, 'concurrent');
    } finally {
      if (gateServer) await new Promise((resolve) => gateServer.close(resolve));const closing=new Promise(resolve=>staticServer.close(resolve));staticServer.closeAllConnections();await closing;
      await rm(root, { recursive: true, force: true });
    }
    assert.deepEqual(issues, [], `TASK9_STAGE_LIFECYCLE_RED:${issues.join(',')}`);
  });

  test('TASK9_PACKAGED_CLI_RED', async () => {
    const issues = [];
    const requestedPaths = [];
    const server = createServer((request, response) => {
      requestedPaths.push(request.url);
      const bodies = { '/one': '<main>CLI_STEP_ONE</main>', '/two': '<main>CLI_STEP_TWO</main>' };
      const body = bodies[request.url] ?? '<main>NOT_FOUND</main>';
      response.writeHead(bodies[request.url] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'x-cli-route': request.url });
      response.end(body);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`, root = await mkdtemp(join(tmpdir(), 'task9-packaged-cli-red-'));
    const runCli = (arguments_, packaged = false) => new Promise((resolve) => {
      const child = packaged
        ? spawn('pnpm', ['capture:closure', '--', ...arguments_], { stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn(process.execPath, ['scripts/capture-snapshot-closure.mjs', ...arguments_], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', (error) => resolve({ code: null, error, stderr, stdout }));
      child.once('close', (code) => resolve({ code, stderr, stdout }));
    });
    const readWrapper = async (outputPath) => { try { return JSON.parse(await readFile(outputPath, 'utf8')); } catch { return null; } };
    const isClosed = (wrapper) => wrapper?.closure === null && wrapper?.completeness_status === 'incomplete' && wrapper?.run_status === 'target_unavailable' && wrapper?.release_gate === 'no_release' && Array.isArray(wrapper?.run_issues) && wrapper.run_issues.length > 0;
    const pathExists = async (path) => { try { await access(path); return true; } catch { return false; } };
    try {
      const publicDir = join(root, 'evals', 'public-cases'), fixtureDir = join(root, 'evals', 'fixtures'), registryDir = join(root, 'registry');
      await mkdir(publicDir, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      await mkdir(registryDir, { recursive: true });
      const cliProfile = profile('packaged-cli-profile', { browser_engine_digest: d('9') });
      const taskScript = { task_script_id: 'packaged-cli-v1', steps: [
        { step_id: 'visit-one', instruction: 'Use registered route one.', required_replay_profile_ids: [cliProfile.replay_profile_id] },
        { step_id: 'visit-two', instruction: 'Use registered route two.', required_replay_profile_ids: [cliProfile.replay_profile_id] },
      ] };
      const taskDigest = sha(Buffer.from(canonicalize(taskScript))), caseId = 'RW-PACKAGED-CLI-001';
      const fixture = { closure_version: 'snapshot-closure-v1', entry_url: `${origin}/one`, task_script_digest: d('1'), capture_environment_digest: d('2'), captured_at: '2026-08-20T00:00:00Z', authenticated: false, replay_profiles: [cliProfile], network_records: [], observation_records: [], outbound_effect_ledger_digest: d('3'), completeness_status: 'incomplete', manifest_digest: '' };
      fixture.manifest_digest = snapshotClosureDigest(fixture);
      const casePath = join(publicDir, 'packaged-cli.json'), caseManifest = { case_id: caseId, canonical_locator: 'public-sites/task9-test', entry_url: `${origin}/one`, snapshot_closure_digest: fixture.manifest_digest, task_script: taskScript };
      await writeFile(casePath, `${canonicalize(caseManifest)}\n`);
      await writeFile(join(fixtureDir, `${caseId}.snapshot-closure.json`), `${canonicalize(fixture)}\n`);
      const runnerSource = `const origin=${JSON.stringify(origin)};export async function run({profiles,steps,executeStep}){for(const step of steps){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:step.step_id},async({request,observe})=>{const response=await request({method:'GET',url:origin+(step.step_id==='visit-one'?'/one':'/two')});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}}\n`;
      const transportSource = "const headers=response=>[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));export async function request({method,url}){const response=await fetch(url,{method,redirect:'manual'}),body=Buffer.from(await response.arrayBuffer());return{status:response.status,final_url:url,headers:headers(response),body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n";
      const runnerPath = join(registryDir, 'runner.mjs'), transportPath = join(registryDir, 'transport.mjs'), registryPath = join(registryDir, 'capture-registry.json');
      await writeFile(runnerPath, runnerSource);
      await writeFile(transportPath, transportSource);
      const registryManifest = { registry_version: 'snapshot-capture-registry-v1', entries: [{ case_id: caseId, task_script_digest: taskDigest, runner_path: 'runner.mjs', runner_digest: sha(Buffer.from(runnerSource)), runner_module_closure: [{ relative_path: 'runner.mjs', raw_sha256: sha(Buffer.from(runnerSource)) }], transport_path: 'transport.mjs', transport_digest: sha(Buffer.from(transportSource)), transport_module_closure: [{ relative_path: 'transport.mjs', raw_sha256: sha(Buffer.from(transportSource)) }] }], registry_digest: '' };
      registryManifest.registry_digest = captureRegistryDigest(registryManifest);
      await writeFile(registryPath, `${canonicalize(registryManifest)}\n`);

      const positiveCas = join(root, 'cas-positive'), positiveOutput = join(root, 'output-positive.json');
      requestedPaths.length = 0;
      const positive = await runCli(['--case', casePath, '--registry', registryPath, '--cas', positiveCas, '--output', positiveOutput], true), positiveWrapper = await readWrapper(positiveOutput);
      if (positive.code !== 0 || positiveWrapper?.completeness_status !== 'complete' || positiveWrapper?.run_status !== 'completed' || positiveWrapper?.release_gate !== 'no_release') issues.push(`packaged-positive-not-complete:${positive.code}`);
      if (requestedPaths.join(',') !== '/one,/two') issues.push(`packaged-positive-steps:${requestedPaths.join(',')}`);
      if (positiveWrapper?.closure) {
        const diskCas = { async get(locator) { try { return await readFile(join(positiveCas, locator.slice(4))); } catch { return null; } } };
        try { const replay = await replayClosure(positiveWrapper.closure, diskCas); if (replay.run_status !== 'completed' || replay.live_network_events !== 0) issues.push('packaged-positive-replay-invalid'); } catch { issues.push('packaged-positive-not-replayable'); }
        const observationBytes = [];
        for (const row of positiveWrapper.closure.observation_records ?? []) { try { observationBytes.push(await readFile(join(positiveCas, row.content_addressed_artifact_locator.slice(4)), 'utf8')); } catch {} }
        if (!observationBytes.some((value) => value.includes('CLI_STEP_ONE')) || !observationBytes.some((value) => value.includes('CLI_STEP_TWO'))) issues.push('packaged-positive-artifacts-missing');
      }

      const negative = async (label, arguments_, expectedCode) => {
        const casPath = join(root, `cas-${label}`), outputPath = join(root, `output-${label}.json`);
        requestedPaths.length = 0;
        const result = await runCli([...arguments_, '--cas', casPath, '--output', outputPath]), wrapper = await readWrapper(outputPath);
        if (result.code !== expectedCode) issues.push(`${label}-exit:${result.code}`);
        if (expectedCode === 2 && !isClosed(wrapper)) issues.push(`${label}-wrapper-not-closed`);
        if (requestedPaths.length !== 0) issues.push(`${label}-touched-target`);
        if (await pathExists(casPath)) issues.push(`${label}-touched-cas`);
      };
      await negative('missing-registry', ['--case', casePath], 2);
      const malformedRegistry = join(root, 'malformed-registry.json');
      await writeFile(malformedRegistry, '{not-json\n');
      await negative('malformed-registry', ['--case', casePath, '--registry', malformedRegistry], 2);
      await writeFile(transportPath, `${transportSource}// CHANGED_AFTER_MANIFEST\n`);
      await negative('changed-registry', ['--case', casePath, '--registry', registryPath], 2);

      const unknownCas = join(root, 'cas-unknown'), unknownOutput = join(root, 'output-unknown.json');
      requestedPaths.length = 0;
      const unknown = await runCli(['--case', casePath, '--registry', registryPath, '--cas', unknownCas, '--output', unknownOutput, '--unknown', 'value']);
      if (unknown.code !== 64) issues.push(`unknown-arg-exit:${unknown.code}`);
      if (requestedPaths.length !== 0 || await pathExists(unknownCas)) issues.push('unknown-arg-touched-target-or-cas');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
    assert.deepEqual(issues, [], `TASK9_PACKAGED_CLI_RED:${issues.join(',')}`);
  });

  test('TASK9_MODULE_AUTHORITY_RED', async () => {
    const issues = [], requests = [];
    const server = createServer((request, response) => {
      requests.push(request.url);
      response.writeHead(200, { 'content-type': 'text/plain', 'x-authority-route': request.url });
      response.end(request.url);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`, root = await mkdtemp(join(tmpdir(), 'task9-module-authority-red-'));
    const stageNames = async () => new Set((await readdir(tmpdir())).filter((name) => name.startsWith('ux-skill-runner-') || name.startsWith('ux-skill-transport-')));
    const pathExists = async (path) => { try { await access(path); return true; } catch { return false; } };
    const runNodeCli = (arguments_) => new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/capture-snapshot-closure.mjs', ...arguments_], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', (error) => resolve({ code: null, error, stderr, stdout }));
      child.once('close', (code) => resolve({ code, stderr, stdout }));
    });
    const authorityProfile = profile('module-authority-profile', { browser_engine_digest: d('8') });
    const taskScript = { task_script_id: 'module-authority-v1', steps: [{ step_id: 'visit', instruction: 'Use registered request capability.', required_replay_profile_ids: [authorityProfile.replay_profile_id] }] };
    const taskDigest = sha(Buffer.from(canonicalize(taskScript)));
    const writeCase = async (directory, caseId, locator) => {
      const publicDir = join(directory, 'evals', 'public-cases'), fixtureDir = join(directory, 'evals', 'fixtures');
      await mkdir(publicDir, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      const fixture = { closure_version: 'snapshot-closure-v1', entry_url: locator, task_script_digest: d('1'), capture_environment_digest: d('2'), captured_at: '2026-08-20T00:00:00Z', authenticated: false, replay_profiles: [authorityProfile], network_records: [], observation_records: [], outbound_effect_ledger_digest: d('3'), completeness_status: 'incomplete', manifest_digest: '' };
      fixture.manifest_digest = snapshotClosureDigest(fixture);
      const casePath = join(publicDir, `${caseId}.json`);
      await writeFile(casePath, `${canonicalize({ case_id: caseId, canonical_locator: 'public-sites/task9-test', entry_url: locator, snapshot_closure_digest: fixture.manifest_digest, task_script: taskScript })}\n`);
      await writeFile(join(fixtureDir, `${caseId}.snapshot-closure.json`), `${canonicalize(fixture)}\n`);
      return casePath;
    };
    const runnerSource = `const target=${JSON.stringify(`${origin}/selected`)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:target});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`;
    const transportFunction = "export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer());return{status:response.status,final_url:url,headers:[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')})),body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n";
    const writeRegistry = async (directory, specifications) => {
      await mkdir(directory, { recursive: true });
      const entries = [];
      for (const specification of specifications) {
        const runnerPath = `${specification.prefix}-runner.mjs`, transportPath = `${specification.prefix}-transport.mjs`;
        await writeFile(join(directory, runnerPath), specification.runnerSource);
        await writeFile(join(directory, transportPath), specification.transportSource);
        entries.push({ case_id: specification.caseId, task_script_digest: taskDigest, runner_path: runnerPath, runner_digest: sha(Buffer.from(specification.runnerSource)), runner_module_closure: [{ relative_path: runnerPath, raw_sha256: sha(Buffer.from(specification.runnerSource)) }], transport_path: transportPath, transport_digest: sha(Buffer.from(specification.transportSource)), transport_module_closure: [{ relative_path: transportPath, raw_sha256: sha(Buffer.from(specification.transportSource)) }] });
      }
      entries.sort((left, right) => Buffer.compare(Buffer.from(canonicalize([left.case_id, left.task_script_digest])), Buffer.from(canonicalize([right.case_id, right.task_script_digest]))));
      const manifest = { registry_version: 'snapshot-capture-registry-v1', entries, registry_digest: '' };
      manifest.registry_digest = captureRegistryDigest(manifest);
      const registryPath = join(directory, 'capture-registry.json');
      await writeFile(registryPath, `${canonicalize(manifest)}\n`);
      return registryPath;
    };
    const assertNoStageResidue = async (before, label) => {
      const after = await stageNames(), residual = [...after].filter((name) => !before.has(name));
      if (residual.length) issues.push(`${label}-stage-residue:${residual.length}`);
      await Promise.all(residual.map((name) => rm(join(tmpdir(), name), { recursive: true, force: true })));
    };
    try {
      const invalidRoot = join(root, 'invalid-selected'), invalidCaseId = 'RW-MODULE-AUTHORITY-INVALID', invalidCasePath = await writeCase(invalidRoot, invalidCaseId, `${origin}/selected`);
      const invalidTransport = `await fetch(${JSON.stringify(`${origin}/unexpected`)});export const notRequest=true;\n`;
      const invalidRegistry = await writeRegistry(join(invalidRoot, 'registry'), [{ caseId: invalidCaseId, prefix: 'invalid', runnerSource, transportSource: invalidTransport }]);
      const invalidCas = join(invalidRoot, 'cas'), invalidOutput = join(invalidRoot, 'output.json'), beforeInvalid = await stageNames();
      requests.length = 0;
      const invalid = await runNodeCli(['--case', invalidCasePath, '--registry', invalidRegistry, '--cas', invalidCas, '--output', invalidOutput]);
      let invalidWrapper; try { invalidWrapper = JSON.parse(await readFile(invalidOutput, 'utf8')); } catch {}
      if (invalid.code !== 2 || invalidWrapper?.closure !== null || invalidWrapper?.completeness_status !== 'incomplete' || invalidWrapper?.run_status !== 'target_unavailable' || invalidWrapper?.release_gate !== 'no_release') issues.push(`invalid-registry-not-closed:${invalid.code}`);
      if (requests.length) issues.push(`invalid-registry-touched-target:${requests.join(',')}`);
      if (await pathExists(invalidCas)) issues.push('invalid-registry-touched-cas');
      await assertNoStageResidue(beforeInvalid, 'invalid-registry');

      const selectedRoot = join(root, 'unselected-entry'), selectedCaseId = 'RW-MODULE-AUTHORITY-SELECTED', unselectedCaseId = 'RW-MODULE-AUTHORITY-UNSELECTED', selectedCasePath = await writeCase(selectedRoot, selectedCaseId, `${origin}/selected`);
      const unselectedTransport = `await fetch(${JSON.stringify(`${origin}/unselected`)});${transportFunction}`;
      const selectedRegistry = await writeRegistry(join(selectedRoot, 'registry'), [
        { caseId: selectedCaseId, prefix: 'selected', runnerSource, transportSource: transportFunction },
        { caseId: unselectedCaseId, prefix: 'unselected', runnerSource, transportSource: unselectedTransport },
      ]);
      const selectedCas = join(selectedRoot, 'cas'), selectedOutput = join(selectedRoot, 'output.json'), beforeSelected = await stageNames();
      requests.length = 0;
      const selected = await runNodeCli(['--case', selectedCasePath, '--registry', selectedRegistry, '--cas', selectedCas, '--output', selectedOutput]);
      let selectedWrapper; try { selectedWrapper = JSON.parse(await readFile(selectedOutput, 'utf8')); } catch {}
      if (selected.code !== 0 || selectedWrapper?.completeness_status !== 'complete') issues.push(`selected-entry-not-complete:${selected.code}`);
      if (requests.includes('/unselected')) issues.push('unselected-entry-executed');
      if (!requests.includes('/selected')) issues.push('selected-entry-not-executed');
      await assertNoStageResidue(beforeSelected, 'selected-entry');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
    assert.deepEqual(issues, [], `TASK9_MODULE_AUTHORITY_RED:${issues.join(',')}`);
  });

  test('TASK9_AUTHORITY_LEASE_RED', async () => {
    const issues = [], requests = [];
    const server = createServer((request, response) => {
      requests.push(request.url);
      const send = () => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end(request.url); };
      if (request.url === '/slow') setTimeout(send, 150); else send();
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`, root = await mkdtemp(join(tmpdir(), 'task9-authority-lease-red-'));
    const stageNames = async () => new Set((await readdir(tmpdir())).filter((name) => name.startsWith('ux-skill-runner-') || name.startsWith('ux-skill-transport-')));
    const leaseProfile = profile('authority-lease-profile', { browser_engine_digest: d('7') });
    const taskScript = { task_script_id: 'authority-lease-v1', steps: [{ step_id: 'visit', instruction: 'Use registered request capability.', required_replay_profile_ids: [leaseProfile.replay_profile_id] }] };
    const taskDigest = sha(Buffer.from(canonicalize(taskScript)));
    const runNodeCli = (arguments_) => new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/capture-snapshot-closure.mjs', ...arguments_], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', (error) => resolve({ code: null, error, stderr, stdout }));
      child.once('close', (code) => resolve({ code, stderr, stdout }));
    });
    const writeScenario = async (label, runnerSource, transportSource, locator) => {
      const directory = join(root, label), publicDir = join(directory, 'evals', 'public-cases'), fixtureDir = join(directory, 'evals', 'fixtures'), registryDir = join(directory, 'registry'), caseId = `RW-AUTHORITY-LEASE-${label.toUpperCase()}`;
      await mkdir(publicDir, { recursive: true }); await mkdir(fixtureDir, { recursive: true }); await mkdir(registryDir, { recursive: true });
      const fixture = { closure_version: 'snapshot-closure-v1', entry_url: locator, task_script_digest: d('1'), capture_environment_digest: d('2'), captured_at: '2026-08-20T00:00:00Z', authenticated: false, replay_profiles: [leaseProfile], network_records: [], observation_records: [], outbound_effect_ledger_digest: d('3'), completeness_status: 'incomplete', manifest_digest: '' };
      fixture.manifest_digest = snapshotClosureDigest(fixture);
      const casePath = join(publicDir, `${label}.json`);
      await writeFile(casePath, `${canonicalize({ case_id: caseId, canonical_locator: 'public-sites/task9-test', entry_url: locator, snapshot_closure_digest: fixture.manifest_digest, task_script: taskScript })}\n`);
      await writeFile(join(fixtureDir, `${caseId}.snapshot-closure.json`), `${canonicalize(fixture)}\n`);
      const runnerPath = join(registryDir, 'runner.mjs'), transportPath = join(registryDir, 'transport.mjs'), registryPath = join(registryDir, 'capture-registry.json');
      await writeFile(runnerPath, runnerSource); await writeFile(transportPath, transportSource);
      const manifest = { registry_version: 'snapshot-capture-registry-v1', entries: [{ case_id: caseId, task_script_digest: taskDigest, runner_path: 'runner.mjs', runner_digest: sha(Buffer.from(runnerSource)), runner_module_closure: [{ relative_path: 'runner.mjs', raw_sha256: sha(Buffer.from(runnerSource)) }], transport_path: 'transport.mjs', transport_digest: sha(Buffer.from(transportSource)), transport_module_closure: [{ relative_path: 'transport.mjs', raw_sha256: sha(Buffer.from(transportSource)) }] }], registry_digest: '' };
      manifest.registry_digest = captureRegistryDigest(manifest); await writeFile(registryPath, `${canonicalize(manifest)}\n`);
      return { casePath, registryPath, casPath: join(directory, 'cas'), outputPath: join(directory, 'output.json') };
    };
    const transportPrelude = "const headers=response=>[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));";
    const verifyScenario = async (label, sources, expectedPaths, expectedRecords) => {
      const paths = await writeScenario(label, sources.runner, sources.transport, sources.locator), before = await stageNames();requests.length = 0;
      const result = await runNodeCli(['--case', paths.casePath, '--registry', paths.registryPath, '--cas', paths.casPath, '--output', paths.outputPath]);
      let wrapper; try { wrapper = JSON.parse(await readFile(paths.outputPath, 'utf8')); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (result.code !== 0 || wrapper?.completeness_status !== 'complete' || wrapper?.run_status !== 'completed') issues.push(`${label}-not-complete:${result.code}`);
      if (JSON.stringify(requests) !== JSON.stringify(expectedPaths)) issues.push(`${label}-unexpected-target-requests:${requests.join(',')}`);
      if (wrapper?.closure?.network_records?.length !== expectedRecords) issues.push(`${label}-network-record-count:${wrapper?.closure?.network_records?.length}`);
      if (/unhandled(?:Promise)?Rejection/i.test(result.stderr)) issues.push(`${label}-unhandled-rejection`);
      if (wrapper?.closure) {
        const diskCas = { async get(locator) { try { return await readFile(join(paths.casPath, locator.slice(4))); } catch { return null; } } };
        try { const replay = await replayClosure(wrapper.closure, diskCas); if (replay.run_status !== 'completed' || replay.live_network_events !== 0) issues.push(`${label}-replay-invalid`); } catch { issues.push(`${label}-replay-failed`); }
      }
      const after = await stageNames(), residual = [...after].filter((name) => !before.has(name));if (residual.length) issues.push(`${label}-stage-residue:${residual.length}`);await Promise.all(residual.map((name) => rm(join(tmpdir(), name), { recursive: true, force: true })));
    };
    try {
      const singleRunner = `const target=${JSON.stringify(`${origin}/registered`)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:target});await new Promise(resolve=>setTimeout(resolve,80));await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`;
      const singleTransport = `${transportPrelude}export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer());setTimeout(()=>{void fetch(new URL('/late-unrecorded',url)).catch(()=>{});},0);return{status:response.status,final_url:url,headers:headers(response),body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;
      await verifyScenario('single', { runner: singleRunner, transport: singleTransport, locator: `${origin}/registered` }, ['/registered'], 1);

      const overlapRunner = `const origin=${JSON.stringify(origin)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const [fast,slow]=await Promise.all([request({method:'GET',url:origin+'/fast'}),request({method:'GET',url:origin+'/slow'})]);await observe({evidence_kind:'dom_snapshot',handle:fast.observation_handles[0]});await observe({evidence_kind:'dom_snapshot',handle:slow.observation_handles[0]});});}\n`;
      const overlapTransport = `${transportPrelude}export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer());if(url.endsWith('/fast'))setTimeout(()=>{void fetch(new URL('/late-unrecorded',url)).catch(()=>{});},20);return{status:response.status,final_url:url,headers:headers(response),body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;
      await verifyScenario('overlap', { runner: overlapRunner, transport: overlapTransport, locator: `${origin}/fast` }, ['/fast', '/slow'], 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
    assert.deepEqual(issues, [], `TASK9_AUTHORITY_LEASE_RED:${issues.join(',')}`);
  });

  test('TASK9_COMPARTMENT_AUTHORITY_RED', async () => {
    const issues = [], requests = [];
    const server = createServer((request, response) => { requests.push(request.url); response.writeHead(200, { 'content-type': 'text/plain' }); response.end(request.url); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`, port = server.address().port, root = await mkdtemp(join(tmpdir(), 'task9-compartment-authority-red-'));
    const stageNames = async () => new Set((await readdir(tmpdir())).filter((name) => name.startsWith('ux-skill-runner-') || name.startsWith('ux-skill-transport-')));
    const pathExists = async (path) => { try { await access(path); return true; } catch { return false; } };
    const compartmentProfile = profile('compartment-authority-profile', { browser_engine_digest: d('6') });
    const taskScript = { task_script_id: 'compartment-authority-v1', steps: [{ step_id: 'visit', instruction: 'Use only registered capabilities.', required_replay_profile_ids: [compartmentProfile.replay_profile_id] }] };
    const taskDigest = sha(Buffer.from(canonicalize(taskScript)));
    const runNodeCli = (arguments_) => new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/capture-snapshot-closure.mjs', ...arguments_], { stdio: ['ignore', 'pipe', 'pipe'] });let stdout = '', stderr = '';
      const deadline=setTimeout(()=>child.kill('SIGKILL'),10_000);child.stdout.on('data', (chunk) => { stdout += chunk; });child.stderr.on('data', (chunk) => { stderr += chunk; });child.once('error', (error) => { clearTimeout(deadline);resolve({ code: null, error, stderr, stdout }); });child.once('close', (code) => { clearTimeout(deadline);resolve({ code, stderr, stdout }); });
    });
    const writeScenario = async (label, runnerSource, transportSource) => {
      const directory = join(root, label), publicDir = join(directory, 'evals', 'public-cases'), fixtureDir = join(directory, 'evals', 'fixtures'), registryDir = join(directory, 'registry'), caseId = `RW-COMPARTMENT-${label.toUpperCase()}`;
      await mkdir(publicDir, { recursive: true });await mkdir(fixtureDir, { recursive: true });await mkdir(registryDir, { recursive: true });
      const fixture = { closure_version: 'snapshot-closure-v1', entry_url: `${origin}/registered`, task_script_digest: d('1'), capture_environment_digest: d('2'), captured_at: '2026-08-20T00:00:00Z', authenticated: false, replay_profiles: [compartmentProfile], network_records: [], observation_records: [], outbound_effect_ledger_digest: d('3'), completeness_status: 'incomplete', manifest_digest: '' };
      fixture.manifest_digest = snapshotClosureDigest(fixture);const casePath = join(publicDir, `${label}.json`);
      await writeFile(casePath, `${canonicalize({ case_id: caseId, canonical_locator: 'public-sites/task9-test', entry_url: `${origin}/registered`, snapshot_closure_digest: fixture.manifest_digest, task_script: taskScript })}\n`);await writeFile(join(fixtureDir, `${caseId}.snapshot-closure.json`), `${canonicalize(fixture)}\n`);
      await writeFile(join(registryDir, 'runner.mjs'), runnerSource);await writeFile(join(registryDir, 'transport.mjs'), transportSource);
      const manifest = { registry_version: 'snapshot-capture-registry-v1', entries: [{ case_id: caseId, task_script_digest: taskDigest, runner_path: 'runner.mjs', runner_digest: sha(Buffer.from(runnerSource)), runner_module_closure: [{ relative_path: 'runner.mjs', raw_sha256: sha(Buffer.from(runnerSource)) }], transport_path: 'transport.mjs', transport_digest: sha(Buffer.from(transportSource)), transport_module_closure: [{ relative_path: 'transport.mjs', raw_sha256: sha(Buffer.from(transportSource)) }] }], registry_digest: '' };
      manifest.registry_digest = captureRegistryDigest(manifest);const registryPath = join(registryDir, 'capture-registry.json');await writeFile(registryPath, `${canonicalize(manifest)}\n`);
      return { directory, casePath, registryPath, casPath: join(directory, 'cas'), outputPath: join(directory, 'output.json'), fsPath: join(directory, 'outside-fs'), childPath: join(directory, 'outside-child') };
    };
    const escapeRoot = "Object['con'+'structor']('return pro'+'cess')()";
    const httpEffect = (path) => `await new Promise((resolve,reject)=>{const request=${escapeRoot}.getBuiltinModule('node:'+'http').get(${JSON.stringify(`${origin}${path}`)},{agent:false},response=>{response.resume();response.on('end',resolve);});request.on('error',reject);});`;
    const netEffect = (path) => `await new Promise((resolve,reject)=>{const socket=${escapeRoot}.getBuiltinModule('node:'+'net').connect(${port},'127.0.0.1',()=>{socket.end(${JSON.stringify(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)});resolve();});socket.on('error',reject);});`;
    const fileEffects = (fsPath, childPath) => `${escapeRoot}.getBuiltinModule('node:'+'fs').writeFileSync(${JSON.stringify(fsPath)},'outside');${escapeRoot}.getBuiltinModule('node:child_'+'pro'+'cess').execFileSync('/usr/bin/touch',[${JSON.stringify(childPath)}]);`;
    const benignRunner = `const target=${JSON.stringify(`${origin}/registered`)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:target});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`;
    const benignTransport = "export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer()),headers=[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));return{status:response.status,final_url:url,headers,body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n";
    const executeScenario = async (label, sourceFactory, expectClosed) => {
      const draftDirectory = join(root, label), pathsForSource = { fsPath: join(draftDirectory, 'outside-fs'), childPath: join(draftDirectory, 'outside-child') }, sources = sourceFactory(pathsForSource), paths = await writeScenario(label, sources.runner, sources.transport), before = await stageNames();requests.length = 0;
      const result = await runNodeCli(['--case', paths.casePath, '--registry', paths.registryPath, '--cas', paths.casPath, '--output', paths.outputPath]);let wrapper;try{wrapper=JSON.parse(await readFile(paths.outputPath,'utf8'))}catch{}await new Promise((resolve)=>setTimeout(resolve,100));
      if(expectClosed){if(result.code!==2||wrapper?.closure!==null||wrapper?.completeness_status!=='incomplete'||wrapper?.run_status!=='target_unavailable'||wrapper?.release_gate!=='no_release')issues.push(`${label}-not-closed:${result.code}`);if(await pathExists(paths.casPath))issues.push(`${label}-touched-cas`)}else{if(result.code!==0||wrapper?.completeness_status!=='complete'||wrapper?.closure?.network_records?.length!==1)issues.push(`${label}-not-complete:${result.code}`);if(wrapper?.closure){const diskCas={async get(locator){try{return await readFile(join(paths.casPath,locator.slice(4)))}catch{return null}}};try{const replay=await replayClosure(wrapper.closure,diskCas);if(replay.run_status!=='completed'||replay.live_network_events!==0)issues.push(`${label}-replay-invalid`)}catch{issues.push(`${label}-replay-failed`)}}}
      if(requests.join(',')!==(expectClosed?'':'/registered'))issues.push(`${label}-outside-requests:${requests.join(',')}`);if(await pathExists(paths.fsPath)||await pathExists(paths.childPath))issues.push(`${label}-outside-file-effect`);if(/unhandled(?:Promise)?Rejection/i.test(result.stderr))issues.push(`${label}-unhandled-rejection`);
      const after=await stageNames(),residual=[...after].filter(name=>!before.has(name));if(residual.length)issues.push(`${label}-stage-residue:${residual.length}`);await Promise.all(residual.map(name=>rm(join(tmpdir(),name),{recursive:true,force:true})));
    };
    try {
      await executeScenario('runner-top', (paths) => ({ runner: `${httpEffect('/outside-runner-http')}${fileEffects(paths.fsPath, paths.childPath)}${benignRunner}`, transport: benignTransport }), true);
      await executeScenario('transport-top', (paths) => ({ runner: benignRunner, transport: `${netEffect('/outside-transport-net')}${fileEffects(paths.fsPath, paths.childPath)}${benignTransport}` }), true);
      await executeScenario('late', (paths) => {
        const runner = `const target=${JSON.stringify(`${origin}/registered`)},escape=()=>${escapeRoot};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:target});setTimeout(()=>{try{escape().getBuiltinModule('node:'+'fs').writeFileSync(${JSON.stringify(paths.fsPath)},'late');escape().getBuiltinModule('node:child_'+'pro'+'cess').execFileSync('/usr/bin/touch',[${JSON.stringify(paths.childPath)}]);}catch{}},0);await new Promise(resolve=>setTimeout(resolve,180));await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`;
        const transport = `const escape=()=>${escapeRoot};export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer()),headers=[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));setTimeout(()=>{void(async()=>{${httpEffect('/outside-late-http')}${netEffect('/outside-late-net')}})().catch(()=>{});},0);return{status:response.status,final_url:url,headers,body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;
        return { runner, transport };
      }, false);
    } finally { const closing=new Promise((resolve)=>server.close(resolve));server.closeAllConnections();await closing;await rm(root, { recursive: true, force: true }); }
    assert.deepEqual(issues, [], `TASK9_COMPARTMENT_AUTHORITY_RED:${issues.join(',')}`);
  });

  test('TASK9_BROKER_ACCOUNTING_RED', async () => {
    const issues = [], requests = [];
    const server = createServer((request, response) => { requests.push(request.url); const finish=()=>{response.writeHead(200,{'content-type':'text/plain'});response.end(request.url)};request.url.startsWith('/late-unrecorded')?setTimeout(finish,120):finish(); });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
    const origin=`http://127.0.0.1:${server.address().port}`,root=await mkdtemp(join(tmpdir(),'task9-broker-accounting-red-')),brokerProfile=profile('broker-accounting-profile',{browser_engine_digest:d('7')}),taskScript={task_script_id:'broker-accounting-v1',steps:[{step_id:'visit',instruction:'Use only accounted registered requests.',required_replay_profile_ids:[brokerProfile.replay_profile_id]}]},taskDigest=sha(Buffer.from(canonicalize(taskScript)));
    const stageNames=async()=>new Set((await readdir(tmpdir())).filter(name=>name.startsWith('ux-skill-runner-')||name.startsWith('ux-skill-transport-'))),pathExists=async path=>{try{await access(path);return true}catch{return false}};
    const runNodeCli=arguments_=>new Promise(resolve=>{const child=spawn(process.execPath,['scripts/capture-snapshot-closure.mjs',...arguments_],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const deadline=setTimeout(()=>child.kill('SIGKILL'),10_000);child.stdout.on('data',chunk=>{stdout+=chunk});child.stderr.on('data',chunk=>{stderr+=chunk});child.once('error',error=>{clearTimeout(deadline);resolve({code:null,error,stderr,stdout})});child.once('close',code=>{clearTimeout(deadline);resolve({code,stderr,stdout})})});
    const writeScenario=async(label,runnerSource,transportSource)=>{const directory=join(root,label),publicDir=join(directory,'evals','public-cases'),fixtureDir=join(directory,'evals','fixtures'),registryDir=join(directory,'registry'),caseId=`RW-BROKER-${label.toUpperCase()}`;await mkdir(publicDir,{recursive:true});await mkdir(fixtureDir,{recursive:true});await mkdir(registryDir,{recursive:true});const fixture={closure_version:'snapshot-closure-v1',entry_url:`${origin}/registered`,task_script_digest:d('1'),capture_environment_digest:d('2'),captured_at:'2026-08-20T00:00:00Z',authenticated:false,replay_profiles:[brokerProfile],network_records:[],observation_records:[],outbound_effect_ledger_digest:d('3'),completeness_status:'incomplete',manifest_digest:''};fixture.manifest_digest=snapshotClosureDigest(fixture);const casePath=join(publicDir,`${label}.json`);await writeFile(casePath,`${canonicalize({case_id:caseId,canonical_locator: 'public-sites/task9-test', entry_url: `${origin}/registered`, snapshot_closure_digest:fixture.manifest_digest,task_script:taskScript})}\n`);await writeFile(join(fixtureDir,`${caseId}.snapshot-closure.json`),`${canonicalize(fixture)}\n`);await writeFile(join(registryDir,'runner.mjs'),runnerSource);await writeFile(join(registryDir,'transport.mjs'),transportSource);const manifest={registry_version:'snapshot-capture-registry-v1',entries:[{case_id:caseId,task_script_digest:taskDigest,runner_path:'runner.mjs',runner_digest:sha(Buffer.from(runnerSource)),runner_module_closure:[{relative_path:'runner.mjs',raw_sha256:sha(Buffer.from(runnerSource))}],transport_path:'transport.mjs',transport_digest:sha(Buffer.from(transportSource)),transport_module_closure:[{relative_path:'transport.mjs',raw_sha256:sha(Buffer.from(transportSource))}]}],registry_digest:''};manifest.registry_digest=captureRegistryDigest(manifest);const registryPath=join(registryDir,'capture-registry.json');await writeFile(registryPath,`${canonicalize(manifest)}\n`);return{casePath,registryPath,casPath:join(directory,'cas'),outputPath:join(directory,'output.json')};};
    const execute=async(label,runnerSource,transportSource,{closed,registered})=>{const paths=await writeScenario(label,runnerSource,transportSource),before=await stageNames();requests.length=0;const result=await runNodeCli(['--case',paths.casePath,'--registry',paths.registryPath,'--cas',paths.casPath,'--output',paths.outputPath]);let wrapper;try{wrapper=JSON.parse(await readFile(paths.outputPath,'utf8'))}catch{}await new Promise(resolve=>setTimeout(resolve,180));if(closed){if(result.code!==2||wrapper?.closure!==null||wrapper?.completeness_status!=='incomplete'||wrapper?.run_status!=='target_unavailable'||wrapper?.release_gate!=='no_release')issues.push(`${label}-not-closed:${result.code}`);if(await pathExists(paths.casPath))issues.push(`${label}-touched-cas`)}else{if(result.code!==0||wrapper?.completeness_status!=='complete'||wrapper?.closure?.network_records?.length!==registered.length)issues.push(`${label}-not-complete:${result.code}:${wrapper?.closure?.network_records?.length}`);if(wrapper?.closure){const diskCas={async get(locator){try{return await readFile(join(paths.casPath,locator.slice(4)))}catch{return null}}};try{const replay=await replayClosure(wrapper.closure,diskCas);if(replay.run_status!=='completed'||replay.live_network_events!==0)issues.push(`${label}-replay-invalid`)}catch{issues.push(`${label}-replay-failed`)}}}if(requests.join(',')!==registered.join(','))issues.push(`${label}-unexpected-target-requests:${requests.join(',')}`);if(/unhandled(?:Promise)?Rejection/i.test(result.stderr))issues.push(`${label}-unhandled-rejection`);const after=await stageNames(),residual=[...after].filter(name=>!before.has(name));if(residual.length)issues.push(`${label}-stage-residue:${residual.length}`);await Promise.all(residual.map(name=>rm(join(tmpdir(),name),{recursive:true,force:true})));};
    const headers="headers:[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')})),redirect_chain:[],",singleRunner=`const target=${JSON.stringify(`${origin}/registered`)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:target});await new Promise(resolve=>setTimeout(resolve,180));await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`,detachedTransport=`export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer());void fetch(new URL('/late-unrecorded',url),{redirect:'manual'}).catch(()=>{});return{status:response.status,final_url:url,${headers}body,observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;
    const overlapRunner=`const origin=${JSON.stringify(origin)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const responses=await Promise.all([request({method:'GET',url:origin+'/fast'}),request({method:'GET',url:origin+'/slow'})]);for(const response of responses)await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`,cleanTransport=`export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer());return{status:response.status,final_url:url,${headers}body,observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`,overlapDetached=`export async function request({url}){const response=await fetch(url,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer());void fetch(new URL('/late-unrecorded-'+(url.endsWith('/fast')?'fast':'slow'),url),{redirect:'manual'}).catch(()=>{});return{status:response.status,final_url:url,${headers}body,observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;
    try{await execute('single-detached',singleRunner,detachedTransport,{closed:true,registered:['/registered']});await execute('overlap-detached',overlapRunner,overlapDetached,{closed:true,registered:['/fast','/slow']});await execute('overlap-clean',overlapRunner,cleanTransport,{closed:false,registered:['/fast','/slow']})}finally{const closing=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closing;await rm(root,{recursive:true,force:true})}
    assert.deepEqual(issues,[],`TASK9_BROKER_ACCOUNTING_RED:${issues.join(',')}`);
  });

  test('TASK9_BROKER_HEADER_BINDING_RED', async () => {
    const issues=[],requests=[],fixedDate='Wed, 19 Aug 2026 00:00:00 GMT',finalBody='FINAL_HEADER_BYTES';
    const server=createServer((request,response)=>{requests.push(request.url);if(request.url==='/entry'){response.writeHead(302,[['Connection','close'],['Content-Length','0'],['Content-Security-Policy',"script-src 'none'"],['Date',fixedDate],['Location','/final'],['Set-Cookie','hop-a=1; Path=/'],['Set-Cookie','hop-b=2; Path=/'],['X-Hop-Marker','HOP_ORIGINAL']]);response.end();return}if(request.url==='/final'){response.writeHead(200,[['Connection','close'],['Content-Length',String(Buffer.byteLength(finalBody))],['Content-Security-Policy',"default-src 'none'"],['Date',fixedDate],['Set-Cookie','final-a=1; Path=/'],['Set-Cookie','final-b=2; Path=/'],['X-Final-Marker','FINAL_ORIGINAL']]);response.end(finalBody);return}response.writeHead(404,{Connection:'close'}).end()});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const origin=`http://127.0.0.1:${server.address().port}`,root=await mkdtemp(join(tmpdir(),'task9-broker-header-red-')),headerProfile=profile('broker-header-profile',{browser_engine_digest:d('8')}),taskScript={task_script_id:'broker-header-v1',steps:[{step_id:'visit',instruction:'Capture exact broker-owned ordered headers.',required_replay_profile_ids:[headerProfile.replay_profile_id]}]},taskDigest=sha(Buffer.from(canonicalize(taskScript)));
    const orderedArtifact=rows=>Buffer.from(canonicalize({headers:rows.map(([name,value],sequence)=>({sequence,name_lower_ascii:name,value_bytes_base64:b64(value)}))})),hopRows=[['connection','close'],['content-length','0'],['content-security-policy',"script-src 'none'"],['date',fixedDate],['location','/final'],['set-cookie','hop-a=1; Path=/'],['set-cookie','hop-b=2; Path=/'],['x-hop-marker','HOP_ORIGINAL']],finalRows=[['connection','close'],['content-length',String(Buffer.byteLength(finalBody))],['content-security-policy',"default-src 'none'"],['date',fixedDate],['set-cookie','final-a=1; Path=/'],['set-cookie','final-b=2; Path=/'],['x-final-marker','FINAL_ORIGINAL']];
    const stageNames=async()=>new Set((await readdir(tmpdir())).filter(name=>name.startsWith('ux-skill-runner-')||name.startsWith('ux-skill-transport-'))),pathExists=async path=>{try{await access(path);return true}catch{return false}},runNodeCli=arguments_=>new Promise(resolve=>{const child=spawn(process.execPath,['scripts/capture-snapshot-closure.mjs',...arguments_],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const deadline=setTimeout(()=>child.kill('SIGKILL'),10_000);child.stdout.on('data',chunk=>{stdout+=chunk});child.stderr.on('data',chunk=>{stderr+=chunk});child.once('error',error=>{clearTimeout(deadline);resolve({code:null,error,stderr,stdout})});child.once('close',code=>{clearTimeout(deadline);resolve({code,stderr,stdout})})});
    const writeScenario=async mode=>{const directory=join(root,mode),publicDir=join(directory,'evals','public-cases'),fixtureDir=join(directory,'evals','fixtures'),registryDir=join(directory,'registry'),caseId=`RW-BROKER-HEADER-${mode.toUpperCase()}`;await mkdir(publicDir,{recursive:true});await mkdir(fixtureDir,{recursive:true});await mkdir(registryDir,{recursive:true});const fixture={closure_version:'snapshot-closure-v1',entry_url:`${origin}/entry`,task_script_digest:d('1'),capture_environment_digest:d('2'),captured_at:'2026-08-20T00:00:00Z',authenticated:false,replay_profiles:[headerProfile],network_records:[],observation_records:[],outbound_effect_ledger_digest:d('3'),completeness_status:'incomplete',manifest_digest:''};fixture.manifest_digest=snapshotClosureDigest(fixture);const casePath=join(publicDir,`${mode}.json`);await writeFile(casePath,`${canonicalize({case_id:caseId,canonical_locator: 'public-sites/task9-test', entry_url: `${origin}/entry`, snapshot_closure_digest:fixture.manifest_digest,task_script:taskScript})}\n`);await writeFile(join(fixtureDir,`${caseId}.snapshot-closure.json`),`${canonicalize(fixture)}\n`);const runner=`const target=${JSON.stringify(`${origin}/entry`)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:target});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`,transport=`const mode=${JSON.stringify(mode)},rows=response=>[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')})),reorder=rows=>[...rows].reverse().map((row,sequence)=>({...row,sequence})),forge=(rows,name)=>rows.map(row=>row.name===name?{...row,value_bytes_base64:Buffer.from('FORGED','latin1').toString('base64')}:row);export async function request({url}){const hop=await fetch(url,{redirect:'manual'}),location=new URL(hop.headers.get('location'),url).href,final=await fetch(location,{redirect:'manual'}),body=Buffer.from(await final.arrayBuffer());let hopHeaders=rows(hop),finalHeaders=rows(final);if(mode==='final-omit')finalHeaders=[];if(mode==='final-forge')finalHeaders=forge(finalHeaders,'x-final-marker');if(mode==='final-reorder')finalHeaders=reorder(finalHeaders);if(mode==='hop-omit')hopHeaders=hopHeaders.filter(row=>row.name==='location');if(mode==='hop-forge')hopHeaders=forge(hopHeaders,'x-hop-marker');if(mode==='hop-reorder')hopHeaders=reorder(hopHeaders);return{status:final.status,final_url:location,headers:finalHeaders,body,redirect_chain:[{sequence:0,status:hop.status,url,location,response_headers:hopHeaders}],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;await writeFile(join(registryDir,'runner.mjs'),runner);await writeFile(join(registryDir,'transport.mjs'),transport);const manifest={registry_version:'snapshot-capture-registry-v1',entries:[{case_id:caseId,task_script_digest:taskDigest,runner_path:'runner.mjs',runner_digest:sha(Buffer.from(runner)),runner_module_closure:[{relative_path:'runner.mjs',raw_sha256:sha(Buffer.from(runner))}],transport_path:'transport.mjs',transport_digest:sha(Buffer.from(transport)),transport_module_closure:[{relative_path:'transport.mjs',raw_sha256:sha(Buffer.from(transport))}]}],registry_digest:''};manifest.registry_digest=captureRegistryDigest(manifest);const registryPath=join(registryDir,'capture-registry.json');await writeFile(registryPath,`${canonicalize(manifest)}\n`);return{casePath,registryPath,casPath:join(directory,'cas'),outputPath:join(directory,'output.json')};};
    const execute=async(mode,positive)=>{const paths=await writeScenario(mode),before=await stageNames();requests.length=0;const result=await runNodeCli(['--case',paths.casePath,'--registry',paths.registryPath,'--cas',paths.casPath,'--output',paths.outputPath]);let wrapper;try{wrapper=JSON.parse(await readFile(paths.outputPath,'utf8'))}catch{}if(!positive){if(result.code!==2||wrapper?.closure!==null||wrapper?.completeness_status!=='incomplete'||wrapper?.run_status!=='target_unavailable'||wrapper?.release_gate!=='no_release')issues.push(`${mode}-not-closed:${result.code}`);if(await pathExists(paths.casPath))issues.push(`${mode}-touched-cas`)}else{if(result.code!==0||wrapper?.completeness_status!=='complete'||wrapper?.closure?.network_records?.length!==1)issues.push(`exact-not-complete:${result.code}`);const record=wrapper?.closure?.network_records?.[0],hop=record?.redirect_chain?.[0];try{const finalBytes=await readFile(join(paths.casPath,record.content_addressed_header_artifact_locator.slice(4))),hopBytes=await readFile(join(paths.casPath,hop.content_addressed_header_artifact_locator.slice(4)));if(!finalBytes.equals(orderedArtifact(finalRows)))issues.push('exact-final-header-bytes-mismatch');if(!hopBytes.equals(orderedArtifact(hopRows)))issues.push('exact-hop-header-bytes-mismatch')}catch{issues.push('exact-header-artifact-missing')}if(wrapper?.closure){const diskCas={async get(locator){try{return await readFile(join(paths.casPath,locator.slice(4)))}catch{return null}}};try{const replay=await replayClosure(wrapper.closure,diskCas);if(replay.run_status!=='completed'||replay.live_network_events!==0)issues.push('exact-replay-invalid')}catch{issues.push('exact-replay-failed')}}}if(requests.join(',')!=='/entry,/final')issues.push(`${mode}-request-order:${requests.join(',')}`);if(/unhandled(?:Promise)?Rejection/i.test(result.stderr))issues.push(`${mode}-unhandled-rejection`);const after=await stageNames(),residual=[...after].filter(name=>!before.has(name));if(residual.length)issues.push(`${mode}-stage-residue:${residual.length}`);await Promise.all(residual.map(name=>rm(join(tmpdir(),name),{recursive:true,force:true})));};
    try{for(const mode of['final-omit','final-forge','final-reorder','hop-omit','hop-forge','hop-reorder'])await execute(mode,false);await execute('exact',true)}finally{const closing=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closing;await rm(root,{recursive:true,force:true})}assert.deepEqual(issues,[],`TASK9_BROKER_HEADER_BINDING_RED:${issues.join(',')}`);
  });

  test('TASK9_RAW_HEADER_SOURCE_RED', async () => {
    const issues=[],requests=[],fixedDate='Wed, 19 Aug 2026 00:00:00 GMT',bodyText='RAW_HEADER_BODY';
    const server=createServer((request,response)=>{requests.push(request.url);if(request.url==='/raw-entry'){response.writeHead(302,[['X-Hop-Zeta','hop-first'],['X-Hop-Alpha','hop-middle'],['X-Hop-Zeta','hop-second'],['Connection','close'],['Content-Length','0'],['Date',fixedDate],['Location','/raw-final']]);response.end();return}if(request.url==='/raw-final'){response.writeHead(200,[['X-Zeta','final-first'],['X-Alpha','final-middle'],['X-Zeta','final-second'],['Connection','close'],['Content-Length',String(Buffer.byteLength(bodyText))],['Date',fixedDate]]);response.end(bodyText);return}response.writeHead(404,[['Connection','close'],['Content-Length','0'],['Date',fixedDate]]);response.end()});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const origin=`http://127.0.0.1:${server.address().port}`,root=await mkdtemp(join(tmpdir(),'task9-raw-header-source-red-')),rawProfile=profile('raw-header-profile',{browser_engine_digest:d('9')}),taskScript={task_script_id:'raw-header-source-v1',steps:[{step_id:'visit',instruction:'Capture the registered raw-header route.',required_replay_profile_ids:[rawProfile.replay_profile_id]}]},taskDigest=sha(Buffer.from(canonicalize(taskScript)));
    const expectedHop={headers:[{sequence:0,name_lower_ascii:'x-hop-zeta',value_bytes_base64:b64('hop-first')},{sequence:1,name_lower_ascii:'x-hop-alpha',value_bytes_base64:b64('hop-middle')},{sequence:2,name_lower_ascii:'x-hop-zeta',value_bytes_base64:b64('hop-second')},{sequence:3,name_lower_ascii:'connection',value_bytes_base64:b64('close')},{sequence:4,name_lower_ascii:'content-length',value_bytes_base64:b64('0')},{sequence:5,name_lower_ascii:'date',value_bytes_base64:b64(fixedDate)},{sequence:6,name_lower_ascii:'location',value_bytes_base64:b64('/raw-final')}]},expectedFinal={headers:[{sequence:0,name_lower_ascii:'x-zeta',value_bytes_base64:b64('final-first')},{sequence:1,name_lower_ascii:'x-alpha',value_bytes_base64:b64('final-middle')},{sequence:2,name_lower_ascii:'x-zeta',value_bytes_base64:b64('final-second')},{sequence:3,name_lower_ascii:'connection',value_bytes_base64:b64('close')},{sequence:4,name_lower_ascii:'content-length',value_bytes_base64:b64(String(Buffer.byteLength(bodyText)))},{sequence:5,name_lower_ascii:'date',value_bytes_base64:b64(fixedDate)}]};
    const directory=join(root,'scenario'),publicDir=join(directory,'evals','public-cases'),fixtureDir=join(directory,'evals','fixtures'),registryDir=join(directory,'registry'),caseId='RW-RAW-HEADER-SOURCE-001',casePath=join(publicDir,'raw.json'),casPath=join(directory,'cas'),outputPath=join(directory,'output.json');
    const pathExists=async path=>{try{await access(path);return true}catch{return false}},stageNames=async()=>new Set((await readdir(tmpdir())).filter(name=>name.startsWith('ux-skill-runner-')||name.startsWith('ux-skill-transport-'))),runNodeCli=arguments_=>new Promise(resolve=>{const child=spawn(process.execPath,['scripts/capture-snapshot-closure.mjs',...arguments_],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const deadline=setTimeout(()=>child.kill('SIGKILL'),10_000);child.stdout.on('data',chunk=>{stdout+=chunk});child.stderr.on('data',chunk=>{stderr+=chunk});child.once('error',error=>{clearTimeout(deadline);resolve({code:null,error,stderr,stdout})});child.once('close',code=>{clearTimeout(deadline);resolve({code,stderr,stdout})})});
    try{
      await mkdir(publicDir,{recursive:true});await mkdir(fixtureDir,{recursive:true});await mkdir(registryDir,{recursive:true});const fixture={closure_version:'snapshot-closure-v1',entry_url:`${origin}/raw-entry`,task_script_digest:d('1'),capture_environment_digest:d('2'),captured_at:'2026-08-20T00:00:00Z',authenticated:false,replay_profiles:[rawProfile],network_records:[],observation_records:[],outbound_effect_ledger_digest:d('3'),completeness_status:'incomplete',manifest_digest:''};fixture.manifest_digest=snapshotClosureDigest(fixture);await writeFile(casePath,`${canonicalize({case_id:caseId,canonical_locator: 'public-sites/task9-test', entry_url: `${origin}/raw-entry`, snapshot_closure_digest:fixture.manifest_digest,task_script:taskScript})}\n`);await writeFile(join(fixtureDir,`${caseId}.snapshot-closure.json`),`${canonicalize(fixture)}\n`);
      const runner=`const target=${JSON.stringify(`${origin}/raw-entry`)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method:'GET',url:target});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`,transport=`const rows=response=>[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));export async function request({url}){const hop=await fetch(url,{redirect:'manual'}),location=new URL(hop.headers.get('location'),url).href,final=await fetch(location,{redirect:'manual'}),body=Buffer.from(await final.arrayBuffer());return{status:final.status,final_url:location,headers:rows(final),body,redirect_chain:[{sequence:0,status:hop.status,url,location,response_headers:rows(hop)}],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;await writeFile(join(registryDir,'runner.mjs'),runner);await writeFile(join(registryDir,'transport.mjs'),transport);const manifest={registry_version:'snapshot-capture-registry-v1',entries:[{case_id:caseId,task_script_digest:taskDigest,runner_path:'runner.mjs',runner_digest:sha(Buffer.from(runner)),runner_module_closure:[{relative_path:'runner.mjs',raw_sha256:sha(Buffer.from(runner))}],transport_path:'transport.mjs',transport_digest:sha(Buffer.from(transport)),transport_module_closure:[{relative_path:'transport.mjs',raw_sha256:sha(Buffer.from(transport))}]}],registry_digest:''};manifest.registry_digest=captureRegistryDigest(manifest);const registryPath=join(registryDir,'capture-registry.json');await writeFile(registryPath,`${canonicalize(manifest)}\n`);
      const before=await stageNames(),result=await runNodeCli(['--case',casePath,'--registry',registryPath,'--cas',casPath,'--output',outputPath]);let wrapper;try{wrapper=JSON.parse(await readFile(outputPath,'utf8'))}catch{}if(result.code!==0||wrapper?.completeness_status!=='complete'||wrapper?.closure?.network_records?.length!==1)issues.push(`raw-not-complete:${result.code}`);const record=wrapper?.closure?.network_records?.[0],hop=record?.redirect_chain?.[0];try{const finalBytes=await readFile(join(casPath,record.content_addressed_header_artifact_locator.slice(4))),hopBytes=await readFile(join(casPath,hop.content_addressed_header_artifact_locator.slice(4)));if(!finalBytes.equals(Buffer.from(canonicalize(expectedFinal))))issues.push('raw-final-cas-not-exact');if(!hopBytes.equals(Buffer.from(canonicalize(expectedHop))))issues.push('raw-hop-cas-not-exact')}catch{issues.push('raw-header-artifact-missing')}if(wrapper?.closure){const diskCas={async get(locator){try{return await readFile(join(casPath,locator.slice(4)))}catch{return null}}};try{const replay=await replayClosure(wrapper.closure,diskCas),response=replay.responses?.[0];if(replay.run_status!=='completed'||replay.live_network_events!==0)issues.push('raw-replay-invalid');if(!Buffer.from(canonicalize(response?.headers)).equals(Buffer.from(canonicalize(expectedFinal))))issues.push('raw-final-replay-not-exact');if(!Buffer.from(canonicalize(response?.redirects?.[0]?.headers)).equals(Buffer.from(canonicalize(expectedHop))))issues.push('raw-hop-replay-not-exact')}catch{issues.push('raw-replay-failed')}}if(requests.join(',')!=='/raw-entry,/raw-final')issues.push(`raw-request-order:${requests.join(',')}`);if(/unhandled(?:Promise)?Rejection/i.test(result.stderr))issues.push('raw-unhandled-rejection');const after=await stageNames(),residual=[...after].filter(name=>!before.has(name));if(residual.length)issues.push(`raw-stage-residue:${residual.length}`);await Promise.all(residual.map(name=>rm(join(tmpdir(),name),{recursive:true,force:true})));if(!await pathExists(outputPath))issues.push('raw-output-missing')
    }finally{const closing=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closing;await rm(root,{recursive:true,force:true})}assert.deepEqual(issues,[],`TASK9_RAW_HEADER_SOURCE_RED:${issues.join(',')}`);
  });

  test('TASK9_METHOD_BINDING_RED', async () => {
    const issues=[],requests=[],fixedDate='Wed, 19 Aug 2026 00:00:00 GMT',bodyText='METHOD_BOUND_BODY';
    const server=createServer((request,response)=>{requests.push(`${request.method} ${request.url}`);if(request.url==='/redirect-head'){response.writeHead(302,[['Connection','close'],['Content-Length','0'],['Date',fixedDate],['Location','/redirect-final']]);response.end();return}if(['/mismatch-head-get','/mismatch-get-head','/positive-get','/positive-head','/redirect-final'].includes(request.url)){response.writeHead(200,[['Connection','close'],['Content-Length',String(Buffer.byteLength(bodyText))],['Date',fixedDate],['X-Method-Seen',request.method]]);response.end(bodyText);return}response.writeHead(404,[['Connection','close'],['Content-Length','0'],['Date',fixedDate]]);response.end()});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const origin=`http://127.0.0.1:${server.address().port}`,root=await mkdtemp(join(tmpdir(),'task9-method-binding-red-')),methodProfile=profile('method-binding-profile',{browser_engine_digest:d('b')}),taskScript={task_script_id:'method-binding-v1',steps:[{step_id:'visit',instruction:'Execute the registered GET or HEAD exactly.',required_replay_profile_ids:[methodProfile.replay_profile_id]}]},taskDigest=sha(Buffer.from(canonicalize(taskScript)));
    const pathExists=async path=>{try{await access(path);return true}catch{return false}},stageNames=async()=>new Set((await readdir(tmpdir())).filter(name=>name.startsWith('ux-skill-runner-')||name.startsWith('ux-skill-transport-'))),runNodeCli=arguments_=>new Promise(resolve=>{const child=spawn(process.execPath,['scripts/capture-snapshot-closure.mjs',...arguments_],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const deadline=setTimeout(()=>child.kill('SIGKILL'),10_000);child.stdout.on('data',chunk=>{stdout+=chunk});child.stderr.on('data',chunk=>{stderr+=chunk});child.once('error',error=>{clearTimeout(deadline);resolve({code:null,error,stderr,stdout})});child.once('close',code=>{clearTimeout(deadline);resolve({code,stderr,stdout})})});
    const writeScenario=async({label,declaredMethod,path,transportMode})=>{const directory=join(root,label),publicDir=join(directory,'evals','public-cases'),fixtureDir=join(directory,'evals','fixtures'),registryDir=join(directory,'registry'),caseId=`RW-METHOD-${label.toUpperCase()}`,casePath=join(publicDir,`${label}.json`),casPath=join(directory,'cas'),outputPath=join(directory,'output.json');await mkdir(publicDir,{recursive:true});await mkdir(fixtureDir,{recursive:true});await mkdir(registryDir,{recursive:true});const fixture={closure_version:'snapshot-closure-v1',entry_url:`${origin}${path}`,task_script_digest:d('1'),capture_environment_digest:d('2'),captured_at:'2026-08-20T00:00:00Z',authenticated:false,replay_profiles:[methodProfile],network_records:[],observation_records:[],outbound_effect_ledger_digest:d('3'),completeness_status:'incomplete',manifest_digest:''};fixture.manifest_digest=snapshotClosureDigest(fixture);await writeFile(casePath,`${canonicalize({case_id:caseId,canonical_locator: 'public-sites/task9-test', entry_url: `${origin}${path}`, snapshot_closure_digest:fixture.manifest_digest,task_script:taskScript})}\n`);await writeFile(join(fixtureDir,`${caseId}.snapshot-closure.json`),`${canonicalize(fixture)}\n`);const runner=`const target=${JSON.stringify(`${origin}${path}`)},method=${JSON.stringify(declaredMethod)};export async function run({profiles,steps,executeStep}){await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[0].step_id},async({request,observe})=>{const response=await request({method,url:target});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`,transport=`const mode=${JSON.stringify(transportMode)},rows=response=>[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));export async function request({method,url}){const executed=mode==='head-as-get'?'GET':mode==='get-as-head'?'HEAD':method,hop=await fetch(url,{method:executed,redirect:'manual'});if(mode==='redirect'){const location=new URL(hop.headers.get('location'),url).href,final=await fetch(location,{method:executed,redirect:'manual'}),body=Buffer.from(await final.arrayBuffer());return{status:final.status,final_url:location,headers:rows(final),body,redirect_chain:[{sequence:0,status:hop.status,url,location,response_headers:rows(hop)}],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]}}const body=Buffer.from(await hop.arrayBuffer());return{status:hop.status,final_url:url,headers:rows(hop),body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;await writeFile(join(registryDir,'runner.mjs'),runner);await writeFile(join(registryDir,'transport.mjs'),transport);const manifest={registry_version:'snapshot-capture-registry-v1',entries:[{case_id:caseId,task_script_digest:taskDigest,runner_path:'runner.mjs',runner_digest:sha(Buffer.from(runner)),runner_module_closure:[{relative_path:'runner.mjs',raw_sha256:sha(Buffer.from(runner))}],transport_path:'transport.mjs',transport_digest:sha(Buffer.from(transport)),transport_module_closure:[{relative_path:'transport.mjs',raw_sha256:sha(Buffer.from(transport))}]}],registry_digest:''};manifest.registry_digest=captureRegistryDigest(manifest);const registryPath=join(registryDir,'capture-registry.json');await writeFile(registryPath,`${canonicalize(manifest)}\n`);return{casePath,casPath,directory,outputPath,registryPath};};
    const execute=async scenario=>{const paths=await writeScenario(scenario),before=await stageNames();requests.length=0;const result=await runNodeCli(['--case',paths.casePath,'--registry',paths.registryPath,'--cas',paths.casPath,'--output',paths.outputPath]);let wrapper;try{wrapper=JSON.parse(await readFile(paths.outputPath,'utf8'))}catch{}if(scenario.closed){if(result.code!==2||wrapper?.closure!==null||wrapper?.completeness_status!=='incomplete'||wrapper?.run_status!=='target_unavailable'||wrapper?.release_gate!=='no_release')issues.push(`${scenario.label}-not-closed:${result.code}`);if(await pathExists(paths.casPath))issues.push(`${scenario.label}-touched-cas`)}else{const record=wrapper?.closure?.network_records?.[0];if(result.code!==0||wrapper?.completeness_status!=='complete'||wrapper?.closure?.network_records?.length!==1)issues.push(`${scenario.label}-not-complete:${result.code}`);if(record?.request_method!==scenario.declaredMethod)issues.push(`${scenario.label}-closure-method:${record?.request_method}`);if(scenario.declaredMethod==='HEAD'&&record){try{const body=await readFile(join(paths.casPath,record.content_addressed_body_artifact_locator.slice(4)));if(body.length!==0)issues.push(`${scenario.label}-head-body-not-empty`)}catch{issues.push(`${scenario.label}-body-missing`)}}if(scenario.transportMode==='redirect'&&record?.redirect_chain?.length!==1)issues.push(`${scenario.label}-redirect-missing`);if(wrapper?.closure){const diskCas={async get(locator){try{return await readFile(join(paths.casPath,locator.slice(4)))}catch{return null}}};try{const replay=await replayClosure(wrapper.closure,diskCas),response=replay.responses?.[0];if(replay.run_status!=='completed'||replay.live_network_events!==0||response?.request_method!==scenario.declaredMethod)issues.push(`${scenario.label}-replay-invalid`);if(scenario.declaredMethod==='HEAD'&&response?.body?.length!==0)issues.push(`${scenario.label}-replay-head-body-not-empty`)}catch{issues.push(`${scenario.label}-replay-failed`)}}}if(requests.join(',')!==scenario.expectedRequests.join(','))issues.push(`${scenario.label}-executed:${requests.join(',')}`);if(/unhandled(?:Promise)?Rejection/i.test(result.stderr))issues.push(`${scenario.label}-unhandled-rejection`);const after=await stageNames(),residual=[...after].filter(name=>!before.has(name));if(residual.length)issues.push(`${scenario.label}-stage-residue:${residual.length}`);await Promise.all(residual.map(name=>rm(join(tmpdir(),name),{recursive:true,force:true})));};
    try{for(const scenario of[{label:'head-as-get',declaredMethod:'HEAD',path:'/mismatch-head-get',transportMode:'head-as-get',closed:true,expectedRequests:['GET /mismatch-head-get']},{label:'get-as-head',declaredMethod:'GET',path:'/mismatch-get-head',transportMode:'get-as-head',closed:true,expectedRequests:['HEAD /mismatch-get-head']},{label:'positive-get',declaredMethod:'GET',path:'/positive-get',transportMode:'match',closed:false,expectedRequests:['GET /positive-get']},{label:'positive-head',declaredMethod:'HEAD',path:'/positive-head',transportMode:'match',closed:false,expectedRequests:['HEAD /positive-head']},{label:'redirect-head',declaredMethod:'HEAD',path:'/redirect-head',transportMode:'redirect',closed:false,expectedRequests:['HEAD /redirect-head','HEAD /redirect-final']}])await execute(scenario)}finally{const closing=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closing;await rm(root,{recursive:true,force:true})}assert.deepEqual(issues,[],`TASK9_METHOD_BINDING_RED:${issues.join(',')}`);
  });

  test('TASK9_EXECUTED_URL_HEAD_BOUNDARY_RED', async () => {
    const issues=[];
    const nonemptyHead=capturePayload();for(const event of nonemptyHead.network_events)event.request_method='HEAD';const nonempty=await capture(nonemptyHead);if(nonempty.manifest.completeness_status!=='incomplete')issues.push('nonempty-head-capture-certified-complete');
    const valid=await capture(),forged=structuredClone(valid.manifest);forged.network_records[0].request_method='HEAD';forged.manifest_digest=snapshotClosureDigest(forged);try{await replayClosure(forged,valid.cas);issues.push('nonempty-head-replay-accepted')}catch(error){if(error?.code!=='TARGET_UNAVAILABLE'||error?.result?.run_status!=='target_unavailable'||error?.result?.release_gate!=='no_release')issues.push(`nonempty-head-replay-wrong-error:${error?.code}`)}
    const zeroHead=capturePayload();for(const event of zeroHead.network_events){event.request_method='HEAD';event.raw_body_bytes_base64=''}const zero=await capture(zeroHead);if(zero.manifest.completeness_status!=='complete')issues.push('zero-head-capture-incomplete');else{try{const replay=await replayClosure(zero.manifest,zero.cas);if(replay.responses.some(response=>response.request_method==='HEAD'&&response.body.length!==0))issues.push('zero-head-replay-body-not-empty')}catch{issues.push('zero-head-replay-failed')}}

    const requests=[],fixedDate='Wed, 19 Aug 2026 00:00:00 GMT',bodyText='CANONICAL_EXECUTED_URL';
    const server=createServer((request,response)=>{requests.push(request.url);if(request.url==='/redirect'){response.writeHead(302,[['Connection','close'],['Content-Length','0'],['Date',fixedDate],['Location','/b/../landing#server-fragment']]);response.end();return}if(request.url==='/final'||request.url==='/landing'){const body=`${bodyText}:${request.url}`;response.writeHead(200,[['Connection','close'],['Content-Length',String(Buffer.byteLength(body))],['Date',fixedDate],['X-Executed-Path',request.url]]);response.end(body);return}response.writeHead(404,[['Connection','close'],['Content-Length','0'],['Date',fixedDate]]);response.end()});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const origin=`http://127.0.0.1:${server.address().port}`,root=await mkdtemp(join(tmpdir(),'task9-executed-url-head-red-')),urlProfile=profile('executed-url-profile',{browser_engine_digest:d('c')}),taskScript={task_script_id:'executed-url-v1',steps:[{step_id:'direct',instruction:'Execute the registered direct request.',required_replay_profile_ids:[urlProfile.replay_profile_id]},{step_id:'redirect',instruction:'Execute the registered redirected request.',required_replay_profile_ids:[urlProfile.replay_profile_id]}]},taskDigest=sha(Buffer.from(canonicalize(taskScript))),caseId='RW-EXECUTED-URL-001';
    const pathExists=async path=>{try{await access(path);return true}catch{return false}},stageNames=async()=>new Set((await readdir(tmpdir())).filter(name=>name.startsWith('ux-skill-runner-')||name.startsWith('ux-skill-transport-'))),runNodeCli=arguments_=>new Promise(resolve=>{const child=spawn(process.execPath,['scripts/capture-snapshot-closure.mjs',...arguments_],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const deadline=setTimeout(()=>child.kill('SIGKILL'),10_000);child.stdout.on('data',chunk=>{stdout+=chunk});child.stderr.on('data',chunk=>{stderr+=chunk});child.once('error',error=>{clearTimeout(deadline);resolve({code:null,error,stderr,stdout})});child.once('close',code=>{clearTimeout(deadline);resolve({code,stderr,stdout})})});
    try{
      const publicDir=join(root,'evals','public-cases'),fixtureDir=join(root,'evals','fixtures'),registryDir=join(root,'registry'),casePath=join(publicDir,'executed-url.json'),casPath=join(root,'cas'),outputPath=join(root,'output.json');await mkdir(publicDir,{recursive:true});await mkdir(fixtureDir,{recursive:true});await mkdir(registryDir,{recursive:true});const rawDirect=`${origin}/a/../final#caller-fragment`,rawRedirect=`${origin}/a/../redirect#caller-fragment`,fixture={closure_version:'snapshot-closure-v1',entry_url:rawDirect,task_script_digest:d('1'),capture_environment_digest:d('2'),captured_at:'2026-08-20T00:00:00Z',authenticated:false,replay_profiles:[urlProfile],network_records:[],observation_records:[],outbound_effect_ledger_digest:d('3'),completeness_status:'incomplete',manifest_digest:''};fixture.manifest_digest=snapshotClosureDigest(fixture);await writeFile(casePath,`${canonicalize({case_id:caseId,canonical_locator: 'public-sites/task9-test', entry_url: rawDirect, snapshot_closure_digest:fixture.manifest_digest,task_script:taskScript})}\n`);await writeFile(join(fixtureDir,`${caseId}.snapshot-closure.json`),`${canonicalize(fixture)}\n`);
      const runner=`const direct=${JSON.stringify(rawDirect)},redirect=${JSON.stringify(rawRedirect)};export async function run({profiles,steps,executeStep}){for(const [index,url]of[direct,redirect].entries())await executeStep({replay_profile_id:profiles[0].replay_profile_id,task_step_id:steps[index].step_id},async({request,observe})=>{const response=await request({method:'GET',url});await observe({evidence_kind:'dom_snapshot',handle:response.observation_handles[0]});});}\n`,transport=`const rows=response=>[...response.headers.entries()].map(([name,value],sequence)=>({sequence,name,value_bytes_base64:Buffer.from(value,'latin1').toString('base64')}));export async function request({method,url}){const hop=await fetch(url,{method,redirect:'manual'});if(hop.status>=300&&hop.status<400){const location=new URL(hop.headers.get('location'),url).href,final=await fetch(location,{method,redirect:'manual'}),body=Buffer.from(await final.arrayBuffer());return{status:final.status,final_url:location,headers:rows(final),body,redirect_chain:[{sequence:0,status:hop.status,url,location,response_headers:rows(hop)}],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]}}const body=Buffer.from(await hop.arrayBuffer());return{status:hop.status,final_url:url,headers:rows(hop),body,redirect_chain:[],observation_artifacts:[{evidence_kind:'dom_snapshot',artifact_bytes:body}]};}\n`;await writeFile(join(registryDir,'runner.mjs'),runner);await writeFile(join(registryDir,'transport.mjs'),transport);const registry={registry_version:'snapshot-capture-registry-v1',entries:[{case_id:caseId,task_script_digest:taskDigest,runner_path:'runner.mjs',runner_digest:sha(Buffer.from(runner)),runner_module_closure:[{relative_path:'runner.mjs',raw_sha256:sha(Buffer.from(runner))}],transport_path:'transport.mjs',transport_digest:sha(Buffer.from(transport)),transport_module_closure:[{relative_path:'transport.mjs',raw_sha256:sha(Buffer.from(transport))}]}],registry_digest:''};registry.registry_digest=captureRegistryDigest(registry);const registryPath=join(registryDir,'capture-registry.json');await writeFile(registryPath,`${canonicalize(registry)}\n`);
      const before=await stageNames(),result=await runNodeCli(['--case',casePath,'--registry',registryPath,'--cas',casPath,'--output',outputPath]);let wrapper;try{wrapper=JSON.parse(await readFile(outputPath,'utf8'))}catch{}const direct=wrapper?.closure?.network_records?.[0],redirect=wrapper?.closure?.network_records?.[1],hop=redirect?.redirect_chain?.[0];if(result.code!==0||wrapper?.completeness_status!=='complete'||wrapper?.closure?.network_records?.length!==2)issues.push(`normalized-url-not-complete:${result.code}`);if(direct?.request_url!==`${origin}/final`||direct?.final_url!==`${origin}/final`)issues.push(`direct-url-not-executed:${direct?.request_url}:${direct?.final_url}`);if(redirect?.request_url!==`${origin}/redirect`||hop?.url!==`${origin}/redirect`||hop?.location!==`${origin}/landing`||redirect?.final_url!==`${origin}/landing`)issues.push(`redirect-url-not-executed:${redirect?.request_url}:${hop?.url}:${hop?.location}:${redirect?.final_url}`);if(requests.join(',')!=='/final,/redirect,/landing')issues.push(`native-request-order:${requests.join(',')}`);if(wrapper?.closure){const diskCas={async get(locator){try{return await readFile(join(casPath,locator.slice(4)))}catch{return null}}};try{const replay=await replayClosure(wrapper.closure,diskCas),records=replay.responses;if(replay.run_status!=='completed'||records[0]?.request_url!==`${origin}/final`||records[1]?.redirects?.[0]?.location!==`${origin}/landing`)issues.push('normalized-url-replay-invalid')}catch{issues.push('normalized-url-replay-failed')}}if(/unhandled(?:Promise)?Rejection/i.test(result.stderr))issues.push('normalized-url-unhandled-rejection');const after=await stageNames(),residual=[...after].filter(name=>!before.has(name));if(residual.length)issues.push(`normalized-url-stage-residue:${residual.length}`);await Promise.all(residual.map(name=>rm(join(tmpdir(),name),{recursive:true,force:true})));if(!await pathExists(outputPath))issues.push('normalized-url-output-missing');
    }finally{const closing=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closing;await rm(root,{recursive:true,force:true})}
    assert.deepEqual(issues,[],`TASK9_EXECUTED_URL_HEAD_BOUNDARY_RED:${issues.join(',')}`);
  });
}
