# Skill Foundry

## Purpose

Create, adapt, evaluate and approve reusable agent skills without turning the factory into an uncontrolled prompt collection.

## Activate when

- a new external skill/repository is proposed;
- a repeated workflow should become reusable;
- an existing skill triggers poorly or produces inconsistent output;
- two skills overlap and need consolidation.

## Lifecycle

`DISCOVER → INSPECT → LICENSE/SECURITY → EXTRACT → NORMALIZE → EVAL → COMPARE → APPROVE → REGISTRY`

## Required skill contract

Every accepted skill must define:

1. purpose;
2. activation conditions;
3. non-activation conditions where ambiguity is likely;
4. inputs;
5. workflow;
6. outputs;
7. quality gates;
8. failure/kill criteria;
9. permissions/external dependencies;
10. provenance.

## Evaluation

Create representative positive, negative and edge-case tasks. Compare the candidate against the current factory baseline on correctness, evidence fidelity, task completion, context cost, latency/complexity and failure behavior.

Approve only if the skill adds measurable capability or materially improves reliability. Merge or reject duplicate skills that merely restate existing instructions.

## Security handoff

Any skill that requests installers, hooks, shell commands, network listeners, browser automation, MCP servers, secrets or broad filesystem access must pass `third-party-security` before executable adoption.

## Registry states

- `core` — first-party canonical capability.
- `core-adapted` — local capability derived from upstream patterns.
- `core-selective` — trusted but only loaded for matching tasks.
- `controlled` — useful, but executable integration requires strict boundaries.
- `pattern-only` — conceptual donor; no executable trust.
- `idea-extract` — architecture idea only.

## Provenance

Adapted from skill-creation/evaluation patterns in `anthropics/skills` skill-creator, with factory-specific security and routing constraints.
