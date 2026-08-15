# AI Factory 2.4 — Autonomous Runtime

## Goal

A run must continue without an open ChatGPT session or the user's laptop. The runtime owns durable state, routing, bounded execution, validation, repair, incident capture and learning.

## Architecture

```text
QUEUE
  -> DISPATCHER
  -> EXECUTIVE ROUTER
  -> AGENT + SELECTED SKILLS
  -> EXECUTION
  -> EVIDENCE / ROOT-OF-TRUST / SECURITY / QUALITY GATES
      -> PASS -> SHIP -> TELEMETRY
      -> FAIL -> INCIDENT -> ROOT CAUSE -> REPAIR
                                -> NEGATIVE ACTION
                                -> REGRESSION EVAL
                                -> LESSON / PATCH CANDIDATE
                                -> BASELINE COMPARISON
                                -> PROMOTE | REJECT
```

## Durable state

Reference storage is PostgreSQL/Supabase using `infra/supabase/migrations/20260815_240_autonomous_runtime.sql`.

Required stores:

- `factory_runs` — run objective, state, active agents, selected skills, heartbeat and terminal result;
- `factory_tasks` — independently claimable units with retry/lock budgets;
- `factory_events` — append-oriented black-box event ledger;
- `factory_checkpoints` — resumable state snapshots;
- `factory_incidents` — consequential failures and root-cause records;
- `factory_lessons` — candidate/promoted/rejected learning records;
- `factory_negative_action_observations` — matches against the negative-action registry.

Runtime state must never depend only on process memory or chat history.

## Dispatcher and workers

The dispatcher uses the single Executive/Capability Router already present in the factory. It selects only materially relevant executive agents and skills. Default target is 2–5 skills and at most three executive agents.

A worker must:

1. atomically claim one task;
2. reconstruct context from durable state;
3. load the relevant agent/skill contracts plus Root of Trust and negative actions when the task can cause side effects;
4. execute one bounded unit;
5. persist evidence/events/checkpoint;
6. run gates;
7. update heartbeat;
8. complete, repair, block, or fail explicitly.

The model/tool provider is an external adapter. Credentials belong in hosted runtime secrets, never the repository.

## Incident and learning loop

Every meaningful failure follows:

`OBSERVE -> CLASSIFY -> ROOT_CAUSE -> LESSON_CANDIDATE -> GENERALIZE -> REGRESSION_EVAL -> PATCH_CANDIDATE -> COMPARE -> PROMOTE | REJECT`

The factory may learn by changing ordinary skills, routing heuristics, evals and workflows within its autonomy ceiling. It may not directly rewrite Root of Trust, catastrophic controls, security authority or its own autonomy ceiling.

## Negative actions

`registry/negative-actions.json` is the machine-readable list of behavior the factory must avoid or block.

Severity:

- `UNDESIRABLE` — discouraged weak practice;
- `FORBIDDEN` — blocked except through an explicitly defined exception path;
- `CATASTROPHIC` — hard block due to irreversible loss, security/evidence compromise or Root-of-Trust risk.

Failures may propose new negative actions. Promotion must follow `registry/learning-policy.json`.

## Constitution / Root of Trust

`registry/factory-constitution.json` is above ordinary runtime self-modification. Runtime agents may read it and may prepare a change proposal, but the operation blocked by a rule cannot also approve removal of that rule.

## Autonomy

`registry/autonomy-levels.json` defines A0–A7. The default is A3 (safe repair). A4 permits automatic promotion only for low-risk, reversible improvements that pass required evals. A6 permits constitutional proposals, not self-approval.

## Watchdog

The watchdog should run on hosted infrastructure and detect:

- stale run heartbeats;
- abandoned task locks;
- exhausted retry budgets;
- runs stuck in non-terminal states;
- missing telemetry after a claimed task.

Safe recovery may requeue a task only when retry budget remains and the action is reversible. Otherwise mark `BLOCKED`/`FAILED` and emit an incident.

## What makes 2.4 actually autonomous

Repository contracts alone are not enough. Device-independent execution is `CONFIRMED` only after all of these exist in a hosted environment:

1. the durable database migration is applied;
2. a hosted worker/dispatcher is deployed;
3. model/tool provider credentials are configured as secrets;
4. watchdog/scheduler is enabled;
5. one end-to-end run proves: queue -> route -> execute -> checkpoint -> gate -> terminal state;
6. one injected failure proves: incident -> repair/blocked -> lesson/eval candidate;
7. the same failure is not repeated after an approved learning change.

Until those conditions are measured, the repository contains the autonomous-runtime implementation contract and reference persistence layer, not proof of continuous autonomous operation.
