# Evidence-aware Product UX Skill v0.1 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a vendor-neutral, deterministic experimental `improving-product-ux` Skill with one high-risk Admin deletion rule, a HulianUI evidence adapter, shared CLI/Skill/MCP semantics, canonical packaging, and fail-closed real-world regression harness contracts.

**Architecture:** Implement one ESM Node.js evaluator as the sole semantic authority. JSON Schema validates inputs, small pure modules canonicalize and reduce them, and CLI, Skill, and HulianUI bridge only adapt transport into the same `EvaluationInputBundle`; none may duplicate UX rules. The first vertical slice intentionally keeps unsupported design-spec behavior visible as `not_run`, `unknown`, `escalation`, or `no_release` rather than claiming v0.1 stable coverage.

**Tech Stack:** Node.js 22.22.2, pnpm 8.15.5, ESM `.mjs`, built-in `node:test`, Ajv 8.20.0, ajv-formats 3.0.1, json-canonicalize 2.0.1, YAML 2.9.0, GitHub Actions, JSON Schema 2020-12.

**Spec:** `docs/superpowers/specs/2026-08-18-evidence-aware-product-ux-skill-design.md` at approved semantic commit `f596998c88ca088a0c74160e55d54328f7123a49`; status-only closure commit `95933b36360d28734f5b5cf6fd10f4bc5148a382`.

## Global Constraints

- Work only in `Zhanglala103838/ux-skill`; do not write into `/Users/zhangzhiwei/Desktop/用户体验要素`.
- Keep `main` untouched until review; implement on a branch created from `design/v0`.
- Do not modify HulianUI MCP or any third-party upstream repository in this plan.
- Keep one evaluator semantic path; CLI, Skill, fixtures, and MCP bridge must produce byte-equal canonical evidence for equal input.
- Support exactly `guide`, `scan`, `refactor`, and `verify`; reject unknown or multiple primary modes.
- Treat 0 Findings, a famous brand, a component contract, and an automated scan as insufficient evidence of UX success or WCAG conformance.
- Block all black-box login, form submission, cart, checkout, real API mutation, account creation, and sensitive-data collection.
- Use RFC 8785 JCS, NFC strings, I-JSON, CanonicalRelativePath, normalized error codes, and the design-spec digest domains exactly.
- Keep Inquiry text non-authoritative and outside release, authorization, risk, and recommendation inputs.
- Preserve all 100 vector IDs. A vector may be `red` or `green`; it must never disappear or be reported as passing without executable expected output.
- No README, quick-reference document, long changelog, hidden total UX score, cross-site ranking, or stable-release claim.

---

## Planned File Map

```text
SKILL.md                                  Skill router and evaluator invocation contract
agents/openai.yaml                       Skill UI metadata
package.json                             Exact runtime, scripts, exports, dependency pins
pnpm-lock.yaml                           Resolved dependency graph
.nvmrc                                   Node 22.22.2
references/*.md                          Progressive UX context loaded by request mode
schemas/core/*.schema.json               Input, authority, claim, snapshot, delta schemas
schemas/evaluator/*.schema.json          Rule, finding, projection, report schemas
schemas/adapters/*.schema.json           HulianUI response/evidence schemas
knowledge/*.json                         Sources, assertions, rules, registries, policies
knowledge/manifest.json                  Exact path/digest/load-order manifest
knowledge/policy-manifest.json           Sole policy_manifest_digest preimage
evaluator/canonical.mjs                  I-JSON, NFC, JCS, canonical sets and paths
evaluator/digests.mjs                    Domain-separated SHA-256 functions
evaluator/validation.mjs                 Ajv pipeline and normalized errors
evaluator/authority.mjs                  Minimal high-risk delete authority/party decision
evaluator/rules-runtime.mjs              AST and tool-dependency evaluation
evaluator/claims.mjs                     Claim, grade, risk and recommendation reducers
evaluator/projection.mjs                 Semantic projection and digest
evaluator/index.mjs                      Sole evaluate(bundle, options) entry point
adapters/hulianui/contract.json          Pinned AlertDialog adapter contract
adapters/hulianui/adapter.mjs            MCP result to CanonicalAdapterEvidence mapping
adapters/hulianui/fixture.json           Captured pinned response fixture
scripts/ux-evaluate.mjs                  CLI transport
scripts/check-vector-catalog.mjs         Design-table/catalog parity
scripts/validate-skill.mjs               Frontmatter, metadata and route validation
scripts/run-red-baseline.mjs             Pre-evaluator baseline recorder
scripts/pack-ustar.mjs                   Canonical uncompressed ustar packer
scripts/capture-snapshot-closure.mjs     Read-only black-box closure capture
scripts/check-release.mjs                Parity, vector, artifact and regression gate
evals/vector-catalog.json                All 100 immutable vector IDs and contract text
evals/red/*.json                         Executable RED inputs and expected outputs
evals/golden/*.json                      Canonical bytes and digest fixtures
evals/parity/*.json                      Skill/CLI/MCP equivalent transports
evals/artifact/*                         ART-ONEFILE-001 fixture and expected bytes
evals/public-cases/*.json                GOV.UK, Apple, IKEA and Stripe case manifests
evals/holdout-commitments.json           Public commitments only, no secret/case output
evals/helpers/*.mjs                      Shared deterministic test fixture/process helpers
knowledge/artifact-manifest.json         Exact distributable path set for canonical packing
evals/tests/*.test.mjs                   Node test suites
.github/workflows/ci.yml                 Clean-environment verification
```

### Task 1: Repository Contract and Honest RED Baseline

**Files:**
- Create: `package.json`, `.nvmrc`, `evals/vector-catalog.json`
- Create: `scripts/check-vector-catalog.mjs`, `scripts/run-red-baseline.mjs`
- Create: `evals/tests/vector-catalog.test.mjs`
- Modify: none

**Interfaces:**
- Consumes: the 100-row table under design spec §18.1.
- Produces: `loadVectorCatalog(): Promise<VectorContract[]>`, `recordBaseline(catalog): BaselineReport`.

- [ ] **Step 1: Write the failing catalog test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadVectorCatalog } from '../../scripts/check-vector-catalog.mjs';

test('catalog freezes every approved vector exactly once', async () => {
  const rows = await loadVectorCatalog();
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map((row) => row.vector_id)).size, 100);
  assert.ok(rows.some((row) => row.vector_id === 'RW-SNAPSHOT-HEADERS-001'));
  assert.ok(rows.some((row) => row.vector_id === 'ART-ONEFILE-001'));
});
```

- [ ] **Step 2: Run it and preserve RED**

Run: `node --test evals/tests/vector-catalog.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/check-vector-catalog.mjs`.

- [ ] **Step 3: Add exact runtime metadata and catalog loader**

`package.json` must contain:

```json
{"name":"ux-skill","private":true,"type":"module","packageManager":"pnpm@8.15.5","engines":{"node":"22.22.2"},"scripts":{"test":"node --test evals/tests/*.test.mjs","vectors:check":"node scripts/check-vector-catalog.mjs","baseline:red":"node scripts/run-red-baseline.mjs","ux:evaluate":"node scripts/ux-evaluate.mjs","capture:closure":"node scripts/capture-snapshot-closure.mjs","skill:check":"node scripts/validate-skill.mjs","artifact:pack":"node scripts/pack-ustar.mjs","release:check":"node scripts/check-release.mjs"},"dependencies":{"ajv":"8.20.0","ajv-formats":"3.0.1","json-canonicalize":"2.0.1","yaml":"2.9.0"},"devDependencies":{"playwright":"1.62.1"}}
```

Write `.nvmrc` as the single line `22.22.2`. Implement `loadVectorCatalog()` to reject duplicate IDs, missing `expected_contract`, and any difference between committed catalog IDs and the §18.1 Markdown table. Populate `evals/vector-catalog.json` with all 100 exact IDs and their full §18.1 contract text.

- [ ] **Step 4: Record a baseline that cannot be mistaken for success**

`recordBaseline()` must emit one row per vector:

```js
{ vector_id, behavior_version: 'absent', outcome: 'red', reason: 'EVALUATOR_ABSENT' }
```

Run: `pnpm baseline:red`

Expected: process exits 0 only when all 100 rows are `red`; summary prints `green=0 red=100 release=no_release`.

- [ ] **Step 5: Run and commit**

Run: `pnpm install --lockfile-only && pnpm install --frozen-lockfile && pnpm vectors:check && pnpm test`

Expected: PASS; `pnpm-lock.yaml` is created and the baseline remains RED by content.

```bash
git add package.json pnpm-lock.yaml .nvmrc evals/vector-catalog.json scripts/check-vector-catalog.mjs scripts/run-red-baseline.mjs evals/tests/vector-catalog.test.mjs
git commit -m "test: freeze UX evaluator RED catalog"
```

### Task 2: Canonical Bytes, Paths, Collections, and Digests

**Files:**
- Create: `evaluator/canonical.mjs`, `evaluator/digests.mjs`
- Create: `evals/tests/canonical.test.mjs`
- Create: `evals/golden/scenario-family-registry.json`, `evals/golden/rotation-selection.json`

**Interfaces:**
- Produces: `assertIJson(value)`, `assertNfc(value)`, `assertCanonicalRelativePath(path)`, `jcsBytes(value)`, `canonicalSet(items, keyOf)`, `digest(domain, preimage)`, `digestJcs(domain, value)`.
- All later tasks consume these functions without alternate serialization.

- [ ] **Step 1: Write golden failures**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSet, assertCanonicalRelativePath } from '../../evaluator/canonical.mjs';
import { digestJcs } from '../../evaluator/digests.mjs';

test('scenario registry golden is exact', () => {
  const value = {registry_version:'scenario-family-v1',scenario_family_ids:['admin-internal-tool','ai-assisted-workflow','brand-marketing-website','consumer-transaction','cross-channel-service','developer-documentation','public-service-information','retail-commerce-discovery']};
  assert.equal(digestJcs('ux-skill:scenario-family-registry:v1', value), 'b764d922bd94ceb6869cd60984261acae344cd0a5e21c1cc9970cff710e417d0');
});

test('canonical set sorts by UTF-8 JCS key', () => {
  assert.deepEqual(canonicalSet([{id:'\u{10000}'},{id:'\uE000'}], (x) => x.id).map((x) => x.id), ['\uE000','\u{10000}']);
});

test('path rejects separators and dot segments', () => {
  for (const path of ['a//b','a/../b','a\\b','a%2fb']) assert.throws(() => assertCanonicalRelativePath(path), /PATH_INVALID/);
});
```

- [ ] **Step 2: Run to verify missing modules fail**

Run: `node --test evals/tests/canonical.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement pure canonical primitives**

Use `json-canonicalize` only after recursive I-JSON/NFC validation. Sort canonical-set members by unsigned UTF-8 bytes of `JCS(key)`, collapse byte-identical duplicates, and throw `DUPLICATE_ID_CONFLICT` for equal keys with different JCS.

```js
export const digest = (domain, bytes) =>
  createHash('sha256').update(Buffer.from(domain, 'utf8')).update(bytes).digest('hex');
export const digestJcs = (domain, value) => digest(domain, jcsBytes(value));
```

- [ ] **Step 4: Add the rotation golden**

Assert the exact §18.3 preimage produces `e01f97c0db9a39b9bd3f61c187ce9892a962a953328eb3cdac67658974a3bfcd` and exact case ID order is Stripe then IKEA.

- [ ] **Step 5: Verify and commit**

Run: `node --test evals/tests/canonical.test.mjs`

Expected: PASS.

```bash
git add evaluator/canonical.mjs evaluator/digests.mjs evals/tests/canonical.test.mjs evals/golden
git commit -m "feat: add canonical UX data primitives"
```

### Task 3: Closed Schemas and Normative Validation Errors

**Files:**
- Create: `schemas/core/evaluation-input.schema.json`, `schemas/core/snapshot-closure.schema.json`, `schemas/core/authority.schema.json`, `schemas/core/claims.schema.json`
- Create: `schemas/evaluator/output.schema.json`, `schemas/evaluator/rule.schema.json`, `schemas/evaluator/semantic-projection.schema.json`, `schemas/adapters/hulian-component-doc-v1.schema.json`, `schemas/adapters/hulian-evaluation-request-v1.schema.json`, `schemas/core/real-world-case.schema.json`, `schemas/manifest.json`, `evaluator/validation.mjs`
- Create: `evals/tests/validation.test.mjs`, `evals/helpers/fixtures.mjs`, `evals/red/RW-SNAPSHOT-SCHEMA-CLOSED-001.json`

**Interfaces:**
- `evals/helpers/fixtures.mjs` produces `fixtureWithHeaders`, `fixtureWithRedirectHop`, `highRiskDelete`, `twoSafeNonDominatedCandidates`, `ruleWithTwoRequiredTools`, `input`, `cancelled`, `timeout`, `deleteBundle`, `hulianDeleteBundle`, `closureWithCsp`, `casWithoutHeaderBytes`, `appleCase`, and `fakeBrowserRequesting`; helpers return frozen JSON and perform no network.
- Produces: `validateBySchema(schemaId,value): {ok:true,value}|{ok:false,errors:NormalizedError[]}` and bundle wrapper `validateInput(value)`.
- `NormalizedError` key is the complete tuple from spec §12.2.

- [ ] **Step 1: Freeze the nested-schema regression**

```js
test('headers is required and nested objects reject unknown fields', () => {
  const missing = validateBySchema('CanonicalResponseHeaders', {});
  assert.deepEqual(missing.errors.map((e) => [e.code,e.instance_pointer]), [['REQUIRED_MISSING','/headers']]);
  const extra = validateBySchema('RedirectHop', fixtureWithRedirectHop({note:'x'}));
  assert.deepEqual(extra.errors.map((e) => e.code), ['ADDITIONAL_PROPERTY']);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test evals/tests/validation.test.mjs`

Expected: FAIL because `validateInput` is absent.

- [ ] **Step 3: Encode schemas as closed objects**

Set `additionalProperties:false` and explicit `required` on all ten domain schemas and every Manifest, ReplayProfile, CanonicalResponseHeaders wrapper/item, network item, redirect hop, observation item, authority item, claim item, and output projection item. Compile with Ajv 2020 and `allErrors:true`.

- [ ] **Step 4: Normalize Ajv output**

Map only to the spec codes, deduplicate by full tuple, and sort with `canonicalSet`. Tagged unions validate the selected branch only; never expose Ajv `oneOf` summary text. Write `schemas/manifest.json` as exact `{path,file_digest}` rows for all ten domain schemas, sorted by CanonicalRelativePath.

- [ ] **Step 5: Verify and commit**

Run: `node --test evals/tests/validation.test.mjs`

Expected: PASS for missing headers, extra hop fields, NFC, duplicate IDs, ref missing, and suppressed stages.

```bash
git add schemas evaluator/validation.mjs evals/helpers/fixtures.mjs evals/tests/validation.test.mjs evals/red/RW-SNAPSHOT-SCHEMA-CLOSED-001.json
git commit -m "feat: add closed UX schemas and normalized errors"
```

### Task 4: Minimal Authority and Party Boundary for Destructive Admin Actions

**Files:**
- Create: `evaluator/authority.mjs`
- Create: `knowledge/registries.json`, `knowledge/decision-policies.json`
- Create: `evals/tests/authority.test.mjs`
- Create: executable RED fixtures for `AUTH-ROOT-001`, `ACT-DISJOINT-001`, `TENANT-UNKNOWN-001`, `PARTY-COMPLETENESS-PROOF-001`, `SOFT-TIE-001`, `SOFT-TIE-AUTH-U-001`

**Interfaces:**
- Produces: `evaluateAuthority(context): AuthorityDecision`, `derivePartyInventory(graph, proof): PartyInventory`, `solveCandidates(universe): SelectionDecision`.
- `AuthorityDecision.status` is exactly `continue|block|escalation|invalid_input`.

- [ ] **Step 1: Write failing boundary tests**

```js
test('unknown party closure escalates a high-risk delete', () => {
  const result = evaluateAuthority(highRiskDelete({partyProof:'unknown'}));
  assert.deepEqual(result, {status:'escalation',reason_code:'PARTY_INVENTORY_UNKNOWN'});
});

test('safe Pareto tie never selects a candidate', () => {
  const result = solveCandidates(twoSafeNonDominatedCandidates());
  assert.equal(result.selection_status, 'undecided');
  assert.equal(result.selected_solution_id, null);
  assert.equal(result.next_action, 'ask_decision_owner');
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test evals/tests/authority.test.mjs`

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement the fail-closed vertical slice**

Implement exact acting-chain continuity, trusted-root membership, tenant coverage, party completeness, and the hard/soft result tables needed by the delete scenario. For any design-spec authority feature not yet executable, emit `escalation` with a stable `coverage_gap_id`; never assume authorization.

- [ ] **Step 4: Verify and commit**

Run: `node --test evals/tests/authority.test.mjs`

Expected: PASS for the six named vectors and all table branches used by the delete flow.

```bash
git add evaluator/authority.mjs knowledge/registries.json knowledge/decision-policies.json evals/tests/authority.test.mjs evals/red
git commit -m "feat: enforce destructive-action authority boundaries"
```

### Task 5: AST, Tool Dependencies, Findings, and Run Status

**Files:**
- Create: `evaluator/rules-runtime.mjs`
- Consume: `schemas/evaluator/rule.schema.json`
- Create: `knowledge/rules.json`
- Create: `evals/tests/rules-runtime.test.mjs`
- Create: fixtures for `AST-APP-FE-001`, `TOOL-MULTI-CANCEL-TIMEOUT-001`, `FIND-INC-001`, `EMISSION-REASON-001`

**Interfaces:**
- Produces: `evaluateRule(rule, input, toolResults): RuleEvaluation`, `deriveFindingContext(bundle): FindingContextV1|null`, `emitFinding(ruleEvaluation, findingContext): Finding|null`, `reduceRunStatus(parts): RunStatus`.

Task 5 interfaces are internal diagnostic primitives, not public authority-bearing APIs.

Fixture migration: immutable catalog `*-001` rows retain explicit legacy-adapter coverage; non-catalog `FIND-INC-002` and `EMISSION-REASON-002` freeze the current exact-10 RuleEvaluation plus exact-6 FindingContext two-argument interface.

- [ ] **Step 1: Write reducer tests**

```js
test('required timeout dominates required cancellation', () => {
  const result = evaluateRule(ruleWithTwoRequiredTools(), input(), [cancelled('a'), timeout('b')]);
  assert.equal(result.outcome, 'evaluation_error');
  assert.equal(result.reason_code, 'REQUIRED_TOOL_TIMEOUT');
});

test('critical unknown emits escalation and no invented success', () => {
  const context = deriveFindingContext(bundle);
  const finding = emitFinding(ruleEvaluation, context);
  assert.equal(finding.finding_type, 'escalation');
  assert.equal(finding.emission_reason_code, 'RELEASE_CRITICAL_UNKNOWN');
});
```

- [ ] **Step 2: Confirm RED, implement the exact first-match tables, then rerun**

Run before implementation: `node --test evals/tests/rules-runtime.test.mjs`

Expected: FAIL with missing module.

Implement the §11 AST grammar and only the operators required by the frozen rules. Reject unknown operators with `AST_OP_UNKNOWN`; never treat evaluator exceptions as a UX Finding.

Run after implementation: same command.

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add evaluator/rules-runtime.mjs knowledge/rules.json evals/tests/rules-runtime.test.mjs evals/red
git commit -m "feat: add deterministic UX rule runtime"
```

### Task 6: Claims, Evidence, Risk, and Recommendation Reducers

**Files:**
- Create: `evaluator/claims.mjs`
- Create: `knowledge/sources.json`, `knowledge/assertions.json`
- Create: `evals/tests/claims.test.mjs`
- Create: fixtures for `CLAIM-DOWNGRADE-001`, `REC-WEAK-001`, `REC-HIGH-NORMATIVE-NONENTAIL-001`, `REC-REDUCER-001`, `RELEASE-SOFT-TIE-001`

**Interfaces:**
- Produces: `assessClaim(claim,evidence,policy)`, `assessRisk(finding,context)`, `assessRecommendation(parts)`, `reduceRelease(parts)`.
- Acceptance freezes the closed authority-material union: `exact_requires` requires a non-null valid `required_action` and `outcome_equivalent_verified=false`; its authority ceiling is `required`, while only `sameAction` derives exact-mandatory reversibility. `outcome_only` requires `required_action=null` and maps equivalent true/false to `conditional_advice`/`explore`. `none` requires null/false and maps to neutral `required`. Every other field combination is `INVALID_INPUT`, and caller `exact_mandatory_action` cannot strengthen a result.

- [ ] **Step 1: Freeze weak-evidence and tie behavior**

```js
test('weak evidence creates inquiry, not action advice', () => {
  const result = assessRecommendation({evidence_ceiling:'none',authority_ceiling:'required',risk_ceiling:'strong_advice',reversibility_ceiling:'strong_advice'});
  assert.equal(result.strength, 'none');
  assert.equal(result.output_kind, 'research_question');
});

test('soft tie remains undecided', () => {
  assert.deepEqual(reduceRelease({gates:'clear',selection:'undecided',authority_complete:true}), {status:'undecided',next_action:'ask_decision_owner'});
});
```

- [ ] **Step 2: Confirm RED and implement closed lookup tables**

Run: `node --test evals/tests/claims.test.mjs`

Expected before implementation: FAIL; after implementing exact §8-§9 first-match tables: PASS.

- [ ] **Step 3: Commit**

```bash
git add evaluator/claims.mjs knowledge/sources.json knowledge/assertions.json evals/tests/claims.test.mjs evals/red
git commit -m "feat: add evidence-aware UX recommendation reducers"
```

### Task 7: Progressive References and Final Knowledge Manifest

**Files:**
- Create: all eight `references/*.md`
- Create: `knowledge/manifest.json`, `knowledge/policy-manifest.json`, `scripts/check-knowledge.mjs`
- Create: `evals/tests/knowledge-manifest.test.mjs`

**Interfaces:**
- Produces: `loadKnowledgeManifest(): Promise<KnowledgeManifest>`, `loadPolicyManifest(): Promise<PolicyManifest>`, and exact route closures for `guide|scan|refactor|verify`.
- `knowledge/manifest.json` fixes every knowledge/reference path, SHA-256, load order, and dependency closure before adapter/closure manifests and evaluator golden digests are created in Tasks 8-10.

- [ ] **Step 1: Write the manifest contract test**

```js
test('guide route has one exact dependency closure', async () => {
  const manifest = await loadKnowledgeManifest();
  assert.deepEqual(manifest.routes.guide.paths, ['references/context-model.md','references/journey-authority.md','references/claim-study.md','references/inquiry-design.md','references/ethics.md']);
  assert.equal(new Set(manifest.files.map((row) => row.path)).size, manifest.files.length);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test evals/tests/knowledge-manifest.test.mjs`

Expected: FAIL because the manifest loader is absent.

- [ ] **Step 3: Write references and the closed manifest**

Write each reference once, in imperative form where procedural, and keep detailed schemas/source propositions in their canonical JSON files. `knowledge/policy-manifest.json` is additionalProperties=false and contains only `policy_files`, a canonical-set with the exact `{path:"knowledge/decision-policies.json",file_digest}` row; `policy_manifest_digest=digestJcs("ux-skill:manifest:v1", policyManifest)`. `knowledge/manifest.json` contains exact `{path,file_digest}` rows for knowledge/reference inputs including policy-manifest.json, plus route load order and dependency closure; it excludes itself to avoid a digest cycle. No glob, locale sorting, raw-file shortcut, or duplicated reference text is allowed.

- [ ] **Step 4: Verify and commit**

Run: `node scripts/check-knowledge.mjs && node --test evals/tests/knowledge-manifest.test.mjs`

Expected: PASS; changing one knowledge or reference byte fails the manifest check.

```bash
git add references knowledge/manifest.json knowledge/policy-manifest.json scripts/check-knowledge.mjs evals/tests/knowledge-manifest.test.mjs
git commit -m "feat: add UX knowledge and route manifest"
```

### Task 8: HulianUI AlertDialog Evidence Adapter

**Files:**
- Create: `adapters/hulianui/contract.json`, `adapters/hulianui/fixture.json`, `adapters/hulianui/adapter.mjs`
- Consume: `schemas/adapters/hulian-component-doc-v1.schema.json`
- Create: `evals/tests/hulianui-adapter.test.mjs`
- Create: relevant adapter RED/golden fixtures

**Interfaces:**
- Produces only `classifyHulianResult(result,contract)` and `mapHulianComponentDoc(result,contract): CanonicalAdapterEvidence`.
- The pure adapter does not import the evaluator, call MCP, or modify HulianUI; it accepts captured or caller-provided tool results.

- [ ] **Step 1: Write classifier and digest failures**

```js
test('mismatch dominates stale and partial', () => {
  assert.equal(classifyHulianResult(mismatchedAndStale(), contract), 'incompatible_source');
});

test('canonical evidence never asserts UX outcome', () => {
  const evidence = mapHulianComponentDoc(validFixture, contract);
  assert.equal(createHash('sha256').update(jcsBytes(contract)).digest('hex'), 'f297ea75545ceefa627a4d977d528ec7e48be736f6e9015c07cda2444e0deb8c');
  assert.deepEqual(Object.keys(evidence).sort(), ['component_identity','events','exports','import','props','slots','source_artifact_identity']);
  assert.deepEqual(contract.prohibited_claims, ['ux-outcome','wcag-conformance','user-success','complete-destructive-flow']);
});
```

- [ ] **Step 2: Confirm RED, implement, and verify**

Run before and after: `node --test evals/tests/hulianui-adapter.test.mjs`

Expected before: FAIL. Expected after: all adapter vectors PASS and shuffled exports/props/events/slots produce byte-equal evidence.

- [ ] **Step 3: Commit**

```bash
git add adapters evals/tests/hulianui-adapter.test.mjs evals/red evals/golden
git commit -m "feat: add pinned HulianUI evidence adapter"
```

### Task 9: Fail-Closed Public-Site Snapshot Closure Harness

**Files:**
- Create: `scripts/capture-snapshot-closure.mjs`
- Consume: `schemas/core/real-world-case.schema.json`
- Create: `evals/public-cases/govuk.json`, `apple.json`, `ikea.json`, `stripe.json`
- Create: `evals/tests/snapshot-closure.test.mjs`
- Create: executable fixtures for `RW-SNAPSHOT-DRIFT-001`, `RW-SNAPSHOT-HEADERS-001`, `RW-REPLAY-PROFILE-001`, `RW-BLACKBOX-EFFECT-001`

**Interfaces:**
- Produces: `captureClosure(caseManifest,browser): SnapshotClosureManifest`, `replayClosure(manifest,cas): ReplayEvidence`.
- Capture requires an injected browser driver; core evaluator stays browser-independent.

- [ ] **Step 1: Write closure security tests**

```js
test('CSP header cannot disappear during replay', async () => {
  const closure = closureWithCsp("script-src 'none'");
  await assert.rejects(() => replayClosure(closure, casWithoutHeaderBytes()), /TARGET_UNAVAILABLE/);
});

test('live or mutating request blocks the case', async () => {
  const result = await captureClosure(appleCase(), fakeBrowserRequesting('POST','https://store.example/checkout'));
  assert.equal(result.completeness_status, 'incomplete');
  assert.equal(result.release_gate, 'no_release');
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test evals/tests/snapshot-closure.test.mjs`

Expected: FAIL with missing capture module.

- [ ] **Step 3: Implement capture/replay contracts**

Capture only anonymous read-only GET/HEAD traffic. Store CanonicalResponseHeaders and bodies in a caller-provided content-addressed store; key network records by `[replay_profile_id,sequence]`; require every task step/profile observation; reject SSE, WebSocket, live replay, missing bytes, digest mismatch, and prohibited effects.

- [ ] **Step 4: Encode exact case profiles**

Apple uses the three exact profiles from spec §18.3. GOV.UK uses one desktop-keyboard profile. IKEA uses anonymous Beijing/no-geolocation and stops before cart. Stripe stops before login, key creation, or API call. Mark discovery curl digests as non-replayable provenance, not formal closure artifacts.

On the development machine, install the pinned browser and run an authorized read-only capture:

```bash
pnpm exec playwright install chromium
pnpm capture:closure -- --case evals/public-cases/apple.json --cas .artifacts/cas --output .artifacts/apple-closure.json
```

Expected: either `completeness_status=complete` with no outbound effects, or a machine-readable `target_unavailable/no_release`; never substitute current live bytes after capture.

- [ ] **Step 5: Verify and commit**

Run: `node --test evals/tests/snapshot-closure.test.mjs`

Expected: PASS with every miss mapping to `target_unavailable + RunIssue + no_release`.

```bash
git add scripts/capture-snapshot-closure.mjs evals/public-cases evals/tests/snapshot-closure.test.mjs evals/red
git commit -m "feat: add fail-closed website regression harness"
```

### Task 10: Sole Evaluator Entry Point and Semantic Projection

Task 10 evaluate(bundle) is the sole authority-bearing public evaluation gate.
verifyRunArtifact deterministically replays from the raw normalized bundle and fixed evaluator artifacts, then byte-compares the result.
Digests provide identity and integrity, not authenticity.

**Files:**
- Create: `evaluator/projection.mjs`, `evaluator/index.mjs`
- Consume: `schemas/evaluator/semantic-projection.schema.json`, `schemas/manifest.json`
- Create: `evaluator/manifest.json` with exact evaluator file digests and the finalized schema/knowledge/policy manifest digests
- Create: `evals/tests/evaluator.test.mjs`
- Create: `evals/golden/high-risk-delete.json`

**Interfaces:**
- Produces: `evaluate(bundle): EvaluationResult`; `bundle.adapter_evidence` is the only adapter-evidence channel.
- `EvaluationResult` contains `assurance`, `inquiry`, `semantic_projection`, `semantic_digest`, and non-semantic `audit_sidecar`.

- [ ] **Step 1: Write the end-to-end failing test**

```js
test('same normalized delete bundle replays to one semantic digest', async () => {
  const outputs = await Promise.all(Array.from({length:5}, () => evaluate(deleteBundle())));
  assert.equal(new Set(outputs.map((x) => x.semantic_digest)).size, 1);
  assert.match(outputs[0].assurance.warning, /does not mean UX is good/i);
  assert.equal(outputs[0].inquiry.authoritative, false);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test evals/tests/evaluator.test.mjs`

Expected: FAIL with missing evaluator entry point.

- [ ] **Step 3: Implement the pipeline**

Reject any out-of-band adapter evidence option; callers must construct one complete EvaluationInputBundle. Before evaluation, verify `schemas/manifest.json`, `knowledge/manifest.json`, and `knowledge/policy-manifest.json`. Compute `policy_manifest_digest` only as `digestJcs("ux-skill:manifest:v1", loadPolicyManifest())`; raw `decision-policies.json` SHA-256 and synthesized alternate manifests are invalid. Then write `evaluator/manifest.json` with exact `{path,file_digest}` rows for the eight evaluator modules plus schema, knowledge, and that policy manifest digest. Execute stages in this order: parse/I-JSON → NFC → schema → collection/ref validation → policy semantics → rules/tools → claims/risk/recommendation → projection/digests. Derive output arrays with registry ordering; exclude timestamps, localized prose, MCP text, and Inquiry text from semantic projection.

- [ ] **Step 4: Verify and commit**

Run: `node --test evals/tests/evaluator.test.mjs`

Expected: PASS with five identical digests and byte-equal golden projection.

```bash
git add evaluator/index.mjs evaluator/projection.mjs evaluator/manifest.json evals/tests/evaluator.test.mjs evals/golden/high-risk-delete.json
git commit -m "feat: compose deterministic UX evaluator"
```

### Task 11: CLI and HulianUI Bridge Transports

**Files:**
- Create: `scripts/ux-evaluate.mjs`, `adapters/hulianui/bridge.mjs`
- Consume: `schemas/adapters/hulian-evaluation-request-v1.schema.json`, `adapters/hulianui/adapter.mjs`
- Create: `evals/tests/cli.test.mjs`, `evals/helpers/process.mjs`
- Create: `evals/parity/guide.json`, `scan.json`, `refactor.json`, `verify.json`

**Interfaces:**
- CLI: `ux-evaluate --mode <guide|scan|refactor|verify> --input <path|-> --output json`.
- Bridge: `evaluateHulianMcpResult(bundleBase,toolResult): EvaluationResult`; `bundleBase` is validated by `hulian-evaluation-request-v1` and forbids `adapter_evidence`. The bridge maps the tool result, constructs the sole complete bundle with one canonical adapter evidence set, then calls `evaluate(bundle)`.
- `evals/helpers/process.mjs` produces `runCli(args)` and `runCliWithDifferentRequestId(args)` by spawning the checked-in CLI with fixed environment and parsing stdout JSON.
- Produces stdout JSON only; diagnostics go to stderr.

- [ ] **Step 1: Write CLI contract tests**

```js
test('unknown and multiple modes are invalid_input', async () => {
  assert.equal((await runCli(['--mode','audit+verify'])).json.run_status, 'invalid_input');
});

test('bridge rejects a preset adapter-evidence channel', async () => {
  await assert.rejects(() => evaluateHulianMcpResult({...bundleBase(),adapter_evidence:[]}, validFixture), /ADDITIONAL_PROPERTY/);
});

test('transport metadata does not change semantic digest', async () => {
  const a = await runCli(['--mode','scan','--input','evals/parity/scan.json']);
  const b = await runCliWithDifferentRequestId(['--mode','scan','--input','evals/parity/scan.json']);
  assert.equal(a.json.semantic_digest, b.json.semantic_digest);
});
```

- [ ] **Step 2: Confirm RED, implement thin transport, verify**

Run: `node --test evals/tests/cli.test.mjs`

Expected before: FAIL; after: PASS. The CLI and bridge must call `evaluate(bundle)` and contain no UX rule or recommendation table. For parity fixtures, the CLI/Skill complete bundle contains captured evidence E, while the bridge base omits the field and maps its tool result to byte-identical E.

- [ ] **Step 3: Commit**

```bash
git add scripts/ux-evaluate.mjs adapters/hulianui/bridge.mjs evals/tests/cli.test.mjs evals/parity
git commit -m "feat: expose UX evaluator transports"
```

### Task 12: Skill Router and Product Metadata

**Files:**
- Create: `SKILL.md`, `agents/openai.yaml`, `scripts/validate-skill.mjs`
- Create: `evals/tests/skill-contract.test.mjs`
- Consume: `knowledge/manifest.json`, `scripts/ux-evaluate.mjs`

**Interfaces:**
- Skill invokes the existing `pnpm ux:evaluate -- --mode <mode> --input - --output json` transport and loads only the approved manifest route.

- [ ] **Step 1: Write the Skill contract test**

```js
test('Skill is lean and routes to the existing CLI', async () => {
  const skill = await readFile('SKILL.md','utf8');
  assert.match(skill, /^---\nname: improving-product-ux\ndescription:/);
  assert.ok(skill.split('\n').length < 500);
  assert.match(skill, /pnpm ux:evaluate/);
  await access('scripts/ux-evaluate.mjs');
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test evals/tests/skill-contract.test.mjs`

Expected: FAIL because SKILL.md is absent; the CLI dependency already exists from Task 11.

- [ ] **Step 3: Write the Skill and metadata**

The approved repository root is already the Skill directory, so do not create a nested skill. `scripts/validate-skill.mjs` enforces two-field YAML frontmatter, name `improving-product-ux`, description length <=1024, quoted metadata strings, 25-64 character short description, explicit `$improving-product-ux` default prompt, and exact manifest routes. SKILL.md normalizes one request mode, declares bundle gaps, loads only its route, invokes the CLI, presents Assurance and Inquiry separately, and obtains authorization before any external effect.

```yaml
interface:
  display_name: "Evidence-aware Product UX"
  short_description: "Evidence-bounded guidance for digital product UX"
  default_prompt: "Use $improving-product-ux to guide, scan, refactor, or verify this product experience."
policy:
  allow_implicit_invocation: true
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm skill:check && node --test evals/tests/skill-contract.test.mjs`

Expected: PASS; removing the CLI, changing a route, or adding unsupported frontmatter fails.

```bash
git add SKILL.md agents/openai.yaml scripts/validate-skill.mjs evals/tests/skill-contract.test.mjs
git commit -m "feat: add evidence-aware Product UX Skill"
```

### Task 13: Canonical ustar Artifact

**Files:**
- Create: `scripts/pack-ustar.mjs`, `knowledge/artifact-manifest.json`
- Create: `evals/artifact/one-file-input/a`, `evals/artifact/ART-ONEFILE-001.json`
- Create: `evals/tests/artifact.test.mjs`

**Interfaces:**
- Produces: `packCanonicalUstar(entries): Buffer` and CLI `pack-ustar <artifact-manifest.json> <output.tar>`; the CLI reads only exact canonical paths in the manifest and cannot include its output file.

- [ ] **Step 1: Decode the spec golden into a test**

```js
test('one-file ustar is byte exact', async () => {
  const golden = JSON.parse(await readFile('evals/artifact/ART-ONEFILE-001.json'));
  const bytes = packCanonicalUstar([{path:'a',content:Buffer.from(golden.file_base64,'base64')}]);
  assert.equal(bytes.length, golden.archive_length);
  assert.equal(bytes.toString('base64'), golden.archive_base64);
  assert.equal(digest('ux-skill:artifact:v1', bytes), golden.artifact_digest);
});
```

`knowledge/artifact-manifest.json` must contain a UTF-8-sorted canonical-set of exact distributable paths and no glob: `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `SKILL.md`, `agents/openai.yaml`, all eight named references, all ten named domain schemas plus `schemas/manifest.json`, all seven knowledge JSON files plus `knowledge/artifact-manifest.json`, all eight evaluator modules plus `evaluator/manifest.json`, all four HulianUI adapter files, and `scripts/ux-evaluate.mjs`, `scripts/check-knowledge.mjs`, `scripts/validate-skill.mjs`, `scripts/pack-ustar.mjs`, `scripts/capture-snapshot-closure.mjs`. It stores paths only, so including itself is not a digest cycle; docs, evals, node_modules, `.git`, and output tar are excluded.

The committed `ART-ONEFILE-001.json` must be this exact independent golden (file `a` contains one byte `x`):

```json
{"path":"a","file_base64":"eA==","archive_length":2048,"artifact_digest":"f6a0f180d997c4dcecf1bdf2aa17e0cfc2aa05ea1c7161f26fa7a4df5b0954a3","archive_base64":"YQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAwMDA2NDQAMDAwMDAwMAAwMDAwMDAwADAwMDAwMDAwMDAxADAwMDAwMDAwMDAwADAwNjA3NwAgMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB1c3RhcgAwMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}
```

- [ ] **Step 2: Confirm RED, implement headers byte-by-byte, verify**

Run: `node --test evals/tests/artifact.test.mjs`

Expected before: FAIL; after: PASS. Do not shell out to `tar`; reject directories, links, PAX, long names, and non-canonical paths.

- [ ] **Step 3: Commit**

```bash
git add scripts/pack-ustar.mjs knowledge/artifact-manifest.json evals/artifact evals/tests/artifact.test.mjs
git commit -m "feat: add canonical UX Skill artifact packer"
```

### Task 14: Semantic Parity and Release Gate

**Files:**
- Create: `scripts/check-release.mjs`
- Create: `evals/tests/parity.test.mjs`, `evals/tests/release-gate.test.mjs`, `evals/helpers/transports.mjs`
- Create: `evals/holdout-commitments.json`

**Interfaces:**
- `evals/helpers/transports.mjs` produces `evaluateThreeTransports(path)` as `{skill,cli,mcp}`: `skill` validates the SKILL route then invokes its declared CLI command with complete bundle E, `cli` invokes the CLI directly with the same bundle E, and `mcp` passes a base with no adapter_evidence plus a tool result that maps to byte-identical E into `evaluateHulianMcpResult`. The helper also evaluates the bundle directly as an oracle and strips audit sidecars before byte comparison.
- Produces: `checkParity(transports): ParityReport`, `checkRelease(inputs): ReleaseGateReport`.

- [ ] **Step 1: Write release-failure tests**

```js
test('red vectors and missing holdout cannot release', async () => {
  const report = await checkRelease({catalog:catalogWithOneRed(),holdout:{status:'missing'},publicCases:[]});
  assert.deepEqual(report, {status:'no_release',reason_codes:['HOLDOUT_MISSING','REAL_WORLD_REQUIRED','VECTOR_RED']});
});

test('Skill CLI and MCP bridge are semantic peers', async () => {
  const report = await checkParity(await evaluateThreeTransports('evals/parity/scan.json'));
  assert.equal(report.semantic_parity, 1);
  assert.equal(report.adapter_evidence_parity, 1);
});
```

- [ ] **Step 2: Confirm RED, implement deterministic set reduction, verify**

Run: `node --test evals/tests/parity.test.mjs evals/tests/release-gate.test.mjs`

Expected before: FAIL; after: PASS. Sort all reason codes canonically. Holdout status other than current-generation `pass` is always `no_release`; do not expose private case details.

- [ ] **Step 3: Run the vertical-slice gate**

Run: `pnpm release:check`

Expected for this experimental slice: `no_release` until every required vector, real-world baseline/verify pair, and current holdout generation is green. The command exits 1 for `no_release`; CI uploads the report with `if: always()` while preserving the failing gate conclusion.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-release.mjs evals/helpers/transports.mjs evals/tests/parity.test.mjs evals/tests/release-gate.test.mjs evals/holdout-commitments.json
git commit -m "test: enforce UX semantic parity and release gates"
```

### Task 15: Clean-Environment CI and Developer Handoff

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Create: `evals/tests/no-prohibited-claims.test.mjs` (imports `deleteBundle` and `hulianDeleteBundle` from the Task 3 fixture helper)

**Interfaces:**
- CI jobs: `unit`, `golden`, `pack-repro`, `release-report`.
- Produces downloadable `release-gate-report.json` and canonical `.tar`; does not publish npm or GitHub Release.

- [ ] **Step 1: Add the prohibited-claim test**

```js
test('implemented delete and Hulian fixtures respect evidence ceilings', async () => {
  const outputs = [evaluate(deleteBundle()), evaluate(hulianDeleteBundle())];
  for (const output of outputs) {
    assert.equal(output.assurance.claims.includes('wcag_conformant'), false);
    assert.equal(output.assurance.claims.includes('user_success'), false);
    assert.equal(output.assurance.claims.includes('ux_good'), false);
  }
});
```

- [ ] **Step 2: Write CI with exact commands**

Each job uses `actions/checkout@v4`, `pnpm/action-setup@v4` with 8.15.5, `actions/setup-node@v4` with 22.22.2 and pnpm cache, and `actions/upload-artifact@v4`, then `pnpm install --frozen-lockfile`. Run:

```bash
pnpm vectors:check
pnpm test
pnpm artifact:pack -- knowledge/artifact-manifest.json ux-skill.tar
pnpm release:check
```

`release-report` runs `pnpm release:check` without `continue-on-error`. Upload `release-gate-report.json` in the next step with `if: always()`; the original gate step exit code remains the job/workflow conclusion, so `no_release` stays red while its report is preserved.

- [ ] **Step 3: Verify in two clean directories**

Run twice from separately extracted source archives:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm artifact:pack -- knowledge/artifact-manifest.json ux-skill.tar
shasum -a 256 ux-skill.tar
```

Expected: tests PASS and the two tar SHA-256 values are byte-equal. `release:check` may remain `no_release` only for explicitly listed unmet gates.

- [ ] **Step 4: Commit and push the implementation branch**

```bash
git add .github/workflows/ci.yml package.json pnpm-lock.yaml evals/tests/no-prohibited-claims.test.mjs
git commit -m "ci: verify reproducible UX Skill artifacts"
git push -u origin implementation/v0.1-vertical-slice
```

- [ ] **Step 5: Hand off to the development machine**

Record the implementation commit, artifact SHA-256, exact failing release gates, pull/install/test commands, and expected output in the task handoff. The development machine—not this implementation run—opens one GitHub issue per vector ID or runtime failure after validation. Do not mark the Skill stable and do not merge to `main` before that feedback is resolved.

## Plan Self-Review Result

- Spec coverage for the approved first vertical slice is mapped to Tasks 1-15: exact mode routing, canonical validation, authority boundary, one destructive-action rule, Claim/Risk/Recommendation, shared evaluator, HulianUI adapter, Skill, artifact, public-site closure, parity, holdout/release behavior, and clean CI.
- Full production execution of every authority/research/effect capability remains outside this vertical slice and therefore must surface as fail-closed coverage gaps; this plan does not silently approximate it.
- All referenced functions are introduced before downstream use: knowledge precedes evaluator, the pure adapter precedes the bridge, evaluator precedes CLI/bridge, and CLI precedes Skill.
- The plan contains no placeholder steps; test fixture/process/transport helpers and the full artifact golden are named explicitly, and no missing vector, evidence, or unavailable website can become a passing result.