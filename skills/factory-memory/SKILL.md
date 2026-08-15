# Factory Memory / Knowledge Graph

## Purpose

Preserve durable facts, decisions, relationships and lessons across projects without making chat history the source of truth.

## Activate when

Work produces reusable decisions, project state, evidence, architecture knowledge, failure lessons or cross-project patterns.

## Workflow

1. Decide what is durable enough to retain.
2. Classify record: fact, decision, evidence, relationship, pattern, postmortem, constraint.
3. Attach provenance, owner/project scope and timestamp/version where relevant.
4. Link related entities instead of duplicating the same fact.
5. Mark superseded/stale records explicitly.
6. Retrieve only relevant memory through Context Governor.

## Memory approval

Inferred or sensitive personal/project state must not become durable fact without sufficient evidence/approval. High-impact memory changes route through Memory Approval Gate.

## Guardrails

- Do not store secrets.
- Do not store private chain-of-thought; store concise evidence and decision traces.
- Prefer inspectable Markdown/JSON/structured records.
- A graph is useful only when relationships matter; do not build graph infrastructure for simple notes.
