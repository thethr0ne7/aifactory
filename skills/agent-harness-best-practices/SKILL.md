# Agent Harness Best Practices

## Purpose

Provide bounded orchestration discipline for tool-using agents: research before action, explicit checkpoints, runtime authorization, observability and durable state.

## Activate when

A task involves multiple tools, repository writes, production actions, resumable execution or a non-trivial autonomous workflow.

## Workflow

`RESEARCH → PROPOSE → VALIDATE → APPROVE/COMMIT → EXECUTE → OBSERVE → SAVE → SHIP`

1. Research the current state before proposing changes.
2. Propose explicit actions and expected effects.
3. Validate permissions, targets, inputs and safety gates.
4. Obtain required approval/commit point before irreversible execution.
5. Execute through the tool/runtime boundary.
6. Observe actual results, not intended results.
7. Save state and evidence.
8. Ship only after relevant gates pass.

## Failure policy

Failures become repair inputs with bounded retries and kill criteria. Do not loop autonomously until something happens to work.

## Guardrails

- Do not import full agent marketplaces, hook systems or generic multi-agent orchestration without product need.
- Runtime/tool authorization controls side effects; model intent alone is insufficient.
- Observability and state persistence are part of correctness for long-running tasks.

## Provenance

Adapted from useful harness patterns previously studied from `affaan-m/ECC` and related agent-runtime practices.
