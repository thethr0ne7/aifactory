# Architecture Review

## Purpose

Review a system architecture against actual product requirements, failure modes and operational constraints without rewarding unnecessary complexity.

## Activate when

A new architecture, major refactor, integration boundary, data flow or scaling/security decision is proposed.

## Workflow

1. Restate product/runtime requirements and non-goals.
2. Map components, data ownership, trust boundaries and critical flows.
3. Identify single points of failure, tight coupling, hidden state and ambiguous ownership.
4. Verify each major component has a concrete need.
5. Review security, observability, failure recovery and migration path.
6. Compare simpler alternatives.
7. Produce `KEEP`, `CHANGE`, `REMOVE`, `DEFER` decisions with evidence.

## Guardrails

- No DevOps empire for speculative scale.
- Distributed systems, queues, sharding, replicas and event buses require measured need.
- Architecture diagrams do not prove runtime behavior.
- Prefer replaceable adapters at external/provider boundaries.
