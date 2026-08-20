---
name: improving-product-ux
description: Evidence-aware guidance for digital product design, UX review, migration, refactoring, verification, websites, Admin interfaces, cross-platform services, and HulianUI. Do not use for pure brand art, complete physical-space human-factors work, or legal or medical certification.
---

# Improve Product UX

## Route the request

1. Normalize exactly one request mode.
   - Use guide for design guidance or a new experience.
   - Use scan for review, audit, or comparison of an existing experience.
   - Use refactor for migration or restructuring work.
   - Use verify for acceptance, regression, or release-readiness evidence.
2. Resolve ambiguity before evaluation. Treat a compare or audit request as scan unless it asks to verify an implemented change. Treat a release-readiness request as verify.
3. Validate the [knowledge manifest](knowledge/manifest.json). Read only routes[request_mode].paths, in its listed order, after its digest and dependency checks pass. Do not guess, add, reorder, or hardcode reference files.
4. When a refactor target actually uses HulianUI, obtain adapter evidence only through the existing HulianUI bridge. Do not infer adapter evidence or load vendor material for other targets.

## Build the input

1. Assemble one `EvaluationInputBundle` from the supplied artifacts and captured evidence.
2. Preserve explicit unknown, incomplete, comparison, audit, and snapshot states accepted by the existing contract.
3. Declare every missing required field or evidence gap. Never invent evidence, authority, completeness, claims, or release status.
4. Fail closed and stop before evaluation when a valid bundle cannot be produced. State that no evaluator result and no release authorization exist.
5. Keep `request_mode` identical to the normalized mode.

## Evaluate

1. Invoke the existing [CLI](scripts/ux-evaluate.mjs) once with the bundle on standard input:

   Run pnpm --silent ux:evaluate --mode &lt;mode&gt; --input - --output json.

2. Preserve the CLI exit code, error codes, semantic projection, audit sidecar, recommendation, and release decision exactly. Never convert no_release, incomplete evidence, or a failed run into approval.

## Respond on two tracks

- **Assurance:** Report only evaluator-backed findings, evidence grades, risks, recommendations, run status, and release decision. Name incomplete or unavailable assurance explicitly.
- **Inquiry:** Report unresolved questions, missing evidence, assumptions to test, and the next authorized evidence-gathering step. Keep inquiry proposals separate from assurance claims.

## Guard external effects

Treat evaluation as analysis, not authorization. Obtain explicit authorization before any external effect, including writing files, changing issues, sending messages, mutating tools or services, capturing remote systems, or deploying. Keep scope, target, and timing within that authorization.
