# Agent Evaluation

## Purpose

Turn traces, experiments and evaluator outputs into bounded evidence for comparing agent candidates.

## Preferred external role

Opik may act as trace/experiment/evaluation infrastructure. It is not a policy authority and cannot promote agents.

Use `runtime/external-eval-adapters.mjs` to create transport-neutral envelopes before any provider-specific network adapter is configured.

## Evaluation loop

`candidate → task set → traces → metrics/judges → normalized Factory dimensions → baseline comparison → regression check → promotion assessment`

## Truth rules

- Preserve trace/evaluator provenance.
- Distinguish measured metrics from model judgments.
- A judge score is not automatically `MEASURED`.
- Missing baseline or regression evidence blocks promotion eligibility.
- Never collapse multiple dimensions into a single fitness number and use it as sole promotion authority.
- Negative-action and security gates remain outside the evaluator.

## Required dimensions

- task success;
- evidence quality;
- truthfulness;
- safety compliance;
- tool discipline;
- cost/resource efficiency.

Latency, robustness, user preference and domain accuracy are optional additional dimensions when evidence exists.
