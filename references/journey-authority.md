# Journey and authority

Use this reference to separate a user journey from authority to act.

## Trace the journey

1. List the task steps from the declared entry state to the bounded outcome.
2. Mark decisions, handoffs, irreversible effects, error states, recovery paths, and exit paths.
3. Identify the actor and every affected party at each effectful step.
4. Preserve unknown branches when the observed evidence does not close them.
5. Evaluate only the captured or authorized journey boundary.

## Verify authority before effects

Treat analysis, recommendation, approval, authorization, capability, and execution as different states. A recommendation never grants permission. A UI control never proves backend authority. A component contract never proves that a complete destructive flow is safe.

Before any external write, issue update, message, deployment, account action, or destructive operation:

1. Resolve the acting chain and trusted authority root.
2. Verify scope, tenant binding, purpose, validity interval, revocation state, required approvals, and separation of duties.
3. Derive the affected-party inventory from authoritative evidence.
4. Bind the approved decision and effect to the same execution envelope.
5. Revalidate the complete guard at commit time.
6. Produce no effect and escalate or block when authority is missing, conflicting, stale, or unknown.

For black-box public sites, remain read-only. Stop before login, form submission, account creation, cart, checkout, or API mutation. Record the blocked boundary instead of crossing it.

Use the canonical authority schemas, registries, and decision policies for exact semantics. Do not restate them here.
