# Agent Workflow / Stateful Control

## Purpose

Keep long-running work in explicit states with bounded transitions, approvals and retry limits.

## Activate when

A task spans multiple stages, tools, approvals, asynchronous dependencies or resumable execution.

## Workflow

Use explicit phase states such as:

`RESEARCH → PROPOSE → VALIDATE → APPROVE/COMMIT → EXECUTE → OBSERVE → SAVE → SHIP`

For each transition record:

- current state;
- required evidence;
- allowed actions;
- completion condition;
- next state;
- retry/kill limit.

## Rules

- The model may propose actions; the runtime/tool boundary authorizes and executes them.
- Failed execution returns to a defined repair state, not an unbounded autonomous loop.
- Save checkpoints after meaningful state transitions.
- Resuming work must reconstruct state from durable records, not guesses.

## Guardrails

- No recursive delegation without a bounded parent task.
- No infinite retries.
- No implicit promotion from draft/research to production execution.
- Human approval is required wherever policy/product rules explicitly demand it.
