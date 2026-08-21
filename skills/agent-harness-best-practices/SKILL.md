# Agent Harness Best Practices

## Purpose

Provide bounded orchestration discipline for tool-using agents: research before action, explicit checkpoints, runtime authorization, observability, independent verification and durable state.

## Activate when

A task involves multiple tools, repository writes, production actions, resumable execution or a non-trivial autonomous workflow.

## Operating loop

`RESEARCH -> PLAN -> PRODUCE -> VALIDATE -> REVIEW -> VERIFY -> SAVE -> SHIP`

1. Research the current state before proposing changes.
2. Plan explicit actions, expected effects and acceptance evidence.
3. Produce through the bounded tool/runtime boundary.
4. Validate the output with the narrowest credible deterministic/runtime checks.
5. Review for contradictions, security, architecture and requirement drift when the risk justifies it.
6. Verify the repaired/final state from fresh evidence rather than producer intent.
7. Save durable state, decisions and evidence.
8. Ship only after relevant gates pass.

## Repair branch

`PRODUCE -> VALIDATE -> PASS: VERIFY/SHIP | FAIL: REPAIR -> REVALIDATE`

Repairs are bounded. Repeated failure escalates or blocks instead of looping until something happens to pass.

## Separation rule

Producer, reviewer and verifier are **functions**, not a reason to create agent theater.

Use separate agents/contexts only when separation reduces correlated error or protects the evidence boundary. At minimum:

- the reviewer/verifier receives the acceptance criteria and relevant artifact/evidence;
- it does not inherit unsupported producer conclusions as facts;
- verification checks the resulting state, not merely the proposed patch;
- one agent may perform multiple phases when independence has low expected value.

## Failure policy

Failures become repair inputs with bounded retries and kill criteria. Record actual failure evidence and preserve terminal-state integrity.

## Guardrails

- Do not import full agent marketplaces, hook systems or generic multi-agent orchestration without product need.
- Runtime/tool authorization controls side effects; model intent alone is insufficient.
- Observability and state persistence are part of correctness for long-running tasks.
- Do not confuse planning/review prose with runtime verification.
- Do not count more agents as stronger verification.

## Provenance

Adapted from useful harness patterns audited from `affaan-m/ECC` at commit `d8409a4b0813771235555e32e3d8046a73988bfa`, including its plan/test/implement/review/verify discipline. Factory keeps its own authority, evidence and bounded-retry rules and does not import ECC's full harness or agent catalog.
