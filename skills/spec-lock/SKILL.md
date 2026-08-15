# Spec Lock

## Purpose

Turn an ambiguous request into a testable specification before non-trivial execution, without over-planning simple work.

## Activate when

The task has multiple interpretations, expensive rework risk, UI/layout constraints, data/legal requirements, destructive changes or production consequences.

## Workflow

1. Capture the requested outcome in one sentence.
2. Separate fixed requirements from preferences and assumptions.
3. Record explicit exclusions and non-goals.
4. Define acceptance criteria that can be checked after production.
5. Identify unresolved blockers; resolve them from available sources/tools before asking the user when possible.
6. Freeze the spec for the current execution phase.
7. If new evidence materially changes scope, reopen the spec explicitly instead of drifting silently.

## Output contract

- goal;
- required behavior/content;
- constraints;
- exclusions;
- acceptance criteria;
- unresolved blockers;
- verification plan.

## Guardrails

- Do not invent requirements.
- Do not silently relax a hard constraint to make implementation easier.
- Avoid turning ordinary low-risk edits into heavyweight specification documents.
