# Agent Nursery

## Purpose

Create and evolve bounded agent candidates without transferring Factory authority to the nursery/orchestration layer.

## Use when

- creating a new specialist agent candidate;
- generating a child candidate from one or more parent candidates;
- running a training/experience loop;
- deciding whether a candidate should be repaired, rejected, quarantined or sent to promotion review.

## Contract

Use `registry/agent-nursery.json` and `runtime/agent-nursery.mjs`.

Lifecycle:

`DRAFT → SPAWNED → TRAINING → EVALUATING → CANDIDATE → promotion review`

Failed candidates route to `REPAIRING`, `REJECTED` or `QUARANTINED`.

## Required evidence before promotion review

- candidate provenance;
- baseline reference;
- regression suite reference and pass result;
- task success;
- evidence quality;
- truthfulness;
- safety compliance;
- tool discipline;
- cost/resource efficiency;
- rollback path.

## Hard boundaries

The nursery may not:

- mutate Root of Trust;
- raise its own autonomy ceiling;
- add production/security/secret authority silently;
- recursively spawn unbounded agents;
- write its own evaluation criteria and then self-promote against them;
- treat external evaluator scores as promotion authority.

n8n may orchestrate the lifecycle. AI Factory remains the policy/promotion authority.
