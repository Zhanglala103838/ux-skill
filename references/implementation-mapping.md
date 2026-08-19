# Implementation mapping

Use this reference after an assessed problem and authorized refactor scope exist.

## Map evidence to a change

1. Select a Finding or assessed Claim with a traceable source and bounded context.
2. Describe the user-visible state transition that must change.
3. Identify the smallest reversible implementation boundary: content, structure, interaction, state handling, component composition, service contract, or operational process.
4. List alternatives and their tradeoffs for affected parties.
5. Map the chosen candidate to existing product and design-system capabilities.
6. Preserve error, busy, empty, permission, cancellation, retry, keyboard, focus, and recovery states.
7. Define acceptance evidence, guardrails, rollback conditions, and the verification task before editing.
8. Record the changeset and allowed input delta for later comparison.

A design-system or HulianUI contract proves only that an implementation candidate exists within the documented scope. It does not prove journey completeness, accessibility conformance, user success, or release safety. Keep vendor-neutral behavior requirements separate from component names.

## Implement within authority

Do not modify repositories, files, issues, messages, deployments, accounts, or third-party systems without the required authorization. Keep black-box targets read-only and work on an isolated derivative or prototype when intervention is allowed.

## Verify the mapped change

Re-run the same bounded task with equivalent actor, party inventory, seed, environment, and behavior version. Compare only preregistered deltas and their derived closure. Execute negative controls and guardrails. Escalate unexplained drift, missing evidence, new release-critical Findings, or uncertain external effects.

Use canonical schemas and evaluator output for exact IDs and release decisions; do not duplicate their logic in implementation notes.
