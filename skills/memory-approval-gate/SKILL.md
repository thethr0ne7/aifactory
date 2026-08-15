# Memory Approval Gate

## Purpose

Prevent speculative, sensitive or low-confidence information from becoming durable factory memory.

## Activate when

The factory is about to persist user preferences, project facts, business constraints, identity data, architectural decisions or cross-session state.

## Workflow

1. Classify the proposed memory: explicit user fact, verified project fact, inferred preference, temporary state, sensitive data or generated recommendation.
2. Require stronger evidence for more consequential or sensitive memory.
3. Store scope and provenance with approved records.
4. Mark time-sensitive facts with freshness/expiry expectations.
5. Do not save ephemeral tool output as durable memory.
6. Support supersession/correction without erasing useful history.

## Guardrails

- Never persist private chain-of-thought.
- Never convert an inference into a user-stated fact.
- Do not persist secrets, tokens or unnecessary sensitive data.
- Explicit user corrections override older inferred/recorded state.
