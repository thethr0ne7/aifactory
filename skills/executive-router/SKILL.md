# Executive Router

## Purpose

Activate bounded executive agents when their decision rights materially change the outcome, route evidence and handoffs between them, and return one integrated decision.

Executive agents are real factory roles with profiles in `agents/executive/` and machine-readable contracts in `registry/executive-agents.json`. They are not fictional personalities and do not form a default council.

## Activate when

The task involves strategy, prioritization, product scope, economics, execution planning, architecture, positioning, acquisition, pricing, monetization or a cross-functional ship decision.

## Executive agents

- **CEO** — objective, priority, scope, opportunity cost, kill/ship.
- **CFO** — economics, budget, ROI, funding, unit economics, downside.
- **COO** — sequence, owners, dependencies, operating constraints, delivery risk.
- **CIO** — architecture, data, security, reliability, integration boundaries.
- **CMO** — audience, positioning, UX promise, brand, acquisition, communication.
- **CRO** — pricing, funnel, conversion, revenue model, sales path.

## Runtime

Use `runtime/executive-team.json`.

Lifecycle:

`DORMANT → ACTIVATED → WORKING → HANDOFF/REVIEW → COMPLETE`

A blocked agent may route a bounded handoff rather than inventing missing competence or evidence.

## Routing workflow

1. Restate the decision in one sentence.
2. Identify which executive decision rights can materially change the answer.
3. Activate the smallest sufficient set of agents; default maximum is three.
4. Load each activated agent's default skill pack plus task-specific skills only when necessary.
5. Give all activated agents the same verified evidence ledger and explicit assumptions.
6. Run independent work in parallel only when dependencies do not overlap.
7. Use structured handoffs for unresolved domain questions.
8. Resolve conflicts by explicit decision rights, evidence and constraints — never majority voting.
9. CEO owns the final integrated decision for cross-functional strategy/ship questions.
10. Return `PASS`, `CONDITIONAL`, or `BLOCKED` with the next action.

## Handoff envelope

Every executive handoff must carry:

- task;
- decision context;
- verified evidence;
- assumptions;
- constraints;
- current state;
- open questions;
- requested decision;
- deadline or trigger when relevant.

## Output contract

Return:

- decision;
- activated agents;
- decisive evidence;
- assumptions;
- key trade-offs;
- unresolved risks;
- kill criteria;
- next action;
- status.

## Guardrails

- Never activate all six by default.
- Never create fictional dialogue, personality theatre or majority voting.
- Do not duplicate the same research across agents; share the evidence ledger.
- An agent may not exceed its decision rights merely because its prose sounds confident.
- If evidence is missing, route to Research & Truth.
- If a gate fails, route to Repair/Validation instead of approving by consensus.
