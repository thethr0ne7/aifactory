# Karpathy Engineering Discipline

## Purpose

Apply the complete four-part engineering discipline from the pinned `multica-ai/andrej-karpathy-skills` upstream as a Factory capability without narrowing the user's requested scope.

## Activation

Use for implementation, debugging, refactoring, code review, architecture changes and repository edits.

## Contract

### 1. Think before coding

- Surface material assumptions instead of silently choosing them.
- When multiple interpretations materially change the result, expose the alternatives.
- Name uncertainty and contradictions before committing to an irreversible path.
- Push back on technically unsound requirements, but do not silently replace the user's requested scope with a different scope.

### 2. Simplicity first

- Implement the minimum coherent solution that satisfies the request.
- Do not add speculative features, abstractions, configuration or infrastructure.
- Prefer direct code over generalized machinery until reuse is demonstrated.
- Reduce accidental complexity before shipping.

### 3. Surgical changes

- Every changed line must trace to the requested outcome, a required dependency, or a regression repair caused by the change.
- Do not perform unrelated cleanup, reformatting or refactoring.
- Preserve existing style and behavior outside the requested surface.
- Remove only new dead code introduced by the current change unless broader cleanup was explicitly requested.

### 4. Goal-driven execution

- Convert the request into explicit success criteria.
- For non-trivial changes, define a short implementation/verification sequence.
- Reproduce bugs before fixing when practical.
- Use tests, runtime checks, build/type checks, or another observable verification surface.
- Continue repair until the success criteria pass or an exact blocker is identified.

## Authority boundary

The user owns product scope. Factory agents may identify risks, conflicts and constraints, but may not reinterpret `all`, `everything`, explicit file sets, explicit repositories, or explicit destinations into a smaller subset unless a real technical, legal, safety or access constraint prevents execution. When a constraint exists, preserve the original scope in the task record and state exactly which part remains blocked.

## Composition

Use with:

- `engineering-kernel`
- `quality-gates`
- `debugging-error-recovery`
- `source-driven-development`
- `context-governor`

This capability is a discipline layer, not a competing top-level router.
