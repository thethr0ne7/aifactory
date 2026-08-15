# Autonomous Runtime

## Purpose

Run AI Factory work as durable, resumable jobs that continue independently of an open chat session or a user's device.

## Activate when

A task must survive disconnects, span multiple stages, wait on external dependencies, execute on a schedule, or continue without the user remaining online.

## Runtime contract

Every run must have:

- immutable `run_id`;
- objective and scoped input;
- current state;
- activated executive agents;
- selected skill pack;
- autonomy level;
- evidence ledger reference;
- heartbeat and checkpoint timestamps;
- retry/kill budget;
- terminal result: `COMPLETE`, `BLOCKED`, or `FAILED`.

## State machine

`QUEUED -> QUALIFYING -> ROUTED -> WORKING -> VALIDATING -> REPAIRING -> LEARNING -> COMPLETE`

Allowed terminal detours:

- any active state -> `BLOCKED` when a required dependency/evidence/approval is missing;
- any active state -> `FAILED` when retry budget is exhausted or an invariant is violated;
- `REPAIRING -> WORKING` after a bounded repair;
- `LEARNING -> COMPLETE` after lessons/evals are persisted or explicitly skipped with reason.

## Workflow

1. Claim one runnable task atomically.
2. Reconstruct state only from durable records.
3. Qualify and route using the single Executive/Capability Router.
4. Load only the required skill pack and contracts.
5. Execute one bounded unit of work.
6. Persist events, evidence, outputs, cost/time metadata and a checkpoint.
7. Run evidence, security, quality and invariant gates.
8. On failure, route to Incident Learning and Repair.
9. On success, persist telemetry and close or schedule the next task.
10. Update heartbeat throughout work so the watchdog can detect stale workers.

## Guardrails

- No infinite loops or recursive delegation.
- No implicit promotion from research/draft to production writes.
- No runtime process may modify Root of Trust controls directly.
- A task may not weaken its own gate, eval, acceptance criterion or negative-action rule to obtain a pass.
- Workers must be replaceable; durable state lives outside process memory.
- If runtime infrastructure or credentials are absent, report `BLOCKED`; never pretend background execution exists.
