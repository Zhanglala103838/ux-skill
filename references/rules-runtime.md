# Rules runtime

Use this reference to interpret deterministic rule output without replacing the evaluator.

## Prepare inputs

1. Parse and validate I-JSON and Unicode before schema validation.
2. Normalize collections with their registered keys and byte ordering.
3. Resolve references and policy prerequisites before executing a rule.
4. Preserve the single evaluation-effective time basis.
5. Treat malformed or conflicting inputs as explicit failures.

## Read four-valued results

Interpret true, false, unknown, and evaluation error as distinct states. Unknown means the available material cannot decide the proposition. Evaluation error means the rule could not be validly evaluated. Neither is a pass.

Apply applicability and exclusion before the rule assertion. Resolve required tool dependencies through the shared dependency decision. A failed, cancelled, partial-incomplete, missing, or incompatible dependency must produce the registered terminal outcome and trace; do not let an adapter choose alternate semantics.

## Preserve determinism

Use only registered paths, operators, invariants, reason codes, and rule versions. Keep ordered traces ordered and canonical sets canonically sorted. Never use locale sorting, completion order, wall-clock timing, transport prose, or inferred defaults in semantic output.

Emit Findings only through the registered rule and emission contract. Recompute run status from authoritative evaluations, Findings, issues, and decisions. Do not hand-edit evaluator output.

The canonical rules registry and schemas are the sole source for exact operands, priorities, reason codes, and object shapes.
