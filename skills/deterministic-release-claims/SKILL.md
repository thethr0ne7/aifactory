# Deterministic Release Claims

## Purpose

Ensure release notes and ship statements describe only behavior that was actually changed and verified.

## Activate when

Preparing a release, PR summary, deployment status, audit result or statement such as “fixed”, “works”, “production-ready” or “passed”.

## Workflow

1. Map each claim to a concrete diff/config/data change.
2. Map each behavioral claim to a verification result.
3. Separate static inspection, automated test, preview validation and production validation.
4. Downgrade unverified claims to precise conditional language.
5. List known unverified surfaces and remaining blockers.

## Guardrails

- “Build passes” does not prove runtime behavior.
- “Preview works” does not prove production migration or transport E2E.
- Never call a task complete while critical verification remains pending.
- Release prose must not outrun evidence.
