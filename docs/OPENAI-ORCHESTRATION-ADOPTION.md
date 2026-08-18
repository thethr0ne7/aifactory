# OpenAI orchestration pattern adoption

Status: **selective pattern adoption**. This is not a platform rewrite and does not make any external repository part of the Factory Root of Trust.

## Adopted now

### Repo-owned workflow contract

`WORKFLOW.md` and `registry/workflow-contract.json` make orchestration policy versioned with the Factory repository. The pattern is adapted from the separation of policy, coordination, execution, integration and observability described by OpenAI Symphony.

### Bounded agent execution

The existing Executive Router remains authoritative. The adoption reinforces explicit agents, tools, guardrails, bounded handoffs and observable runs rather than introducing a new multi-agent framework or swarm.

### Deterministic Truth Gate

`runtime/truth-gate.mjs` is the executable regression mirror. Supabase `af_apply_runtime_truth_gate` is the persistence-time enforcement point. It guarantees that terminal state and terminal result are written consistently.

Current hard rules:

- a Telegram author must be in `activated_agents`;
- at most six valid Telegram posts survive terminal normalization;
- invalid posts are dropped rather than relabeled;
- `COMPLETE` plus unresolved `BLOCKER` evidence becomes `BLOCKED`;
- the task, run and terminal event receive the same gated status/result.

### Evaluation before promotion

The gate has deterministic Node regression tests and is added to PR validation and autonomous-worker preflight. The rule is intentionally narrow: deterministic checks precede any future model-graded evaluation.

## Supabase enforcement

- `20260818_281_telegram_agent_truth_guard.sql`: defense-in-depth author trigger already present on `main`.
- `20260818_282_runtime_truth_gate.sql`: terminal transaction gate and `af_finish_task` integration.

The new SECURITY DEFINER gate functions are restricted to `service_role` and are not executable by `anon` or `authenticated`.

## Explicit non-goals for this phase

- no new long-lived orchestration service;
- no unbounded agent concurrency;
- no direct SDK dependency on OpenAI Agents SDK in the hosted worker;
- no MCP server added merely for architectural symmetry;
- no Apps SDK control panel until the underlying run/evidence contracts prove stable;
- no autonomous merge to `main`.

## Promotion sequence

1. Validate branch contracts and deterministic tests.
2. Review Draft PR and CI evidence.
3. Merge only after gates pass.
4. Observe live Telegram and general Factory runs for truth-gate repairs/blocks.
5. Only then consider the next layer: connector/MCP normalization and Factory HQ widgets.

Source provenance is recorded in `registry/upstreams/openai-orchestration-patterns.json` as `PATTERN`, not `POLICY` or `INVARIANT`.
