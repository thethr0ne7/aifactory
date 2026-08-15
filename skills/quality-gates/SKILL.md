# Evaluation / Quality Gates

## Purpose

Convert subjective confidence into explicit, testable release conditions.

## Activate when

Any non-trivial artifact, code change, research conclusion, design, document transformation or integration is ready for review.

## Workflow

1. Load acceptance criteria from Spec Lock or task definition.
2. Choose only relevant gates: correctness, evidence, legal, financial, methodical, security, tests/build/types, data integrity, UX/mobile, accessibility, performance, visual fidelity, provenance.
3. Evaluate each gate independently.
4. Distinguish `PASS`, `CONDITIONAL`, `FAIL`, `NOT_VERIFIED`.
5. Aggregate to a ship decision without hiding failed gates behind an average score.
6. Route failures to Repair Loop and re-run the affected gates.

## Gate rule

A critical `FAIL` blocks shipment. `NOT_VERIFIED` is not equivalent to `PASS`.

## Guardrails

- Do not manufacture green status when a test/tool could not run.
- Evidence fidelity outranks prose quality.
- A polished output can still fail correctness or provenance.
- Scores may support comparison, but explicit blocker states control shipment.
