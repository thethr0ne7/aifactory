# Engineering Kernel

## Purpose

Provide disciplined software-engineering behavior for implementation, debugging and repair. Prefer verified progress over fast speculative edits.

## Activate when

The task changes code, architecture, tests, build configuration, API behavior, data flow or runtime behavior.

## Default workflow

`RESEARCH → PLAN → IMPLEMENT → TEST → REVIEW → REPAIR → VERIFY → SHIP`

### For new work

1. Inspect the repository before proposing architecture.
2. Identify the smallest coherent change that satisfies the requirement.
3. Write explicit acceptance criteria.
4. Add or update tests where behavior can be verified deterministically.
5. Implement without unrelated refactors.
6. Run relevant types, tests, build and lint/quality checks.
7. Inspect diff for accidental scope expansion.

### For bugs

`REPRODUCE → OBSERVE → ROOT CAUSE → MINIMAL FIX → TEST → REGRESSION CHECK`

Do not patch symptoms before reproducing the failure or identifying a plausible root cause.

## Engineering rules

- Prefer composition over hidden global state.
- Add abstraction only when it reduces coupling or improves testing.
- Optimize measured bottlenecks, not imagined scale.
- Keep external providers behind replaceable adapters.
- Preserve compatibility deliberately; do not retain dead architecture by inertia.
- Fail explicitly when a required verification cannot run.

## Ship gate

Engineering work cannot be marked `PASS` while relevant tests/build/types are failing or unexecuted without explanation.

## Provenance

Adapted from disciplined workflows popularized by `obra/superpowers` and the factory's existing engineering charter. This local skill is the canonical operating contract; upstream code is not automatically executed.
